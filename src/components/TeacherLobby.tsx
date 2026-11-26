import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  createExamFromPoolSelection,
  fetchQuestionPool,
  updateExamSettings,
} from '../services/adminService';
import {
  createClassroom,
  deleteClassroom,
  fetchTeacherClassrooms,
  regenerateClassroomCode,
  removeStudentFromClassroom,
  setExamClassrooms,
} from '../services/classroomService';
import type { SmartboardPayload } from '../services/smartboardService';
import type { ClassroomWithDetails } from '../types/classroom';
import type { Exam, ExamStatus } from '../types/exam';
import {
  formatScheduleWindow,
  fromDatetimeLocalValue,
  getExamScheduleState,
  toDatetimeLocalValue,
} from '../utils/examSchedule';
import {
  CurriculumTimelineSelector,
  type PoolQuestionWithWeek,
  type SubjectCurriculumSelection,
} from './CurriculumTimelineSelector';
import { ExamAttendanceDrawer } from './ExamAttendanceDrawer';
import { SmartboardCodeModal } from './SmartboardCodeModal';

interface TeacherLobbyProps {
  teacherId: string;
  teacherName: string;
  isAdmin: boolean;
  exams: Exam[];
  onExamsChanged: (focusExamId?: string) => Promise<void>;
  onOpenAnalytics: (examId: string) => void;
  onPreviewExam: (examId: string) => void;
  onOpenJsonImport: () => void;
  onOpenSmartboardLocal: (payload: SmartboardPayload) => void;
}

type TeacherTab = 'EXAMS' | 'CLASSROOMS';
type ExamPresetMode = 'CUSTOM' | 'SINGLE_SUBJECT' | 'LGS' | 'YKS';

type PoolQuestionExtended = PoolQuestionWithWeek & {
  grade?: number | null;
};

interface TeacherInviteRow {
  id: string;
  code: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

interface CreateInviteRpcResponse {
  ok: boolean;
  id?: string;
  code?: string;
  expires_at?: string;
  error?: string;
}

const GRADE_LEVELS = [5, 6, 7, 8, 9, 10, 11, 12];

const LGS_SUBJECT_QUOTAS: Record<string, number> = {
  Türkçe: 20,
  'T.C. İnkılap Tarihi': 10,
  'Din Kültürü': 10,
  İngilizce: 10,
  Matematik: 20,
  'Fen Bilimleri': 20,
};

const YKS_SUBJECT_QUOTAS: Record<string, number> = {
  Türkçe: 40,
  'Sosyal Bilimler': 20,
  Matematik: 40,
  'Fen Bilimleri': 20,
};

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getAssignedClassIds(ex: Exam): string[] {
  if (ex.assigned_classroom_ids && ex.assigned_classroom_ids.length > 0) {
    return ex.assigned_classroom_ids;
  }
  return ex.classroom_id ? [ex.classroom_id] : [];
}

function getTonightPreset(): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const ymd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return { start: `${ymd}T20:00`, end: `${ymd}T20:40` };
}

function formatInviteDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const TeacherLobby: React.FC<TeacherLobbyProps> = ({
  teacherId,
  teacherName,
  isAdmin,
  exams,
  onExamsChanged,
  onOpenAnalytics,
  onPreviewExam,
  onOpenJsonImport,
  onOpenSmartboardLocal,
}) => {
  const [activeTab, setActiveTab] = useState<TeacherTab>('EXAMS');
  const [classrooms, setClassrooms] = useState<ClassroomWithDetails[]>([]);
  const [loadingRooms, setLoadingRooms] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Öğretmen Davet Kodu Modalı (Tek Kullanımlık + Süreli)
  const [showInviteModal, setShowInviteModal] = useState<boolean>(false);
  const [inviteHours, setInviteHours] = useState<number>(24);
  const [invites, setInvites] = useState<TeacherInviteRow[]>([]);
  const [loadingInvites, setLoadingInvites] = useState<boolean>(false);
  const [creatingInvite, setCreatingInvite] = useState<boolean>(false);

  // Sınav Ayarları Modalı (Durum, Misafir, Çoklu Sınıf Atama, Zamanlı Pencere)
  const [settingsExam, setSettingsExam] = useState<Exam | null>(null);
  const [draftStatus, setDraftStatus] = useState<ExamStatus>('PUBLISHED');
  const [draftAllowGuests, setDraftAllowGuests] = useState<boolean>(true);
  const [draftClassIds, setDraftClassIds] = useState<string[]>([]);
  const [draftStartsAt, setDraftStartsAt] = useState<string>('');
  const [draftEndsAt, setDraftEndsAt] = useState<string>('');
  const [savingSettings, setSavingSettings] = useState<boolean>(false);

  // Canlı Bekleme Odası / Katılım Yoklaması modalı
  const [attendanceExam, setAttendanceExam] = useState<Exam | null>(null);

  // Güvenli Akıllı Tahta Kodu modalı
  const [smartboardModalExamId, setSmartboardModalExamId] = useState<
    string | null
  >(null);
  const [showSmartboardModal, setShowSmartboardModal] =
    useState<boolean>(false);

  // Sınıflarım sekmesi: Yeni sınıf oluşturma
  const [newClassName, setNewClassName] = useState<string>('');
  const [newGrade, setNewGrade] = useState<string>('5');
  const [creatingRoom, setCreatingRoom] = useState<boolean>(false);

  // "+ Yeni Sınav Hazırla" çekmecesi
  const [showCreator, setShowCreator] = useState<boolean>(false);
  const [pool, setPool] = useState<PoolQuestionExtended[]>([]);
  const [loadingPool, setLoadingPool] = useState<boolean>(false);
  const today = new Date().toISOString().slice(0, 10);
  const [wizTitle, setWizTitle] = useState<string>('');
  const [wizDate, setWizDate] = useState<string>(today);
  const [wizPenalty, setWizPenalty] = useState<number>(0.333);
  const [wizDuration, setWizDuration] = useState<number>(40);
  const [wizAllowGuests, setWizAllowGuests] = useState<boolean>(true);
  const [wizStartsAt, setWizStartsAt] = useState<string>('');
  const [wizEndsAt, setWizEndsAt] = useState<string>('');
  const [wizLevels, setWizLevels] = useState<number[]>([5]);
  const [wizPresetMode, setWizPresetMode] = useState<ExamPresetMode>('CUSTOM');
  const [wizSingleSubject, setWizSingleSubject] = useState<string>('');
  const [wizStartWeek, setWizStartWeek] = useState<number>(1);
  const [wizEndWeek, setWizEndWeek] = useState<number>(10);
  const [wizClassIds, setWizClassIds] = useState<string[]>([]);
  const [wizSubjectSelections, setWizSubjectSelections] = useState<
    Record<string, SubjectCurriculumSelection>
  >({});
  const [creatingExam, setCreatingExam] = useState<boolean>(false);

  const loadClassrooms = useCallback(async () => {
    setLoadingRooms(true);
    try {
      const data = await fetchTeacherClassrooms(teacherId, isAdmin);
      setClassrooms(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sınıflar yüklenemedi.';
      setFeedback({ type: 'err', text: msg });
    } finally {
      setLoadingRooms(false);
    }
  }, [teacherId, isAdmin]);

  const loadTeacherInvites = useCallback(async () => {
    if (!supabase) return;
    setLoadingInvites(true);
    try {
      const { data, error } = await supabase
        .from('teacher_invites')
        .select('id, code, expires_at, used_at, created_at')
        .eq('created_by', teacherId)
        .order('created_at', { ascending: false })
        .limit(12);

      if (error) throw error;
      setInvites((data ?? []) as TeacherInviteRow[]);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Davet kodları yüklenemedi.';
      setFeedback({ type: 'err', text: msg });
    } finally {
      setLoadingInvites(false);
    }
  }, [teacherId]);

  useEffect(() => {
    loadClassrooms();
  }, [loadClassrooms]);

  useEffect(() => {
    if (showInviteModal) {
      loadTeacherInvites();
    }
  }, [showInviteModal, loadTeacherInvites]);

  useEffect(() => {
    if (!showCreator || pool.length > 0) return;
    setLoadingPool(true);
    fetchQuestionPool()
      .then((data) => setPool(data as PoolQuestionExtended[]))
      .catch((err) => {
        const msg =
          err instanceof Error ? err.message : 'Soru havuzu yüklenemedi.';
        setFeedback({ type: 'err', text: msg });
      })
      .finally(() => setLoadingPool(false));
  }, [showCreator, pool.length]);

  const roomNameMap = useMemo(() => {
    const map = new Map<string, ClassroomWithDetails>();
    classrooms.forEach((c) => map.set(c.id, c));
    return map;
  }, [classrooms]);

  const myClassroomIds = useMemo(
    () => new Set(classrooms.map((c) => c.id)),
    [classrooms]
  );

  // Sınav sahipliği izolasyonu: sadece kendi sınavı veya kendi sınıfına atananlar
  const visibleExams = useMemo(() => {
    if (isAdmin) return exams;
    return exams.filter((ex) => {
      if (ex.owner_id === teacherId) return true;
      return getAssignedClassIds(ex).some((cid) => myClassroomIds.has(cid));
    });
  }, [exams, isAdmin, teacherId, myClassroomIds]);

  const totalStudents = useMemo(
    () => classrooms.reduce((sum, c) => sum + c.members.length, 0),
    [classrooms]
  );

  // Seviyeye göre filtrelenmiş sınıflar
  const filteredClassroomsForWizard = useMemo(() => {
    if (wizLevels.length === 0) return classrooms;
    return classrooms.filter(
      (c) => c.grade == null || wizLevels.includes(c.grade)
    );
  }, [classrooms, wizLevels]);

  // Seviyeye göre filtrelenmiş soru havuzu
  const filteredPoolForWizard = useMemo(() => {
    if (wizLevels.length === 0) return pool;
    return pool.filter((q) => q.grade == null || wizLevels.includes(q.grade));
  }, [pool, wizLevels]);

  const availableSubjects = useMemo(() => {
    const set = new Set<string>();
    filteredPoolForWizard.forEach((q) => {
      if (q.subject) set.add(q.subject);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [filteredPoolForWizard]);

  // Tek ders modunda varsayılan dersi seç
  useEffect(() => {
    if (
      wizPresetMode === 'SINGLE_SUBJECT' &&
      !wizSingleSubject &&
      availableSubjects.length > 0
    ) {
      setWizSingleSubject(availableSubjects[0]);
    }
  }, [wizPresetMode, wizSingleSubject, availableSubjects]);

  const isQuestionCountLocked =
    wizPresetMode === 'LGS' || wizPresetMode === 'YKS';

  const visibleSubjectsForWizard = useMemo(() => {
    if (wizPresetMode === 'LGS') return Object.keys(LGS_SUBJECT_QUOTAS);
    if (wizPresetMode === 'YKS') return Object.keys(YKS_SUBJECT_QUOTAS);
    if (wizPresetMode === 'SINGLE_SUBJECT') {
      return wizSingleSubject ? [wizSingleSubject] : [];
    }
    return availableSubjects;
  }, [wizPresetMode, wizSingleSubject, availableSubjects]);

  const totalWizardQuestions = useMemo(
    () =>
      visibleSubjectsForWizard.reduce((sum, subject) => {
        const count = wizSubjectSelections[subject]?.questionCount ?? 0;
        return sum + (count > 0 ? count : 0);
      }, 0),
    [visibleSubjectsForWizard, wizSubjectSelections]
  );

  const handleSelectPresetMode = (mode: ExamPresetMode) => {
    setWizPresetMode(mode);
    if (mode === 'LGS') {
      setWizLevels([8]);
      setWizPenalty(0.333);
      setWizDuration(155);
      const next: Record<string, SubjectCurriculumSelection> = {};
      Object.entries(LGS_SUBJECT_QUOTAS).forEach(([subject, questionCount]) => {
        next[subject] = {
          subject,
          questionCount,
          allTopics: false,
          excludedOutcomeCodes:
            wizSubjectSelections[subject]?.excludedOutcomeCodes ?? [],
        };
      });
      setWizSubjectSelections(next);
    } else if (mode === 'YKS') {
      setWizLevels([12]);
      setWizPenalty(0.25);
      setWizDuration(165);
      const next: Record<string, SubjectCurriculumSelection> = {};
      Object.entries(YKS_SUBJECT_QUOTAS).forEach(([subject, questionCount]) => {
        next[subject] = {
          subject,
          questionCount,
          allTopics: false,
          excludedOutcomeCodes:
            wizSubjectSelections[subject]?.excludedOutcomeCodes ?? [],
        };
      });
      setWizSubjectSelections(next);
    } else if (mode === 'SINGLE_SUBJECT') {
      const targetSubject = wizSingleSubject || availableSubjects[0] || '';
      setWizSingleSubject(targetSubject);
      if (targetSubject) {
        setWizSubjectSelections((prev) => ({
          ...prev,
          [targetSubject]: prev[targetSubject] ?? {
            subject: targetSubject,
            questionCount: 20,
            allTopics: false,
            excludedOutcomeCodes: [],
          },
        }));
      }
    }
  };

  const toggleWizardLevel = (level: number) => {
    setWizLevels((prev) =>
      prev.includes(level)
        ? prev.filter((l) => l !== level)
        : [...prev, level].sort((a, b) => a - b)
    );
  };

  // =========================================================================
  // ORTAK AKSİYONLAR
  // =========================================================================

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      setFeedback({ type: 'err', text: `Kopyalanamadı, kod: ${text}` });
    }
  };

  const handleCreateTeacherInvite = async () => {
    if (!supabase) return;
    setCreatingInvite(true);
    setFeedback(null);
    try {
      const { data, error } = await supabase.rpc('create_teacher_invite', {
        p_hours: inviteHours,
      });
      if (error) throw error;

      const res = data as CreateInviteRpcResponse | null;
      if (!res?.ok || !res.code) {
        throw new Error(res?.error ?? 'Davet kodu üretilemedi.');
      }

      setFeedback({
        type: 'ok',
        text: `Tek kullanımlık davet kodu üretildi: ${res.code}`,
      });
      await loadTeacherInvites();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Davet kodu üretilemedi.',
      });
    } finally {
      setCreatingInvite(false);
    }
  };

  // Sınav Ayarları Modalını aç / kaydet
  const openSettingsModal = (ex: Exam) => {
    setSettingsExam(ex);
    setDraftStatus((ex.status ?? 'PUBLISHED').toUpperCase() as ExamStatus);
    setDraftAllowGuests(ex.allow_guests ?? true);
    setDraftClassIds(getAssignedClassIds(ex));
    setDraftStartsAt(toDatetimeLocalValue(ex.starts_at));
    setDraftEndsAt(toDatetimeLocalValue(ex.ends_at));
  };

  const toggleDraftClass = (classroomId: string) => {
    setDraftClassIds((prev) =>
      prev.includes(classroomId)
        ? prev.filter((id) => id !== classroomId)
        : [...prev, classroomId]
    );
  };

  const handleSaveAllExamSettings = async () => {
    if (!settingsExam) return;

    const startsIso = fromDatetimeLocalValue(draftStartsAt);
    const endsIso = fromDatetimeLocalValue(draftEndsAt);
    if (startsIso && endsIso && new Date(endsIso) <= new Date(startsIso)) {
      setFeedback({
        type: 'err',
        text: 'Bitiş saati başlangıç saatinden sonra olmalıdır.',
      });
      return;
    }

    setSavingSettings(true);
    setFeedback(null);
    try {
      await Promise.all([
        updateExamSettings(settingsExam.id, {
          status: draftStatus,
          allow_guests: draftAllowGuests,
          starts_at: startsIso,
          ends_at: endsIso,
        }),
        setExamClassrooms(settingsExam.id, draftClassIds),
      ]);
      setSettingsExam(null);
      setFeedback({
        type: 'ok',
        text: `"${settingsExam.title}" sınav ayarları güncellendi.`,
      });
      await onExamsChanged();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Ayarlar kaydedilemedi.',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  // Sınıf işlemleri
  const handleCreateClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassName.trim()) return;

    setCreatingRoom(true);
    setFeedback(null);
    try {
      await createClassroom({
        teacherId,
        name: newClassName,
        grade: newGrade ? Number(newGrade) : null,
      });
      setNewClassName('');
      setFeedback({
        type: 'ok',
        text: 'Sınıf oluşturuldu ve anlamlı davet kodu üretildi.',
      });
      await loadClassrooms();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Sınıf oluşturulamadı.';
      setFeedback({ type: 'err', text: msg });
    } finally {
      setCreatingRoom(false);
    }
  };

  const handleRegenerateCode = async (room: ClassroomWithDetails) => {
    if (
      !window.confirm(
        `"${room.name}" sınıfının davet kodunu yenilemek istiyor musun? Eski kod geçersiz olur.`
      )
    ) {
      return;
    }
    try {
      const nextCode = await regenerateClassroomCode(room.id, room.name);
      setClassrooms((prev) =>
        prev.map((c) => (c.id === room.id ? { ...c, invite_code: nextCode } : c))
      );
      setFeedback({
        type: 'ok',
        text: `"${room.name}" yeni davet kodu: ${nextCode}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Kod yenilenemedi.';
      setFeedback({ type: 'err', text: msg });
    }
  };

  const handleDeleteClassroom = async (room: ClassroomWithDetails) => {
    if (
      !window.confirm(
        `"${room.name}" sınıfını silmek istediğine emin misin? Öğrenci hesapları silinmez.`
      )
    ) {
      return;
    }
    try {
      await deleteClassroom(room.id);
      setClassrooms((prev) => prev.filter((c) => c.id !== room.id));
      setFeedback({ type: 'ok', text: `"${room.name}" sınıfı silindi.` });
      await onExamsChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sınıf silinemedi.';
      setFeedback({ type: 'err', text: msg });
    }
  };

  const handleRemoveStudent = async (
    classroomId: string,
    studentId: string,
    studentName: string
  ) => {
    if (
      !window.confirm(
        `${studentName} adlı öğrenciyi bu sınıftan çıkarmak istiyor musun?`
      )
    ) {
      return;
    }
    try {
      await removeStudentFromClassroom(classroomId, studentId);
      setClassrooms((prev) =>
        prev.map((c) =>
          c.id === classroomId
            ? {
                ...c,
                members: c.members.filter((m) => m.student_id !== studentId),
              }
            : c
        )
      );
      setFeedback({ type: 'ok', text: `${studentName} sınıftan çıkarıldı.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Öğrenci çıkarılamadı.';
      setFeedback({ type: 'err', text: msg });
    }
  };

  // Havuzdan müfredat aralığına (startWeek – endWeek) göre dengeli sınav derleme
  const handleCreateExamFromWizard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wizTitle.trim() || totalWizardQuestions === 0) return;

    const startsIso = fromDatetimeLocalValue(wizStartsAt);
    const endsIso = fromDatetimeLocalValue(wizEndsAt);
    if (startsIso && endsIso && new Date(endsIso) <= new Date(startsIso)) {
      setFeedback({
        type: 'err',
        text: 'Bitiş saati başlangıç saatinden sonra olmalıdır.',
      });
      return;
    }

    setCreatingExam(true);
    setFeedback(null);
    try {
      const selectedIds: string[] = [];

      for (const subject of visibleSubjectsForWizard) {
        const sel = wizSubjectSelections[subject];
        if (!sel || sel.questionCount <= 0) continue;

        const eligible = filteredPoolForWizard.filter((q) => {
          if (q.subject !== subject) return false;
          if (sel.excludedOutcomeCodes.includes(q.outcome_code)) return false;
          if (!sel.allTopics) {
            const week =
              typeof q.curriculum_week === 'number' && q.curriculum_week >= 1
                ? q.curriculum_week
                : 1;
            if (week < wizStartWeek || week > wizEndWeek) return false;
          }
          return true;
        });

        const picked = shuffleArray(eligible).slice(
          0,
          Math.min(sel.questionCount, eligible.length)
        );
        selectedIds.push(...picked.map((q) => q.id));
      }

      if (selectedIds.length === 0) {
        throw new Error(
          'Seçili hafta aralığı ve ders kriterlerine uygun soru havuzda bulunamadı.'
        );
      }

      const validAssignedClasses = wizClassIds.filter((cid) =>
        filteredClassroomsForWizard.some((c) => c.id === cid)
      );

      const newExamId = await createExamFromPoolSelection({
        title: wizTitle,
        examDate: wizDate,
        wrongPenaltyRatio: wizPenalty,
        examScope: validAssignedClasses.length > 0 ? 'CLASSROOM' : 'NATIONAL',
        allowGuests: wizAllowGuests,
        status: 'PUBLISHED',
        showSolutionsAfterFinish: true,
        durationMinutes: wizDuration,
        startsAt: startsIso,
        endsAt: endsIso,
        questionIds: selectedIds,
        ownerId: teacherId,
      });

      if (validAssignedClasses.length > 0) {
        await setExamClassrooms(newExamId, validAssignedClasses);
      }

      setWizTitle('');
      setWizClassIds([]);
      setWizStartsAt('');
      setWizEndsAt('');
      setWizSubjectSelections({});
      setShowCreator(false);
      setActiveTab('EXAMS');
      setFeedback({
        type: 'ok',
        text: `Yeni sınav (${selectedIds.length} soru) oluşturuldu ve sınav kodun hazırlandı!`,
      });
      await onExamsChanged(newExamId);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Sınav oluşturulamadı.';
      setFeedback({ type: 'err', text: msg });
    } finally {
      setCreatingExam(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-5 sm:p-6 space-y-5">
      {/* KOMPAKT ÜST KARŞILAMA ŞERİDİ */}
      <header className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-6 py-5 rounded-2xl shadow-lg border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
            Hoş geldin, {teacherName}
          </h1>
          <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-300 font-semibold">
            <span>
              <strong className="text-white">{visibleExams.length}</strong> Sınav
            </span>
            <span className="text-slate-600">•</span>
            <span>
              <strong className="text-indigo-300">{classrooms.length}</strong>{' '}
              Sınıf
            </span>
            <span className="text-slate-600">•</span>
            <span>
              <strong className="text-emerald-300">{totalStudents}</strong>{' '}
              Öğrenci
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowInviteModal(true)}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-200 text-xs sm:text-sm font-extrabold cursor-pointer transition-colors"
          >
            🔑 Davet Kodu
          </button>

          {visibleExams.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSmartboardModalExamId(visibleExams[0]?.id ?? null);
                setShowSmartboardModal(true);
              }}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-indigo-200 text-xs sm:text-sm font-extrabold cursor-pointer transition-colors"
            >
              🖥 Tahta Kodu
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowCreator((prev) => !prev)}
            className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs sm:text-sm font-black shadow-md shadow-emerald-500/20 cursor-pointer transition-colors"
          >
            {showCreator ? '✕ Oluşturucuyu Kapat' : '+ Yeni Sınav Hazırla'}
          </button>
        </div>
      </header>

      {/* BİLDİRİM */}
      {feedback && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs font-bold flex items-center justify-between ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="underline cursor-pointer"
          >
            Kapat
          </button>
        </div>
      )}

      {/* AÇILIR "+ YENİ SINAV HAZIRLA" ÇEKMECESİ */}
      {showCreator && (
        <section className="bg-white p-6 rounded-2xl border-2 border-emerald-400 shadow-lg space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900">
                Yeni Sınav Hazırla
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Seviye, sınav modu ve müfredat aralığını seçerek saniyeler
                içinde dengeli deneme üret.
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={onOpenJsonImport}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
              >
                + JSON Dosyasıyla Sınav Yükle →
              </button>
            )}
          </div>

          <form onSubmit={handleCreateExamFromWizard} className="space-y-5">
            {/* 1. TEMEL BİLGİLER */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Sınav Başlığı
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: 5. Sınıf Kasım Sonu Genel Denemesi"
                  value={wizTitle}
                  onChange={(e) => setWizTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-medium focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Tarih
                </label>
                <input
                  type="date"
                  value={wizDate}
                  onChange={(e) => setWizDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Götürme
                  </label>
                  <select
                    value={wizPenalty}
                    onChange={(e) => setWizPenalty(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-xs font-bold"
                  >
                    <option value={0.333}>3Y 1D</option>
                    <option value={0.25}>4Y 1D</option>
                    <option value={0}>Yok</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Süre (dk)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={240}
                    value={wizDuration}
                    onChange={(e) => setWizDuration(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-xs font-bold"
                  />
                </div>
              </div>
            </div>

            {/* 2. SINAV MODU + SEVİYE SEÇİMİ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <span className="text-xs font-extrabold text-slate-700 block">
                  Sınav Modu
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(
                    [
                      { id: 'CUSTOM', label: 'Özelleştir' },
                      { id: 'SINGLE_SUBJECT', label: 'Tek Ders' },
                      { id: 'LGS', label: 'LGS (Sabit)' },
                      { id: 'YKS', label: 'YKS (Sabit)' },
                    ] as { id: ExamPresetMode; label: string }[]
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleSelectPresetMode(m.id)}
                      className={`py-2 px-2.5 rounded-xl border text-xs font-extrabold cursor-pointer transition-all ${
                        wizPresetMode === m.id
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                          : 'bg-white border-slate-300 text-slate-700 hover:border-indigo-400'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {wizPresetMode === 'SINGLE_SUBJECT' && (
                  <div className="pt-1">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Ders Seçimi
                    </label>
                    <select
                      value={wizSingleSubject}
                      onChange={(e) => setWizSingleSubject(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800"
                    >
                      {availableSubjects.length === 0 ? (
                        <option value="">Bu seviyede ders bulunamadı</option>
                      ) : (
                        availableSubjects.map((sub) => (
                          <option key={sub} value={sub}>
                            {sub}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                )}
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-700">
                    Katılacak Seviyeler
                  </span>
                  <span className="text-[10px] text-slate-500 font-semibold">
                    Sınıfları ve dersleri filtreler
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {GRADE_LEVELS.map((lvl) => {
                    const active = wizLevels.includes(lvl);
                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => toggleWizardLevel(lvl)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-extrabold cursor-pointer transition-all ${
                          active
                            ? 'bg-slate-900 border-slate-900 text-white'
                            : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
                        }`}
                      >
                        {lvl}. Sınıf
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 3. MÜFREDAT ZAMAN ÇİZELGESİ VE DİKEY DERS KARTLARI */}
            {loadingPool ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                Soru havuzu yükleniyor...
              </p>
            ) : (
              <CurriculumTimelineSelector
                pool={filteredPoolForWizard}
                startWeek={wizStartWeek}
                endWeek={wizEndWeek}
                onRangeChange={(nextStart, nextEnd) => {
                  setWizStartWeek(nextStart);
                  setWizEndWeek(nextEnd);
                }}
                subjectSelections={wizSubjectSelections}
                onSubjectSelectionChange={(subject, next) =>
                  setWizSubjectSelections((prev) => ({
                    ...prev,
                    [subject]: next,
                  }))
                }
                isQuestionCountLocked={isQuestionCountLocked}
                visibleSubjects={visibleSubjectsForWizard}
              />
            )}

            {/* 4. OPSİYONEL ZAMANLI SINAV PENCERESİ */}
            <div className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-200/80 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-indigo-950">
                  Zamanlı Sınav Penceresi (Başlangıç – Bitiş)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const p = getTonightPreset();
                      setWizStartsAt(p.start);
                      setWizEndsAt(p.end);
                      setWizDuration(40);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold cursor-pointer"
                  >
                    ⚡ Bu Akşam 20:00 – 20:40
                  </button>
                  {(wizStartsAt || wizEndsAt) && (
                    <button
                      type="button"
                      onClick={() => {
                        setWizStartsAt('');
                        setWizEndsAt('');
                      }}
                      className="px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[11px] font-bold cursor-pointer"
                    >
                      Temizle
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Başlangıç Tarihi & Saati
                  </label>
                  <input
                    type="datetime-local"
                    value={wizStartsAt}
                    onChange={(e) => setWizStartsAt(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Bitiş Tarihi & Saati (Otomatik Kapanış)
                  </label>
                  <input
                    type="datetime-local"
                    value={wizEndsAt}
                    onChange={(e) => setWizEndsAt(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold"
                  />
                </div>
              </div>
            </div>

            {/* 5. SEVİYEYE GÖRE FİLTRELENMİŞ SINIF ATAMASI */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-slate-700">
                  Hangi Sınıflarına Atansın?{' '}
                  <span className="font-normal text-slate-500">
                    (Seçili seviyelere göre filtrelenir; boş bırakılırsa Türkiye
                    Geneli açılır)
                  </span>
                </span>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wizAllowGuests}
                    onChange={(e) => setWizAllowGuests(e.target.checked)}
                    className="accent-indigo-600"
                  />
                  Misafir (Gölge) katılıma açık
                </label>
              </div>

              {filteredClassroomsForWizard.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {filteredClassroomsForWizard.map((c) => {
                    const checked = wizClassIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          setWizClassIds((prev) =>
                            checked
                              ? prev.filter((id) => id !== c.id)
                              : [...prev, c.id]
                          )
                        }
                        className={`px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer transition-all ${
                          checked
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'bg-white border-slate-300 text-slate-700 hover:border-indigo-400'
                        }`}
                      >
                        {checked ? '✓ ' : '+ '}
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  Seçili seviyede kayıtlı sınıfın yok; sınav Türkiye Geneli
                  olarak açılacak.
                </p>
              )}
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={
                  creatingExam || !wizTitle.trim() || totalWizardQuestions === 0
                }
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs sm:text-sm font-bold cursor-pointer"
              >
                {creatingExam
                  ? 'Derleniyor...'
                  : `Sınavı Oluştur ve Yayınla (${totalWizardQuestions} Soru)`}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* TEMİZ SEKMELİ GEZİNTİ ÇUBUĞU */}
      <div className="flex items-center gap-6 border-b border-slate-200 px-1">
        <button
          type="button"
          onClick={() => setActiveTab('EXAMS')}
          className={`pb-3 text-sm font-extrabold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'EXAMS'
              ? 'border-indigo-600 text-indigo-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Sınavlarım ({visibleExams.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('CLASSROOMS')}
          className={`pb-3 text-sm font-extrabold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'CLASSROOMS'
              ? 'border-indigo-600 text-indigo-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Sınıflarım ({classrooms.length})
        </button>
      </div>

      {/* =================================================================== */}
      {/* SEKME 1: SINAVLARIM — 3 SÜTUNLU KOMPAKT KART IZGARASI               */}
      {/* =================================================================== */}
      {activeTab === 'EXAMS' ? (
        visibleExams.length === 0 ? (
          <div className="bg-white p-10 rounded-2xl border border-dashed border-slate-300 text-center text-xs text-slate-500">
            Henüz sınav bulunmuyor. Sağ üstten{' '}
            <strong>+ Yeni Sınav Hazırla</strong> butonuna basarak ilk sınavını
            oluşturabilirsin.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleExams.map((ex) => {
              const assignedIds = getAssignedClassIds(ex);
              const status = (ex.status ?? 'PUBLISHED').toUpperCase();
              const scheduleLabel = formatScheduleWindow(
                ex.starts_at,
                ex.ends_at
              );
              const scheduleState = getExamScheduleState(ex);
              const officialCount = ex.official_count ?? 0;
              const guestCount = ex.guest_count ?? 0;
              const totalCount = officialCount + guestCount;
              const isCopied = copiedKey === `exam-${ex.id}`;

              return (
                <div
                  key={ex.id}
                  className="bg-white rounded-2xl border border-slate-200 hover:border-indigo-300 shadow-xs p-4 flex flex-col justify-between gap-3.5 transition-all"
                >
                  <div className="space-y-2.5">
                    {/* ÜST SATIR: KOD (TIKLA KOPYALA) + DURUM + TAHTA KODU + AYARLAR */}
                    <div className="flex items-center justify-between gap-2">
                      {ex.exam_code ? (
                        <button
                          type="button"
                          title="Sınav kodunu kopyala"
                          onClick={() =>
                            handleCopy(`exam-${ex.id}`, ex.exam_code!)
                          }
                          className={`font-mono text-[11px] font-black px-2.5 py-1 rounded-full tracking-wider cursor-pointer transition-colors ${
                            isCopied
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-900 hover:bg-indigo-900 text-indigo-100'
                          }`}
                        >
                          {isCopied ? '✓ Kopyalandı' : ex.exam_code}
                        </button>
                      ) : (
                        <span className="text-[11px] font-bold text-slate-400">
                          Kodsuz
                        </span>
                      )}

                      <div className="flex items-center gap-1">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                            status === 'PUBLISHED'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : status === 'DRAFT'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                        >
                          <span>
                            {status === 'PUBLISHED'
                              ? 'Yayında'
                              : status === 'DRAFT'
                                ? 'Taslak'
                                : 'Arşiv'}
                          </span>
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              status === 'PUBLISHED'
                                ? 'bg-emerald-500'
                                : status === 'DRAFT'
                                  ? 'bg-amber-500'
                                  : 'bg-slate-400'
                            }`}
                          />
                        </span>

                        <button
                          type="button"
                          title="Bu sınav için 5 haneli Akıllı Tahta kodu üret"
                          onClick={() => {
                            setSmartboardModalExamId(ex.id);
                            setShowSmartboardModal(true);
                          }}
                          className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-indigo-100 text-slate-600 hover:text-indigo-800 text-[11px] font-bold cursor-pointer transition-colors"
                        >
                          🖥
                        </button>

                        <button
                          type="button"
                          title="Sınav ayarları (Sınıf ata, saat ayarla, durum)"
                          onClick={() => openSettingsModal(ex)}
                          className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 text-[11px] font-bold cursor-pointer transition-colors"
                        >
                          ⚙
                        </button>
                      </div>
                    </div>

                    {/* BAŞLIK VE KATILIM ÖZETİ */}
                    <div>
                      <h3 className="text-sm font-extrabold text-slate-900 leading-snug line-clamp-2 min-h-[2.4rem]">
                        {ex.title}
                      </h3>
                      <p className="text-[11px] font-semibold text-slate-500 mt-1">
                        <span className="text-emerald-700 font-bold">
                          {officialCount} Resmi
                        </span>{' '}
                        •{' '}
                        <span className="text-fuchsia-700 font-bold">
                          {guestCount} Misafir
                        </span>
                        {ex.grade ? ` • ${ex.grade}. Sınıf` : ''}
                      </p>
                    </div>

                    {/* ŞUBE VE SAAT ROZETLERİ */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {assignedIds.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => openSettingsModal(ex)}
                          className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[10px] font-bold cursor-pointer hover:bg-amber-100"
                        >
                          Türkiye Geneli
                        </button>
                      ) : (
                        assignedIds.map((cid) => (
                          <button
                            key={cid}
                            type="button"
                            onClick={() => openSettingsModal(ex)}
                            className="px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-100 text-indigo-800 text-[10px] font-bold cursor-pointer hover:bg-indigo-100"
                          >
                            {roomNameMap.get(cid)?.name ?? 'Sınıf'}
                          </button>
                        ))
                      )}

                      {scheduleLabel ? (
                        <button
                          type="button"
                          onClick={() => openSettingsModal(ex)}
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer ${
                            scheduleState.phase === 'UPCOMING'
                              ? 'bg-amber-100 text-amber-950'
                              : scheduleState.phase === 'LIVE'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          🕒 {scheduleLabel}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openSettingsModal(ex)}
                          className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-500 text-[10px] font-semibold cursor-pointer"
                        >
                          + Saat
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ALT KOMPAKT BUTON SATIRI */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => onPreviewExam(ex.id)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-bold cursor-pointer transition-colors"
                    >
                      Önizle
                    </button>

                    {assignedIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setAttendanceExam(ex)}
                        className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer transition-colors ${
                          scheduleState.phase === 'UPCOMING'
                            ? 'bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-900'
                            : 'bg-white hover:bg-amber-50 border-slate-200 text-slate-700'
                        }`}
                      >
                        {scheduleState.phase === 'UPCOMING'
                          ? 'Bekleme'
                          : 'Yoklama'}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpenAnalytics(ex.id)}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold shadow-xs cursor-pointer transition-colors text-center"
                    >
                      Analizi Aç{totalCount > 0 ? ` (${totalCount})` : ''}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* ================================================================= */
        /* SEKME 2: SINIFLARIM — YENİ SINIF SATIRI + 3 SÜTUNLU KARTLAR       */
        /* ================================================================= */
        <section className="space-y-4">
          <form
            onSubmit={handleCreateClassroom}
            className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <input
              type="text"
              required
              placeholder="Yeni sınıf adı (Örn: 5-D Matematik veya 8-A LGS)"
              value={newClassName}
              onChange={(e) => setNewClassName(e.target.value)}
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
            <select
              value={newGrade}
              onChange={(e) => setNewGrade(e.target.value)}
              className="w-full sm:w-40 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800"
            >
              <option value="5">5. Sınıf</option>
              <option value="6">6. Sınıf</option>
              <option value="7">7. Sınıf</option>
              <option value="8">8. Sınıf (LGS)</option>
              <option value="9">9. Sınıf</option>
              <option value="10">10. Sınıf</option>
              <option value="11">11. Sınıf</option>
              <option value="12">12. Sınıf (YKS)</option>
            </select>
            <button
              type="submit"
              disabled={creatingRoom || !newClassName.trim()}
              className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs sm:text-sm font-bold cursor-pointer shrink-0"
            >
              {creatingRoom ? 'Ekleniyor...' : '+ Sınıf Oluştur'}
            </button>
          </form>

          {loadingRooms ? (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center text-xs font-bold text-slate-500">
              Sınıflar yükleniyor...
            </div>
          ) : classrooms.length === 0 ? (
            <div className="bg-white/80 p-8 rounded-2xl border border-dashed border-slate-300 text-center text-xs text-slate-500">
              Henüz kayıtlı bir sınıfın yok. Yukarıdan ilk sınıfını oluşturup
              anlamlı davet kodunu öğrencilerle paylaşabilirsin.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {classrooms.map((room) => (
                <div
                  key={room.id}
                  className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-extrabold text-slate-900">
                            {room.name}
                          </h3>
                          {room.grade && (
                            <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 text-[10px] font-bold">
                              {room.grade}. Sınıf
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {room.teacher_name} •{' '}
                          <strong>{room.members.length} öğrenci</strong>
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteClassroom(room)}
                        className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold cursor-pointer"
                      >
                        Sil
                      </button>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-900 text-white flex items-center justify-between gap-2">
                      <div>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-300 block">
                          Sınıf Kodu
                        </span>
                        <span className="font-mono text-lg font-black tracking-wider">
                          {room.invite_code}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(`room-${room.id}`, room.invite_code)
                          }
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                            copiedKey === `room-${room.id}`
                              ? 'bg-emerald-500 text-white'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          }`}
                        >
                          {copiedKey === `room-${room.id}` ? '✓' : 'Kopyala'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRegenerateCode(room)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-bold cursor-pointer"
                        >
                          Yenile
                        </button>
                      </div>
                    </div>
                  </div>

                  <details className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs">
                    <summary className="font-bold text-slate-700 cursor-pointer select-none">
                      Kayıtlı Öğrenciler ({room.members.length})
                    </summary>
                    <div className="mt-2.5 pt-2.5 border-t border-slate-200 space-y-2">
                      {room.members.length === 0 ? (
                        <p className="text-[11px] text-slate-400">
                          Henüz katılan öğrenci yok.
                        </p>
                      ) : (
                        room.members.map((m) => (
                          <div
                            key={m.student_id}
                            className="flex items-center justify-between gap-2 bg-white p-2 rounded-lg border border-slate-200/80"
                          >
                            <div className="min-w-0">
                              <p className="font-bold text-slate-900 truncate">
                                {m.full_name}
                              </p>
                              <p className="text-[10px] text-slate-500 truncate">
                                {m.school_name || 'Okul yok'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                handleRemoveStudent(
                                  room.id,
                                  m.student_id,
                                  m.full_name
                                )
                              }
                              className="px-2 py-1 rounded bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 text-[10px] font-bold cursor-pointer shrink-0"
                            >
                              Çıkar
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* =================================================================== */}
      {/* ÖĞRETMEN DAVET KODU MODALI (TEK KULLANIMLIK + SÜRELİ)               */}
      {/* =================================================================== */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300 block">
                  Meslektaş Daveti
                </span>
                <h2 className="text-base font-extrabold mt-0.5">
                  Öğretmen Davet Kodu
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <p className="text-xs text-slate-600 leading-relaxed">
                Ürettiğin her kod <strong>tek kullanımlıktır</strong> ve seçilen
                süre dolduğunda otomatik geçersiz olur. Kodu paylaştığın öğretmen
                kayıt olurken doğrudan onaylanır.
              </p>

              <div className="flex items-center gap-2">
                <select
                  value={inviteHours}
                  onChange={(e) => setInviteHours(Number(e.target.value))}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800"
                >
                  <option value={24}>24 Saat Geçerli</option>
                  <option value={48}>48 Saat Geçerli</option>
                  <option value={72}>72 Saat Geçerli</option>
                </select>
                <button
                  type="button"
                  disabled={creatingInvite}
                  onClick={handleCreateTeacherInvite}
                  className="flex-1 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-black cursor-pointer transition-colors"
                >
                  {creatingInvite ? 'Üretiliyor...' : '+ Yeni Davet Kodu Üret'}
                </button>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <h3 className="text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">
                  Son Ürettiğin Kodlar ({invites.length})
                </h3>

                {loadingInvites ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    Yükleniyor...
                  </p>
                ) : invites.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    Henüz öğretmen davet kodu üretmedin.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {invites.map((inv) => {
                      const isUsed = Boolean(inv.used_at);
                      const isExpired =
                        !isUsed &&
                        new Date(inv.expires_at).getTime() <= Date.now();
                      const isActive = !isUsed && !isExpired;
                      const isCopied = copiedKey === `invite-${inv.id}`;

                      return (
                        <div
                          key={inv.id}
                          className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${
                            isActive
                              ? 'bg-amber-50/60 border-amber-200'
                              : 'bg-slate-50 border-slate-200 opacity-75'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-black tracking-wider text-slate-900">
                                {inv.code}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                  isActive
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : isUsed
                                      ? 'bg-indigo-100 text-indigo-800'
                                      : 'bg-slate-200 text-slate-600'
                                }`}
                              >
                                {isActive
                                  ? 'Aktif'
                                  : isUsed
                                    ? 'Kullanıldı'
                                    : 'Süresi Doldu'}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              {isUsed && inv.used_at
                                ? `Kullanım: ${formatInviteDate(inv.used_at)}`
                                : `Son geçerlilik: ${formatInviteDate(inv.expires_at)}`}
                            </p>
                          </div>

                          {isActive && (
                            <button
                              type="button"
                              onClick={() =>
                                handleCopy(`invite-${inv.id}`, inv.code)
                              }
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer shrink-0 transition-colors ${
                                isCopied
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-900 hover:bg-slate-800 text-white'
                              }`}
                            >
                              {isCopied ? '✓ Kopyalandı' : 'Kopyala'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SINAV AYARLARI MODALI (SINIF ATAMA + SAAT + DURUM + MİSAFİR)        */}
      {/* =================================================================== */}
      {settingsExam && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-300 block">
                  Sınav Ayarları{' '}
                  {settingsExam.exam_code ? `• ${settingsExam.exam_code}` : ''}
                </span>
                <h2 className="text-base font-extrabold truncate mt-0.5">
                  {settingsExam.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSettingsExam(null)}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 cursor-pointer shrink-0"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* DURUM VE MİSAFİR */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Yayın Durumu
                  </label>
                  <select
                    value={draftStatus}
                    onChange={(e) =>
                      setDraftStatus(e.target.value as ExamStatus)
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800"
                  >
                    <option value="DRAFT">Taslak (Gizli)</option>
                    <option value="PUBLISHED">Yayında (Açık)</option>
                    <option value="CLOSED">Kapalı (Arşiv)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Misafir (Gölge) Katılım
                  </label>
                  <button
                    type="button"
                    onClick={() => setDraftAllowGuests((v) => !v)}
                    className={`w-full rounded-xl border px-3 py-2 text-xs font-bold cursor-pointer transition-colors ${
                      draftAllowGuests
                        ? 'bg-fuchsia-50 border-fuchsia-300 text-fuchsia-800'
                        : 'bg-slate-100 border-slate-300 text-slate-600'
                    }`}
                  >
                    {draftAllowGuests
                      ? '✓ Misafir Katılıma Açık'
                      : '✕ Misafir Katılım Kapalı'}
                  </button>
                </div>
              </div>

              {/* ÇOKLU SINIF ATAMASI */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-800">
                    Atanan Sınıflar
                  </span>
                  <span className="text-[10px] text-slate-500 font-semibold">
                    Seçilmezse Türkiye Geneli olur
                  </span>
                </div>

                {classrooms.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Henüz sınıfın yok. &quot;Sınıflarım&quot; sekmesinden yeni
                    sınıf ekleyebilirsin.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {classrooms.map((c) => {
                      const checked = draftClassIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleDraftClass(c.id)}
                          className={`px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer transition-all ${
                            checked
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'bg-white border-slate-300 text-slate-700 hover:border-indigo-400'
                          }`}
                        >
                          {checked ? '✓ ' : '+ '}
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ZAMANLI OTURUM SAATİ */}
              <div className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-indigo-950">
                    Zamanlı Sınav Penceresi
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const p = getTonightPreset();
                        setDraftStartsAt(p.start);
                        setDraftEndsAt(p.end);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold cursor-pointer"
                    >
                      ⚡ Bu Akşam 20:00–20:40
                    </button>
                    {(draftStartsAt || draftEndsAt) && (
                      <button
                        type="button"
                        onClick={() => {
                          setDraftStartsAt('');
                          setDraftEndsAt('');
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-bold cursor-pointer"
                      >
                        Temizle
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                      Başlangıç
                    </label>
                    <input
                      type="datetime-local"
                      value={draftStartsAt}
                      onChange={(e) => setDraftStartsAt(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                      Bitiş (Otomatik Kapanış)
                    </label>
                    <input
                      type="datetime-local"
                      value={draftEndsAt}
                      onChange={(e) => setDraftEndsAt(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSettingsExam(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-700 cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={savingSettings}
                onClick={handleSaveAllExamSettings}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-extrabold cursor-pointer"
              >
                {savingSettings ? 'Kaydediliyor...' : 'Ayarları Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CANLI BEKLEME ODASI VE YOKLAMA ÇEKMECESİ */}
      {attendanceExam && (
        <ExamAttendanceDrawer
          exam={attendanceExam}
          assignedClassrooms={classrooms.filter((c) =>
            getAssignedClassIds(attendanceExam).includes(c.id)
          )}
          onClose={() => setAttendanceExam(null)}
          onExamStartedEarly={() => onExamsChanged()}
        />
      )}

      {/* GÜVENLİ AKILLI TAHTA KODU MODALI */}
      {showSmartboardModal && (
        <SmartboardCodeModal
          teacherId={teacherId}
          teacherName={teacherName}
          exams={visibleExams}
          initialExamId={smartboardModalExamId}
          onClose={() => setShowSmartboardModal(false)}
          onOpenLocalSmartboard={onOpenSmartboardLocal}
        />
      )}
    </div>
  );
};