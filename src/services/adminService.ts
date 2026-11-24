import { generateExamCode } from '../utils/codeGenerator';
import { supabase } from '../lib/supabase';
import type { UserProfile, UserRole } from '../types/auth';
import type {
  AgentQuestionInput,
  Exam,
  ExamScope,
  ExamStatus,
  PoolQuestion,
  ValidOption,
} from '../types/exam';

const VALID_OPTIONS: ValidOption[] = ['A', 'B', 'C', 'D', 'E'];

// ============================================================================
// 1. MERKEZİ SORU HAVUZU İŞLEMLERİ
// ============================================================================

export async function fetchQuestionPool(): Promise<PoolQuestion[]> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const { data, error } = await supabase
    .from('question_pool')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as PoolQuestion[];
}

export async function importQuestionsToPool(
  agentQuestions: AgentQuestionInput[],
  createdBy?: string
): Promise<number> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const batchPrefix = `pool-${Date.now()}`;
  const rows = agentQuestions.map((item, idx) => {
    const rawCorrect = String(item.dogruCevap ?? 'A')
      .trim()
      .toUpperCase() as ValidOption;
    const correctOption: ValidOption = VALID_OPTIONS.includes(rawCorrect)
      ? rawCorrect
      : 'A';

    const hasValidSvg =
      typeof item.svgKodu === 'string' && item.svgKodu.includes('<svg');

    return {
      id: `${batchPrefix}-${idx + 1}`,
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
      created_by: createdBy ?? null,
    };
  });

  const { error } = await supabase.from('question_pool').insert(rows);
  if (error) throw error;
  return rows.length;
}

export async function updatePoolQuestion(
  id: string,
  updates: Partial<PoolQuestion>
): Promise<PoolQuestion> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const { data, error } = await supabase
    .from('question_pool')
    .update({
      subject: updates.subject,
      grade: updates.grade,
      unit: updates.unit,
      outcome_code: updates.outcome_code,
      outcome_title: updates.outcome_title,
      difficulty: updates.difficulty,
      question_text: updates.question_text,
      correct_option: updates.correct_option,
      svg_code: updates.svg_code,
      solution: updates.solution,
      distractor_analysis: updates.distractor_analysis,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data as PoolQuestion;
}

export async function deletePoolQuestion(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');
  const { error } = await supabase.from('question_pool').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================================
// 2. OTOMATİK SINAV SİHİRBAZI VE YAYIN YÖNETİMİ
// ============================================================================

export async function createExamFromPoolSelection(params: {
  title: string;
  examDate: string;
  wrongPenaltyRatio: number;
  examScope: ExamScope;
  allowGuests: boolean;
  status: ExamStatus;
  showSolutionsAfterFinish: boolean;
  durationMinutes: number;
  questionIds: string[];
  ownerId?: string;
  startsAt?: string | null;
  endsAt?: string | null;
}): Promise<string> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');
  if (params.questionIds.length === 0) {
    throw new Error('Sınav oluşturmak için en az 1 soru seçilmelidir.');
  }

  const examId = `exam-${Date.now()}`;

  // Seçilen sorulardan sınıf seviyesini otomatik algıla
  const { data: gradeRows } = await supabase
    .from('question_pool')
    .select('grade')
    .in('id', params.questionIds)
    .not('grade', 'is', null)
    .limit(1);

  const inferredGrade = gradeRows?.[0]?.grade ?? null;

  let inserted = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    const examCode = generateExamCode(attempt >= 5);
    const { error: examError } = await supabase.from('exams').insert({
      starts_at: params.startsAt ?? null,
      ends_at: params.endsAt ?? null,
      id: examId,
      title: params.title.trim(),
      exam_date: params.examDate,
      wrong_penalty_ratio: params.wrongPenaltyRatio,
      exam_scope: params.examScope,
      allow_guests: params.allowGuests,
      status: params.status,
      show_solutions_after_finish: params.showSolutionsAfterFinish,
      duration_minutes: params.durationMinutes,
      owner_id: params.ownerId ?? null,
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

  const linkRows = params.questionIds.map((qId, idx) => ({
    exam_id: examId,
    question_id: qId,
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

export async function updateExamSettings(
  examId: string,
  updates: Partial<
    Pick<
      Exam,
      'status' | 'allow_guests' | 'show_solutions_after_finish' | 'exam_scope' | 'starts_at' | 'ends_at'
      | 'ends_at'
    >
  >
): Promise<void> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');
  const { error } = await supabase
    .from('exams')
    .update(updates)
    .eq('id', examId);

  if (error) throw error;
}

export async function deleteExam(examId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');
  const { error } = await supabase.from('exams').delete().eq('id', examId);
  if (error) throw error;
}

// ============================================================================
// 3. KULLANICI VE ROL YÖNETİMİ
// ============================================================================

export async function fetchAllProfiles(): Promise<UserProfile[]> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, school_name, grade, classroom')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as UserProfile[];
}

export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<void> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId);

  if (error) throw error;
}