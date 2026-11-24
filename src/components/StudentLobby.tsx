import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchStudentClassrooms,
  joinClassroomByCode,
} from '../services/classroomService';
import {
  fetchStudentCompletedExams,
  updateStudentGrade,
} from '../services/examService';
import type { UserProfile } from '../types/auth';
import type { StudentEnrolledClassroom } from '../types/classroom';
import type {
  Exam,
  ParticipationType,
  StudentCompletedAttempt,
} from '../types/exam';
import { toAsciiUpper } from '../utils/codeGenerator';
import {
  formatCountdown,
  formatScheduleWindow,
  getExamScheduleState,
} from '../utils/examSchedule';

interface StudentLobbyProps {
  studentId: string;
  profile: UserProfile | null;
  exams: Exam[];
  onStartExam: (exam: Exam, participationType: ParticipationType) => void;
  onViewCompletedReport: (exam: Exam, attempt: StudentCompletedAttempt) => void;
  onProfileUpdated: () => Promise<void>;
}

type DiscoveryMode = 'LIVE' | 'ARCHIVE';

function getExamClassIds(ex: Exam): string[] {
  if (ex.assigned_classroom_ids && ex.assigned_classroom_ids.length > 0) {
    return ex.assigned_classroom_ids;
  }
  return ex.classroom_id ? [ex.classroom_id] : [];
}

/**
 * Yatay kaydırmalı dar dikey kart şeridi (sağ/sol masaüstü ok butonlu)
 */
const HorizontalCardStrip: React.FC<{
  scrollRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}> = ({ scrollRef, children }) => (
  <div
    ref={scrollRef}
    className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scroll-smooth [scrollbar-width:thin]"
  >
    {children}
  </div>
);

