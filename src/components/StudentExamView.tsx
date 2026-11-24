import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  fetchExamScheduleTimestamps,
  joinWaitingRoom,
  leaveWaitingRoom,
} from '../services/waitingRoomService';
import type { UserProfile } from '../types/auth';
import type {
  Exam,
  ExamDataset,
  OptionChoice,
  ParticipationType,
  Question,
  Student,
  StudentAnswer,
  ValidOption,
} from '../types/exam';
import {
  formatCountdown,
  formatScheduleWindow,
  getExamScheduleState,
} from '../utils/examSchedule';
import {
  QuestionDrawingArea,
  type DrawingStroke,
} from './QuestionDrawingArea';
import { StudentPostExamReport } from './StudentPostExamReport';
import { SvgPreview } from './SvgPreview';

interface StudentExamViewProps {
  exam: Exam;
  questions: Question[];
  dataset: ExamDataset;
  profile: UserProfile | null;
  isStaff: boolean;
  isPreviewMode?: boolean;
  lockedParticipationType?: ParticipationType;
  onComplete: (student: Student, answers: StudentAnswer[]) => Promise<void>;
  onGoToDashboard: () => void;
  onBackToLobby?: () => void;
}

type ExamPhase = 'WAITING_ROOM' | 'START' | 'IN_PROGRESS' | 'FINISHED';

