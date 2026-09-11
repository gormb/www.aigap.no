#!/usr/bin/env python3
"""qrgen.py - generate every served QR *image* for the redir QR codes.

This is the single Python counterpart of `i/u/qr.html`: both use the SAME
size / EC / hole grid and the SAME file naming, so a matrix shown in the
browser can be written straight to disk (and vice versa).

Output, under i/:
    <base>.qr<N><EC><hole>.png   borderless NxN code, centred WHITE hole
                                 (no quiet zone -- the site adds it via CSS)
    <base>.qr1.png               clean, tiny, hole-0 code the site displays

    <N>    module count, one of {21, 25, 29}   (21 uses the short www. host)
    <EC>   error correction, one of {L, M, Q, H}
    <hole> centred white hole in modules, one of {0, 3, 5, 7, 9}
    e.g. bgda.qr29Q9.png = https://aigap.no/bgda, 29x29, EC Q, 9-module hole

`<base>.qr1.png` is the smallest code that fits: 21 modules with the www host
at EC-L when the id is short enough, else the https link at EC-M at its
natural minimum size.  Content is always https://aigap.no/<base>.

Usage:
    python3 i/u/qrgen.py [base ...]     # default: every qr/qra base in the DB
    python3 i/u/qrgen.py --no-combos    # only refresh the .qr1.png thumbnails
    python3 i/u/qrgen.py --no-qr1       # only refresh the matrix combos

Requires: Pillow, numpy, qrcode.
"""
import glob, io, json, os, re, sys, urllib.parse, urllib.request
import numpy as np
import qrcode
from PIL import Image
from qrcode.constants import (ERROR_CORRECT_L, ERROR_CORRECT_M,
                              ERROR_CORRECT_Q, ERROR_CORRECT_H)

HERE = os.path.dirname(os.path.abspath(__file__))        # i/u
ROOT = os.path.dirname(os.path.dirname(HERE))            # repo root
OUT = os.path.join(ROOT, 'i')                            # served images live here

PREFIX = 'https://aigap.no/'
WWW = 'www.aigap.no/'
ECS = {'L': ERROR_CORRECT_L, 'M': ERROR_CORRECT_M,
       'Q': ERROR_CORRECT_Q, 'H': ERROR_CORRECT_H}
SIZES = [21, 25, 29]
HOLES = [0, 3, 5, 7, 9]


def db_bases():
    """QR-code bases from the live Supabase `redir` table.

    Only ids ending in `qra` (current) or `qr` (legacy) are QR codes; the
    suffix is stripped: `bgdaqra` -> `bgda`.  Returns None if unreachable."""
    try:
        dbjs = open(os.path.join(ROOT, 'db.js'), encoding='utf8').read()
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
    """The encoded string: 21 modules use the shorter www. host, the rest https."""
    return (WWW if N == 21 else PREFIX) + base


def matrix(content, version, ec):
    """Module matrix; True = black.  version=None -> smallest that fits."""
    q = qrcode.QRCode(version=version, error_correction=ec, box_size=1, border=0)
    q.add_data(content)
    q.make(fit=version is None)
    return np.array(q.get_matrix(), dtype=bool)


def png_bytes(mask):
    """1-bit borderless PNG (black modules on white), like the served files."""
    buf = io.BytesIO()
    Image.fromarray(~mask).convert('1').save(buf, format='PNG', optimize=True)
    return buf.getvalue()


def combo_bytes(base, N, ec, hole):
    """Borderless NxN code with a centred white hole, or None if it can't fit."""
    try:
        mask = matrix(content_for(base, N), (N - 17) // 4, ec)
    except Exception:
        return None                          # payload too big for N at this EC
    lo = (N - hole) // 2
    mask[lo:lo + hole, lo:lo + hole] = False
    return png_bytes(mask)


def qr1_bytes(base):
    """Smallest clean hole-0 code the site displays (no art, no hole)."""
    for content, version, ec in ((WWW + base, 1, ERROR_CORRECT_L),
                                 (PREFIX + base, None, ERROR_CORRECT_M)):
        try:
            return png_bytes(matrix(content, version, ec))
        except Exception:
            continue
    return None


def write(path, data):
    """Write only when the bytes changed; return True if written."""
    if os.path.exists(path) and open(path, 'rb').read() == data:
        return False
    open(path, 'wb').write(data)
    return True


def main(argv):
    combos = '--no-combos' not in argv
    qr1 = '--no-qr1' not in argv
    bases = [a for a in argv if not a.startswith('-')]

    if not bases:
        bases = db_bases()
        if bases is None:
            bases = sorted({os.path.basename(f)[:-len('.qr.png')]
                            for f in glob.glob(os.path.join(OUT, '*.qr.png'))})
            src = 'local *.qr.png files'
        else:
            src = 'live redir table (qra/qr)'
    else:
        src = 'command line'

    os.makedirs(OUT, exist_ok=True)
    n_combos = n_qr1 = 0
    for b in bases:
        if combos:
            for N in SIZES:
                for ecname, ec in ECS.items():
                    for hole in HOLES:
                        data = combo_bytes(b, N, ec, hole)
                        if data is None:
                            continue             # can't fit -> skip
                        n_combos += write(
                            os.path.join(OUT, f'{b}.qr{N}{ecname}{hole}.png'), data)
        if qr1:
            data = qr1_bytes(b)
            if data:
                n_qr1 += write(os.path.join(OUT, f'{b}.qr1.png'), data)

    print(f'{len(bases)} bases ({src}) -> {n_combos} combos, {n_qr1} .qr1.png '
          f'written under {OUT}')


if __name__ == '__main__':
    main(sys.argv[1:])
