-- =============================================================================
-- ARMA LİG — RLS sertleştirme (2026-11-28)
-- Supabase SQL Editor'da tek seferde çalıştırın. Tekrar çalıştırmak güvenlidir.
--
-- 1) profiles: Kullanıcılar kendi satırını güncelleyebiliyor (subject, grade için
--    gerekli) ama 'role' sütunu da açıktı → öğrenci kendini admin yapabiliyordu.
-- 2) question_pool: 'v2_all_pool' herkese yazma/silme izni veriyordu.
-- =============================================================================

-- Yardımcı fonksiyonlar (security definer: profiles RLS'ine takılmaz, döngü yapmaz)
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'teacher'));
$$;

-- -----------------------------------------------------------------------------
-- 1) Rol koruması
-- Doğrudan istemciden (PostgREST: 'authenticated' / 'anon') gelen rol
-- değişikliklerini yalnızca admin yapabilir. claim_teacher_invite gibi
-- security definer RPC'ler ve SQL Editor (postgres) etkilenmez.
-- -----------------------------------------------------------------------------
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if tg_op = 'INSERT' and new.role is distinct from 'student' then
      raise exception 'Rol atama yetkiniz yok.' using errcode = '42501';
    elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
      raise exception 'Rol değiştirme yetkiniz yok.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard
  before insert or update on public.profiles
  for each row execute function public.guard_profile_role();

-- -----------------------------------------------------------------------------
-- 2) Soru havuzu
-- Okuma: önceki gibi açık (sınav/akıllı tahta akışları bozulmasın diye).
-- Ekleme: admin + öğretmen (ExamImportView öğretmenlere de açık).
-- Güncelleme / silme: yalnızca admin.
-- -----------------------------------------------------------------------------
drop policy if exists v2_all_pool on public.question_pool;
drop policy if exists pool_select_all on public.question_pool;
drop policy if exists pool_insert_staff on public.question_pool;
drop policy if exists pool_update_admin on public.question_pool;
drop policy if exists pool_delete_admin on public.question_pool;

create policy pool_select_all on public.question_pool
  for select using (true);

create policy pool_insert_staff on public.question_pool
  for insert to authenticated with check (public.is_staff());

create policy pool_update_admin on public.question_pool
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy pool_delete_admin on public.question_pool
  for delete to authenticated using (public.is_admin());

-- =============================================================================
-- GERİ ALMA (bir şey bozulursa yalnızca bu bloğu çalıştırın)
-- =============================================================================
-- drop trigger if exists profiles_role_guard on public.profiles;
-- drop policy if exists pool_select_all on public.question_pool;
-- drop policy if exists pool_insert_staff on public.question_pool;
-- drop policy if exists pool_update_admin on public.question_pool;
-- drop policy if exists pool_delete_admin on public.question_pool;
-- create policy v2_all_pool on public.question_pool for all using (true) with check (true);
