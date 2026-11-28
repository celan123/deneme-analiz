-- Boş sınıf (grade) alanlarını kazanım kodundaki ilk sayıdan doldurur.
-- Örnek: MAT.5.1.1 -> 5, FB.6.1.3 -> 6, DYS.DO.5.8 -> 5, T.O.5.20 -> 5
-- Etki: 283 satır (Matematik 104, Türkçe 60, Sosyal 59 -> 5; Fen 60 -> 6)

update public.question_pool
set grade = substring(outcome_code from '\.(\d+)\.')::int
where grade is null
  and outcome_code ~ '\.(\d+)\.';

-- Kontrol
select subject, grade, count(*) from public.question_pool group by 1, 2 order by 1, 2;

-- GERİ ALMA (yalnızca bu betikle doldurulan satırlar için; önceden dolu olanlar İngilizce ve Din'di)
-- update public.question_pool set grade = null
-- where subject in ('Matematik', 'Türkçe', 'Sosyal Bilgiler', 'Fen Bilimleri');
