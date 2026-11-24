import { supabase } from '../lib/supabase';
import type {
  AgentQuestionInput,
  Exam,
  ExamDataset,
  ParticipationType,
  PoolQuestion,
  Question,
  Student,
  StudentAnswer,
  StudentCompletedAttempt,
  ValidOption,
} from '../types/exam';
import { generateExamCode } from '../utils/codeGenerator';

const VALID_OPTIONS: ValidOption[] = ['A', 'B', 'C', 'D', 'E'];

/**
 * Veritabanındaki tüm deneme sınavlarını Resmi/Misafir sayıları ve
 * çoklu sınıf atamalarıyla birlikte listeler.
 */
export async function fetchAllExams(): Promise<Exam[]> {
  if (!supabase) {
    throw new Error('Supabase ortam değişkenleri (.env.local) tanımlı değil.');
  }

  const [examsRes, statsRes, classLinksRes] = await Promise.all([
    supabase
      .from('exams')
      .select(
        'id, starts_at, ends_at,title, exam_date, wrong_penalty_ratio, exam_scope, allow_guests, status, show_solutions_after_finish, duration_minutes, classroom_id, owner_id, grade, exam_code'
      )
      .order('created_at', { ascending: false }),
    supabase
      .from('exam_stats')
      .select('exam_id, participant_count, official_count, guest_count'),
    supabase.from('exam_classrooms').select('exam_id, classroom_id'),
  ]);

  if (examsRes.error) throw examsRes.error;

  const statsMap = new Map<
    string,
    { participant_count: number; official_count: number; guest_count: number }
  >();
  if (!statsRes.error && statsRes.data) {
    for (const row of statsRes.data) {
      statsMap.set(row.exam_id, {
        participant_count: Number(row.participant_count ?? 0),
        official_count: Number(row.official_count ?? 0),
        guest_count: Number(row.guest_count ?? 0),
      });
    }
  }

  const classesByExam = new Map<string, string[]>();
  if (!classLinksRes.error && classLinksRes.data) {
    for (const row of classLinksRes.data) {
      const list = classesByExam.get(row.exam_id) ?? [];
      list.push(row.classroom_id);
      classesByExam.set(row.exam_id, list);
    }
  }

  return ((examsRes.data ?? []) as Exam[]).map((ex) => {
    const st = statsMap.get(ex.id);
    const linked = classesByExam.get(ex.id) ?? [];
    const mergedClassIds =
      linked.length > 0
        ? linked
        : ex.classroom_id
          ? [ex.classroom_id]
          : [];

    return {
      ...ex,
      assigned_classroom_ids: mergedClassIds,
      participant_count: st?.participant_count ?? 0,
      official_count: st?.official_count ?? 0,
      guest_count: st?.guest_count ?? 0,
    };
  });
}

/**
 * Belirtilen sınavın sorularını merkezi havuzdan, öğrencilerini, cevaplarını
 * ve Resmi/Misafir katılım türlerini getirir.
 */
