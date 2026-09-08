#!/usr/bin/env python3
"""_qr1Gen.py - write the small clean hole-0 `.qr1.png` for every QR code.

Each `.qr1.png` is a clean full QR (NO baked white centre, NO art) encoding
`https://aigap.no/<base>` — the homepage overlays the cover art on it later.
Borderless 1-bit at the smallest version that fits the payload (tiny file).

Usage (from i/):  python3 _qr1Gen.py
"""
import glob, io, os
import qrcode
from qrcode.constants import ERROR_CORRECT_M, ERROR_CORRECT_L
from PIL import Image

EC_M = ERROR_CORRECT_M
EC_L = ERROR_CORRECT_L

def matrix_of(content, version, ec):
    q = qrcode.QRCode(version=version, error_correction=ec, box_size=1, border=0)
    q.add_data(content)
    q.make(fit=False if version else True)
    return q.get_matrix()

def render(N, m):
    img = Image.new('1', (N, N), 1)          # 1 = white
    px = img.load()
    for y, row in enumerate(m):
        for x, v in enumerate(row):
            if v:
                px[x, y] = 0
    return img

for f in sorted(glob.glob('*.qr.png')):
    base = f[:-len('.qr.png')]
    # 1) smallest: a 21-module code using www at EC-L (short codes only)
    try:
        m = matrix_of('www.aigap.no/' + base, 1, EC_L)   # version 1 = 21 modules
        N = len(m)
        label = '21 www L'
    except Exception:
        # 2) otherwise the real https link at EC-M, smallest version that fits
        m = matrix_of('https://aigap.no/' + base, None, EC_M)
        N = len(m)
        label = '%d https M' % N
    img = render(N, m)
    o = base + '.qr1.png'
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    d = buf.getvalue()
    if os.path.exists(o) and open(o, 'rb').read() == d:
        continue
    open(o, 'wb').write(d)
    print(f'{f} -> {o} {N}x{N}px {len(d)} B ({label}, clean, hole 0)')
