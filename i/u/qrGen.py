#!/usr/bin/env python3
"""qrgen.py - write the QR code each `redir` row's `qr` token asks for, twice.

Every code is written as a 1-bit GIF and an identical 1-bit PNG:

Filename = the token, verbatim, both extensions:
    i/<id>.<token>.gif    used by the pages
    i/<id>.<token>.png    same pixels, for comparing/eyeballing
                          e.g. i/ldd.21Q9tu.gif + i/ldd.21Q9tu.png
Token    = <N><EC><hole>[t][u]    (schema i/u/qr.sql, picked in i/u/qrgallery.html)

    N     21 | 25 | … | 53  modules (QR version 1..9); 21 encodes the short www.aigap.no host
    EC    L | M | Q | H
    hole  0 | 3 | … | N-1   centred white square kept free for the artwork
           (the big ones only survive on a transparent/keyed art)
    t     clear ONLY the modules the keyed art really covers -- the same rule
          i/u/qr.js uses, so the file and the browser tile agree; without t the
          whole square is cleared and the art covers it
    u     21x UPPERCASE host (Alphanumeric mode fits 21 modules where the
          lowercase Byte string does not)

The hole of each size that fits the artwork -- 9x9 on a 21x21 code, 13x13 on a
25x25 code, 11x11 and 13x13 on a 29x29 code -- keeps 9 of its modules (identical
set to keep() in i/u/qrmetrics.js) so the artwork never covers them.  Any other
hole is a plain square: nothing is kept.

    python3 i/u/qrgen.py             every present='qr' row: writes what the
                                     token needs (both formats) AND deletes every
                                     generated gif/png no token needs (keeps
                                     <id>.png art and <id>.qr.png print codes)
    python3 i/u/qrgen.py <id> [...]   only these rows (no deleting)
    python3 i/u/qrgen.py --check      report only, write nothing
    python3 i/u/qrgen.py --no-prune   write, delete nothing

All the hole-free codes are also packed into ONE flat sprite in the repo root: a
single row of 21x21 cells, one cell per song in m.md order, so a page can show a
song's code by stepping the background position by 21 (no index file, no per-id
files).  It is written twice -- m.gif (m.html steps through this one: 1-bit GIF,
2-entry colour table, hand-rolled LZW) and m.png (same pixels, for eyeballing).

Requires: PIL, numpy, qrcode.  optipng used if present.
"""
import io, json, os, re, shutil, subprocess, sys, tempfile, urllib.request

# Third-party deps: fail with the exact pip command instead of a bare traceback.
_gone = []
try:
    import numpy as np
except ModuleNotFoundError:
    np = None; _gone.append('numpy')
try:
    import qrcode
    from qrcode.constants import (ERROR_CORRECT_L, ERROR_CORRECT_M,
                                  ERROR_CORRECT_Q, ERROR_CORRECT_H)
except ModuleNotFoundError:
    qrcode = None; _gone.append('qrcode')
try:
    from PIL import Image
except ModuleNotFoundError:
    Image = None; _gone.append('pillow')
if _gone:
    sys.exit("qrgen.py: missing Python module(s): " + ', '.join(_gone) + "\n"
             "  install with:  python3 -m pip install " + ' '.join(_gone))

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'i')
OPT = shutil.which('optipng')

PREFIX, WWW = 'https://aigap.no/', 'www.aigap.no/'
ECS = {'L': ERROR_CORRECT_L, 'M': ERROR_CORRECT_M,
       'Q': ERROR_CORRECT_Q, 'H': ERROR_CORRECT_H}
KEEP_AT = {21: (9,), 25: (13,), 29: (11, 13)}   # the holes that keep modules
KEYTOL, KEYSHR = 1, 0.20
TOK = re.compile(r'^((?:2[159]|3[379]|4[159]|5[3])[LMQH]\d{1,2})(t?)(u?)$')
OLD = (re.compile(r'^.+\.qr2[159][LMQH](?:[03579]|11|13)t?u?\.(?:png|gif)$'),
       re.compile(r'^.+\.qr1\.(?:png|gif)$'),
       re.compile(r'^qr2[159]i\d*\.(?:png|gif)$'))
KEEP = set()


def keep(h, r, x):   # the 3 bars the artwork never covers (i/u/qrmetrics.js)
    return (x == 0 and (r < 3 or r >= h - 3)) or (x == h - 1 and r < 3)


