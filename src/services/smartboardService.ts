import { supabase } from '../lib/supabase';
import type { ExamDataset, Question, ValidOption } from '../types/exam';
import { fetchExamDataset } from './examService';

export interface SmartboardOptionCounts {
  A: number;
  B: number;
  C: number;
  D: number;
  E: number;
  BLANK: number;
}

export interface SmartboardClassQuestionStat {
  total: number;
  correct: number;
  wrong: number;
  blank: number;
  missRate: number; // (yanlış + boş) yüzdesi
  optionCounts: SmartboardOptionCounts;
}

export interface SmartboardQuestionItem {
  id: string;
  question_number: number;
  question_text: string;
  outcome_code: string | null;
  outcome_title: string;
  subject: string | null;
  svg_code: string | null;
  options: Partial<Record<ValidOption, string>>;
  correct_option: ValidOption;
  solution_text: string | null;
  statsByClass: Record<string, SmartboardClassQuestionStat>;
}

export interface SmartboardPayload {
  examId: string;
  examTitle: string;
  examCode: string | null;
  examDate: string;
  teacherName: string;
  generatedAt: string;
  classrooms: string[];
  classSizes: Record<string, number>;
  questions: SmartboardQuestionItem[];
}

export interface CreatedSmartboardCode {
  code: string;
  expiresAt: string;
  examTitle: string;
  payload: SmartboardPayload;
}

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_DIGITS = '23456789';
const CODE_TTL_MS = 3 * 60 * 1000; // 3 dakika