export async function fetchExamDataset(examId: string): Promise<ExamDataset> {
  if (!supabase) {
    throw new Error('Supabase ortam değişkenleri (.env.local) tanımlı değil.');
  }

  const [examRes, linksRes, answersRes, participationsRes, classLinksRes] =
    await Promise.all([
      supabase
        .from('exams')
        .select(
          'id, title, exam_date,starts_at, ends_at, wrong_penalty_ratio, exam_scope, allow_guests, status, show_solutions_after_finish, duration_minutes, classroom_id, owner_id, grade, exam_code'
        )
        .eq('id', examId)
        .single(),
      supabase
        .from('exam_questions')
        .select('question_number, question:question_pool(*)')
        .eq('exam_id', examId)
        .order('question_number', { ascending: true }),
      supabase.from('student_answers').select('*').eq('exam_id', examId),
      supabase
        .from('exam_participations')
        .select('student_id, participation_type, school_name')
        .eq('exam_id', examId),
      supabase
        .from('exam_classrooms')
        .select('classroom_id')
        .eq('exam_id', examId),
    ]);

  if (examRes.error) throw examRes.error;
  if (linksRes.error) throw linksRes.error;
  if (answersRes.error) throw answersRes.error;

  const participationMap = new Map<
    string,
    { participation_type: ParticipationType; school_name: string | null }
  >();
  if (!participationsRes.error && participationsRes.data) {
    for (const row of participationsRes.data) {
      participationMap.set(row.student_id, {
        participation_type:
          (row.participation_type as ParticipationType) ?? 'OFFICIAL',
        school_name: row.school_name ?? null,
      });
    }
  }

  const questions: Question[] = [];
  for (const row of linksRes.data ?? []) {
    const rawQ = Array.isArray(row.question) ? row.question[0] : row.question;
    if (!rawQ) continue;
    const poolQ = rawQ as PoolQuestion;

    questions.push({
      id: poolQ.id,
      exam_id: examId,
      question_number: row.question_number,
      subject: poolQ.subject,
      outcome_code: poolQ.outcome_code,
      outcome_title: poolQ.outcome_title,
      correct_option: poolQ.correct_option,
      question_type: poolQ.question_type ?? undefined,
      question_text: poolQ.question_text ?? undefined,
      options: poolQ.options ?? undefined,
      grade: poolQ.grade,
      unit: poolQ.unit,
      difficulty: poolQ.difficulty,
      svg_code: poolQ.svg_code,
      solution: poolQ.solution,
      distractor_analysis: poolQ.distractor_analysis,
    });
  }

  const answers = (answersRes.data ?? []) as StudentAnswer[];
  const studentIds = Array.from(new Set(answers.map((a) => a.student_id)));
  let students: Student[] = [];

  if (studentIds.length > 0) {
    const studentsRes = await supabase
      .from('students')
      .select('id, full_name, classroom')
      .in('id', studentIds);

    if (studentsRes.error) throw studentsRes.error;
    students = ((studentsRes.data ?? []) as Student[]).map((s) => {
      const part = participationMap.get(s.id);
      return {
        ...s,
        participation_type: part?.participation_type ?? 'OFFICIAL',
        school_name: part?.school_name ?? null,
      };
    });
  }

  const examRow = examRes.data as Exam;
  const linkedClassIds =
    !classLinksRes.error && classLinksRes.data && classLinksRes.data.length > 0
      ? classLinksRes.data.map((r) => r.classroom_id)
      : examRow.classroom_id
        ? [examRow.classroom_id]
        : [];

  const guestCount = students.filter(
    (s) => s.participation_type === 'GUEST'
  ).length;

  return {
    exam: {
      ...examRow,
      assigned_classroom_ids: linkedClassIds,
      participant_count: students.length,
      official_count: students.length - guestCount,
      guest_count: guestCount,
    },
    questions,
    students,
    answers,
  };
}

/**
 * Öğrenci sınavı bitirdiğinde öğrenci kaydını, telemetrili cevaplarını
 * ve Resmi/Misafir katılım kaydını kalıcı olarak kaydeder.
 */
export async function submitStudentExam(
  student: Student,
  answers: StudentAnswer[],
  userId?: string | null
): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase bağlantısı hazır değil.');
  }

  const { error: studentError } = await supabase.from('students').insert({
    id: student.id,
    full_name: student.full_name,
    classroom: student.classroom,
  });

  if (studentError) throw studentError;

  const { error: answersError } = await supabase
    .from('student_answers')
    .insert(answers);

  if (answersError) throw answersError;

  const examId = answers[0]?.exam_id;
  if (examId) {
    const { error: partError } = await supabase
      .from('exam_participations')
      .insert({
        exam_id: examId,
        student_id: student.id,
        user_id: userId ?? null,
        participation_type: student.participation_type ?? 'OFFICIAL',
        school_name: student.school_name ?? null,
      });

    if (partError) throw partError;
  }
}