def db():
    t = open(os.path.join(ROOT, 'db.js'), encoding='utf8').read()
    u, k = (re.search(p, t).group(1) for p in
            (r'url\s*:\s*"([^"]+)"', r'publishableKey\s*:\s*"([^"]+)"'))
    h = {'apikey': k, 'Authorization': 'Bearer ' + k}
    q = '/rest/v1/redir?select=id,qr,present&present=eq.qr&order=sort.asc,id.asc'
    return json.load(urllib.request.urlopen(urllib.request.Request(u + q, headers=h)))


def mat(s, N, ec):
    q = qrcode.QRCode(version=(N - 17) // 4, error_correction=ECS[ec], box_size=1, border=0)
    q.add_data(s)
    q.make(fit=False)
    return np.array(q.get_matrix(), dtype=bool)


def keyed(i):
    p = os.path.join(OUT, i + '.png')
    if not os.path.exists(p):
        return None
    a = np.asarray(Image.open(p).convert('RGBA'), dtype=np.uint8)
    op = a[:, :, 3] >= 128
    if not op.any():
        return np.zeros(op.shape, bool)
    c = ((a[:, :, 0].astype(np.int32) << 16) | (a[:, :, 1].astype(np.int32) << 8)
         | a[:, :, 2].astype(np.int32))
    v, n = np.unique(c[op], return_counts=True)
    k, best = int(v[n.argmax()]), int(n.max())
    if op.all() and best >= KEYSHR * op.size:
        d = ((np.abs(a[:, :, 0].astype(np.int32) - ((k >> 16) & 255)) <= KEYTOL)
             & (np.abs(a[:, :, 1].astype(np.int32) - ((k >> 8) & 255)) <= KEYTOL)
             & (np.abs(a[:, :, 2].astype(np.int32) - (k & 255)) <= KEYTOL))
        return ~(op & d)
    return op


def cov(i, h):
    a = keyed(i)
    if a is None:
        return np.zeros((h, h), bool)
    im = Image.fromarray(np.where(a, 255, 0).astype(np.uint8))
    w0, h0 = im.size
    r = min(h / w0, h / h0)
    w, hh = max(1, round(w0 * r)), max(1, round(h0 * r))
    box = Image.new('L', (h, h), 0)
    box.paste(im.resize((w, hh), Image.BILINEAR), ((h - w) // 2, (h - hh) // 2))
    return np.asarray(box) >= 128


def opt(d):
    if not OPT:
        return d
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
        f.write(d)
        p = f.name
    subprocess.run([OPT, '-o5', '-strip', 'all', '-quiet', p], check=True)
    v = open(p, 'rb').read()
    os.remove(p)
    return v


def _mat(i, tok):
    head, t, u = TOK.match(tok).groups()
    N, ec, hole = int(head[:2]), head[2], int(head[3:])
    s = (WWW if N == 21 else PREFIX) + i
    m = mat(s.upper() if u else s, N, ec)
    if hole:
        lo, o = (N - hole) // 2, m.copy()
        c = cov(i, hole) if t else np.ones((hole, hole), bool)
        for r in range(hole):
            for x in range(hole):
                if c[r, x]:
                    m[lo + r][lo + x] = False
        if hole in KEEP_AT.get(N, ()):
            for r in range(hole):
                for x in range(hole):
                    if keep(hole, r, x):
                        m[lo + r][lo + x] = o[lo + r][lo + x]
    return m


def png(m):
    b = io.BytesIO()
    Image.fromarray(~m).convert('1').save(b, format='PNG', optimize=True)
    return opt(b.getvalue())


def _lzw(px, n=2):
    clear, end = 1 << n, (1 << n) + 1
    out, buf, bits = bytearray(), 0, 0

    def emit(c, w):
        nonlocal buf, bits
        buf |= c << bits
        bits += w
        while bits >= 8:
            out.append(buf & 255)
            buf >>= 8
            bits -= 8

    size, table, nxt, prev = n + 1, {}, end + 1, None
    emit(clear, size)
    for k in px:
        if prev is None:
            prev = k
            continue
        if (prev, k) in table:
            prev = table[(prev, k)]
            continue
        emit(prev, size)
        if nxt < 4096:
            table[(prev, k)] = nxt
            if nxt >= (1 << size) and size < 12:
                size += 1
            nxt += 1
        else:
            emit(clear, size)
            table, nxt, size = {}, end + 1, n + 1
        prev = k
    if prev is not None:
        emit(prev, size)
    emit(end, size)
    if bits:
        out.append(buf & 255)
    return bytes(out)


def gif(m):
    """1-bit GIF: 2-entry global colour table (0 = module), no local table."""
    h, w = m.shape
    d = _lzw(np.where(m, 0, 1).astype(np.uint8).ravel().tolist())
    o = bytearray(b'GIF87a')
    o += w.to_bytes(2, 'little') + h.to_bytes(2, 'little') + b'\x80\x00\x00'
    o += b'\x00\x00\x00\xff\xff\xff'
    o += b',' + b'\x00\x00\x00\x00'
    o += w.to_bytes(2, 'little') + h.to_bytes(2, 'little') + b'\x00\x02'
    for i in range(0, len(d), 255):
        c = d[i:i + 255]
        o += bytes((len(c),)) + c
    o += b'\x00\x3b'
    return bytes(o)


def build(i, tok):
    m = _mat(i, tok)
    return png(m), gif(m)


def main(a):
    chk = '--check' in a
    ids = {x for x in a if not x.startswith('-')}
    prune = '--no-prune' not in a and not ids
    rs = [r for r in db() if not ids or r['id'] in ids]
    need, new, w = set(), [], []
    for r in rs:
        i, tok = r['id'], (r.get('qr') or '').strip()
        if not tok:
            w.append('%s: no qr token -> pick one in i/u/qrgallery.html' % i)
            continue
        if not TOK.match(tok):
            w.append('%s: token "%s" is not <N><EC><hole>[t][u] -> re-pick in i/u/qrgallery.html'
                     % (i, tok))
            continue
        try:
            pd, gd = build(i, tok)
        except Exception as e:
            w.append('%s: %s does not fit (%s) -> pick another size/EC in i/u/qrgallery.html'
                     % (i, tok, e))
            continue
        f, g = '%s.%s.png' % (i, tok), '%s.%s.gif' % (i, tok)
        need.update((f, g))
        if tok[3] != '0' and not os.path.exists(os.path.join(OUT, i + '.png')):
            w.append('%s: art i/%s.png missing -> the hole stays white (add the art or use hole 0)'
                     % (i, i))
        for n, d in ((f, pd), (g, gd)):
            p = os.path.join(OUT, n)
            if not os.path.exists(p) or open(p, 'rb').read() != d:
                new.append(n)
                if not chk:
                    open(p, 'wb').write(d)
    md = open(os.path.join(ROOT, 'm.md'), encoding='utf8').read()
    song = [u.rsplit('/', 1)[-1] for u in re.findall(r'^🎵 \[[^\]]*\]\(([^)]+)', md, re.M)]
    strip = np.zeros((21, max(1, len(song)) * 21), bool)
    for k, sid in enumerate(song):
        try:
            strip[:, k * 21:(k + 1) * 21] = mat('WWW.AIGAP.NO/' + sid.upper(), 21, 'M')
        except Exception:
            pass
    for name, data in (('m.gif', gif(strip)), ('m.png', png(strip))):
        p = os.path.join(ROOT, name)
        if not os.path.exists(p) or open(p, 'rb').read() != data:
            new.append(name)
            if not chk:
                open(p, 'wb').write(data)
    gone = []
    if prune and not chk:
        for f in sorted(os.listdir(OUT)):
            if f in need or f in KEEP or f.endswith('.qr.png') or not any(p.match(f) for p in OLD):
                continue
            os.remove(os.path.join(OUT, f))
            gone.append(f)
    print('%d rows -> %d file %s (i/ gifs + pngs, m.gif + m.png), %d stale png %s, %d warnings'
          % (len(rs), len(new), 'to write' if chk else 'written',
             len(gone), 'deleted', len(w)))
    for f in gone[:5]:
        print('  deleted i/' + f + ('  (+%d more)' % (len(gone) - 5) if len(gone) > 5 else ''))
    for x in w:
        print('WARN', x)
    if w:
        print('WARN       fix the row in i/u/qrgallery.html, then: python3 i/u/qrgen.py <id>')
    if new or gone:
        print('now: git add i q && git commit   (check the pngs in)')


if __name__ == '__main__':
    main(sys.argv[1:])
