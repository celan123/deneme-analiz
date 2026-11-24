import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import type { Exam, ExamStatus, PoolQuestion } from '../types/exam';
import {
  formatScheduleWindow,
  fromDatetimeLocalValue,
  getExamScheduleState,
  toDatetimeLocalValue,
} from '../utils/examSchedule';
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
  const [pool, setPool] = useState<PoolQuestion[]>([]);
  const [loadingPool, setLoadingPool] = useState<boolean>(false);
  const today = new Date().toISOString().slice(0, 10);
  const [wizTitle, setWizTitle] = useState<string>('');
  const [wizDate, setWizDate] = useState<string>(today);
  const [wizPenalty, setWizPenalty] = useState<number>(0.333);
  const [wizDuration, setWizDuration] = useState<number>(40);
  const [wizAllowGuests, setWizAllowGuests] = useState<boolean>(true);
  const [wizStartsAt, setWizStartsAt] = useState<string>('');
  const [wizEndsAt, setWizEndsAt] = useState<string>('');
  const [wizSubjectFilter, setWizSubjectFilter] = useState<string>('ALL');
  const [wizClassIds, setWizClassIds] = useState<string[]>([]);
  const [outcomeQuotas, setOutcomeQuotas] = useState<Record<string, number>>(
    {}
  );
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

  useEffect(() => {
    loadClassrooms();
  }, [loadClassrooms]);

  useEffect(() => {
    if (!showCreator || pool.length > 0) return;
    setLoadingPool(true);
    fetchQuestionPool()
      .then((data) => setPool(data))
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

  const visibleExams = useMemo(() => {
    if (isAdmin) return exams;
    return exams.filter((ex) => {
      if (!ex.owner_id || ex.owner_id === teacherId) return true;
      return getAssignedClassIds(ex).some((cid) => myClassroomIds.has(cid));
    });
  }, [exams, isAdmin, teacherId, myClassroomIds]);

  const totalStudents = useMemo(
    () => classrooms.reduce((sum, c) => sum + c.members.length, 0),
    [classrooms]
  );

  const availableSubjects = useMemo(() => {
    const set = new Set<string>();
    pool.forEach((q) => {
      if (q.subject) set.add(q.subject);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [pool]);

  const outcomeGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        outcome_code: string;
        outcome_title: string;
        subject: string;
        questions: PoolQuestion[];
      }
    >();

    for (const q of pool) {
      if (wizSubjectFilter !== 'ALL' && q.subject !== wizSubjectFilter) {
        continue;
      }
      let grp = map.get(q.outcome_code);
      if (!grp) {
        grp = {
          outcome_code: q.outcome_code,
          outcome_title: q.outcome_title,
          subject: q.subject,
          questions: [],
        };
        map.set(q.outcome_code, grp);
      }
      grp.questions.push(q);
    }

    return Array.from(map.values()).sort((a, b) =>
      a.outcome_code.localeCompare(b.outcome_code, 'tr')
    );
  }, [pool, wizSubjectFilter]);

  const totalWizardQuestions = useMemo(
    () =>
      Object.values(outcomeQuotas).reduce(
        (sum, count) => sum + (count > 0 ? count : 0),
        0
      ),
    [outcomeQuotas]
  );

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

  // Havuzdan hızlı sınav derleme
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
      for (const grp of outcomeGroups) {
        const quota = outcomeQuotas[grp.outcome_code] ?? 0;
        if (quota <= 0) continue;
        const picked = shuffleArray(grp.questions).slice(
          0,
          Math.min(quota, grp.questions.length)
        );
        selectedIds.push(...picked.map((q) => q.id));
      }

      const newExamId = await createExamFromPoolSelection({
        title: wizTitle,
        examDate: wizDate,
        wrongPenaltyRatio: wizPenalty,
        examScope: wizClassIds.length > 0 ? 'CLASSROOM' : 'NATIONAL',
        allowGuests: wizAllowGuests,
        status: 'PUBLISHED',
        showSolutionsAfterFinish: true,
        durationMinutes: wizDuration,
        startsAt: startsIso,
        endsAt: endsIso,
        questionIds: selectedIds,
        ownerId: teacherId,
      });

      if (wizClassIds.length > 0) {
        await setExamClassrooms(newExamId, wizClassIds);
      }

      setWizTitle('');
      setWizClassIds([]);
      setWizStartsAt('');
      setWizEndsAt('');
      setOutcomeQuotas({});
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
                Merkezi soru havuzundan kazanım kotası seçerek saniyeler içinde
                deneme üret veya kendi JSON dosyanı yükle.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenJsonImport}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
            >
              + JSON Dosyasıyla Sınav Yükle →
            </button>
          </div>

          <form onSubmit={handleCreateExamFromWizard} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Sınav Başlığı
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: 5. Sınıf 1. Ünite Kazanım Denemesi-1"
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

            {/* OPSİYONEL ZAMANLI SINAV PENCERESİ */}
            <div className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-200/80 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-indigo-950">
                  Zamanlı Sınav Penceresi (Opsiyonel)
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

            {/* HANGİ SINIFLARA ATANSIN? */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-slate-700">
                  Hangi Sınıflarına Atansın?{' '}
                  <span className="font-normal text-slate-500">
                    (Hiçbiri seçilmezse Türkiye Geneli açılır)
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

              {classrooms.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {classrooms.map((c) => {
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
                  Henüz sınıfın yok; sınav Türkiye Geneli olarak açılacak,
                  sonradan dilediğin sınıflara atayabilirsin.
                </p>
              )}
            </div>

            {/* KAZANIM KOTALARI */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                  Havuzdan Kazanım Kotası Seç
                </span>
                <select
                  value={wizSubjectFilter}
                  onChange={(e) => setWizSubjectFilter(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold"
                >
                  <option value="ALL">Tüm Dersler</option>
                  {availableSubjects.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>

              {loadingPool ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  Soru havuzu yükleniyor...
                </p>
              ) : (
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-200 rounded-xl border border-slate-200">
                  {outcomeGroups.map((grp) => {
                    const selected = outcomeQuotas[grp.outcome_code] ?? 0;
                    const maxCount = grp.questions.length;
                    return (
                      <div
                        key={grp.outcome_code}
                        className="p-3 bg-slate-50/40 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                              {grp.outcome_code}
                            </span>
                            <span className="text-[11px] text-slate-500 font-semibold">
                              {grp.subject} • {maxCount} soru
                            </span>
                          </div>
                          <p className="text-xs text-slate-800 font-medium truncate mt-0.5">
                            {grp.outcome_title}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setOutcomeQuotas((prev) => ({
                                ...prev,
                                [grp.outcome_code]: Math.max(0, selected - 1),
                              }))
                            }
                            className="w-7 h-7 rounded-lg border border-slate-300 bg-white font-black text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            -
                          </button>
                          <span className="w-8 text-center text-xs font-black text-slate-900">
                            {selected}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setOutcomeQuotas((prev) => ({
                                ...prev,
                                [grp.outcome_code]: Math.min(
                                  maxCount,
                                  selected + 1
                                ),
                              }))
                            }
                            className="w-7 h-7 rounded-lg border border-slate-300 bg-white font-black text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
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