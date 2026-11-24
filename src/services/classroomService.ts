import { supabase } from '../lib/supabase';
import type {
  ClassroomMember,
  ClassroomWithDetails,
  StudentEnrolledClassroom,
} from '../types/classroom';

// Tahtada okunması ve yazılması kolay, Türkçe özel karakter çakışması yaratmayan 4 harfli kelimeler
const FOUR_LETTER_WORDS = [
  'ALAN', 'ALEV', 'ARPA', 'ARZU', 'AYNA', 'AYVA', 'BALE', 'BORA', 'BOYA',
  'DAMA', 'DEPO', 'DERS', 'DEVA', 'DOST', 'EBRU', 'EFOR', 'EKOL', 'ELMA',
  'EMEL', 'ESER', 'ETAP', 'FARK', 'FUAR', 'GALA', 'GOLF', 'GRUP', 'HALE',
  'HANE', 'HAVA', 'HECE', 'JALE', 'JEST', 'JUDO', 'KALE', 'KAMP', 'KANO',
  'KARA', 'KARE', 'KART', 'KASA', 'KASE', 'KAYA', 'KENT', 'KONU', 'KORO',
  'KOTA', 'KOZA', 'KRAL', 'KUPA', 'KURS', 'KUTU', 'KUZU', 'LALE', 'LENS',
  'LOGO', 'MARS', 'MART', 'MASA', 'MAYA', 'MERA', 'MERT', 'MODA', 'MOLA',
  'NANE', 'NEON', 'NOTA', 'OBJE', 'OCAK', 'ODAK', 'OKUL', 'OLAY', 'OLGU',
  'OLTA', 'OMUZ', 'ONAY', 'ONUR', 'OPAL', 'ORAN', 'ORDU', 'ORTA', 'OTEL',
  'OVAL', 'OYUN', 'OZAN', 'OZON', 'PANO', 'PARK', 'PLAK', 'PLAN', 'POLO',
  'POTA', 'PUAN', 'PUMA', 'ROKA', 'ROTA', 'RULO', 'SADE', 'SAHA', 'SEDA',
  'SEMA', 'SERA', 'SOBA', 'SODA', 'SOLO', 'SORU', 'SPOR', 'STAR', 'TANE',
  'TAZE', 'TEMA', 'TEPE', 'TERE', 'TEST', 'TOST', 'TREN', 'TUNA', 'UFUK',
  'ULAK', 'ULUS', 'UMUT', 'USUL', 'UYAK', 'UYKU', 'UYUM', 'UZAY', 'UZUN',
  'VAHA', 'VAZO', 'VEFA', 'VOLT', 'YAKA', 'YASA', 'YAYA', 'YELE', 'YOGA',
  'YURT', 'YUVA', 'ZARF', 'ZEKA',
] as const;

function toAsciiUpper(text: string): string {
  return text
    .replace(/ç/gi, 'C')
    .replace(/ğ/gi, 'G')
    .replace(/ı/g, 'I')
    .replace(/i/g, 'I')
    .replace(/İ/g, 'I')
    .replace(/ö/gi, 'O')
    .replace(/ş/gi, 'S')
    .replace(/ü/gi, 'U')
    .toUpperCase();
}

function normalizePrefix(name: string): string {
  const ascii = toAsciiUpper(name).replace(/[^A-Z0-9]/g, '');
  return ascii.slice(0, 2) || 'SN';
}

export function generateInviteCode(
  className: string,
  withNumericSuffix = false
): string {
  const prefix = normalizePrefix(className);
  const word =
    FOUR_LETTER_WORDS[Math.floor(Math.random() * FOUR_LETTER_WORDS.length)];

  if (!withNumericSuffix) {
    return `${prefix}-${word}`;
  }

  const num = Math.floor(10 + Math.random() * 90);
  return `${prefix}-${word}${num}`;
}

/**
 * Öğretmenin (veya Admin ise tüm okulun) sınıflarını ve kayıtlı öğrencilerini getirir.
 */
