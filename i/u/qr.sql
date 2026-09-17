-- qr.sql - the "selected QR" + "present" fields on public.redir, used by i/u/qrgallery.html
--
-- Token format:  <size><EC><hole>[t][u]
--     <size>  21 | 25 | 29                (21 encodes the short www. host)
--     <EC>    L | M | Q | H
--     <hole>  0 | 3 | 5 | 7 | 9 | 11 | 13  centred white hole in modules (11 only
--             fits 29, 13 only 25/29; the 9x9 hole of 21, 13x13 of 25, 11x11 and
--             13x13 of 29 keep 9 modules for the artwork)
--     t       transparent variant (image keyed, whole art centred)
--     u       21x UPPERCASE host: WWW.AIGAP.NO/ID  (Alphanumeric mode, fits
--             ~25 chars at 21-L where Byte mode only fits ~17)
--
-- Examples: 25M5  ·  25M5t  ·  21L5  ·  21L5u  ·  21L5tu

alter table public.redir add column if not exists qr text;
alter table public.redir add column if not exists present text;

comment on column public.redir.qr is
  'Selected QR variant: <size><EC><hole>[t][u]; t=transparent, u=21x uppercase host';
comment on column public.redir.present is
  'How the code is presented: qr | img | none (none = group Hidden)';

-- 1b) present: how the code is shown.  Set by the migration in section 3,
--     then editable from i/u/qrgallery.html.
alter table public.redir drop constraint if exists redir_present_chk;
alter table public.redir add constraint redir_present_chk
  check (present is null or present in ('qr','img','none'));
alter table public.redir alter column present set default 'img';
create index if not exists redir_id_lower_idx on public.redir (lower(id));

-- 2) the format constraint (z = 21x uppercase allowed only for size 21) ------
alter table public.redir drop constraint if exists redir_qr_fmt;
alter table public.redir add constraint redir_qr_fmt
  check (qr is null or qr ~ '^(21[LMQH][03579]t?u?|25[LMQH](?:[03579]|13)t?|29[LMQH](?:[03579]|11|13)t?)$');

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
-- select id, "desc", qr, present from public.redir order by sort, id;

-- 3) ONE-SHOT migration: bare every qr/qra id, remember it in `present`.
--    BACK UP FIRST (dbAdm -> Util -> Export -> redir).  Run once.
--    No collisions: 2026-09-13 no bare id (ldd, bmd, bgda, play, mlist, m*) exists.
update public.redir set present='qr' where id ~ '(qr|qra)$';
-- lowercase ldd keeps the plain book link; LDD keeps the &c=w,3000,nLg0 variant
update public.redir set url = replace(url,'&c=w,3000,nLg0','') where id='lddqra';
update public.redir set qr = (select qr from public.redir where id='lddqra') where id='LDD' and qr is null;
delete from public.redir where id in ('Bqra','BMD');   -- Bqra dup of LDD, BMD dup of bmdqra
update public.redir set id = regexp_replace(id,'(qr|qra)$','') where id ~ '(qr|qra)$';
update public.redir set present='none' where "group"='Hidden';
update public.redir set present='img' where present is null;

-- guards: both must return 0 rows
-- select id from public.redir where id ~ '(qr|qra)$';
-- select lower(id),count(*) from public.redir group by 1 having count(*)>1;
-- rollback: update public.redir set id=id||'qra' where present='qr'; (the 2 deleted rows: restore from the export)
