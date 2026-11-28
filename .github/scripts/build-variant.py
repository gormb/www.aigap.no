#!/usr/bin/env python3
"""Bygg en bok-variant: forside + én kapittelside per kapittel + de fire utgavene.

En variant er en ordnet liste kapitler hentet fra bokas egen tekst. Hvert kapittel
får malens kapittelside foran sine underkapitler, og boka får malens forside:

    b/<book>/<variant>/<variant>.pdf              spredningen leseren åpner
    b/<book>/<variant>/<variant>_<lg>_<ed>.pdf    de fire utgavene (halvside, tier-filtrert)
    b/<book>/<variant>/<variant>_<lg>_<ed>.md     de fire sidecarene

Forside og kapittelside lages av bokas EGEN mal – de siste fire sidene i dekket
(forside, kapittel, underkapittel, tekst). Malen er merket med et rødt krysstrek og
Arial-oppskrifter; begge fjernes. De innebygde fontene er cmap-løse subset og kan ikke
gjenbrukes, så ny tekst settes i Playfair Display (SC for titler).

De fire utgavene og sidecarene skrives av sync-books.py::extract(), slik at en variant
får nøyaktig samme fasong som en vanlig bok. Mal-blokken legges bakerst i spredningen,
for det er der sync-books.py leter etter den.

Brukes av .github/workflows/build-variant.yml (workflow_dispatch book+variant).
"""
import importlib.util, json, os, re, subprocess, sys, tempfile, unicodedata

import pymupdf  # PyMuPDF - samme bibliotek som sync-books.py

REPO = subprocess.check_output(['git', 'rev-parse', '--show-toplevel']).decode().strip()
BOOK_DIR = os.path.join(REPO, 'b')
SCRIPTS = os.path.join(REPO, '.github', 'scripts')
DB_JS = 'https://aigap.no/db.js'  # SUPABASE-konfig hentes fra DEN deployed versjonen (som sync-books.py)
PAGE_RE = re.compile(r'^####\s+p\.\s*(\d+)\s*$')
HEAD_RE = re.compile(r'^(#{2,3})\s+(.*)$')
EDITIONS = ('NO_PREM', 'NO_FREE', 'EN_PREM', 'EN_FREE')  # tekstkilde, mest komplett først

_GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl'
FONT_URL = {
    'sc':  f'{_GF}/playfairdisplaysc/PlayfairDisplaySC-Regular.ttf',
    'sci': f'{_GF}/playfairdisplaysc/PlayfairDisplaySC-Italic.ttf',
    'pd':  f'{_GF}/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf',
    'pdi': f'{_GF}/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf',
}
HALF = 148.8        # midten av venstre halvside (norsk)
HALF_EN = 446.5     # midten av høyre halvside (engelsk)
MAXW = 257.0        # brukbar bredde i en halvside
LEAD = 1.12         # linjeavstand i en flerlinjet tittel


# --------------------------------------------------------------------------- felles
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


def chapter_parts(main):
    """mainchapter = «NO tittel|NO undertittel|EN tittel|EN undertittel» (engelsk valgfritt)."""
    p = [x.strip() for x in str(main or '').split('|')]
    p += [''] * (4 - len(p))
    return p[0], p[1], p[2], p[3]