export const StudentExamView: React.FC<StudentExamViewProps> = ({
  exam,
  questions,
  dataset,
  profile,
  isStaff,
  isPreviewMode = false,
  lockedParticipationType,
  onComplete,
  onGoToDashboard,
  onBackToLobby,
}) => {
  const sortedQuestions = useMemo(
    () => [...questions].sort((a, b) => a.question_number - b.question_number),
    [questions]
  );

  const allowGuests = exam.allow_guests ?? true;
  const isLockedMode = Boolean(lockedParticipationType);

  // Canlı başlangıç/bitiş saatleri (öğretmen erken başlatırsa anında güncellenir)
  const [liveStartsAt, setLiveStartsAt] = useState<string | null>(
    exam.starts_at ?? null
  );
  const [liveEndsAt, setLiveEndsAt] = useState<string | null>(
    exam.ends_at ?? null
  );

  // Önizlemede ara ekran atlanır; zamanlı sınavda erken girildiyse Bekleme Odası açılır
  const startsInWaitingRoom =
    !isPreviewMode &&
    isLockedMode &&
    getExamScheduleState(exam).phase === 'UPCOMING';

  const [phase, setPhase] = useState<ExamPhase>(
    isPreviewMode
      ? 'IN_PROGRESS'
      : startsInWaitingRoom
        ? 'WAITING_ROOM'
        : 'START'
  );
  const [waitingRegistered, setWaitingRegistered] = useState<boolean>(false);
  const [waitingNowMs, setWaitingNowMs] = useState<number>(() => Date.now());

  const [fullName, setFullName] = useState<string>(profile?.full_name ?? '');
  const [classroom, setClassroom] = useState<string>(
    profile?.classroom || '8-A'
  );
  const [schoolName, setSchoolName] = useState<string>(
    profile?.school_name ?? ''
  );
  const [participationType, setParticipationType] = useState<ParticipationType>(
    isPreviewMode ? 'GUEST' : (lockedParticipationType ?? 'OFFICIAL')
  );

  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<string, OptionChoice>
  >({});
  const [changeCounts, setChangeCounts] = useState<Record<string, number>>({});
  const [timeSpentMap, setTimeSpentMap] = useState<Record<string, number>>({});
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());
  const [drawingsByQuestion, setDrawingsByQuestion] = useState<
    Record<string, DrawingStroke[]>
  >({});

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [completedRecord, setCompletedRecord] = useState<{
    student: Student;
    answers: StudentAnswer[];
  } | null>(null);

  const currentQuestion = sortedQuestions[currentIdx];
  const currentQuestionIdRef = useRef<string | undefined>(currentQuestion?.id);
  currentQuestionIdRef.current = currentQuestion?.id;

  const autoSubmittedRef = useRef<boolean>(false);
  const finishExamRef = useRef<() => void>(() => {});

  // Önizleme karnesi için ana dataset'i bozmadan yalnızca bellekte geçici veri birleştir
  const reportDataset = useMemo<ExamDataset>(() => {
    if (!isPreviewMode || !completedRecord) return dataset;
    return {
      ...dataset,
      students: [...dataset.students, completedRecord.student],
      answers: [...dataset.answers, ...completedRecord.answers],
    };
  }, [isPreviewMode, completedRecord, dataset]);

  useEffect(() => {
    if (isPreviewMode) {
      setParticipationType('GUEST');
    } else if (lockedParticipationType) {
      setParticipationType(lockedParticipationType);
    }
  }, [isPreviewMode, lockedParticipationType]);

  // =========================================================================
  // BEKLEME ODASI: KAYIT + GERİ SAYIM + ÖĞRETMEN "ŞİMDİ BAŞLAT" DİNLEYİCİSİ
  // =========================================================================
  useEffect(() => {
    if (phase !== 'WAITING_ROOM') return;

    let cancelled = false;

    if (profile?.id) {
      joinWaitingRoom({
        examId: exam.id,
        userId: profile.id,
        fullName: fullName.trim() || profile.full_name || 'Öğrenci',
        classroom,
      })
        .then(() => {
          if (!cancelled) setWaitingRegistered(true);
        })
        .catch(() => {
          // Sessiz geç
        });
    }

    const clockId = window.setInterval(() => {
      setWaitingNowMs(Date.now());
    }, 1000);

    const applyUpdatedSchedule = (
      nextStarts: string | null,
      nextEnds: string | null
    ) => {
      if (cancelled) return;
      setLiveStartsAt(nextStarts);
      setLiveEndsAt(nextEnds);
      const st = getExamScheduleState({
        starts_at: nextStarts,
        ends_at: nextEnds,
      });
      if (st.phase === 'LIVE' || st.phase === 'ALWAYS_OPEN') {
        setPhase('IN_PROGRESS');
      }
    };

    const pollId = window.setInterval(async () => {
      const latest = await fetchExamScheduleTimestamps(exam.id);
      if (latest) {
        applyUpdatedSchedule(latest.starts_at, latest.ends_at);
      }
    }, 3000);

    const channel = supabase
      ? supabase
          .channel(`exam-start-${exam.id}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'exams',
              filter: `id=eq.${exam.id}`,
            },
            (payload) => {
              const row = payload.new as {
                starts_at?: string | null;
                ends_at?: string | null;
              };
              applyUpdatedSchedule(
                row.starts_at ?? null,
                row.ends_at ?? null
              );
            }
          )
          .subscribe()
      : null;

    return () => {
      cancelled = true;
      window.clearInterval(clockId);
      window.clearInterval(pollId);
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [phase, exam.id, profile?.id, profile?.full_name, fullName, classroom]);

  // Bekleme odasında geri sayım 00:00'a ulaştığı an soruları otomatik aç
  useEffect(() => {
    if (phase !== 'WAITING_ROOM') return;
    const sched = getExamScheduleState(
      { starts_at: liveStartsAt, ends_at: liveEndsAt },
      waitingNowMs
    );
    if (sched.phase === 'LIVE' || sched.phase === 'ALWAYS_OPEN') {
      setPhase('IN_PROGRESS');
    }
  }, [phase, liveStartsAt, liveEndsAt, waitingNowMs]);

  // Sınav aktifken her saniye aktif sorunun süre sayacını 1 artır
  useEffect(() => {
    if (phase !== 'IN_PROGRESS') return;

    const timer = window.setInterval(() => {
      const qId = currentQuestionIdRef.current;
      if (!qId) return;
      setTimeSpentMap((prev) => ({
        ...prev,
        [qId]: (prev[qId] ?? 0) + 1,
      }));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [phase]);

  const handleLeaveWaitingRoom = async () => {
    if (profile?.id) {
      await leaveWaitingRoom(exam.id, profile.id);
    }
    onBackToLobby?.();
  };

  const handleStartExam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || sortedQuestions.length === 0) return;

    if (
      isLockedMode &&
      getExamScheduleState({ starts_at: liveStartsAt, ends_at: liveEndsAt })
        .phase === 'UPCOMING'
    ) {
      setPhase('WAITING_ROOM');
      return;
    }

    setPhase('IN_PROGRESS');
  };

  const handleSelectOption = (questionId: string, option: ValidOption) => {
    setSelectedAnswers((prev) => {
      const previousChoice = prev[questionId] ?? null;

      if (previousChoice === option) {
        return { ...prev, [questionId]: null };
      }

      if (previousChoice !== null && previousChoice !== option) {
        setChangeCounts((cPrev) => ({
          ...cPrev,
          [questionId]: (cPrev[questionId] ?? 0) + 1,
        }));
      }

      return { ...prev, [questionId]: option };
    });
  };

  const handleToggleFlag = (questionId: string) => {
    setFlaggedIds((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  };

  const handleFinishExam = async () => {
    if (submitting) return;
    setSubmitting(true);

    const effectiveParticipation: ParticipationType = isPreviewMode
      ? 'GUEST'
      : (lockedParticipationType ??
        (allowGuests ? participationType : 'OFFICIAL'));

    const newStudent: Student = {
      id: isPreviewMode ? `preview-${Date.now()}` : `stu-${Date.now()}`,
      full_name: isPreviewMode
        ? `${fullName.trim() || profile?.full_name || 'Öğretmen'} (Önizleme)`
        : fullName.trim() || profile?.full_name || 'Öğrenci',
      classroom,
      participation_type: effectiveParticipation,
      school_name: schoolName.trim() || null,
    };

    const finalAnswers: StudentAnswer[] = sortedQuestions.map((q) => ({
      exam_id: exam.id,
      student_id: newStudent.id,
      question_id: q.id,
      selected_option: selectedAnswers[q.id] ?? null,
      time_spent_seconds: timeSpentMap[q.id] ?? 0,
      change_count: changeCounts[q.id] ?? 0,
    }));

    try {
      // Önizleme modunda veritabanına ve canlı analiz verisine hiçbir kayıt yazılmaz
      if (!isPreviewMode) {
        await onComplete(newStudent, finalAnswers);
      }
      setCompletedRecord({ student: newStudent, answers: finalAnswers });
      setPhase('FINISHED');
    } finally {
      setSubmitting(false);
    }
  };

  finishExamRef.current = handleFinishExam;

  // Sınav içi geri sayım ve bitiş saatinde otomatik teslim (Önizleme modunda çalışmaz)
  useEffect(() => {
    if (phase !== 'IN_PROGRESS' || isPreviewMode) {
      setRemainingMs(null);
      return;
    }

    autoSubmittedRef.current = false;
    const durationDeadline =
      Date.now() + (exam.duration_minutes ?? 40) * 60 * 1000;
    const scheduleEndMs = liveEndsAt ? new Date(liveEndsAt).getTime() : null;

    const effectiveDeadline =
      scheduleEndMs &&
      scheduleEndMs > Date.now() &&
      participationType === 'OFFICIAL'
        ? Math.min(durationDeadline, scheduleEndMs)
        : durationDeadline;

    const tick = () => {
      const left = Math.max(0, effectiveDeadline - Date.now());
      setRemainingMs(left);
      if (left === 0 && !autoSubmittedRef.current) {
        autoSubmittedRef.current = true;
        finishExamRef.current();
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [
    phase,
    isPreviewMode,
    exam.duration_minutes,
    liveEndsAt,
    participationType,
  ]);

  const handleRetake = () => {
    if (!isStaff && onBackToLobby) {
      onBackToLobby();
      return;
    }
    setCurrentIdx(0);
    setSelectedAnswers({});
    setChangeCounts({});
    setTimeSpentMap({});
    setFlaggedIds(new Set());
    setDrawingsByQuestion({});
    setCompletedRecord(null);
    setPhase(isPreviewMode ? 'IN_PROGRESS' : 'START');
  };

  // =========================================================================
  // FAZ 0: CANLI BEKLEME ODASI (SORULAR KİLİTLİ, GERİ SAYIM AKTİF)
  // =========================================================================
  if (phase === 'WAITING_ROOM') {
    const sched = getExamScheduleState(
      { starts_at: liveStartsAt, ends_at: liveEndsAt },
      waitingNowMs
    );
    const windowText = formatScheduleWindow(liveStartsAt, liveEndsAt);

    return (
      <div className="max-w-xl mx-auto p-6 md:p-10 space-y-5">
        <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-8 text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-xs font-extrabold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              {waitingRegistered
                ? 'Bekleme Odasındasın — Öğretmenine Bildirildi'
                : 'Bekleme Odasına Bağlanılıyor...'}
            </div>

            <h1 className="text-2xl font-extrabold leading-snug">
              {exam.title}
            </h1>

            {windowText && (
              <p className="text-xs font-semibold text-indigo-200">
                Planlanan Oturum: {windowText}
              </p>
            )}

            <div className="py-5 px-6 rounded-2xl bg-slate-950/60 border border-slate-700/80 inline-block min-w-[240px]">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                Başlamasına Kalan Süre
              </span>
              <span className="font-mono text-4xl sm:text-5xl font-black tracking-wider text-amber-300">
                {formatCountdown(sched.msUntilStart)}
              </span>
            </div>
          </div>

          <div className="p-7 space-y-5 text-center">
            <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100 text-xs text-indigo-950 space-y-1.5 leading-relaxed">
              <p className="font-extrabold">
                🔒 Sorular sınav başladığında otomatik açılacaktır.
              </p>
              <p className="text-indigo-800">
                Sayfayı kapatmadan burada bekle. Süre dolduğunda veya öğretmenin
                sınıf tamamlandığı için sınavı{' '}
                <strong>erken başlattığında</strong> 1. soru anında ekranına
                gelecektir.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-slate-600 font-semibold">
              <span className="px-3 py-1 rounded-lg bg-slate-100">
                Katılımcı: <strong>{fullName || profile?.full_name}</strong>
              </span>
              <span className="px-3 py-1 rounded-lg bg-slate-100">
                {sortedQuestions.length} Soru • {exam.duration_minutes ?? 40} dk
              </span>
            </div>

            {onBackToLobby && (
              <button
                type="button"
                onClick={handleLeaveWaitingRoom}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-600 cursor-pointer"
              >
                ← Bekleme Odasından Ayrıl
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // FAZ 1: SINAV GİRİŞ EKRANI (YALNIZCA GERÇEK ÖĞRENCİ / SERBEST MOD)
  // =========================================================================
  if (phase === 'START') {
    return (
      <div className="max-w-xl mx-auto p-6 md:p-10 space-y-4">
        {onBackToLobby && (
          <button
            type="button"
            onClick={onBackToLobby}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-indigo-700 cursor-pointer"
          >
            ← Öğrenci Lobisine Dön
          </button>
        )}

        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-7 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-200 text-xs font-bold uppercase tracking-wider">
                {exam.exam_scope === 'CLASSROOM'
                  ? 'Kurum / Sınıf Denemesi'
                  : 'Türkiye Geneli Deneme'}
              </span>
              {exam.exam_code && (
                <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-indigo-200">
                  {exam.exam_code}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-extrabold">{exam.title}</h1>
            <p className="text-xs text-slate-300">
              {sortedQuestions.length} Soru • {exam.duration_minutes ?? 40} dk •
              Yanlış Götürme: {exam.wrong_penalty_ratio}
            </p>
          </div>

          <form onSubmit={handleStartExam} className="p-7 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                  Ad Soyad
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Ali Yılmaz"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="student-classroom"
                  className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1"
                >
                  Şube / Seviye
                </label>
                <select
                  id="student-classroom"
                  value={classroom}
                  onChange={(e) => setClassroom(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="5-A">5-A Şubesi</option>
                  <option value="5-B">5-B Şubesi</option>
                  <option value="5-C">5-C Şubesi</option>
                  <option value="5-D">5-D Şubesi</option>
                  <option value="6-A">6-A Şubesi</option>
                  <option value="7-A">7-A Şubesi</option>
                  <option value="8-A">8-A Şubesi</option>
                  <option value="8-B">8-B Şubesi</option>
                  <option value="8-C">8-C Şubesi</option>
                  <option value="Bireysel">Bireysel / YKS</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                Okul Adı (Opsiyonel)
              </label>
              <input
                type="text"
                placeholder="Örn: Atatürk Ortaokulu"
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {isLockedMode ? (
              <div
                className={`p-4 rounded-xl border text-xs space-y-1 ${
                  participationType === 'OFFICIAL'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-900'
                }`}
              >
                <p className="font-extrabold uppercase tracking-wider">
                  {participationType === 'OFFICIAL'
                    ? '✓ Resmi Katılım (Otomatik)'
                    : '✦ Misafir / Gölge Katılım (Otomatik)'}
                </p>
                <p className="leading-relaxed opacity-90">
                  {participationType === 'OFFICIAL'
                    ? 'Sonuçların resmi sıralamaya ve analiz raporlarına doğrudan dahil edilecektir.'
                    : 'Kurumun resmi ortalamasını etkilemeden sınava katılır; bitirdiğinde gölge sıralamanı görürsün.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <span className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Katılım Türü
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setParticipationType('OFFICIAL')}
                    className={`p-3.5 rounded-xl border-2 text-left transition-all cursor-pointer ${
                      participationType === 'OFFICIAL'
                        ? 'border-emerald-600 bg-emerald-50/70'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-slate-900">
                        Resmi Katılım
                      </span>
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                      Resmi ortalamaya ve resmi sıralamaya dahil olur.
                    </p>
                  </button>

                  <button
                    type="button"
                    disabled={!allowGuests}
                    onClick={() => setParticipationType('GUEST')}
                    className={`p-3.5 rounded-xl border-2 text-left transition-all ${
                      !allowGuests
                        ? 'border-slate-200 bg-slate-100 opacity-50 cursor-not-allowed'
                        : participationType === 'GUEST'
                          ? 'border-fuchsia-600 bg-fuchsia-50/70 cursor-pointer'
                          : 'border-slate-200 hover:border-slate-300 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-slate-900">
                        Misafir (Gölge)
                      </span>
                      <span className="w-2.5 h-2.5 rounded-full bg-fuchsia-500" />
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                      {allowGuests
                        ? 'Resmi ortalamayı etkilemeden gölge sıralama üretir.'
                        : 'Misafir katılımı kapalı.'}
                    </p>
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={sortedQuestions.length === 0 || !fullName.trim()}
              className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-extrabold text-sm shadow-md shadow-indigo-600/20 transition-colors cursor-pointer"
            >
              Sınava Başla →
            </button>
          </form>
        </div>
      </div>
    );
  }

  // =========================================================================
  // FAZ 3: SINAV SONU KARNESİ
  // =========================================================================
  if (phase === 'FINISHED' && completedRecord) {
    return (
      <div>
        <div className="max-w-5xl mx-auto px-6 md:px-8 pt-6 flex flex-wrap items-center justify-between gap-3">
          {onBackToLobby && (
            <button
              type="button"
              onClick={onBackToLobby}
              className="px-4 py-2 rounded-xl bg-white border border-slate-200 shadow-xs text-xs font-bold text-slate-700 hover:text-indigo-700 hover:border-indigo-300 cursor-pointer"
            >
              {isPreviewMode
                ? '← Öğretmen Lobisine Dön'
                : '← Öğrenci Lobisine Dön'}
            </button>
          )}
          {isPreviewMode && (
            <span className="px-3.5 py-1.5 rounded-xl bg-amber-100 border border-amber-300 text-amber-950 text-xs font-extrabold">
              👁 Önizleme Karnesi — Veritabanına kaydedilmedi
            </span>
          )}
        </div>
        <StudentPostExamReport
          dataset={reportDataset}
          student={completedRecord.student}
          answers={completedRecord.answers}
          isStaff={isStaff}
          onRetake={handleRetake}
          onGoToDashboard={onGoToDashboard}
        />
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <div className="max-w-xl mx-auto p-8 text-center space-y-4">
        <div className="bg-white p-8 rounded-2xl border border-slate-200 space-y-3">
          <p className="text-sm font-bold text-slate-700">
            Bu sınava henüz soru eklenmemiş.
          </p>
          {onBackToLobby && (
            <button
              type="button"
              onClick={onBackToLobby}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer"
            >
              ← Lobiye Dön
            </button>
          )}
        </div>
      </div>
    );
  }

  const availableOptions: ValidOption[] =
    currentQuestion.correct_option === 'E' || Boolean(currentQuestion.options?.E)
      ? ['A', 'B', 'C', 'D', 'E']
      : ['A', 'B', 'C', 'D'];

  const answeredCount = Object.values(selectedAnswers).filter(Boolean).length;
  const isFlagged = flaggedIds.has(currentQuestion.id);

  // =========================================================================
  // FAZ 2: AKTİF SINAV ÇÖZÜM / ÖNİZLEME EKRANI
  // =========================================================================
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 md:p-8 space-y-4">
      {isPreviewMode && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-amber-950">
            <span className="px-2.5 py-0.5 rounded-lg bg-amber-200 font-black uppercase tracking-wider text-[10px]">
              Önizleme Modu
            </span>
            <span className="font-bold">
              {exam.title} — Cevapların veritabanına yazılmaz ve sınıf
              istatistiklerini etkilemez.
            </span>
          </div>
          {onBackToLobby && (
            <button
              type="button"
              onClick={onBackToLobby}
              className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer shrink-0"
            >
              ← Lobiye Dön
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-7 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs font-black">
                  Soru {currentQuestion.question_number} /{' '}
                  {sortedQuestions.length}
                </span>
                {remainingMs !== null && (
                  <span
                    className={`font-mono px-2.5 py-1 rounded-lg text-xs font-black border ${
                      remainingMs <= 60_000
                        ? 'bg-rose-600 text-white border-rose-700 animate-pulse'
                        : remainingMs <= 300_000
                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : 'bg-slate-900 text-emerald-300 border-slate-800'
                    }`}
                  >
                    ⏱ {formatCountdown(remainingMs)}
                  </span>
                )}
                <span className="text-xs text-slate-500 font-semibold">
                  Bu soru: {timeSpentMap[currentQuestion.id] ?? 0} sn
                </span>
                {!isPreviewMode && participationType === 'GUEST' && (
                  <span className="px-2 py-0.5 rounded bg-fuchsia-100 text-fuchsia-800 text-[10px] font-extrabold uppercase">
                    Misafir Modu
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleToggleFlag(currentQuestion.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                  isFlagged
                    ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {isFlagged ? '⚑ İşaretlendi' : '⚐ Sonra Bak'}
              </button>
            </div>

            <QuestionDrawingArea
              strokes={drawingsByQuestion[currentQuestion.id] ?? []}
              onStrokesChange={(nextStrokes) =>
                setDrawingsByQuestion((prev) => ({
                  ...prev,
                  [currentQuestion.id]: nextStrokes,
                }))
              }
            >
              <div className="space-y-4">
                <SvgPreview svgCode={currentQuestion.svg_code} />

                <div className="text-base sm:text-lg font-semibold text-slate-900 leading-relaxed whitespace-pre-line">
                  {currentQuestion.question_text ??
                    currentQuestion.outcome_title}
                </div>
              </div>
            </QuestionDrawingArea>

            <div className="space-y-2.5 pt-1">
              {availableOptions.map((opt) => {
                const isSelected = selectedAnswers[currentQuestion.id] === opt;
                const optionLabel =
                  currentQuestion.options?.[opt] ?? `${opt} Seçeneği`;

                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handleSelectOption(currentQuestion.id, opt)}
                    className={`w-full text-left p-4 rounded-xl border-2 flex items-center gap-3.5 transition-all cursor-pointer ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-50/70 shadow-xs'
                        : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs shrink-0 ${
                        isSelected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {opt}
                    </span>
                    <span className="text-sm font-semibold text-slate-800">
                      {optionLabel}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <button
                type="button"
                disabled={currentIdx === 0}
                onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-700 disabled:opacity-35 hover:bg-slate-50 cursor-pointer"
              >
                ← Önceki
              </button>

              {currentIdx < sortedQuestions.length - 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    setCurrentIdx((i) =>
                      Math.min(sortedQuestions.length - 1, i + 1)
                    )
                  }
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                >
                  Sonraki Soru →
                </button>
              ) : (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleFinishExam}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-extrabold shadow-md shadow-emerald-600/20 cursor-pointer"
                >
                  {submitting
                    ? 'Kaydediliyor...'
                    : isPreviewMode
                      ? 'Önizlemeyi Bitir & Karneyi Gör'
                      : 'Sınavı Bitir & Karnemi Gör'}
                </button>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                Soru Paleti
              </h2>
              <span className="text-xs font-bold text-indigo-600">
                {answeredCount}/{sortedQuestions.length}
              </span>
            </div>

            <div className="grid grid-cols-5 gap-2">
              {sortedQuestions.map((q, idx) => {
                const isCurrent = idx === currentIdx;
                const isAnswered = Boolean(selectedAnswers[q.id]);
                const flagged = flaggedIds.has(q.id);

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setCurrentIdx(idx)}
                    className={`h-9 rounded-lg text-xs font-black transition-all cursor-pointer border ${
                      isCurrent
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : flagged
                          ? 'bg-amber-50 text-amber-800 border-amber-300'
                          : isAnswered
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {q.question_number}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={handleFinishExam}
              className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold cursor-pointer transition-colors"
            >
              {submitting
                ? 'Kaydediliyor...'
                : isPreviewMode
                  ? 'Önizlemeyi Bitir'
                  : 'Sınavı Erken Bitir'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};