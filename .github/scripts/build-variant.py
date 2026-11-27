#!/usr/bin/env python3
"""Bygg en bok-variant (md + pdf) fra kapitlene i public.book_chapter.

En variant er en ordnet liste underkapitler hentet fra bokas egen tekst.
Underkapitlene finnes i bokas .md (sidemarkørene «#### p. N»), og de samme
sidene løftes ut av bokas .pdf, slik at varianten leses som sin egen bok:

    b/<book>/<variant>/<variant>.md   og   b/<book>/<variant>/<variant>.pdf

Brukes av .github/workflows/build-variant.yml (workflow_dispatch book+variant),
som adm-siden dispatcher fra «Create»-knappen i book_variant-tabellen.
"""
import json, os, re, subprocess, sys, unicodedata

REPO = subprocess.check_output(['git', 'rev-parse', '--show-toplevel']).decode().strip()
BOOK_DIR = os.path.join(REPO, 'b')
DB_JS = 'https://aigap.no/db.js'  # SUPABASE-konfig hentes fra DEN deployed versjonen (som sync-books.py)
PAGE_RE = re.compile(r'^####\s+p\.\s*(\d+)\s*$')
HEAD_RE = re.compile(r'^(#{2,3})\s+(.*)$')
EDITIONS = ('NO_PREM', 'NO_FREE', 'EN_PREM', 'EN_FREE')  # tekstkilde, mest komplett først


def get(url, headers=None):
    if not url.startswith(('http://', 'https://')):
        with open(url, encoding='utf-8') as f:
            return f.read()
    cmd = ['curl', '-fsSL']
    for k, v in (headers or {}).items():
        cmd += ['-H', f'{k}: {v}']
    cmd.append(url)
    return subprocess.check_output(cmd).decode()


def gh(kind, msg):
    """GitHub Actions-annotasjon - vises som warning/error-badge på kjøringa."""
    if os.environ.get('GITHUB_ACTIONS'):
        print(f'::{kind}::{msg}')
    else:
        print(f'[{kind.upper()}] {msg}', file=sys.stderr)


def norm(s):
    """Sammenligningsnøkkel: NFC, rette fnutter, enkelt mellomrom, små bokstaver."""
    s = unicodedata.normalize('NFC', str(s or ''))
    for a, b in (('\u201c', '"'), ('\u201d', '"'), ('\u2018', "'"), ('\u2019', "'"), ('\u00a0', ' ')):
        s = s.replace(a, b)
    return re.sub(r'\s+', ' ', s).strip().casefold()


def book_md(book):
    """Bokas egen tekst: (linjer, sti) - premium norsk først, ellers de andre utgavene."""
    for ed in EDITIONS:
        p = os.path.join(BOOK_DIR, book, f'{book}_{ed}.md')
        if os.path.isfile(p):
            with open(p, encoding='utf-8') as f:
                return f.read().split('\n'), p
    return None, None


def page_groups(lines):
    """[(side, [linjer...])] i dokumentrekkefølge."""
    out = [(1, [])]
    for l in lines:
        m = PAGE_RE.match(l)
        if m:
            out.append((int(m.group(1)), []))
        else:
            out[-1][1].append(l)
    return out[1:]


def sub_spans(lines):
    """underkapittel (normalisert navn) -> (første side, siste side)."""
    out, evs, cur = {}, [], 1
    for i, l in enumerate(lines):
        m = PAGE_RE.match(l)
        if m:
            cur = int(m.group(1))
            continue
        h = HEAD_RE.match(l)
        if h:
            evs.append([i, h.group(1), cur, re.sub(r'\s*#+\s*$', '', h.group(2))])
    evs.append([len(lines), 'end', cur, ''])
    for k in range(len(evs) - 1):
        i, lvl, pg, name = evs[k]
        if lvl != '###':
            continue
        end, p = pg, pg
        for l in lines[i + 1:evs[k + 1][0]]:
            m = PAGE_RE.match(l)
            if m:
                p = int(m.group(1))
                continue
            if l.strip():
                end = p  # siste side med innhold før neste overskrift
        out.setdefault(norm(name), (pg, end))
    return out


def build(book, variant, url, key):
    hdrs = {'apikey': key, 'Authorization': f'Bearer {key}'}
    q = f'{url}/rest/v1/book_chapter?book=eq.{book}&variant=eq.{variant}&select=*&order=ord.asc'
    rows = json.loads(get(q, hdrs))
    if not rows:
        sys.exit(f'ingen book_chapter-rader for book={book!r} variant={variant!r}')

    lines, md_path = book_md(book)
    if lines is None:
        sys.exit(f'finner ikke {book}_<utgave>.md under b/{book}/')
    pdf_path = os.path.join(BOOK_DIR, book, f'{book}.pdf')
    if not os.path.isfile(pdf_path):
        sys.exit(f'finner ikke {pdf_path}')

    spans, groups = sub_spans(lines), {p: ls for p, ls in page_groups(lines)}
    sel, missing = [], []
    for r in rows:
        for sub in [s.strip() for s in (r.get('subchapters') or '').split('|') if s.strip()]:
            span = spans.get(norm(sub))
            if not span:
                missing.append(f'{r.get("mainchapter") or "?"} / {sub}')
                continue
            for p in range(span[0], span[1] + 1):
                if p not in sel:
                    sel.append(p)
    if not sel:
        sys.exit('ingen underkapitler kunne stedfestes i bokas md')

    out_dir = os.path.join(BOOK_DIR, book, variant)
    os.makedirs(out_dir, exist_ok=True)

    md = []
    for i, p in enumerate(sel, start=1):
        md.append(f'#### p. {i}')
        if i == 1:
            md.append(f'# {variant}')
        md += groups.get(p, [])
    md_file = os.path.join(out_dir, f'{variant}.md')
    with open(md_file, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(md).rstrip('\n') + '\n')

    import pymupdf  # PyMuPDF - samme bibliotek som sync-books.py
    src = pymupdf.open(pdf_path)
    out = pymupdf.open()
    for p in sel:
        out.insert_pdf(src, from_page=p - 1, to_page=p - 1)
    pdf_file = os.path.join(out_dir, f'{variant}.pdf')
    out.save(pdf_file, garbage=4, deflate=True)

    print(f'[{book}/{variant}] {len(sel)} sider -> {os.path.relpath(md_file, REPO)} + '
          f'{os.path.relpath(pdf_file, REPO)}  ({os.path.getsize(pdf_file) / 1048576:.2f} MB) '
          f'fra {os.path.basename(md_path)}')
    for m in missing:
        gh('warning', f'[{book}/{variant}] fant ikke underkapittelet i bokas md: {m}')
    return len(missing)


def main():
    if len(sys.argv) != 3:
        sys.exit('bruk: build-variant.py <book> <variant>')
    book, variant = sys.argv[1].strip(), sys.argv[2].strip()
    m = re.search(r'window\.SUPABASE=\{url:"([^"]+)",publishableKey:"([^"]+)"\}', get(DB_JS))
    if not m:
        sys.exit(f'kunne ikke lese SUPABASE-konfig fra {DB_JS}')
    build(book, variant, m.group(1), m.group(2))


if __name__ == '__main__':
    main()
