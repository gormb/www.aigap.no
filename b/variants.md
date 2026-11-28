# Variants

A **variant** is an ordered selection of a book's own chapters, published as a book in its
own right. The selection, its titles and its order live in Supabase; the text and the pages
are taken from the book the variant belongs to. Any number of variants can belong to the
same book, and rebuilding one never touches another.

## Data model

`public.book_variant` — one row per variant:

| column | meaning |
| --- | --- |
| `book` | the book the variant is cut from |
| `variant` | variant name, and the folder/file name it is published under |
| `title_no`, `title_en` | the cover title, per language |
| `description` | one-line summary |
| `dtfrom`, `dtto` | publication window |

`public.book_chapter` — one row per main chapter, ordered by `ord`:

| column | meaning |
| --- | --- |
| `book`, `variant` | which variant the row belongs to |
| `mainchapter` | the chapter line, pipe-separated, both languages |
| `subchapters` | the chapter's sub chapters, pipe-separated |
| `ord` | the chapter's position in the variant |

```text
mainchapter   NO title|NO subtitle|EN title|EN subtitle
subchapters   Sub chapter A|Sub chapter B|Sub chapter C
```

The English parts of `mainchapter` are optional; where they are missing the English half of
the page is left blank until they are filled in. Sub chapter names are matched against the
book's own text, so a name that does not occur there is reported and skipped.

## Build

`.github/scripts/build-variant.py <book> <variant>` is the builder.
`.github/workflows/build-variant.yml` runs it (`workflow_dispatch` with `book` and
`variant`), and the **Create** button on the adm page dispatches that workflow. The database
is read through the Supabase REST API, with the configuration fetched from the deployed
`db.js`.

For any `<book>` and `<variant>`, the build writes into `b/<book>/<variant>/`:

| file | what |
| --- | --- |
| `<variant>.pdf` | the spread the reader opens: cover, then per chapter a chapter page followed by that chapter's pages |
| `<variant>_{NO,EN}_{FREE,PREM}.pdf` | the four editions: one half-page per language, tier-filtered |
| `<variant>_{NO,EN}_{FREE,PREM}.md` | the four sidecars the reader fetches for text |

## Requirements

A variant is complete when all four hold.

### 1) Cover page

The book deck's 4th-to-last slide is the *Forside* template: copy it and replace `Navn På
Bok` with `title_no` and `Name of Book` with `title_en`. Each half is set in the font its own
placeholder used. A title too long to fit is wrapped at the template's own size, and only
shrunk if it still will not fit. The template's red X and Arial *oppskrifter* are removed,
leaving the rules, divider and picture in place.

### 2) A main chapter page per main chapter

The book deck's 3rd-to-last slide is the *Kapittelside* template: copy it once per
`book_chapter` row, ahead of that chapter's pages, and fill in the title and description for
both languages from `mainchapter`.

### 3) NO/EN × FREE/PREM md and pdf

Once the spread exists, `sync-books.py`'s `extract()` derives the four editions and the four
sidecars from it. This is the same code path as any other book, so a variant is
half-page-cropped and tier-filtered exactly like `<book>_NO_PREM.pdf`, and its sidecar
headings come out as `# <title>`, `## <chapter>`, `### <sub chapter>`, with songs resolved
through `redir`.

### 4) The aigap.no shortcut

`public.redir` carries the short links. A row makes `https://aigap.no?<variant>` open the
reader on the variant:

```text
id    <variant>
url   https://aigap.no/b/_r?book=../<book>/<variant>/<variant>.pdf
```

---

## AS-IS

Requirements 1–3 are implemented in the builder and produce the files listed above.
Requirement 4 is a row inserted per variant; nothing inserts it automatically.

- **Templates** are read from the variant's own book deck, whose last four slides are
  *Forside*, *Kapittelside*, *Underkapittel* and *Tekst*. The block is kept last in the
  spread, because `sync-books.py` finds it by its `Navn På Bok` / `Name of Book` anchor and
  drops it from the editions.
- **Template marks** — the slides carry a red X and Arial *oppskrifter*, neither of which
  belongs on a real page. The Arial text is dropped for the reader and for the editions, and
  the X is cut out of the content stream, where it is drawn inline as `1 0 0 RG`.
- **Fonts** — decks embed cmap-less subsets, so their fonts cannot be re-used for new text.
  Playfair Display (SC for titles) is fetched from Google Fonts at build time into a temp
  directory and is not committed.
- **`sync-books.py`** — its cover-placeholder regex knew only `Navnet På Boken`, while the
  current decks say `Navn På Bok`, so `coverH`/`_title()` never matched and a sidecar's H1
  fell back to the folder name. Both spellings are now recognised.
- **Concurrent runs** — the job commits and pushes to `main`. Variants are routinely
  dispatched several at a time (and `sync-pdf.yml` pushes too), so a push that loses the race
  is rejected with *fetch first*. The job now stages only its own variant folder and rebases
  on `origin/main`, retrying the push, so overlapping runs no longer fail.

## TODO

- [ ] Insert the `public.redir` row for each variant.
- [ ] Give the adm `book_chapter` editor the 4-part pipe form, so the English half can be
      filled in from the UI.
- [x] `.github/workflows/build-variant.yml` stages the variant's own folder — spread, the four
      editions and the poster `<variant>.jpg` — and rebases its push, so concurrent runs no
      longer fail.
