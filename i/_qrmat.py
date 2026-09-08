#!/usr/bin/env python3
"""_qrmat.py - generate every QR matrix combo per base.

Filename:  <base>.qr<N><EC><hole>.png
  N    = size in modules, one of {25, 29}
  EC   = error-correction level, one of {L, M, Q, H}
  hole = centred white-hole size in modules, one of {3, 5, 7, 9}
  e.g.  bgda.qr29Q9.png = https://aigap.no/bgda, 29x29, EC Q, 9-module hole

Combos that cannot fit the payload at that size+EC are skipped.
BORDERLESS NxN output (no quiet zone), like the reference qr1 files.

Usage: python3 _qrmat.py [outdir] [base...]
  (default outdir: i/; default bases: the QR codes in the Supabase redir table
   -- rows whose id ends in `qra` (current) or `qr` (legacy), suffix stripped --
   with a fallback to local *.qr.png file bases if the DB can't be reached)
"""
import glob, io, json, os, re, sys, urllib.parse, urllib.request
import numpy as np
import qrcode
from PIL import Image
from qrcode.constants import ERROR_CORRECT_L, ERROR_CORRECT_M, ERROR_CORRECT_Q, ERROR_CORRECT_H

HERE = os.path.dirname(os.path.abspath(__file__))
PREFIX = 'https://aigap.no/'
WWW = 'www.aigap.no/'
ECS = {'L': ERROR_CORRECT_L, 'M': ERROR_CORRECT_M,
       'Q': ERROR_CORRECT_Q, 'H': ERROR_CORRECT_H}
SIZES = [21, 25, 29]        # 21 uses the shorter www prefix
HOLES = [3, 5, 7, 9]


def db_bases():
    """Return the QR-code bases from the live Supabase `redir` table.
    Only ids ending in `qra` or `qr` are QR codes; the suffix is stripped so
    `bgdaqra` -> `bgda`.  Returns None if the DB can't be reached."""
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        root = os.path.dirname(here)
        dbjs = open(os.path.join(root, 'db.js'), encoding='utf8').read()
        url = re.search(r'url\s*:\s*"([^"]+)"', dbjs).group(1)
        key = re.search(r'publishableKey\s*:\s*"([^"]+)"', dbjs).group(1)
        if 'YOUR-' in url:
            return None
        hdr = {'apikey': key, 'Authorization': 'Bearer ' + key}
        u = url + '/rest/v1/redir?' + urllib.parse.urlencode({'select': 'id'})
        rows = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=hdr)))
        out = set()
        for r in rows:
            i = r.get('id')
            if not isinstance(i, str):
                continue
            if i.endswith('qra'):
                out.add(i[:-3])
            elif i.endswith('qr'):
                out.add(i[:-2])
        return sorted(out)
    except Exception:
        return None


def content_for(base, N):
    return (WWW if N == 21 else PREFIX) + base

def blank_centred_hole(mask, N, hole):
    """Set a centred white hole of `hole` modules. N and hole are odd here."""
    lo = (N - hole) // 2
    mask[lo:lo + hole, lo:lo + hole] = False
    return mask

def build(content, N, ec, hole):
    """Return PNG bytes for a borderless NxN code with a centred white hole.
    Returns None if the payload does not fit N at this EC."""
    q = qrcode.QRCode(version=(N - 17) // 4, error_correction=ec, box_size=1, border=0)
    q.add_data(content)
    try:
        q.make(fit=False)
    except Exception:
        return None
    mask = np.array(q.get_matrix(), dtype=bool)      # True = black
    mask = blank_centred_hole(mask, N, hole)
    img = Image.fromarray(~mask).convert('1')
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    return buf.getvalue()

def combos_for(base):
    out = []
    for N in SIZES:
        content = content_for(base, N)
        for ecname, ec in ECS.items():
            for hole in HOLES:
                data = build(content, N, ec, hole)
                if data is None:
                    continue                      # can't fit -> skip
                out.append((f'{base}.qr{N}{ecname}{hole}.png', data, N, ecname, hole))
    return out

def main(argv):
    outdir = argv[0] if argv else HERE
    os.makedirs(outdir, exist_ok=True)
    if len(argv) > 1:
        bases = argv[1:]
    else:
        bases = db_bases()
        if bases is None:
            # DB unreachable -> fall back to the local *.qr.png file bases
            bases = sorted({os.path.basename(f)[:-len('.qr.png')]
                            for f in glob.glob(os.path.join(HERE, '*.qr.png'))})
            src = 'local *.qr.png files'
        else:
            src = 'live redir table (qra/qr)'
    total = 0
    for b in bases:
        for fname, data, N, ec, hole in combos_for(b):
            p = os.path.join(outdir, fname)
            if os.path.exists(p) and open(p, 'rb').read() == data:
                continue
            open(p, 'wb').write(data)
            total += 1
    print(f'{len(bases)} bases ({src}) -> {total} files written under {outdir}')

if __name__ == '__main__':
    main(sys.argv[1:])
