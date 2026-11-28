import { supabase } from '../lib/supabase';
import type { PoolQuestion } from '../types/exam';

export type ReviewDecision = 'APPROVE' | 'REJECT';

export type ReviewablePoolQuestion = PoolQuestion & {
  curriculum_week?: number | null;
  review_status?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  approve_count?: number | null;
  reject_count?: number | null;
};

export async function fetchAvailablePoolSubjects(): Promise<string[]> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const { data, error } = await supabase
    .from('question_pool')
    .select('subject');

  if (error) throw error;

  const set = new Set<string>();
  (data ?? []).forEach((row: { subject?: string | null }) => {
    if (row.subject?.trim()) set.add(row.subject.trim());
  });

  return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'));
}

export async function updateReviewerSubject(
  userId: string,
  subject: string
): Promise<void> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const { error } = await supabase
    .from('profiles')
    .update({ subject })
    .eq('id', userId);

  if (error) throw error;
}

export async function fetchUnreviewedQuestions(
  reviewerId: string,
  subject: string
): Promise<{ questions: ReviewablePoolQuestion[]; reviewedCount: number }> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const [reviewsRes, poolRes] = await Promise.all([
    supabase
      .from('question_reviews')
      .select('question_id')
      .eq('reviewer_id', reviewerId),
    supabase
      .from('question_pool')
      .select('*')
      .eq('subject', subject)
      .order('created_at', { ascending: true }),
  ]);

  if (reviewsRes.error) throw reviewsRes.error;
  if (poolRes.error) throw poolRes.error;

  const reviewedIds = new Set(
    (reviewsRes.data ?? []).map((r: { question_id: string }) => r.question_id)
  );

  const allSubjectQuestions = (poolRes.data ?? []) as ReviewablePoolQuestion[];

  // Henüz bu öğretmenin oylamadığı soruları al, en az oy almış olanları öne sırala
  const unreviewed = allSubjectQuestions
    .filter((q) => !reviewedIds.has(q.id))
    .sort((a, b) => {
      const totalA = (a.approve_count ?? 0) + (a.reject_count ?? 0);
      const totalB = (b.approve_count ?? 0) + (b.reject_count ?? 0);
      return totalA - totalB;
    });

  return {
    questions: unreviewed,
    reviewedCount: reviewedIds.size,
  };
}

export async function submitQuestionReview(params: {
  questionId: string;
  reviewerId: string;
  decision: ReviewDecision;
  note?: string;
  durationSeconds?: number;
}): Promise<void> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const { error } = await supabase.from('question_reviews').upsert(
    {
      question_id: params.questionId,
      reviewer_id: params.reviewerId,
      decision: params.decision,
      note: params.note?.trim() || null,
      duration_seconds:
        typeof params.durationSeconds === 'number'
          ? params.durationSeconds
          : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'question_id,reviewer_id' }
  );

  if (error) throw error;
}

export async function fetchReviewerCount(reviewerId: string): Promise<number> {
  if (!supabase) return 0;

  const { count, error } = await supabase
    .from('question_reviews')
    .select('*', { count: 'exact', head: true })
    .eq('reviewer_id', reviewerId);

  if (error) return 0;
  return count ?? 0;
}

export interface AdminQuestionReviewRow {
  id: string;
  question_id: string;
  reviewer_id: string;
  decision: ReviewDecision;
  note: string | null;
  created_at: string;
  updated_at?: string | null;
  duration_seconds?: number | null;
}

export async function fetchAllQuestionReviews(): Promise<
  AdminQuestionReviewRow[]
> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('question_reviews')
    .select(
      'id, question_id, reviewer_id, decision, note, created_at, updated_at, duration_seconds'
    )
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as AdminQuestionReviewRow[];
}