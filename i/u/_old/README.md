# `_old` — archived QR tooling

Nothing here is wired into the site. It is kept only so the earlier attempts can
be reviewed / mined later. The live tooling is one level up:

| live file | role |
|---|---|
| `qr.html` | the analysis + live render engine (every size/EC/hole, deep links, `v=` minimal view) |
| `qrgallery.html` | DB-driven gallery; renders each code by embedding `qr.html` in an iframe |
| `qrmetrics.js` | real ISO codeword-erasure scoring + 1-bit PNG sizing (used by `qr.html`) |
| `qrgen.py` | writes the served PNGs: `<base>.qr<N><EC><hole>.png` combos + `<base>.qr1.png` |
| `qrbook.py` | writes the book QRs `<base>.qr.png` + `i/book.html` (decode-verified) |

## What was replaced, and by what

| archived | replaced by | why kept |
|---|---|---|
| `qrg.html` *(deleted, superseded)* | `qrgallery.html` | old gallery: rendered from pre-generated PNGs and used jsQR scanning + a "% of modules vs EC" guess. Kept in git history only. |
| `qrmatrix.html` + `_qrmat_page.py` | `qr.html` / `qrgallery.html` | 1.1 MB pre-rendered page over the PNG combos; the live engine does the same, filterable, without a build step. |
| `_qrmat.py` | `qrgen.py` | generated the matrix combos; logic merged into `qrgen.py`. |
| `_qr1Gen.py` | `qrgen.py` (`--no-combos`) | generated `<base>.qr1.png`; logic merged into `qrgen.py`. |
| `_qrgen_b.py` | `qrgen.py` | earlier "Option B" output (`<base>.qr21.png`, `<base>.qr25i.png`); naming now unified. |
| `_qrGenMul.py` / `_qrGenMul.sh` | `qrgen.py` | one-off bulk wrapper around the above. |
| `qrGen.py` | `qrgen.py` | older `.qr.png` batch generator (masked centre + logger cover). Kept: its `ERROR_CORRECT_Q when art` idea fed `qrbook.py`. |
| `probe/` | `qrmetrics.js` | pre-generated probe PNGs + `sz/` byte sizes used by the jsQR fit test. Real codeword metrics replaced the guess. |
| `tpl21L*.png`, `tpl25L*.png` | `qrmetrics.js` | early hand-made 21/25 templates for the same fit experiment. |
| `matrix/` | `qrgen.py` | stale `<base>.qr21.png` / `<base>.qr25i.png` artifacts (regenerable, unused by the site). |

## Notes

- `matrix/` and `probe/` are regenerable; safe to delete once you are happy.
- The old `qrmatrix.html` and `probe/` reference `../<base>.qr*.png`, so their
  relative paths no longer resolve from `_old/` — they are reference material,
  not runnable pages.
- The engine is the single source of truth for *which* combo is safe; Python
  only writes the bytes the browser has already approved.
