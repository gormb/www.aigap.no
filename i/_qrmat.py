#!/usr/bin/env python3
"""_qrmat.py - generate every QR matrix combo per base.

Filename:  <base>.qr<N><EC><hole>.png
  N    = size in modules, one of {25, 29}
  EC   = error-correction level, one of {L, M, Q, H}
  hole = centred white-hole size in modules, one of {3, 5, 7, 9}
  e.g.  bgda.qr29Q9.png = https://aigap.no/bgda, 29x29, EC Q, 9-module hole

Combos that cannot fit the payload at that size+EC are skipped.
BORDERLESS NxN output (no quiet zone), like the reference qr1 files.

Usage: python3 _qrmat.py [outdir] [base...]   (default: i/, all *.qr.png bases)
"""
import glob, io, os, sys
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
    bases = argv[1:] if len(argv) > 1 else sorted(
        {os.path.basename(f)[:-len('.qr.png')] for f in glob.glob(os.path.join(HERE, '*.qr.png'))})
    total = 0
    for b in bases:
        for fname, data, N, ec, hole in combos_for(b):
            p = os.path.join(outdir, fname)
            if os.path.exists(p) and open(p, 'rb').read() == data:
                continue
            open(p, 'wb').write(data)
            total += 1
    print(f'{len(bases)} bases -> {total} files written under {outdir}')

if __name__ == '__main__':
    main(sys.argv[1:])
