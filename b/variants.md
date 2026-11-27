# Variants — building a book variant (LddInnovKi)

A variant (`public.book_variant` + `public.book_chapter`) is an ordered selection of a
book's own chapters, published as its own book. This file tracks the four things a
variant needs before it can be opened with a short link.

The book here is **LddInnovKi** (a variant of `LifeDemandedDeath`):

- `title_no` — Innovasjon og KI i praksis
- `title_en` — Innovation & AI practice
- 6 main chapters, 14 sub chapters, all resolving in `b/LifeDemandedDeath/LifeDemandedDeath_NO_PREM.md`

## 1) Add cover page

Create the cover page using the template (the deck's own 4th-to-last slide) and replace
`Navn På Bok` with `title_no` and `Name of Book` with `title_en`.

## 2) Add a main chapter page for each main chapter

Use the main chapter template (the 3rd-to-last slide) to create one page per main chapter.

## 3) Construct NO/EN × FREE/PREM md and pdf

Afterwards, also create the four editions for both pdf and md:
`_NO_FREE`, `_NO_PREM`, `_EN_FREE`, `_EN_PREM`.

## 4) Add the aigap.no shortcut

So that <https://aigap.no?LddInnovKi> opens the book reader on that book. That means
inserting a row in `public.redir` in Supabase.

---

## AS-IS

Not done yet — **nothing has been written to the repo**. Working tree is clean; all work
so far is an out-of-repo prototype.

Settled already:

- **The template** is the book's own slide deck: `b/LifeDemandedDeath/LifeDemandedDeath.pdf`
  pages 204–207 are the last four slides — 204 *Forside*, 205 *Kapittelside*,
  206 *Underkapittel*, 207 *Tekst*. (`b/ABook/ABook.pdf` is a standalone 4-page copy of the
  same deck; `sync-books.py` finds the block via the `Navn På Bok` / `Name of Book` anchor.)
- **The template slides are marked**: a big red X (two red strokes in the content stream)
  and the Arial *oppskrifter*, which must not survive into a real page. Arial is dropped by
  the reader and by the four editions; the red X is not, so it must be removed at build time.
- **The embedded fonts cannot be reused**: they are cmap-less subsets, so new text needs
  Playfair Display (SC Regular/Italic for titles, Playfair Display for the descriptions).
- **Chapter labels carry both languages**, pipe-separated:
  `NO title|NO subtitle|EN title|EN subtitle`, e.g.
  `Problemet|Rikdom som gjør oss late|The Problem|Wealth that makes us lazy`.
  English parts may be absent — then the EN half is left blank until filled in.
- **The four editions are produced by `sync-books.py`**, not by hand: `extract(spread)` writes
  `{name}_{NO|EN}_{FREE|PREM}.md` **and** `render_pdfs()` writes the matching half-page,
  tier-filtered `.pdf`s. `sync-books.py` is importable (it has a `__main__` guard).
- **The reader target is a spread**, one page per slide: `?book=…/<name>.pdf`; the sidecars are
  fetched as `<name>_{NO|EN}_{FREE|PREM}.md` beside it (`srcBase` = the book path minus `.pdf`).

Prototype status (verified by rendering, out-of-repo):

- Cover page: works. Titles swapped and auto-fitted (28 pt → 18.5 pt NO / 18.0 pt EN), red X
  removed by content-stream surgery, Arial *oppskrifter* redacted, rest of the slide intact.
- Main chapter page: text extraction and fitting work, but the page still failed to render
  after the content-stream edit — the red-stroke removal needs to be finished and re-verified.

## TODO

- [ ] Finish the red-X removal so the edited template page renders (`get_pixmap` currently
      raises after the content-stream rewrite).
- [ ] Add cover generation: template slide 204 + `book_variant.title_no` / `title_en`.
- [ ] Add main-chapter generation: template slide 205 per `book_chapter` row, NO/EN from the
      pipe fields, before that chapter's pages.
- [ ] Build the spread `b/<book>/<variant>/<variant>.pdf`: cover → per chapter (chapter page
      then its pages) → the 4 template slides appended, so `_template_start()` still finds the
      template block and `render_pdfs()`/`_data()` behave as for every other book.
- [ ] Call `sync-books.py`'s `extract()` on the spread to emit the 4 `.md` sidecars and the
      4 `.pdf` editions.
- [ ] Write the spread + editions into `b/LifeDemandedDeath/LddInnovKi/`.
- [ ] Extend `.github/scripts/build-variant.py` (and its workflow) to do all of the above.
- [ ] Teach the adm `book_chapter` editor the 4-part pipe form (EN title/subtitle).
- [ ] Insert the `public.redir` row: `LddInnovKi` →
      `https://aigap.no/b/_r?book=../LifeDemandedDeath/LddInnovKi/LddInnovKi.pdf`.
- [ ] Remove this file when the four points are done.
