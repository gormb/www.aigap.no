#!/usr/bin/env python3
"""qrgen.py - write the ONE png each `redir` row's `qr` token asks for.

Filename = the token, verbatim:   i/<id>.<token>.png     e.g. i/ldd.21Q9tu.png
Token    = <N><EC><hole>[t][u]    (schema i/u/qr.sql, picked in i/u/qrgallery.html)

    N     21 | 25 | 29      modules; 21 encodes the short www.aigap.no host
    EC    L | M | Q | H
    hole  0 | 3 | 5 | 7 | 9 | 11 | 13   centred white square kept free for the artwork
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
                                     token needs AND deletes every generated png
                                     no token needs (keeps <id>.png art and
                                     <id>.qr.png print codes)
    python3 i/u/qrgen.py <id> [...]   only these rows (no deleting)
    python3 i/u/qrgen.py --check      report only, write nothing
    python3 i/u/qrgen.py --no-prune   write, delete nothing

Requires: PIL, numpy, qrcode.
"""
import io, json, os, re, sys, urllib.request
import numpy as np
import qrcode
from PIL import Image
from qrcode.constants import (ERROR_CORRECT_L, ERROR_CORRECT_M,
                              ERROR_CORRECT_Q, ERROR_CORRECT_H)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'i')

PREFIX, WWW = 'https://aigap.no/', 'www.aigap.no/'
ECS = {'L': ERROR_CORRECT_L, 'M': ERROR_CORRECT_M,
       'Q': ERROR_CORRECT_Q, 'H': ERROR_CORRECT_H}
KEEP_AT = {21: (9,), 25: (13,), 29: (11, 13)}   # the holes that keep modules
KEYTOL, KEYSHR = 1, 0.20
TOK = re.compile(r'^(2[159][LMQH](?:[03579]|11|13))(t?)(u?)$')
OLD = (re.compile(r'^.+\.qr2[159][LMQH](?:[03579]|11|13)t?u?\.png$'),
       re.compile(r'^.+\.qr1\.png$'),
       re.compile(r'^qr2[159]i\d*\.png$'))
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


def build(i, tok):
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
        if hole in KEEP_AT[N]:
            for r in range(hole):
                for x in range(hole):
                    if keep(hole, r, x):
                        m[lo + r][lo + x] = o[lo + r][lo + x]
    b = io.BytesIO()
    Image.fromarray(~m).convert('1').save(b, format='PNG', optimize=True)
    return b.getvalue()


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
            d = build(i, tok)
        except Exception as e:
            w.append('%s: %s does not fit (%s) -> pick another size/EC in i/u/qrgallery.html'
                     % (i, tok, e))
            continue
        f = '%s.%s.png' % (i, tok)
        need.add(f)
        if tok[3] != '0' and not os.path.exists(os.path.join(OUT, i + '.png')):
            w.append('%s: art i/%s.png missing -> the hole stays white (add the art or use hole 0)'
                     % (i, i))
        p = os.path.join(OUT, f)
        if not os.path.exists(p) or open(p, 'rb').read() != d:
            new.append(f)
            if not chk:
                open(p, 'wb').write(d)
    gone = []
    if prune and not chk:
        for f in sorted(os.listdir(OUT)):
            if f in need or f in KEEP or f.endswith('.qr.png') or not any(p.match(f) for p in OLD):
                continue
            os.remove(os.path.join(OUT, f))
            gone.append(f)
    print('%d rows -> %d png %s, %d stale png %s, %d warnings'
          % (len(rs), len(new), 'to write' if chk else 'written',
             len(gone), 'deleted', len(w)))
    for f in gone[:5]:
        print('  deleted i/' + f + ('  (+%d more)' % (len(gone) - 5) if len(gone) > 5 else ''))
    for x in w:
        print('WARN', x)
    if w:
        print('WARN       fix the row in i/u/qrgallery.html, then: python3 i/u/qrgen.py <id>')
    if new or gone:
        print('now: git add i && git commit   (check the pngs in)')


if __name__ == '__main__':
    main(sys.argv[1:])
