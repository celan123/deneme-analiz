-- =============================================================================
-- ARMA LİG — RLS sertleştirme, 2. adım (2026-11-28)
-- Önce 2026-11-28_rls_sertlestirme.sql çalıştırılmış olmalı (is_admin() orada).
--
-- students / student_answers / questions tabloları {public} ALL true idi:
-- giriş yapmamış biri bile tüm öğrenci cevaplarını değiştirip silebiliyordu.
--
-- Bu adım YAZMA tarafını kapatır, OKUMA'yı şimdilik açık bırakır:
--   * Akıllı tahta modu giriş yapmadan (anon) fetchExamDataset ile bu tabloları okuyor.
--   * Öğrenci sonuç/sıralama ekranı sınavın tüm cevaplarını okuyor.
-- Okumanın kapatılması kod tarafında RPC'ye geçiş gerektirir (ayrı iş).
-- =============================================================================

-- ---------------------------------------------------------------- students
drop policy if exists mvp_all_students on public.students;
drop policy if exists students_select_all on public.students;
drop policy if exists students_insert_auth on public.students;
drop policy if exists students_update_admin on public.students;
drop policy if exists students_delete_admin on public.students;

create policy students_select_all on public.students
  for select using (true);
create policy students_insert_auth on public.students
  for insert to authenticated with check (true);
create policy students_update_admin on public.students
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy students_delete_admin on public.students
  for delete to authenticated using (public.is_admin());

-- --------------------------------------------------------- student_answers
drop policy if exists mvp_all_answers on public.student_answers;
drop policy if exists answers_select_all on public.student_answers;
drop policy if exists answers_insert_auth on public.student_answers;
drop policy if exists answers_update_admin on public.student_answers;
drop policy if exists answers_delete_admin on public.student_answers;

create policy answers_select_all on public.student_answers
  for select using (true);
create policy answers_insert_auth on public.student_answers
  for insert to authenticated with check (true);
create policy answers_update_admin on public.student_answers
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy answers_delete_admin on public.student_answers
  for delete to authenticated using (public.is_admin());

-- --------------------------------------------------------------- questions
-- Uygulama bu tabloya yalnızca okuma yapıyor (akıllı tahta SVG yedeği).
drop policy if exists mvp_all_questions on public.questions;
drop policy if exists questions_select_all on public.questions;
drop policy if exists questions_write_admin on public.questions;

create policy questions_select_all on public.questions
  for select using (true);
create policy questions_write_admin on public.questions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- =============================================================================
-- GERİ ALMA
-- =============================================================================
-- drop policy if exists students_select_all on public.students;
-- drop policy if exists students_insert_auth on public.students;
-- drop policy if exists students_update_admin on public.students;
-- drop policy if exists students_delete_admin on public.students;
-- create policy mvp_all_students on public.students for all using (true) with check (true);
-- drop policy if exists answers_select_all on public.student_answers;
-- drop policy if exists answers_insert_auth on public.student_answers;
-- drop policy if exists answers_update_admin on public.student_answers;
-- drop policy if exists answers_delete_admin on public.student_answers;
-- create policy mvp_all_answers on public.student_answers for all using (true) with check (true);
-- drop policy if exists questions_select_all on public.questions;
-- drop policy if exists questions_write_admin on public.questions;
-- create policy mvp_all_questions on public.questions for all using (true) with check (true);
