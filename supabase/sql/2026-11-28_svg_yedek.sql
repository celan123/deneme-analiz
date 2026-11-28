-- =============================================================================
-- SVG yeniden çizimi: yedek tablosu ve geri alma (2026-11-28)
-- Tablo Supabase'de oluşturuldu (migration: question_svg_backup).
-- Her yeniden çizim partisinde eski svg_code önce bu tabloya kopyalanır.
-- =============================================================================

create table if not exists public.question_svg_backup (
  question_id  text        not null,
  svg_code     text,
  backed_up_at timestamptz not null default now(),
  note         text,
  primary key (question_id, backed_up_at)
);
alter table public.question_svg_backup enable row level security;  -- istemci erişimi yok

-- Partide kullanılan kalıp (yeni SVG'ler $svg$ ... $svg$ ile verilir):
-- with yeni(id, svg) as (values ('pool-...', $svg$<svg ...>$svg$), ...),
-- yedek as (insert into question_svg_backup (question_id, svg_code, note)
--           select q.id, q.svg_code, '<parti notu>' from question_pool q join yeni using (id)
--           returning 1),
-- guncel as (update question_pool q set svg_code = yeni.svg from yeni where q.id = yeni.id returning 1)
-- select (select count(*) from yedek), (select count(*) from guncel);

-- -----------------------------------------------------------------------------
-- GERİ ALMA: bir partiyi (not ile) eski SVG'lere döndürür
-- -----------------------------------------------------------------------------
-- update public.question_pool q
-- set svg_code = b.svg_code
-- from public.question_svg_backup b
-- where b.question_id = q.id
--   and b.note = 'SVG pilotu 2026-11-28';

-- Pilot (2026-11-28): pool-1795725188100-4, pool-1795729240625-13,
--                     pool-1795729240625-5, pool-1795721691555-4 (data-geometri)
