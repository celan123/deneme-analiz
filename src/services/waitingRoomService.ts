import { supabase } from '../lib/supabase';

export interface WaitingStudentEntry {
  exam_id: string;
  user_id: string;
  full_name: string;
  classroom: string | null;
  joined_at: string;
}

/**
 * Öğrenciyi bekleme odasına kaydeder (sayfa yenilerse çakışma üretmez).
 */
export async function joinWaitingRoom(params: {
  examId: string;
  userId: string;
  fullName: string;
  classroom?: string | null;
}): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase.from('exam_waiting_room').upsert(
    {
      exam_id: params.examId,
      user_id: params.userId,
      full_name: params.fullName,
      classroom: params.classroom ?? null,
      joined_at: new Date().toISOString(),
    },
    { onConflict: 'exam_id,user_id' }
  );

  if (error) throw error;
}

/**
 * Öğrenci bekleme odasından kendi isteğiyle çıkarsa kaydını siler.
 */
export async function leaveWaitingRoom(
  examId: string,
  userId: string
): Promise<void> {
  if (!supabase) return;

  await supabase
    .from('exam_waiting_room')
    .delete()
    .eq('exam_id', examId)
    .eq('user_id', userId);
}

/**
 * Bir sınavın bekleme odasındaki (veya giriş yapmış) tüm öğrencilerini getirir.
 */
export async function fetchWaitingStudents(
  examId: string
): Promise<WaitingStudentEntry[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('exam_waiting_room')
    .select('exam_id, user_id, full_name, classroom, joined_at')
    .eq('exam_id', examId)
    .order('joined_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as WaitingStudentEntry[];
}

/**
 * Öğrencinin bekleme odasında öğretmenin "Şimdi Başlat" komutunu yakalaması için
 * sınavın güncel başlangıç/bitiş saatini kontrol eder.
 */
export async function fetchExamScheduleTimestamps(examId: string): Promise<{
  starts_at: string | null;
  ends_at: string | null;
  status: string | null;
} | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('exams')
    .select('starts_at, ends_at, status')
    .eq('id', examId)
    .single();

  if (error) return null;
  return data;
}

/**
 * Öğretmen "Sınavı Şimdi Başlat" dediğinde sınavı o an başlatır ve
 * bitiş saatini tanımlı süre (ör. 40 dk) kadar ileri ayarlar.
 */
export async function startExamNow(
  examId: string,
  durationMinutes: number
): Promise<{ starts_at: string; ends_at: string }> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const now = new Date();
  const ends = new Date(now.getTime() + Math.max(5, durationMinutes) * 60_000);
  const startsIso = now.toISOString();
  const endsIso = ends.toISOString();

  const { error } = await supabase
    .from('exams')
    .update({
      status: 'PUBLISHED',
      starts_at: startsIso,
      ends_at: endsIso,
    })
    .eq('id', examId);

  if (error) throw error;
  return { starts_at: startsIso, ends_at: endsIso };
}