export async function fetchTeacherClassrooms(
  teacherId: string,
  isAdmin: boolean
): Promise<ClassroomWithDetails[]> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  let query = supabase
    .from('classrooms')
    .select(
      'id, teacher_id, name, grade, invite_code, created_at, teacher:profiles!classrooms_teacher_id_fkey(full_name)'
    )
    .order('created_at', { ascending: false });

  if (!isAdmin) {
    query = query.eq('teacher_id', teacherId);
  }

  const { data: classRows, error: classErr } = await query;
  if (classErr) throw classErr;
  if (!classRows || classRows.length === 0) return [];

  const classIds = classRows.map((c) => c.id);
  const { data: memberRows, error: memberErr } = await supabase
    .from('classroom_members')
    .select(
      'classroom_id, student_id, joined_at, profile:profiles!classroom_members_student_id_fkey(full_name, school_name, classroom)'
    )
    .in('classroom_id', classIds)
    .order('joined_at', { ascending: false });

  if (memberErr) throw memberErr;

  const membersByClass = new Map<string, ClassroomMember[]>();
  for (const row of memberRows ?? []) {
    const rawProfile = Array.isArray(row.profile)
      ? row.profile[0]
      : row.profile;
    const member: ClassroomMember = {
      classroom_id: row.classroom_id,
      student_id: row.student_id,
      joined_at: row.joined_at,
      full_name: rawProfile?.full_name ?? 'İsimsiz Öğrenci',
      school_name: rawProfile?.school_name ?? null,
      classroom: rawProfile?.classroom ?? null,
    };
    const list = membersByClass.get(row.classroom_id) ?? [];
    list.push(member);
    membersByClass.set(row.classroom_id, list);
  }

  return classRows.map((c) => {
    const rawTeacher = Array.isArray(c.teacher) ? c.teacher[0] : c.teacher;
    return {
      id: c.id,
      teacher_id: c.teacher_id,
      teacher_name: rawTeacher?.full_name ?? 'Öğretmen',
      name: c.name,
      grade: c.grade,
      invite_code: c.invite_code,
      created_at: c.created_at,
      members: membersByClass.get(c.id) ?? [],
    };
  });
}

export async function createClassroom(params: {
  teacherId: string;
  name: string;
  grade: number | null;
}): Promise<void> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  // Aynı kod başka bir sınıfta kullanılmışsa otomatik yeni kelime dene
  for (let attempt = 0; attempt < 8; attempt++) {
    const inviteCode = generateInviteCode(params.name, attempt >= 5);
    const { error } = await supabase.from('classrooms').insert({
      teacher_id: params.teacherId,
      name: params.name.trim(),
      grade: params.grade,
      invite_code: inviteCode,
    });

    if (!error) return;
    if (error.code !== '23505') throw error;
  }

  throw new Error('Benzersiz davet kodu üretilemedi, lütfen tekrar dene.');
}

export async function regenerateClassroomCode(
  classroomId: string,
  className: string
): Promise<string> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  for (let attempt = 0; attempt < 8; attempt++) {
    const nextCode = generateInviteCode(className, attempt >= 5);
    const { error } = await supabase
      .from('classrooms')
      .update({ invite_code: nextCode })
      .eq('id', classroomId);

    if (!error) return nextCode;
    if (error.code !== '23505') throw error;
  }

  throw new Error('Benzersiz davet kodu üretilemedi, lütfen tekrar dene.');
}

export async function deleteClassroom(classroomId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const { error } = await supabase
    .from('classrooms')
    .delete()
    .eq('id', classroomId);

  if (error) throw error;
}

export async function removeStudentFromClassroom(
  classroomId: string,
  studentId: string
): Promise<void> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const { error } = await supabase
    .from('classroom_members')
    .delete()
    .eq('classroom_id', classroomId)
    .eq('student_id', studentId);

  if (error) throw error;
}

/**
 * Bir sınavı belirtilen sınıfa atar (classroomId = null verilirse Türkiye Geneli'ne çevirir).
 */
export async function assignExamToClassroom(
  examId: string,
  classroomId: string | null
): Promise<void> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const { error } = await supabase
    .from('exams')
    .update({
      classroom_id: classroomId,
      exam_scope: classroomId ? 'CLASSROOM' : 'NATIONAL',
    })
    .eq('id', examId);

  if (error) throw error;
}

/**
 * Öğrenci davet koduyla öğretmenin sınıfına katılır.
 */
