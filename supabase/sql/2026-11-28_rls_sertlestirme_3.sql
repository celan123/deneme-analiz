-- =============================================================================
-- ARMA LİG — RLS sertleştirme, 3. adım (2026-11-28)
-- Önce 1. adım (is_admin / is_staff fonksiyonları) çalıştırılmış olmalı.
--
-- Kapsam: exams, exam_questions, exam_classrooms, exam_participations,
--         exam_attempts, exam_waiting_room, classrooms, classroom_members
--
-- İlke: OKUMA izinleri bugünkü haliyle aynı kalır (hiçbir ekran bozulmasın).
--       YAZMA izinleri koddaki gerçek kullanıma göre daraltılır:
--   * Sınav oluşturma/düzenleme/silme → öğretmen + admin (is_staff)
--   * Sınıf → yalnızca sahibi olan öğretmen (teacher_id) veya admin
--   * Sınıfa katılma / bekleme odası → öğrenci yalnızca KENDİ kaydını yönetir
--   * Katılım kaydı → giriş yapan ekler, yalnızca admin değiştirir/siler
-- Not: createExamFromAgentJson owner_id yazmadığı için sınavlarda sahiplik
--      kontrolü yapılamıyor; şimdilik her öğretmen her sınavı düzenleyebilir.
-- =============================================================================

-- ------------------------------------------------------------------- exams
drop policy if exists mvp_all_exams on public.exams;
drop policy if exists exams_select_all on public.exams;
drop policy if exists exams_write_staff on public.exams;

create policy exams_select_all on public.exams
  for select using (true);
create policy exams_write_staff on public.exams
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------- exam_questions
drop policy if exists v2_all_exam_questions on public.exam_questions;
drop policy if exists exam_questions_select_auth on public.exam_questions;
drop policy if exists exam_questions_write_staff on public.exam_questions;

create policy exam_questions_select_auth on public.exam_questions
  for select to authenticated using (true);
create policy exam_questions_write_staff on public.exam_questions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- --------------------------------------------------------- exam_classrooms
drop policy if exists v2_all_exam_classrooms on public.exam_classrooms;
drop policy if exists exam_classrooms_select_auth on public.exam_classrooms;
drop policy if exists exam_classrooms_write_staff on public.exam_classrooms;

create policy exam_classrooms_select_auth on public.exam_classrooms
  for select to authenticated using (true);
create policy exam_classrooms_write_staff on public.exam_classrooms
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ----------------------------------------------------- exam_participations
drop policy if exists v2_all_participations on public.exam_participations;
drop policy if exists participations_select_all on public.exam_participations;
drop policy if exists participations_insert_own on public.exam_participations;
drop policy if exists participations_update_admin on public.exam_participations;
drop policy if exists participations_delete_admin on public.exam_participations;

create policy participations_select_all on public.exam_participations
  for select using (true);
create policy participations_insert_own on public.exam_participations
  for insert to authenticated
  with check (user_id is null or user_id = auth.uid());
create policy participations_update_admin on public.exam_participations
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy participations_delete_admin on public.exam_participations
  for delete to authenticated using (public.is_admin());

-- ----------------------------------------------------------- exam_attempts
-- Uygulama kodu bu tabloya yazmıyor.
drop policy if exists v2_all_attempts on public.exam_attempts;
drop policy if exists attempts_select_auth on public.exam_attempts;
drop policy if exists attempts_write_admin on public.exam_attempts;

create policy attempts_select_auth on public.exam_attempts
  for select to authenticated using (true);
create policy attempts_write_admin on public.exam_attempts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------- exam_waiting_room
drop policy if exists v2_all_exam_waiting_room on public.exam_waiting_room;
drop policy if exists waiting_select_auth on public.exam_waiting_room;
drop policy if exists waiting_insert_own on public.exam_waiting_room;
drop policy if exists waiting_update_own on public.exam_waiting_room;
drop policy if exists waiting_delete_own on public.exam_waiting_room;

create policy waiting_select_auth on public.exam_waiting_room
  for select to authenticated using (true);
create policy waiting_insert_own on public.exam_waiting_room
  for insert to authenticated with check (user_id = auth.uid());
