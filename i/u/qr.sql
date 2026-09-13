-- qr.sql - the "selected QR" field on public.redir, used by i/u/qrgallery.html
--
-- Token format:  <size><EC><hole>[t][u]
--     <size>  21 | 25 | 29                (21 encodes the short www. host)
--     <EC>    L | M | Q | H
--     <hole>  0 | 3 | 5 | 7 | 9           centred white hole in modules (for a
--             9x9 hole on a 21x21 code the function patterns inside it are kept)
--     t       transparent variant (image keyed, whole art centred)
--     u       21x UPPERCASE host: WWW.AIGAP.NO/ID  (Alphanumeric mode, fits
--             ~25 chars at 21-L where Byte mode only fits ~17)
--
-- Examples: 25M5  ·  25M5t  ·  21L5  ·  21L5u  ·  21L5tu

alter table public.redir add column if not exists qr text;

comment on column public.redir.qr is
  'Selected QR variant: <size><EC><hole>[t][u]; t=transparent, u=21x uppercase host';

-- 2) the format constraint (z = 21x uppercase allowed only for size 21) ------
alter table public.redir drop constraint if exists redir_qr_fmt;
alter table public.redir add constraint redir_qr_fmt
  check (qr is null or qr ~ '^(21[LMQH][03579]t?u?|2[59][LMQH][03579]t?)$');

drop policy if exists "redir update qr" on public.redir;
create policy "redir update qr" on public.redir for update to anon
  using (true) with check (true);

-- DO NOT revoke table-level UPDATE here.
-- redir admin (dbAdm.html + dbAdm.js) authenticates with the SAME public anon
-- key and writes id, url, "desc", "group", sort. Narrowing anon to
--   grant update (qr)
-- broke Save/Edit (and the ?add= upsert) with
--   401  42501  permission denied for table redir
-- Rolled back 2026-09-13: anon keeps table-level UPDATE.
grant update on public.redir to anon;

-- Handy: what is selected today
-- select id, "desc", qr from public.redir where qr is not null order by sort, id;