# --------------------------------------------------------------------------- malen
def sync_books():
    """Last sync-books.py (inneholder extract() som skriver de fire utgavene)."""
    spec = importlib.util.spec_from_file_location('sync_books', os.path.join(SCRIPTS, 'sync-books.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def fonts():
    """Playfair Display fra Google Fonts (OFL) - caches i temp, committes ikke."""
    d = os.path.join(tempfile.gettempdir(), 'aigap-fonts')
    os.makedirs(d, exist_ok=True)
    out = {}
    for k, u in FONT_URL.items():
        p = os.path.join(d, k + '.ttf')
        if not os.path.isfile(p) or os.path.getsize(p) < 1024:
            try:
                subprocess.run(['curl', '-fsSL', u, '-o', p], check=True)
            except subprocess.CalledProcessError as e:
                sys.exit(f'kunne ikke hente fonten {u}: {e}')
        out[k] = p
    return out


_RED = re.compile(r'1(?:\.0+)?\s+0(?:\.0+)?\s+0(?:\.0+)?\s+RG')


def strip_red(page):
    """Fjern malens røde krysstrek (to strøk) fra innholdsstrømmen.

    Strøket er tegnet inline som «1 0 0 RG <sti> S», så det kan skjæres bort uten å
    røre resten av siden. q/Q beholdes - grafisk tilstand må forbli balansert."""
    doc, n = page.parent, 0
    for xref in page.get_contents():
        s = doc.xref_stream(xref).decode('latin-1')
        out, i = [], 0
        while True:
            m = _RED.search(s, i)
            if not m:
                out.append(s[i:])
                break
            j = s.find('\nS\n', m.end())
            if j < 0:
                out.append(s[i:])
                break
            out.append(s[i:m.start()])
            i = j + 3  # fra og med «S» og utover
            n += 1
        doc.update_stream(xref, ''.join(out).encode('latin-1'))
    return n


def drop_text(page, rects):
    """Fjern tekst uten å røre grafikken (Arial-oppskrifter og ubrukte plassholdere)."""
    if not rects:
        return 0
    for r in rects:
        page.add_redact_annot(r, fill=False)
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                          graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                          text=pymupdf.PDF_REDACT_TEXT_REMOVE)
    return len(rects)


def spans(page):
    """{renset tekst: span} - første forekomst vinner (malen kan ha like spans i flere fonter)."""
    out = {}
    for b in page.get_text('dict')['blocks']:
        if b['type'] != 0:
            continue
        for l in b['lines']:
            for s in l['spans']:
                t = s['text'].strip()
                if t:
                    out.setdefault(t, s)
    return out


def rects_lines(page, wanted=(), font=None):
    """Hele linja rundt en plassholder - malen kan ha tier-ord på samme linje.

    Nøkler matcher fra linjestart, så «Kapitteltittelen premiumfreemium» treffes av
    «Kapitteltittelen». `font` treffer linjer som inneholder en gitt fontfamilie
    (Arial = malens oppskrifter, aldri bokinnhold)."""
    out = []
    for b in page.get_text('dict')['blocks']:
        if b['type'] != 0:
            continue
        for l in b['lines']:
            sp = [s for s in l['spans'] if s['text'].strip()]
            if not sp:
                continue
            txt = ' '.join(s['text'].strip() for s in sp)
            hit = any(txt == w or txt.startswith(w) for w in wanted)
            if not hit and font:
                hit = any(font in s['font'].lower() for s in sp)
            if hit:
                out.append(pymupdf.Rect(l['bbox']))
    return out


def wrap(font, text, size, maxw):
    lines, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if cur and font.text_length(t, size) > maxw:
            lines.append(cur)
            cur = w
        else:
            cur = t
    if cur:
        lines.append(cur)
    return lines


def pick_font(name):
    """Plassholderens egen font avgjør hvilken Playfair-variant vi setter inn."""
    n = re.sub(r'[^a-z]', '', str(name or '').lower())
    kind = 'sc' if 'displaysc' in n else 'pd'   # SC = tittel-fonten, ellers beskrivelses-fonten
    return kind + ('i' if 'italic' in n else '')


def put_text(page, text, tmpl, cx, alias, font, down=False):
    """Skriv teksten sentrert om cx, med én linje på mal-plassholderens grunnlinje.

    Lang tekst brekkes over inntil to linjer (malen er laget for én) og krympes bare
    hvis den ikke får plass slik. `down` velger hvilken vei en andre linje vokser -
    forsiden har ledig plass nedover, kapittelsiden oppover."""
    if not text:
        return None
    size, lines = tmpl['size'], None
    while size > 6:
        lines = wrap(font, text, size, MAXW)
        if len(lines) <= 2:
            break
        size -= 0.25
    y, step, n = tmpl['origin'][1], size * LEAD, len(lines)
    for i, line in enumerate(lines):
        k = i if down else n - 1 - i  # k=0 ligger på grunnlinja
        w = font.text_length(line, size)
        page.insert_text((cx - w / 2, y + k * step if down else y - k * step), line,
                         fontname=alias, fontsize=size, color=(0, 0, 0))
    return size, lines


# --------------------------------------------------------------------------- bygget
def build(book, variant, url, key):
    hdrs = {'apikey': key, 'Authorization': f'Bearer {key}'}
    v = json.loads(get(f'{url}/rest/v1/book_variant?book=eq.{book}&variant=eq.{variant}&select=*', hdrs))
    title_no = (v[0].get('title_no') if v else '') or variant
    title_en = (v[0].get('title_en') if v else '') or ''
    rows = json.loads(get(f'{url}/rest/v1/book_chapter?book=eq.{book}&variant=eq.{variant}'
                          f'&select=*&order=ord.asc', hdrs))
    if not rows:
        sys.exit(f'ingen book_chapter-rader for book={book!r} variant={variant!r}')

    lines, md_path = book_md(book)
    if lines is None:
        sys.exit(f'finner ikke {book}_<utgave>.md under b/{book}/')
    pdf_path = os.path.join(BOOK_DIR, book, f'{book}.pdf')
    if not os.path.isfile(pdf_path):
        sys.exit(f'finner ikke {pdf_path}')

    by_sub, groups = sub_spans(lines), {p: ls for p, ls in page_groups(lines)}
    chaps, placed, missing = [], set(), []
    for r in rows:
        pages = []
        for sub in [s.strip() for s in (r.get('subchapters') or '').split('|') if s.strip()]:
            span = by_sub.get(norm(sub))
            if not span:
                missing.append(f'{r.get("mainchapter") or "?"} / {sub}')
                continue
            for p in range(span[0], span[1] + 1):
                if p not in placed:
                    placed.add(p)
                    pages.append(p)
        chaps.append((r.get('mainchapter') or '', pages))
    if not placed:
        sys.exit('ingen underkapitler kunne stedfestes i bokas md')

    sb = sync_books()
    try:
        sb.load_redir(url, hdrs)  # samme sangnavn som den vanlige bok-pipelinen
    except Exception as e:
        gh('warning', f'kunne ikke lese redir-tabellen: {e}')
    src = pymupdf.open(pdf_path)
    tpl = sb._template_start(src)  # 1-basert side der mal-blokken (siste fire) starter
    F = fonts()
    fm = {k: pymupdf.Font(fontfile=p) for k, p in F.items()}

    # 1) sett sammen spredningen: forside, så (kapittelside + kapittelets sider), så malen
    out = pymupdf.open()
    out.insert_pdf(src, from_page=tpl - 1, to_page=tpl - 1)
    cover_i = 0
    chap_i = []
    for main, pages in chaps:
        chap_i.append((out.page_count, main))
        out.insert_pdf(src, from_page=tpl, to_page=tpl)
        for p in pages:
            out.insert_pdf(src, from_page=p - 1, to_page=p - 1)
    out.insert_pdf(src, from_page=tpl - 1, to_page=tpl + 2)  # malen bakerst (blir ikke bokinnhold)

    # 2) gjør mal-kopiene til ekte sider (ingen flere struktur-endringer nå, så
    #    sideobjektene holder seg gyldige - hentes på nytt etter hver endring)
    pg = out[cover_i]
    strip_red(pg)
    pg = out[cover_i]
    sp = spans(pg)  # mal-geometrien leses FØR plassholderen fjernes
    drop_text(pg, rects_lines(pg, ['Navn På Bok', 'Name of Book'], font='arial'))
    pg = out[cover_i]
    for a in ('sc', 'sci', 'pd', 'pdi'):
        pg.insert_font(fontname=a, fontfile=F[a])
    if 'Navn På Bok' in sp:
        fk = pick_font(sp['Navn På Bok']['font'])
        put_text(pg, title_no, sp['Navn På Bok'], HALF, fk, fm[fk], down=True)
        print(f'[{book}/{variant}] forside: {title_no!r}')
    if title_en and 'Name of Book' in sp:
        fk = pick_font(sp['Name of Book']['font'])
        put_text(pg, title_en, sp['Name of Book'], HALF_EN, fk, fm[fk], down=True)

    for idx, main in chap_i:
        no_t, no_d, en_t, en_d = chapter_parts(main)
        pg = out[idx]
        strip_red(pg)
        pg = out[idx]
        sp = spans(pg)  # mal-geometrien leses FØR plassholderne fjernes
        drop_text(pg, rects_lines(pg, ['Kapitteltittelen', 'The Chapter Title',
                                       'Kapittelbeskrivelsen', 'The Chapter Description'],
                                  font='arial'))
        pg = out[idx]
        for a in ('sc', 'sci', 'pd', 'pdi'):
            pg.insert_font(fontname=a, fontfile=F[a])
        for text, key, cx in ((no_t, 'Kapitteltittelen', HALF),
                              (no_d, 'Kapittelbeskrivelsen', HALF),
                              (en_t, 'The Chapter Title', HALF_EN),
                              (en_d, 'The Chapter Description', HALF_EN)):
            if text and key in sp:
                fk = pick_font(sp[key]['font'])
                put_text(pg, text, sp[key], cx, fk, fm[fk])

    out_dir = os.path.join(BOOK_DIR, book, variant)
    os.makedirs(out_dir, exist_ok=True)
    spread = os.path.join(out_dir, f'{variant}.pdf')
    out.set_metadata({'title': title_no, 'author': (src.metadata or {}).get('author') or ''})
    out.save(spread, garbage=4, deflate=True)
    out.close()
    src.close()

    # 3) de fire utgavene (.md + .pdf) og sidecarene - samme vei som en vanlig bok
    sb.extract(spread)

    # 4) leserens plakat: venstre halvside av side 1 (bokens egen .jpg-konvensjon)
    doc = pymupdf.open(spread)
    p1 = doc[0]
    pix = p1.get_pixmap(clip=pymupdf.Rect(0, 0, p1.rect.width / 2, p1.rect.height), dpi=95)
    pix.save(os.path.join(out_dir, f'{variant}.jpg'), jpg_quality=82)
    doc.close()

    print(f'[{book}/{variant}] {len(chaps)} kapitler, {len(placed)} sider -> '
          f'{os.path.relpath(spread, REPO)} + 4 utgaver, fra {os.path.basename(md_path or "")}')
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