export const StudentLobby: React.FC<StudentLobbyProps> = ({
  studentId,
  profile,
  exams,
  onStartExam,
  onViewCompletedReport,
  onProfileUpdated,
}) => {
  const assignedStripRef = useRef<HTMLDivElement | null>(null);
  const discoveryStripRef = useRef<HTMLDivElement | null>(null);

  const [enrolledClasses, setEnrolledClasses] = useState<
    StudentEnrolledClassroom[]
  >([]);
  const [completedAttempts, setCompletedAttempts] = useState<
    StudentCompletedAttempt[]
  >([]);
  const [loadingMeta, setLoadingMeta] = useState<boolean>(true);

  const [selectedGrade, setSelectedGrade] = useState<number | null>(
    profile?.grade ?? null
  );
  const [savingGrade, setSavingGrade] = useState<boolean>(false);

  const [classCode, setClassCode] = useState<string>('');
  const [joiningClass, setJoiningClass] = useState<boolean>(false);
  const [classMsg, setClassMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>('LIVE');
  const [userChoseMode, setUserChoseMode] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    setSelectedGrade(profile?.grade ?? null);
  }, [profile?.grade]);

  useEffect(() => {
    const hasScheduled = exams.some((e) => e.starts_at || e.ends_at);
    if (!hasScheduled) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [exams]);

  const loadStudentMeta = useCallback(async () => {
    setLoadingMeta(true);
    try {
      const [classesData, attemptsData] = await Promise.all([
        fetchStudentClassrooms(studentId),
        fetchStudentCompletedExams(studentId),
      ]);
      setEnrolledClasses(classesData);
      setCompletedAttempts(attemptsData);
    } catch {
      // Sessiz geç
    } finally {
      setLoadingMeta(false);
    }
  }, [studentId]);

  useEffect(() => {
    loadStudentMeta();
  }, [loadStudentMeta]);

  const scrollStrip = (
    ref: React.RefObject<HTMLDivElement | null>,
    direction: 'left' | 'right'
  ) => {
    if (!ref.current) return;
    const delta = direction === 'left' ? -310 : 310;
    ref.current.scrollBy({ left: delta, behavior: 'smooth' });
  };

  const enrolledClassIdSet = useMemo(
    () => new Set(enrolledClasses.map((c) => c.classroom_id)),
    [enrolledClasses]
  );

  const enrolledClassNameMap = useMemo(() => {
    const map = new Map<string, StudentEnrolledClassroom>();
    enrolledClasses.forEach((c) => map.set(c.classroom_id, c));
    return map;
  }, [enrolledClasses]);

  const completedMap = useMemo(() => {
    const map = new Map<string, StudentCompletedAttempt>();
    for (const att of completedAttempts) {
      if (!map.has(att.exam_id)) {
        map.set(att.exam_id, att);
      }
    }
    return map;
  }, [completedAttempts]);

  const nonDraftExams = useMemo(
    () =>
      exams.filter(
        (ex) => (ex.status ?? 'PUBLISHED').toUpperCase() !== 'DRAFT'
      ),
    [exams]
  );

  // =========================================================================
  // BÖLME 1: BANA ATANAN SINAVLAR
  // =========================================================================
  const assignedExams = useMemo(() => {
    return nonDraftExams.filter((ex) =>
      getExamClassIds(ex).some((cid) => enrolledClassIdSet.has(cid))
    );
  }, [nonDraftExams, enrolledClassIdSet]);

  const assignedIdSet = useMemo(
    () => new Set(assignedExams.map((e) => e.id)),
    [assignedExams]
  );

  // =========================================================================
  // BÖLME 2: SEVİYENE UYGUN CANLI SINAVLAR VE POPÜLER ARŞİV
  // =========================================================================
  const matchesGrade = useCallback(
    (ex: Exam) => {
      if (selectedGrade === null) return true;
      if (ex.grade === null || ex.grade === undefined) return false;
      return ex.grade === selectedGrade;
    },
    [selectedGrade]
  );

  const liveDiscoveryExams = useMemo(() => {
    return nonDraftExams
      .filter((ex) => {
        if (assignedIdSet.has(ex.id)) return false;
        if ((ex.status ?? 'PUBLISHED').toUpperCase() !== 'PUBLISHED') {
          return false;
        }
        if (getExamScheduleState(ex, nowMs).phase === 'ENDED') return false;
        if (!matchesGrade(ex)) return false;
        return ex.exam_scope === 'NATIONAL' || (ex.allow_guests ?? true);
      })
      .sort((a, b) => (b.participant_count ?? 0) - (a.participant_count ?? 0));
  }, [nonDraftExams, assignedIdSet, matchesGrade, nowMs]);

  const archiveDiscoveryExams = useMemo(() => {
    return nonDraftExams
      .filter((ex) => {
        if (assignedIdSet.has(ex.id)) return false;
        const status = (ex.status ?? 'PUBLISHED').toUpperCase();
        const endedBySchedule =
          status === 'PUBLISHED' &&
          getExamScheduleState(ex, nowMs).phase === 'ENDED';
        if (status !== 'CLOSED' && !endedBySchedule) return false;
        if (!(ex.allow_guests ?? true)) return false;
        return matchesGrade(ex);
      })
      .sort((a, b) => (b.participant_count ?? 0) - (a.participant_count ?? 0));
  }, [nonDraftExams, assignedIdSet, matchesGrade, nowMs]);

  useEffect(() => {
    if (userChoseMode) return;
    if (liveDiscoveryExams.length === 0 && archiveDiscoveryExams.length > 0) {
      setDiscoveryMode('ARCHIVE');
    } else {
      setDiscoveryMode('LIVE');
    }
  }, [liveDiscoveryExams.length, archiveDiscoveryExams.length, userChoseMode]);

  const resolveAccess = useCallback(
    (
      ex: Exam
    ): {
      allowed: boolean;
      upcoming?: boolean;
      countdownLabel?: string;
      participationType: ParticipationType;
      reason: string;
    } => {
      const status = (ex.status ?? 'PUBLISHED').toUpperCase();
      const isMine = getExamClassIds(ex).some((cid) =>
        enrolledClassIdSet.has(cid)
      );
      const sched = getExamScheduleState(ex, nowMs);

      if (status === 'PUBLISHED') {
        if (sched.phase === 'UPCOMING') {
          return {
            allowed: false,
            upcoming: true,
            countdownLabel: formatCountdown(sched.msUntilStart),
            participationType:
              isMine || ex.exam_scope === 'NATIONAL' ? 'OFFICIAL' : 'GUEST',
            reason: `Başlamasına ${formatCountdown(sched.msUntilStart)} kaldı`,
          };
        }

        if (sched.phase === 'ENDED') {
          if (ex.allow_guests ?? true) {
            return {
              allowed: true,
              participationType: 'GUEST',
              reason: 'Resmi oturum bitti — Gölge Modu açık',
            };
          }
          return {
            allowed: false,
            participationType: 'GUEST',
            reason: 'Sınav süresi doldu.',
          };
        }

        if (isMine) {
          return {
            allowed: true,
            participationType: 'OFFICIAL',
            reason: 'Sınıfına atanmış resmi sınav',
          };
        }
        if (ex.exam_scope === 'NATIONAL') {
          return {
            allowed: true,
            participationType: 'OFFICIAL',
            reason: 'Türkiye Geneli resmi katılım',
          };
        }
        if (ex.allow_guests ?? true) {
          return {
            allowed: true,
            participationType: 'GUEST',
            reason: 'Misafir (Gölge) katılıma açık',
          };
        }
        return {
          allowed: false,
          participationType: 'GUEST',
          reason: 'Yalnızca ilgili sınıfın öğrencilerine açık.',
        };
      }

      if (ex.allow_guests ?? true) {
        return {
          allowed: true,
          participationType: 'GUEST',
          reason: 'Arşiv sınavı — Gölge sıralamanı ölç',
        };
      }

      return {
        allowed: false,
        participationType: 'GUEST',
        reason: 'Yeni çözümlere kapatıldı.',
      };
    },
    [enrolledClassIdSet, nowMs]
  );

  // =========================================================================
  // BÖLME 3: AKILLI ARAMA + SINAV KODU
  // =========================================================================
  const searchResult = useMemo(() => {
    const raw = searchQuery.trim();
    if (!raw) return null;

    const normalizedCode = toAsciiUpper(raw).replace(/\s+/g, '-');
    const exactCodeMatch = nonDraftExams.find(
      (ex) => ex.exam_code && toAsciiUpper(ex.exam_code) === normalizedCode
    );

    if (exactCodeMatch) {
      return {
        type: 'CODE_MATCH' as const,
        exam: exactCodeMatch,
      };
    }

    const lower = raw.toLowerCase();
    const textMatches = nonDraftExams
      .filter((ex) => {
        const access = resolveAccess(ex);
        if (!access.allowed && !access.upcoming && !completedMap.has(ex.id)) {
          return false;
        }
        const hay =
          `${ex.title} ${ex.exam_code ?? ''} ${ex.grade ? `${ex.grade}. sınıf` : ''}`.toLowerCase();
        return hay.includes(lower);
      })
      .sort((a, b) => (b.participant_count ?? 0) - (a.participant_count ?? 0));

    return {
      type: 'SEARCH_LIST' as const,
      exams: textMatches,
      looksLikeCode:
        normalizedCode.startsWith('SNV-') ||
        /^[A-Z0-9]{2,4}-[A-Z0-9]{3,6}$/.test(normalizedCode),
    };
  }, [searchQuery, nonDraftExams, resolveAccess, completedMap]);

  // =========================================================================
  // AKSİYONLAR
  // =========================================================================

  const handleGradeChange = async (nextVal: string) => {
    const parsed = nextVal === 'ALL' ? null : Number(nextVal);
    setSelectedGrade(parsed);
    setUserChoseMode(false);
    setSavingGrade(true);
    try {
      await updateStudentGrade(studentId, parsed);
      await onProfileUpdated();
    } finally {
      setSavingGrade(false);
    }
  };

  const handleJoinClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classCode.trim()) return;

    setJoiningClass(true);
    setClassMsg(null);
    try {
      const { classroomName } = await joinClassroomByCode(classCode, studentId);
      setClassCode('');
      setClassMsg({
        type: 'ok',
        text: `"${classroomName}" sınıfına katıldın! Atanan sınavlar aşağıda listelendi.`,
      });
      await loadStudentMeta();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sınıfa katılınamadı.';
      setClassMsg({ type: 'err', text: msg });
    } finally {
      setJoiningClass(false);
    }
  };

  // DAR DİKEY SINAV KARTI (Şerit ve Arama Sonuçları için ortak)
  const renderVerticalExamCard = (
    ex: Exam,
    options?: { highlight?: boolean; fullWidth?: boolean }
  ) => {
    const attempt = completedMap.get(ex.id);
    const access = resolveAccess(ex);
    const sched = getExamScheduleState(ex, nowMs);
    const scheduleLabel = formatScheduleWindow(ex.starts_at, ex.ends_at);
    const isArchived =
      (ex.status ?? 'PUBLISHED').toUpperCase() === 'CLOSED' ||
      sched.phase === 'ENDED';

    const matchedClassId = getExamClassIds(ex).find((cid) =>
      enrolledClassIdSet.has(cid)
    );
    const assignedRoom = matchedClassId
      ? enrolledClassNameMap.get(matchedClassId)
      : undefined;

    return (
      <div
        key={ex.id}
        className={`${
          options?.fullWidth ? 'w-full' : 'w-[272px] sm:w-[288px] shrink-0 snap-start'
        } p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3.5 ${
          options?.highlight
            ? 'bg-indigo-50/70 border-indigo-400 shadow-sm ring-1 ring-indigo-200'
            : 'bg-white border-slate-200 hover:border-indigo-300 shadow-xs'
        }`}
      >
        <div className="space-y-2.5">
          {/* ÜST ROZET SATIRI */}
          <div className="flex items-center justify-between gap-1.5">
            {access.upcoming ? (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-extrabold">
                ⏳ Yakında
              </span>
            ) : isArchived ? (
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-extrabold">
                Arşiv
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-extrabold">
                Canlı
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              </span>
            )}

            {ex.exam_code && (
              <span className="font-mono text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-900 text-indigo-200">
                {ex.exam_code}
              </span>
            )}
          </div>

          {/* KAPSAM VE SEVİYE ETİKETLERİ */}
          <div className="flex flex-wrap items-center gap-1">
            {assignedRoom ? (
              <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-100 text-[10px] font-bold">
                {assignedRoom.name}
              </span>
            ) : ex.exam_scope === 'NATIONAL' ? (
              <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-900 border border-amber-200 text-[10px] font-bold">
                Türkiye Geneli
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md bg-fuchsia-50 text-fuchsia-800 border border-fuchsia-200 text-[10px] font-bold">
                Misafir Açık
              </span>
            )}

            {ex.grade && (
              <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold">
                {ex.grade}. Sınıf
              </span>
            )}
          </div>

          {/* BAŞLIK */}
          <h3 className="text-sm font-extrabold text-slate-900 leading-snug line-clamp-2 min-h-[2.4rem]">
            {ex.title}
          </h3>

          {/* META VE SAAT */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-slate-500">
              {ex.participant_count ?? 0} katılımcı • {ex.duration_minutes ?? 40}{' '}
              dk
            </p>
            {scheduleLabel && (
              <div className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-100 text-[10px] font-bold text-indigo-800">
                🕒 {scheduleLabel}
              </div>
            )}
          </div>
        </div>

        {/* ALT AKSİYON ALANI (DİKEY KART İÇİN TAM GENİŞLİK BUTON) */}
        <div className="pt-3 border-t border-slate-100 space-y-1.5">
          {attempt ? (
            <>
              <span className="block text-[10px] font-bold text-emerald-700 text-center">
                ✓ Tamamlandı (
                {attempt.participation_type === 'GUEST' ? 'Gölge' : 'Resmi'})
              </span>
              <button
                type="button"
                onClick={() => onViewCompletedReport(ex, attempt)}
                className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold cursor-pointer transition-colors"
              >
                Karneni Gör →
              </button>
            </>
          ) : access.allowed ? (
            <>
              <span
                className={`block text-[10px] font-bold text-center ${
                  access.participationType === 'OFFICIAL'
                    ? 'text-emerald-700'
                    : 'text-fuchsia-700'
                }`}
              >
                {access.participationType === 'OFFICIAL'
                  ? 'Otomatik Resmi Katılım'
                  : 'Otomatik Misafir (Gölge)'}
              </span>
              <button
                type="button"
                onClick={() => onStartExam(ex, access.participationType)}
                className={`w-full py-2 rounded-xl text-white text-xs font-extrabold cursor-pointer transition-colors ${
                  access.participationType === 'OFFICIAL'
                    ? 'bg-indigo-600 hover:bg-indigo-700'
                    : 'bg-fuchsia-600 hover:bg-fuchsia-700'
                }`}
              >
                {access.participationType === 'OFFICIAL'
                  ? 'Sınava Gir →'
                  : 'Gölge Olarak Çöz →'}
              </button>
            </>
          ) : access.upcoming ? (
            <>
              <span className="block font-mono text-[11px] font-black text-amber-900 text-center">
                ⏳ {access.countdownLabel} kaldı
              </span>
              <button
                type="button"
                onClick={() => onStartExam(ex, access.participationType)}
                className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-extrabold cursor-pointer transition-colors shadow-xs"
              >
                Bekleme Odasına Gir →
              </button>
            </>
          ) : (
            <p className="text-[11px] font-semibold text-rose-600 text-center py-1">
              {access.reason}
            </p>
          )}
        </div>
      </div>
    );
  };

  const activeDiscoveryList =
    discoveryMode === 'LIVE' ? liveDiscoveryExams : archiveDiscoveryExams;

  return (
    <div className="max-w-7xl mx-auto p-5 sm:p-6 space-y-6">
      {/* KOMPAKT ÜST KARŞILAMA VE SEVİYE SEÇİMİ */}
      <header className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-6 py-5 rounded-2xl shadow-lg border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
            Hoş geldin, {profile?.full_name ?? 'Öğrenci'}
          </h1>
          <p className="text-xs text-slate-300">
            Atanan sınavlarını çöz, seviyene uygun canlı ve popüler arşiv
            denemelerinde gölge sıralamanı ölç.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-1.5 flex items-center gap-2">
            <label
              htmlFor="lobby-grade-select"
              className="text-[11px] font-bold uppercase tracking-wider text-slate-300"
            >
              Seviyem:
            </label>
            <select
              id="lobby-grade-select"
              disabled={savingGrade}
              value={selectedGrade === null ? 'ALL' : String(selectedGrade)}
              onChange={(e) => handleGradeChange(e.target.value)}
              className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-bold text-white cursor-pointer focus:border-indigo-500 focus:outline-none"
            >
              <option value="ALL">Tüm Seviyeler</option>
              <option value="5">5. Sınıf</option>
              <option value="6">6. Sınıf</option>
              <option value="7">7. Sınıf</option>
              <option value="8">8. Sınıf (LGS)</option>
              <option value="9">9. Sınıf</option>
              <option value="10">10. Sınıf</option>
              <option value="11">11. Sınıf</option>
              <option value="12">12. Sınıf / YKS</option>
            </select>
          </div>

          <div className="bg-slate-800/80 border border-slate-700 rounded-xl px-3.5 py-1.5 flex items-center gap-2">
            <span className="text-[10px] text-slate-400 font-bold uppercase">
              Tamamlanan
            </span>
            <strong className="text-sm font-black text-emerald-300">
              {completedAttempts.length}
            </strong>
          </div>
        </div>
      </header>

      {/* =================================================================== */}
      {/* BÖLME 1: BANA ATANAN SINAVLAR (YATAY KAYDIRMALI ŞERİT)              */}
      {/* =================================================================== */}
      <section className="space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white text-xs font-black flex items-center justify-center shrink-0">
              1
            </span>
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
              Bana Atanan Sınavlar ({assignedExams.length})
            </h2>
            {enrolledClasses.map((room) => (
              <span
                key={room.classroom_id}
                className="px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-[11px] font-bold text-indigo-800"
              >
                {room.name}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <form
              onSubmit={handleJoinClassroom}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                maxLength={12}
                placeholder="Sınıf Kodu (5D-KALE)"
                value={classCode}
                onChange={(e) => setClassCode(e.target.value.toUpperCase())}
                className="w-40 rounded-xl border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={joiningClass || !classCode.trim()}
                className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-bold cursor-pointer transition-colors"
              >
                {joiningClass ? '...' : 'Katıl'}
              </button>
            </form>

            {assignedExams.length > 0 && (
              <div className="hidden sm:flex items-center gap-1 pl-1">
                <button
                  type="button"
                  aria-label="Sola kaydır"
                  onClick={() => scrollStrip(assignedStripRef, 'left')}
                  className="w-8 h-8 rounded-full border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-black text-sm flex items-center justify-center cursor-pointer shadow-2xs"
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Sağa kaydır"
                  onClick={() => scrollStrip(assignedStripRef, 'right')}
                  className="w-8 h-8 rounded-full border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-black text-sm flex items-center justify-center cursor-pointer shadow-2xs"
                >
                  ›
                </button>
              </div>
            )}
          </div>
        </div>

        {classMsg && (
          <div
            className={`px-4 py-2.5 rounded-xl text-xs font-bold border ${
              classMsg.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {classMsg.text}
          </div>
        )}

        {loadingMeta ? (
          <div className="bg-white p-5 rounded-2xl border border-slate-200 text-xs font-semibold text-slate-500 text-center">
            Sınıf sınavların kontrol ediliyor...
          </div>
        ) : assignedExams.length > 0 ? (
          <HorizontalCardStrip scrollRef={assignedStripRef}>
            {assignedExams.map((ex) => renderVerticalExamCard(ex))}
          </HorizontalCardStrip>
        ) : (
          <div className="bg-white/80 p-5 rounded-2xl border border-dashed border-slate-300 text-center text-xs text-slate-500">
            {enrolledClasses.length > 0
              ? 'Kayıtlı olduğun sınıflara henüz yeni bir sınav atanmamış.'
              : 'Henüz kayıtlı bir sınıfın yok. Öğretmeninin verdiği sınıf davet kodunu yukarıdan girebilir veya aşağıdaki sınavları çözebilirsin.'}
          </div>
        )}
      </section>

      {/* =================================================================== */}
      {/* BÖLME 2: CANLI SINAVLAR & POPÜLER ARŞİV (YATAY KAYDIRMALI ŞERİT)    */}
      {/* =================================================================== */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-6 h-6 rounded-lg bg-emerald-600 text-white text-xs font-black flex items-center justify-center shrink-0">
              2
            </span>
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
              {discoveryMode === 'LIVE'
                ? `Canlı Sınavlar${selectedGrade ? ` (${selectedGrade}. Sınıf)` : ''}`
                : `Popüler Arşiv${selectedGrade ? ` (${selectedGrade}. Sınıf)` : ''}`}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-2xs">
              <button
                type="button"
                onClick={() => {
                  setUserChoseMode(true);
                  setDiscoveryMode('LIVE');
                }}
                className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                  discoveryMode === 'LIVE'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Canlı ({liveDiscoveryExams.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setUserChoseMode(true);
                  setDiscoveryMode('ARCHIVE');
                }}
                className={`px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                  discoveryMode === 'ARCHIVE'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Popüler Arşiv ({archiveDiscoveryExams.length})
              </button>
            </div>

            {activeDiscoveryList.length > 0 && (
              <div className="hidden sm:flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Sola kaydır"
                  onClick={() => scrollStrip(discoveryStripRef, 'left')}
                  className="w-8 h-8 rounded-full border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-black text-sm flex items-center justify-center cursor-pointer shadow-2xs"
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Sağa kaydır"
                  onClick={() => scrollStrip(discoveryStripRef, 'right')}
                  className="w-8 h-8 rounded-full border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-black text-sm flex items-center justify-center cursor-pointer shadow-2xs"
                >
                  ›
                </button>
              </div>
            )}
          </div>
        </div>

        {discoveryMode === 'ARCHIVE' &&
          liveDiscoveryExams.length === 0 &&
          archiveDiscoveryExams.length > 0 && (
            <div className="px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-900">
              Şu an seviyene uygun açık canlı sınav bulunmadığı için en popüler
              arşiv sınavları listelendi.
            </div>
          )}

        {activeDiscoveryList.length > 0 ? (
          <HorizontalCardStrip scrollRef={discoveryStripRef}>
            {activeDiscoveryList.map((ex) => renderVerticalExamCard(ex))}
          </HorizontalCardStrip>
        ) : (
          <div className="bg-white/80 p-5 rounded-2xl border border-dashed border-slate-300 text-center text-xs text-slate-500">
            {selectedGrade
              ? `${selectedGrade}. sınıf için şu an bu kategoride sınav bulunamadı. Üstten "Tüm Seviyeler" seçebilirsin.`
              : 'Bu kategoride henüz sınav bulunmuyor.'}
          </div>
        )}
      </section>

      {/* =================================================================== */}
      {/* BÖLME 3: TEK AKILLI ÇUBUK — SINAV KODUYLA GİR VEYA SINAV ARA        */}
      {/* =================================================================== */}
      <section className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="w-6 h-6 rounded-lg bg-fuchsia-600 text-white text-xs font-black flex items-center justify-center shrink-0">
              3
            </span>
            <h2 className="text-base font-extrabold text-slate-900">
              Sınav Koduyla Gir veya Sınav Ara
            </h2>
          </div>
          <span className="text-[11px] text-slate-500">
            Örn: <strong className="font-mono text-slate-700">SNV-ROTA</strong>{' '}
            veya konu adı yaz
          </span>
        </div>

        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Sınav kodu gir (Örn: SNV-ROTA) veya konu / sınav adı ara..."
            className="w-full rounded-xl border-2 border-slate-200 bg-slate-50/70 focus:bg-white focus:border-indigo-500 focus:outline-none px-4 py-3 pr-24 text-sm font-semibold text-slate-900 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 px-3 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-xs font-bold text-slate-700 cursor-pointer"
            >
              Temizle
            </button>
          )}
        </div>

        {searchResult && (
          <div className="space-y-3 pt-1">
            {searchResult.type === 'CODE_MATCH' ? (
              <div className="space-y-2 max-w-sm">
                <span className="inline-block text-xs font-extrabold uppercase tracking-wider text-indigo-700">
                  ✓ Sınav Kodu Eşleşti
                </span>
                {renderVerticalExamCard(searchResult.exam, {
                  highlight: true,
                  fullWidth: true,
                })}
              </div>
            ) : searchResult.exams.length > 0 ? (
              <div className="space-y-2.5">
                <span className="inline-block text-xs font-bold text-slate-500">
                  {searchResult.exams.length} sınav bulundu:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {searchResult.exams.map((ex) =>
                    renderVerticalExamCard(ex, { fullWidth: true })
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-600 text-center">
                {searchResult.looksLikeCode
                  ? `"${toAsciiUpper(searchQuery.trim())}" koduna ait erişilebilir bir sınav bulunamadı.`
                  : `"${searchQuery.trim()}" aramasına uygun sınav bulunamadı.`}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};