create policy waiting_update_own on public.exam_waiting_room
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy waiting_delete_own on public.exam_waiting_room
  for delete to authenticated using (user_id = auth.uid() or public.is_staff());

-- -------------------------------------------------------------- classrooms
drop policy if exists v2_all_classrooms on public.classrooms;
drop policy if exists classrooms_select_auth on public.classrooms;
drop policy if exists classrooms_insert_teacher on public.classrooms;
drop policy if exists classrooms_update_owner on public.classrooms;
drop policy if exists classrooms_delete_owner on public.classrooms;

create policy classrooms_select_auth on public.classrooms
  for select to authenticated using (true);
create policy classrooms_insert_teacher on public.classrooms
  for insert to authenticated
  with check (public.is_staff() and teacher_id = auth.uid());
create policy classrooms_update_owner on public.classrooms
  for update to authenticated
  using (teacher_id = auth.uid() or public.is_admin())
  with check (teacher_id = auth.uid() or public.is_admin());
create policy classrooms_delete_owner on public.classrooms
  for delete to authenticated
  using (teacher_id = auth.uid() or public.is_admin());

-- ------------------------------------------------------- classroom_members
drop policy if exists v2_all_members on public.classroom_members;
drop policy if exists members_select_auth on public.classroom_members;
drop policy if exists members_insert_self on public.classroom_members;
drop policy if exists members_delete_self_or_teacher on public.classroom_members;

create policy members_select_auth on public.classroom_members
  for select to authenticated using (true);
create policy members_insert_self on public.classroom_members
  for insert to authenticated with check (student_id = auth.uid());
create policy members_delete_self_or_teacher on public.classroom_members
  for delete to authenticated
  using (
    student_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.classrooms c
      where c.id = classroom_members.classroom_id and c.teacher_id = auth.uid()
    )
  );

-- =============================================================================
-- GERİ ALMA (bu adımın tamamını eski haline döndürür)
-- =============================================================================
-- drop policy if exists exams_select_all on public.exams;
-- drop policy if exists exams_write_staff on public.exams;
-- create policy mvp_all_exams on public.exams for all using (true) with check (true);
-- drop policy if exists exam_questions_select_auth on public.exam_questions;
-- drop policy if exists exam_questions_write_staff on public.exam_questions;
-- create policy v2_all_exam_questions on public.exam_questions for all to authenticated using (true) with check (true);
-- drop policy if exists exam_classrooms_select_auth on public.exam_classrooms;
-- drop policy if exists exam_classrooms_write_staff on public.exam_classrooms;
-- create policy v2_all_exam_classrooms on public.exam_classrooms for all to authenticated using (true) with check (true);
-- drop policy if exists participations_select_all on public.exam_participations;
-- drop policy if exists participations_insert_own on public.exam_participations;
-- drop policy if exists participations_update_admin on public.exam_participations;
-- drop policy if exists participations_delete_admin on public.exam_participations;
-- create policy v2_all_participations on public.exam_participations for all using (true) with check (true);
-- drop policy if exists attempts_select_auth on public.exam_attempts;
-- drop policy if exists attempts_write_admin on public.exam_attempts;
-- create policy v2_all_attempts on public.exam_attempts for all to authenticated using (true) with check (true);
-- drop policy if exists waiting_select_auth on public.exam_waiting_room;
-- drop policy if exists waiting_insert_own on public.exam_waiting_room;
-- drop policy if exists waiting_update_own on public.exam_waiting_room;
-- drop policy if exists waiting_delete_own on public.exam_waiting_room;
-- create policy v2_all_exam_waiting_room on public.exam_waiting_room for all to authenticated using (true) with check (true);
-- drop policy if exists classrooms_select_auth on public.classrooms;
-- drop policy if exists classrooms_insert_teacher on public.classrooms;
-- drop policy if exists classrooms_update_owner on public.classrooms;
-- drop policy if exists classrooms_delete_owner on public.classrooms;
-- create policy v2_all_classrooms on public.classrooms for all to authenticated using (true) with check (true);
-- drop policy if exists members_select_auth on public.classroom_members;
-- drop policy if exists members_insert_self on public.classroom_members;
-- drop policy if exists members_delete_self_or_teacher on public.classroom_members;
-- create policy v2_all_members on public.classroom_members for all to authenticated using (true) with check (true);
