-- =============================================================================
-- ARMA LİG — RLS sertleştirme, 4. adım: OKUMA tarafı + get_exam_results RPC
-- (2026-11-28) — 1, 2 ve 3. adımlardan SONRA çalıştırın.
--
-- ÖNEMLİ SIRA: Önce bu SQL'i çalıştırın, SONRA yeni ön yüz kodunu deploy edin.
-- (Eski kod bu SQL ile çalışmaya devam eder; yalnızca öğrencinin sıralama
--  tablosunda diğer öğrenciler görünmez. Yeni kod RPC'yi kullanır.)
--
-- Sonuç:
--   * Giriş yapmamış kimse students / student_answers / exam_participations /
--     questions tablolarını okuyamaz.
--   * Öğrenci doğrudan yalnızca KENDİ kayıtlarını okur.
--   * Sıralama için diğer öğrencilerin sonuçları get_exam_results() ile gelir:
--     yalnızca katıldığı sınavda, maskeli ad ("Ahmet Y."), anonim kimlik,
--     süre / şık değiştirme verisi ve okul adı olmadan.
--   * Öğretmen ve admin her şeyi eskisi gibi görür.
-- =============================================================================

-- Ad maskeleme: "Ahmet Can Yılmaz" -> "Ahmet Y."  (istemcideki maskStudentName ile aynı)
create or replace function public.mask_student_name(p_name text)
returns text
language sql immutable
set search_path = public
as $$
  select case
    when coalesce(trim(p_name), '') = '' then 'Öğrenci'
    when array_length(regexp_split_to_array(trim(p_name), '\s+'), 1) = 1 then trim(p_name)
    else (regexp_split_to_array(trim(p_name), '\s+'))[1] || ' ' ||
         upper(left((regexp_split_to_array(trim(p_name), '\s+'))[
           array_length(regexp_split_to_array(trim(p_name), '\s+'), 1)], 1)) || '.'
  end;
$$;

-- -----------------------------------------------------------------------------
-- get_exam_results(p_exam_id) -> { students: [...], answers: [...] }
-- -----------------------------------------------------------------------------
create or replace function public.get_exam_results(p_exam_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_staff  boolean;
  v_joined boolean;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Bu işlem için giriş yapmalısınız.' using errcode = '42501';
  end if;

  v_staff := public.is_staff();
  select exists (
    select 1 from exam_participations
    where exam_id = p_exam_id and user_id = v_uid
  ) into v_joined;

  -- Sınava katılmamış öğrenci başkalarının sonuçlarını göremez
  if not v_staff and not v_joined then
    return jsonb_build_object('students', '[]'::jsonb, 'answers', '[]'::jsonb);
  end if;

  with parts as (
    select distinct on (student_id)
      student_id, user_id, participation_type::text as participation_type, school_name
    from exam_participations
    where exam_id = p_exam_id
    order by student_id, created_at desc
  ),
  stu as (
    select
      s.id                                   as real_id,
      (v_staff or p.user_id = v_uid)         as visible,
      s.full_name, s.classroom,
      coalesce(p.participation_type, 'OFFICIAL') as participation_type,
      p.school_name
    from students s
    left join parts p on p.student_id = s.id
    where s.id in (select distinct student_id from student_answers where exam_id = p_exam_id)
  ),
  stu_out as (
    select
      real_id,
      visible,
      case when visible then real_id else 'p-' || left(md5(real_id), 12) end as out_id,
      jsonb_build_object(
        'id',                 case when visible then real_id else 'p-' || left(md5(real_id), 12) end,
        'full_name',          case when visible then full_name else public.mask_student_name(full_name) end,
        'classroom',          classroom,
        'participation_type', participation_type,
        'school_name',        case when visible then school_name else null end
      ) as obj
    from stu
  )
  select jsonb_build_object(
    'students', coalesce((select jsonb_agg(obj) from stu_out), '[]'::jsonb),
    'answers',  coalesce((
      select jsonb_agg(
        case when so.visible then
          to_jsonb(a)
        else
          jsonb_build_object(
            'exam_id',         a.exam_id,
            'student_id',      so.out_id,
            'question_id',     a.question_id,
            'selected_option', a.selected_option
          )
        end
      )
      from student_answers a
      join stu_out so on so.real_id = a.student_id
      where a.exam_id = p_exam_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_exam_results(text) from public, anon;
grant execute on function public.get_exam_results(text) to authenticated;

-- -----------------------------------------------------------------------------
-- OKUMA kurallarını daralt
-- -----------------------------------------------------------------------------

-- exam_participations: kendi kaydı veya öğretmen/admin
drop policy if exists participations_select_all on public.exam_participations;
drop policy if exists v2_all_participations on public.exam_participations;
drop policy if exists participations_select_own_or_staff on public.exam_participations;
create policy participations_select_own_or_staff on public.exam_participations
  for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- students: kendi katılımına bağlı kayıt veya öğretmen/admin
drop policy if exists students_select_all on public.students;
drop policy if exists mvp_all_students on public.students;
drop policy if exists students_select_own_or_staff on public.students;
create policy students_select_own_or_staff on public.students
  for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.exam_participations ep
      where ep.student_id = students.id and ep.user_id = auth.uid()
    )
  );

-- student_answers: kendi cevapları veya öğretmen/admin
drop policy if exists answers_select_all on public.student_answers;
drop policy if exists mvp_all_answers on public.student_answers;
drop policy if exists answers_select_own_or_staff on public.student_answers;
create policy answers_select_own_or_staff on public.student_answers
  for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.exam_participations ep
      where ep.student_id = student_answers.student_id and ep.user_id = auth.uid()
    )
  );

-- questions: yalnızca öğretmen/admin (akıllı tahta SVG yedeği öğretmen cihazında çalışır)
drop policy if exists questions_select_all on public.questions;
drop policy if exists mvp_all_questions on public.questions;
drop policy if exists questions_select_staff on public.questions;
create policy questions_select_staff on public.questions
  for select to authenticated using (public.is_staff());

-- =============================================================================
-- GERİ ALMA (okumayı 2. ve 3. adımdaki açık haline döndürür; RPC kalır, zararsız)
-- =============================================================================
-- drop policy if exists participations_select_own_or_staff on public.exam_participations;
-- create policy participations_select_all on public.exam_participations for select using (true);
-- drop policy if exists students_select_own_or_staff on public.students;
-- create policy students_select_all on public.students for select using (true);
-- drop policy if exists answers_select_own_or_staff on public.student_answers;
-- create policy answers_select_all on public.student_answers for select using (true);
-- drop policy if exists questions_select_staff on public.questions;
-- create policy questions_select_all on public.questions for select using (true);
