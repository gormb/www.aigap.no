#!/usr/bin/env python3
"""Re-derive public.redir.sort for the m* music rows from the page numbers in m.md.

Run after m.md is updated:  python3 i/u/qrbook_updID.py
"""
import json, os, re, urllib.request
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))   # i/u
ROOT = os.path.dirname(os.path.dirname(HERE))        # repo root
BASE = Decimal('5.5')                # sort 5.5<page> = music placed on a book page
STEP = Decimal('0.0001')             # 5.5 + page/10000  =>  5.5003 = p. 3)
TOP = BASE + STEP * 10000

def conf():
    t = open(os.path.join(ROOT, 'db.js'), encoding='utf8').read()
    return (re.search(r'url\s*:\s*"([^"]+)"', t).group(1),
            re.search(r'publishableKey\s*:\s*"([^"]+)"', t).group(1))

def pages():
    r = {}
    for l in open(os.path.join(ROOT, 'm.md'), encoding='utf8'):
        if '\U0001F3B5' not in l:
            continue
        m, p = re.search(r'aigap\.no/([a-z0-9]+)', l), re.search(r'p\.\s*(\d+(?:[.,]\d+)?)\s*$', l)
        if not (m and p):
            print('%-9s unparsed: %s' % ('?', l.strip()))
            continue
        i = m.group(1)
        if i in r:
            print('%-9s twice in m.md (p.%s, p.%s) - first kept' % (i, r[i], p.group(1)))
            continue
        r[i] = Decimal(p.group(1).replace(',', '.'))
    return r

def rows(u, k):
    h = {'apikey': k, 'Authorization': 'Bearer ' + k}
    q = '/rest/v1/redir?select=id,sort&id=like.m*&order=sort.asc,id.asc'
    return json.load(urllib.request.urlopen(urllib.request.Request(u + q, headers=h)))

def put(u, k, i, v):
    h = {'apikey': k, 'Authorization': 'Bearer ' + k,
         'Content-Type': 'application/json', 'Prefer': 'return=minimal'}
    urllib.request.urlopen(urllib.request.Request(
        u + '/rest/v1/redir?id=eq.' + i, data=json.dumps({'sort': str(v)}).encode(),
        headers=h, method='PATCH')).read()

def main():
    u, k = conf()
    pg = pages()
    rs, seen, n = rows(u, k), set(), 0
    for x in rs:
        i, old = x['id'], x['sort']
        seen.add(i)
        if old is None or i not in pg:
            print('%-9s kept %s (no page in m.md)' % (i, old))
            continue
        old = Decimal(str(old))
        if not (BASE <= old < TOP):
            print('%-9s kept %s (not page-keyed)' % (i, old))
            continue
        new = BASE + pg[i] * STEP
        if new == old:
            print('%-9s p.%s %s ok' % (i, pg[i], old))
            continue
        put(u, k, i, new)
        n += 1
        print('%-9s p.%s %s -> %s' % (i, pg[i], old, new))
    for i in sorted(set(pg) - seen):
        print('%-9s p.%s in m.md but no redir row - skipped' % (i, pg[i]))
    print('%d of %d m* rows updated' % (n, len(rs)))

if __name__ == '__main__':
    main()