/**
 * Giriş yapan öğrencinin daha önce tamamladığı sınavları getirir.
 */
export async function fetchStudentCompletedExams(
  userId: string
): Promise<StudentCompletedAttempt[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('exam_participations')
    .select('exam_id, student_id, participation_type, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as StudentCompletedAttempt[];
}

/**
 * Öğrencinin lobiden kendi sınıf seviyesini güncellemesini sağlar.
 */
export async function updateStudentGrade(
  userId: string,
  grade: number | null
): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from('profiles')
    .update({ grade })
    .eq('id', userId);

  if (error) throw error;
}

/**
 * Soru Ajanı JSON çıktısını hem Merkezi Havuza kaydeder hem de
 * otomatik sınav kodu (SNV-XXXX) ve sınıf seviyesiyle yeni sınava bağlar.
 */
export async function createExamFromAgentJson(params: {
  title: string;
  examDate: string;
  wrongPenaltyRatio: number;
  agentQuestions: AgentQuestionInput[];
}): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase bağlantısı hazır değil.');
  }

  const examId = `exam-${Date.now()}`;
  const inferredGrade =
    params.agentQuestions.find((q) => typeof q.sinif === 'number')?.sinif ??
    null;

  let inserted = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    const examCode = generateExamCode(attempt >= 5);
    const { error: examError } = await supabase.from('exams').insert({
      id: examId,
      title: params.title.trim(),
      exam_date: params.examDate,
      wrong_penalty_ratio: params.wrongPenaltyRatio,
      exam_scope: 'NATIONAL',
      allow_guests: true,
      status: 'PUBLISHED',
      show_solutions_after_finish: true,
      grade: inferredGrade,
      exam_code: examCode,
    });

    if (!examError) {
      inserted = true;
      break;
    }
    if (examError.code !== '23505') throw examError;
  }

  if (!inserted) {
    throw new Error('Benzersiz sınav kodu üretilemedi.');
  }

  const poolRows = params.agentQuestions.map((item, idx) => {
    const rawCorrect = String(item.dogruCevap ?? 'A')
      .trim()
      .toUpperCase() as ValidOption;
    const correctOption: ValidOption = VALID_OPTIONS.includes(rawCorrect)
      ? rawCorrect
      : 'A';

    const hasValidSvg =
      typeof item.svgKodu === 'string' && item.svgKodu.includes('<svg');

    return {
      id: `${examId}-q-${idx + 1}`,
      subject: item.ders?.trim() || 'Genel',
      grade: typeof item.sinif === 'number' ? item.sinif : null,
      unit: item.unite?.trim() || null,
      outcome_code: item.kazanimKodu?.trim() || `KZN-${idx + 1}`,
      outcome_title: item.kazanimAdi?.trim() || 'Kazanım açıklaması girilmedi',
      difficulty: item.zorluk?.trim() || null,
      question_text: item.soruMetni?.trim() || '',
      options: item.secenekler ?? {},
      correct_option: correctOption,
      svg_code: hasValidSvg ? item.svgKodu : null,
      solution: item.cozum?.trim() || null,
      distractor_analysis: item.celdiriciAnalizi ?? null,
    };
  });

  const { error: poolError } = await supabase
    .from('question_pool')
    .insert(poolRows);

  if (poolError) {
    await supabase.from('exams').delete().eq('id', examId);
    throw poolError;
  }

  const linkRows = poolRows.map((q, idx) => ({
    exam_id: examId,
    question_id: q.id,
    question_number: idx + 1,
  }));

  const { error: linkError } = await supabase
    .from('exam_questions')
    .insert(linkRows);

  if (linkError) {
    await supabase.from('exams').delete().eq('id', examId);
    throw linkError;
  }

  return examId;
}