#!/usr/bin/env python3
"""_qrgen_b.py - per-code output (Option B):
    <base>.qr21.png  = RAW  at the code's natural minimum size (21 or 25)
    <base>.qr25i.png = 25x25 with a WHITE centre hole
Content = PREFIX + base, PREFIX default www.aigap.no/ (keep www). EC-L.
Run:  python3 _qrgen_b.py [base...]   (default: every *.qr.png stem in i/)
"""
import glob, io, os, sys
import numpy as np
import qrcode
from PIL import Image
from qrcode.constants import ERROR_CORRECT_L

HERE = os.path.dirname(os.path.abspath(__file__))
PREFIX = 'www.aigap.no/'
QUIET = 0            # no outer white border - pure NxN module code
WHITE_DIM = 25          # qr25i is forced to this size
WHITE_LO = 9            # centred white hole for N=25 -> modules 9..15 (7, centred)
WHITE_HI = 16           #  => file px 11..17 (14±3)

def matrix(content, N=None):
    q = qrcode.QRCode(version=None if N is None else (N - 17) // 4,
                      error_correction=ERROR_CORRECT_L, box_size=1, border=0)
    q.add_data(content); q.make(fit=N is None)
    return [list(map(int, row)) for row in q.get_matrix()]   # 1 = black

def blank_centre25(mat):
    n = len(mat)
    for r in range(WHITE_LO, WHITE_HI):
        for c in range(WHITE_LO, WHITE_HI):
            mat[r][c] = 0          # white

def to_png(mat, quiet=QUIET):
    a = np.array(mat, dtype=bool)          # True = black module
    if quiet:
        pad = np.zeros((a.shape[0] + 2 * quiet, a.shape[1] + 2 * quiet), dtype=bool)
        pad[quiet:quiet + a.shape[0], quiet:quiet + a.shape[1]] = a
        a = pad
    img = Image.fromarray(~a).convert('1') # black on white, 1-bit
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    return buf.getvalue()

def build(base, outdir=HERE):
    content = PREFIX + base
    # qr21: raw, natural min
    m21 = matrix(content)
    p21 = to_png(m21)
    f21 = os.path.join(outdir, base + '.qr21.png')
    # qr25i: force 25 + white centre
    m25 = matrix(content, N=WHITE_DIM)
    blank_centre25(m25)
    p25 = to_png(m25)
    f25 = os.path.join(outdir, base + '.qr25i.png')
    wrote = []
    if not (os.path.exists(f21) and open(f21, 'rb').read() == p21):
        open(f21, 'wb').write(p21); wrote.append(f21)
    if not (os.path.exists(f25) and open(f25, 'rb').read() == p25):
        open(f25, 'wb').write(p25); wrote.append(f25)
    return wrote, len(m21), p21, p25

def main(argv):
    bases = argv or sorted({os.path.basename(f)[:-len('.qr.png')]
                            for f in glob.glob(os.path.join(HERE, '*.qr.png'))})
    print(f'{len(bases)} codes, prefix {PREFIX!r}\n')
    for b in bases:
        wrote, N21, p21, p25 = build(b)
        print(f'{b:10s} qr21={N21}x{N21} raw {len(p21)}B | qr25i {WHITE_DIM}x{WHITE_DIM} white {len(p25)}B'
              + ('  NEW' if wrote else ''))

if __name__ == '__main__':
    main(sys.argv[1:])