export async function joinClassroomByCode(
  rawCode: string,
  studentId: string
): Promise<{ classroomName: string }> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const code = toAsciiUpper(rawCode.trim()).replace(/\s+/g, '-');
  if (!code) throw new Error('Lütfen geçerli bir davet kodu gir.');

  const { data: room, error: findErr } = await supabase
    .from('classrooms')
    .select('id, name')
    .eq('invite_code', code)
    .maybeSingle();

  if (findErr) throw findErr;
  if (!room) {
    throw new Error(
      `"${code}" koduna ait bir sınıf bulunamadı. Kodu kontrol et.`
    );
  }

  const { error: joinErr } = await supabase.from('classroom_members').insert({
    classroom_id: room.id,
    student_id: studentId,
  });

  if (joinErr) {
    if (joinErr.code === '23505') {
      throw new Error(`"${room.name}" sınıfına zaten kayıtlısın.`);
    }
    throw joinErr;
  }

  return { classroomName: room.name };
}

/**
 * Öğrencinin kayıtlı olduğu sınıfları listeler.
 */
export async function fetchStudentClassrooms(
  studentId: string
): Promise<StudentEnrolledClassroom[]> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const { data, error } = await supabase
    .from('classroom_members')
    .select(
      'classroom_id, joined_at, room:classrooms!classroom_members_classroom_id_fkey(name, grade, invite_code, teacher:profiles!classrooms_teacher_id_fkey(full_name))'
    )
    .eq('student_id', studentId)
    .order('joined_at', { ascending: false });

  if (error) throw error;

  const result: StudentEnrolledClassroom[] = [];
  for (const row of data ?? []) {
    const rawRoom = Array.isArray(row.room) ? row.room[0] : row.room;
    if (!rawRoom) continue;
    const rawTeacher = Array.isArray(rawRoom.teacher)
      ? rawRoom.teacher[0]
      : rawRoom.teacher;

    result.push({
      classroom_id: row.classroom_id,
      name: rawRoom.name,
      grade: rawRoom.grade ?? null,
      invite_code: rawRoom.invite_code,
      teacher_name: rawTeacher?.full_name ?? 'Öğretmen',
      joined_at: row.joined_at,
    });
  }
  

  return result;
}
/**
 * Bir sınavın atandığı sınıfları toplu günceller (boş dizi verilirse Türkiye Geneli olur).
 */
export async function setExamClassrooms(
  examId: string,
  classroomIds: string[]
): Promise<void> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const uniqueIds = Array.from(new Set(classroomIds));

  const { error: delErr } = await supabase
    .from('exam_classrooms')
    .delete()
    .eq('exam_id', examId);

  if (delErr) throw delErr;

  if (uniqueIds.length > 0) {
    const { error: insErr } = await supabase.from('exam_classrooms').insert(
      uniqueIds.map((classroom_id) => ({
        exam_id: examId,
        classroom_id,
      }))
    );
    if (insErr) throw insErr;
  }

  const { error: examErr } = await supabase
    .from('exams')
    .update({
      classroom_id: uniqueIds[0] ?? null,
      exam_scope: uniqueIds.length > 0 ? 'CLASSROOM' : 'NATIONAL',
    })
    .eq('id', examId);

  if (examErr) throw examErr;
}
export interface ExamAttendanceEntry {
  user_id: string;
  participation_type: 'OFFICIAL' | 'GUEST';
  created_at: string;
}

/**
 * Bir sınava kullanıcı hesabıyla katılan öğrencileri yoklama eşleştirmesi için döndürür.
 */
export async function fetchExamAttendanceMap(
  examId: string
): Promise<Record<string, ExamAttendanceEntry>> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');

  const { data, error } = await supabase
    .from('exam_participations')
    .select('user_id, participation_type, created_at')
    .eq('exam_id', examId)
    .not('user_id', 'is', null);

  if (error) throw error;

  const map: Record<string, ExamAttendanceEntry> = {};
  for (const row of data ?? []) {
    if (!row.user_id) continue;
    map[row.user_id] = {
      user_id: row.user_id,
      participation_type:
        row.participation_type === 'GUEST' ? 'GUEST' : 'OFFICIAL',
      created_at: row.created_at,
    };
  }
  return map;
}