function randomChar(pool: string): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Karışmayan harf ve rakamlardan oluşan 5 haneli kod üretir (ör. K7M4P) */
export function generateFiveCharCode(): string {
  const chars = [
    randomChar(CODE_LETTERS),
    randomChar(CODE_LETTERS),
    randomChar(CODE_LETTERS),
    randomChar(CODE_DIGITS),
    randomChar(CODE_DIGITS),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

type ExtendedQuestion = Question & {
  outcome_code?: string | null;
  subject?: string | null;
  solution_text?: string | null;
  solution?: string | null;
  svg?: string | null;
  svgCode?: string | null;
  visual_svg?: string | null;
};

function normalizeSvgString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw
    .trim()
    .replace(/^```(?:svg|xml|html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractSvgFromRow(row: Record<string, unknown>): string | null {
  return (
    normalizeSvgString(row.svg_code) ??
    normalizeSvgString(row.svg) ??
    normalizeSvgString(row.svgCode) ??
    normalizeSvgString(row.visual_svg)
  );
}

/**
 * fetchExamDataset içinde svg_code eksik kaldıysa questions ve question_pool
 * tablolarından yedek olarak SVG kodlarını tamamlar.
 */
async function hydrateMissingSvgs(
  examId: string,
  questions: SmartboardQuestionItem[]
): Promise<SmartboardQuestionItem[]> {
  if (!supabase) return questions;
  const hasMissing = questions.some((q) => !q.svg_code);
  if (!hasMissing) return questions;

  try {
    const { data: qRows } = await supabase
      .from('questions')
      .select('*')
      .eq('exam_id', examId);

    if (!qRows || qRows.length === 0) return questions;

    const svgByQuestionId = new Map<string, string>();
    const poolIdByQuestionId = new Map<string, string>();
    const poolIdsToFetch = new Set<string>();

    for (const rawRow of qRows as Record<string, unknown>[]) {
      const qId = typeof rawRow.id === 'string' ? rawRow.id : null;
      if (!qId) continue;

      const foundSvg = extractSvgFromRow(rawRow);
      if (foundSvg) {
        svgByQuestionId.set(qId, foundSvg);
      } else {
        const poolId =
          (typeof rawRow.pool_question_id === 'string' &&
            rawRow.pool_question_id) ||
          (typeof rawRow.question_pool_id === 'string' &&
            rawRow.question_pool_id) ||
          null;
        if (poolId) {
          poolIdByQuestionId.set(qId, poolId);
          poolIdsToFetch.add(poolId);
        }
      }
    }

    if (poolIdsToFetch.size > 0) {
      const { data: poolRows } = await supabase
        .from('question_pool')
        .select('id, svg_code')
        .in('id', Array.from(poolIdsToFetch));

      const svgByPoolId = new Map<string, string>();
      for (const pRow of (poolRows ?? []) as Record<string, unknown>[]) {
        const pId = typeof pRow.id === 'string' ? pRow.id : null;
        const pSvg = extractSvgFromRow(pRow);
        if (pId && pSvg) {
          svgByPoolId.set(pId, pSvg);
        }
      }

      for (const [qId, poolId] of poolIdByQuestionId.entries()) {
        const pSvg = svgByPoolId.get(poolId);
        if (pSvg) svgByQuestionId.set(qId, pSvg);
      }
    }

    return questions.map((q) => ({
      ...q,
      svg_code: q.svg_code ?? svgByQuestionId.get(q.id) ?? null,
    }));
  } catch {
    return questions;
  }
}

/**
 * Sınav verisinden öğrenci isimlerini tamamen temizleyerek salt okunur
 * şube bazlı Akıllı Tahta paketi oluşturur.
 */
export function buildSmartboardPayload(
  dataset: ExamDataset,
  teacherName: string
): SmartboardPayload {
  const officialStudents = dataset.students.filter(
    (s) => s.participation_type !== 'GUEST'
  );
  const activeStudents =
    officialStudents.length > 0 ? officialStudents : dataset.students;

  const studentClassMap = new Map<string, string>();
  const classSizes: Record<string, number> = { ALL: activeStudents.length };
  const classSet = new Set<string>();

  for (const stu of activeStudents) {
    const cls = (stu.classroom || 'Genel').trim() || 'Genel';
    studentClassMap.set(stu.id, cls);
    classSet.add(cls);
    classSizes[cls] = (classSizes[cls] ?? 0) + 1;
  }

  const classrooms = Array.from(classSet).sort((a, b) =>
    a.localeCompare(b, 'tr')
  );

  const answersByQuestion = new Map<
    string,
    Array<{ classroom: string; selected: string | null }>
  >();

  for (const ans of dataset.answers) {
    const cls = studentClassMap.get(ans.student_id);
    if (!cls) continue;
    let list = answersByQuestion.get(ans.question_id);
    if (!list) {
      list = [];
      answersByQuestion.set(ans.question_id, list);
    }
    list.push({ classroom: cls, selected: ans.selected_option });
  }

  const computeStat = (
    rows: Array<{ selected: string | null }>,
    correctOption: ValidOption,
    expectedTotal: number
  ): SmartboardClassQuestionStat => {
    const optionCounts: SmartboardOptionCounts = {
      A: 0,
      B: 0,
      C: 0,
      D: 0,
      E: 0,
      BLANK: 0,
    };
    let correct = 0;
    let wrong = 0;
    let blank = 0;

    for (const r of rows) {
      const opt = r.selected?.toUpperCase() as ValidOption | undefined;
      if (!opt || !(opt in optionCounts)) {
        blank += 1;
        optionCounts.BLANK += 1;
      } else {
        optionCounts[opt] += 1;
        if (opt === correctOption) correct += 1;
        else wrong += 1;
      }
    }

    const missingRows = Math.max(0, expectedTotal - rows.length);
    blank += missingRows;
    optionCounts.BLANK += missingRows;

    const total = Math.max(expectedTotal, correct + wrong + blank);
    const missRate =
      total > 0 ? Math.round(((wrong + blank) / total) * 100) : 0;

    return { total, correct, wrong, blank, missRate, optionCounts };
  };

  const sortedQuestions = [...dataset.questions].sort(
    (a, b) => a.question_number - b.question_number
  );

  const questions: SmartboardQuestionItem[] = sortedQuestions.map((rawQ) => {
    const q = rawQ as ExtendedQuestion;
    const qAnswers = answersByQuestion.get(q.id) ?? [];
    const statsByClass: Record<string, SmartboardClassQuestionStat> = {
      ALL: computeStat(qAnswers, q.correct_option, classSizes.ALL),
    };

    for (const cls of classrooms) {
      const clsRows = qAnswers.filter((a) => a.classroom === cls);
      statsByClass[cls] = computeStat(
        clsRows,
        q.correct_option,
        classSizes[cls] ?? 0
      );
    }

    return {
      id: q.id,
      question_number: q.question_number,
      question_text: q.question_text ?? q.outcome_title,
      outcome_code: q.outcome_code ?? null,
      outcome_title: q.outcome_title,
      subject: q.subject ?? null,
      svg_code: extractSvgFromRow(q as unknown as Record<string, unknown>),
      options: q.options ?? {},
      correct_option: q.correct_option,
      solution_text: q.solution_text ?? q.solution ?? null,
      statsByClass,
    };
  });

  return {
    examId: dataset.exam.id,
    examTitle: dataset.exam.title,
    examCode: dataset.exam.exam_code ?? null,
    examDate: dataset.exam.exam_date,
    teacherName,
    generatedAt: new Date().toISOString(),
    classrooms,
    classSizes,
    questions,
  };
}

/**
 * Öğretmenin telefonundan/panelinden 3 dakika geçerli 5 haneli Akıllı Tahta kodu üretir.
 */
export async function createSmartboardCode(params: {
  examId: string;
  teacherId: string;
  teacherName: string;
}): Promise<CreatedSmartboardCode> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const dataset = await fetchExamDataset(params.examId);
  const rawPayload = buildSmartboardPayload(dataset, params.teacherName);
  const hydratedQuestions = await hydrateMissingSvgs(
    dataset.exam.id,
    rawPayload.questions
  );
  const payload: SmartboardPayload = {
    ...rawPayload,
    questions: hydratedQuestions,
  };

  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateFiveCharCode();
    const { error } = await supabase.from('smartboard_sessions').insert({
      code,
      teacher_id: params.teacherId,
      exam_id: dataset.exam.id,
      exam_title: dataset.exam.title,
      payload,
      expires_at: expiresAt,
    });

    if (!error) {
      return {
        code,
        expiresAt,
        examTitle: dataset.exam.title,
        payload,
      };
    }

    if (error.code !== '23505') {
      throw error;
    }
  }

  throw new Error('Kod üretilemedi, lütfen tekrar deneyin.');
}

/**
 * Akıllı tahtadan girilen 5 haneli kodu doğrular, tüketir ve salt okunur paketi döndürür.
 */
export async function claimSmartboardCode(
  rawCode: string
): Promise<SmartboardPayload> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const cleaned = rawCode.replace(/\s+/g, '').toUpperCase();
  if (cleaned.length !== 5) {
    throw new Error('Lütfen 5 haneli tahta kodunu eksiksiz girin.');
  }

  const { data, error } = await supabase.rpc('claim_smartboard_code', {
    p_code: cleaned,
  });

  if (error) {
    throw new Error(error.message || 'Kod doğrulanırken hata oluştu.');
  }

  const res = data as {
    ok?: boolean;
    error?: string;
    payload?: SmartboardPayload;
  } | null;

  if (!res?.ok || !res.payload) {
    throw new Error(
      res?.error || 'Kod geçersiz veya 3 dakikalık süresi dolmuş.'
    );
  }

  return res.payload;
}