import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchAvailablePoolSubjects,
  fetchUnreviewedQuestions,
  submitQuestionReview,
  updateReviewerSubject,
  type ReviewablePoolQuestion,
  type ReviewDecision,
} from '../services/questionReviewService';
import type { UserProfile } from '../types/auth';
import type { ValidOption } from '../types/exam';
import { FormattedQuestionText } from './FormattedQuestionText';
import { SvgPreview } from './SvgPreview';

interface QuestionReviewPanelProps {
  userId: string;
  profile: (UserProfile & { subject?: string | null }) | null;
  onProfileUpdated?: () => Promise<void>;
  onExit?: () => void;
  onSignOut: () => Promise<void>;
}

const DEFAULT_SUBJECTS = [
  'Matematik',
  'Fen Bilimleri',
  'Sosyal Bilgiler',
  'Türkçe',
  'İngilizce',
  'Din Kültürü',
  'T.C. İnkılap Tarihi',
];

export const QuestionReviewPanel: React.FC<QuestionReviewPanelProps> = ({
  userId,
  profile,
  onProfileUpdated,
  onExit,
  onSignOut,
}) => {
  const [selectedSubject, setSelectedSubject] = useState<string>(
    profile?.subject ?? ''
  );
  const [poolSubjects, setPoolSubjects] = useState<string[]>([]);
  const [questions, setQuestions] = useState<ReviewablePoolQuestion[]>([]);
  const [reviewedTotal, setReviewedTotal] = useState<number>(0);
  const [unitFilter, setUnitFilter] = useState<string>('ALL');
  const [currentIdx, setCurrentIdx] = useState<number>(0);

  const [note, setNote] = useState<string>('');
  const [showSolution, setShowSolution] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Aktif inceleme süresi sayacı (ekran kapanınca / sekme değişince durur)
  const accumulatedMsRef = useRef<number>(0);
  const activeStartRef = useRef<number | null>(null);

  useEffect(() => {
    fetchAvailablePoolSubjects()
      .then((subs) => {
        const merged = Array.from(new Set([...subs, ...DEFAULT_SUBJECTS])).sort(
          (a, b) => a.localeCompare(b, 'tr')
        );
        setPoolSubjects(merged);
      })
      .catch(() => setPoolSubjects(DEFAULT_SUBJECTS));
  }, []);

  const loadQueue = useCallback(
    async (subject: string) => {
      if (!subject) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetchUnreviewedQuestions(userId, subject);
        setQuestions(res.questions);
        setReviewedTotal(res.reviewedCount);
        setCurrentIdx(0);
        setUnitFilter('ALL');
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Sorular yüklenemedi.'
        );
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    if (selectedSubject) {
      void loadQueue(selectedSubject);
    } else {
      setLoading(false);
    }
  }, [selectedSubject, loadQueue]);

  const availableUnits = useMemo(() => {
    const set = new Set<string>();
    questions.forEach((q) => {
      if (q.unit?.trim()) set.add(q.unit.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    if (unitFilter === 'ALL') return questions;
    return questions.filter((q) => (q.unit?.trim() || '') === unitFilter);
  }, [questions, unitFilter]);

  const currentQuestion = filteredQuestions[currentIdx] ?? null;

  // Her yeni soruda süreyi sıfırla
  useEffect(() => {
    accumulatedMsRef.current = 0;
    activeStartRef.current =
      currentQuestion && !document.hidden ? Date.now() : null;
  }, [currentQuestion?.id]);

  // Sekme arka plana atıldığında / ekran kilitlendiğinde süreyi duraklat
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (activeStartRef.current !== null) {
          accumulatedMsRef.current += Date.now() - activeStartRef.current;
          activeStartRef.current = null;
        }
      } else if (currentQuestion) {
        activeStartRef.current = Date.now();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentQuestion]);

  const getElapsedSeconds = (): number => {
    const runningMs =
      activeStartRef.current !== null ? Date.now() - activeStartRef.current : 0;
    const totalMs = accumulatedMsRef.current + runningMs;
    return Math.max(1, Math.round(totalMs / 1000));
  };

  const handleSelectSubject = async (subject: string) => {
    setSelectedSubject(subject);
    try {
      await updateReviewerSubject(userId, subject);
      await onProfileUpdated?.();
    } catch {
      // Profil güncellenemese bile incelemeye devam edebilsin
    }
  };

  const handleVote = async (decision: ReviewDecision) => {
    if (!currentQuestion || submitting) return;
    setSubmitting(true);
    setError(null);

    const durationSeconds = getElapsedSeconds();

    try {
      await submitQuestionReview({
        questionId: currentQuestion.id,
        reviewerId: userId,
        decision,
        note,
        durationSeconds,
      });

      const votedId = currentQuestion.id;
      setQuestions((prev) => prev.filter((q) => q.id !== votedId));
      setReviewedTotal((c) => c + 1);
      setNote('');
      setShowSolution(false);
      setCurrentIdx((idx) =>
        idx >= filteredQuestions.length - 1 ? 0 : idx
      );

      setToast(
        decision === 'APPROVE'
          ? '✓ Olur olarak kaydedildi'
          : '✕ Olmaz olarak kaydedildi'
      );
      window.setTimeout(() => setToast(null), 1800);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Değerlendirme kaydedilemedi.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // BRANŞ SEÇİM EKRANI (İLK GİRİŞ)
  if (!selectedSubject) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-lg border border-slate-200 p-6 space-y-5">
          <div className="space-y-1 text-center">
            <span className="inline-block px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-extrabold uppercase tracking-wider">
              Soru Kalite Kontrol Paneli
            </span>
            <h1 className="text-xl font-extrabold text-slate-900">
              Hoş geldin, {profile?.full_name || 'Hocam'}
            </h1>
            <p className="text-xs text-slate-500">
              Sadece kendi dersindeki soruları görmek için branşını seç:
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {poolSubjects.map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => handleSelectSubject(sub)}
                className="w-full py-3.5 px-4 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 text-sm font-extrabold text-slate-800 transition-all cursor-pointer text-left flex items-center justify-between"
              >
                <span>{sub}</span>
                <span>→</span>
              </button>
            ))}
          </div>

          <div className="pt-2 flex justify-between items-center text-xs">
            {onExit && (
              <button
                type="button"
                onClick={onExit}
                className="font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                ← Ana Panele Dön
              </button>
            )}
            <button
              type="button"
              onClick={onSignOut}
              className="font-bold text-rose-600 hover:text-rose-800 cursor-pointer ml-auto"
            >
              Çıkış Yap
            </button>
          </div>
        </div>
      </div>
    );
  }

  const availableOptions: ValidOption[] =
    currentQuestion &&
    (currentQuestion.correct_option === 'E' ||
      Boolean(currentQuestion.options?.E))
      ? ['A', 'B', 'C', 'D', 'E']
      : ['A', 'B', 'C', 'D'];

  return (
    <div className="min-h-screen bg-slate-100 pb-10">
      {/* MOBİL ÖNCELİKLİ SABİT ÜST BAR */}
      <header className="sticky top-0 z-30 bg-slate-900 text-white px-4 py-3 shadow-md">
        <div className="max-w-xl mx-auto flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-emerald-300 truncate">
                {selectedSubject}
              </span>
              <button
                type="button"
                onClick={() => setSelectedSubject('')}
                className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold cursor-pointer"
              >
                Değiştir
              </button>
            </div>
            <p className="text-[11px] text-slate-400 font-semibold">
              Toplam incelemen:{' '}
              <strong className="text-white">{reviewedTotal}</strong> soru
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onExit && (
              <button
                type="button"
                onClick={onExit}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-slate-200 cursor-pointer"
              >
                Ana Panel
              </button>
            )}
            <button
              type="button"
              onClick={onSignOut}
              className="px-2.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 text-rose-200 text-[11px] font-bold cursor-pointer"
            >
              Çıkış
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-3.5 pt-4 space-y-3.5">
        {/* TEMA / ÜNİTE FİLTRESİ VE İLERLEME */}
        <div className="bg-white rounded-2xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-2 shadow-xs">
          <select
            value={unitFilter}
            onChange={(e) => {
              setUnitFilter(e.target.value);
              setCurrentIdx(0);
              setShowSolution(false);
            }}
            className="flex-1 min-w-[180px] rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800"
          >
            <option value="ALL">
              Tüm Temalar / Üniteler ({questions.length} soru)
            </option>
            {availableUnits.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>

          {filteredQuestions.length > 0 && (
            <span className="px-3 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-black shrink-0">
              {currentIdx + 1} / {filteredQuestions.length}
            </span>
          )}
        </div>

        {/* BİLDİRİM / HATA */}
        {toast && (
          <div className="px-4 py-2.5 rounded-xl bg-slate-900 text-emerald-300 text-xs font-extrabold text-center shadow-md">
            {toast}
          </div>
        )}
        {error && (
          <div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
            {error}
          </div>
        )}

        {/* İÇERİK */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-xs font-bold text-slate-500">
            Sorular yükleniyor...
          </div>
        ) : !currentQuestion ? (
          <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-3 shadow-xs">
            <div className="text-3xl">🎉</div>
            <h2 className="text-base font-extrabold text-slate-900">
              İncelenecek soru kalmadı!
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              <strong>{selectedSubject}</strong> dersinde şu an bekleyen tüm
              soruları değerlendirdin. Yeni sorular yüklendiğinde burada
              görünecek.
            </p>
            <button
              type="button"
              onClick={() => loadQueue(selectedSubject)}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer"
            >
              Yenile
            </button>
          </div>
        ) : (
          <div className="space-y-3.5">
            {/* SORU NİTELİKLERİ KARTI */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2 shadow-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                {currentQuestion.grade && (
                  <span className="px-2.5 py-0.5 rounded-md bg-slate-900 text-white text-[11px] font-extrabold">
                    {currentQuestion.grade}. Sınıf
                  </span>
                )}
                <span className="px-2.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100 font-mono text-[11px] font-extrabold">
                  {currentQuestion.outcome_code}
                </span>
                {currentQuestion.difficulty && (
                  <span className="px-2.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold">
                    {currentQuestion.difficulty}
                  </span>
                )}
                {currentQuestion.curriculum_week && (
                  <span className="px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-bold">
                    {currentQuestion.curriculum_week}. Hafta
                  </span>
                )}
              </div>

              {currentQuestion.unit && (
                <p className="text-[11px] font-bold text-slate-500">
                  Tema: {currentQuestion.unit}
                </p>
              )}
              <p className="text-xs font-semibold text-slate-700 leading-snug">
                {currentQuestion.outcome_title}
              </p>
            </div>

            {/* ÖĞRENCİ GÖRÜNÜMÜ (SORU + SVG + ŞIKLAR) */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4 shadow-xs">
              <SvgPreview svgCode={currentQuestion.svg_code} />

              <FormattedQuestionText
                text={
                  currentQuestion.question_text ?? currentQuestion.outcome_title
                }
                className="text-sm sm:text-base font-semibold text-slate-900 leading-relaxed"
              />

              <div className="space-y-2 pt-1">
                {availableOptions.map((opt) => {
                  const isCorrect =
                    showSolution && currentQuestion.correct_option === opt;
                  return (
                    <div
                      key={opt}
                      className={`p-3 rounded-xl border flex items-center gap-3 ${
                        isCorrect
                          ? 'border-emerald-500 bg-emerald-50/70'
                          : 'border-slate-200 bg-slate-50/50'
                      }`}
                    >
                      <span
                        className={`w-7 h-7 rounded-lg flex items-center justify-center font-black text-xs shrink-0 ${
                          isCorrect
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white border border-slate-200 text-slate-700'
                        }`}
                      >
                        {opt}
                      </span>
                      <span className="text-xs sm:text-sm font-semibold text-slate-800">
                        {currentQuestion.options?.[opt] ?? `${opt} Seçeneği`}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* AÇILIR DOĞRU CEVAP VE ÇÖZÜM */}
              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowSolution((v) => !v)}
                  className="text-xs font-extrabold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                >
                  {showSolution
                    ? '▲ Doğru Cevabı ve Çözümü Gizle'
                    : '▼ Doğru Cevabı ve Çözümü Kontrol Et'}
                </button>

                {showSolution && (
                  <div className="mt-2.5 p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-slate-800 space-y-1">
                    <p className="font-extrabold text-emerald-900">
                      Doğru Cevap: {currentQuestion.correct_option}
                    </p>
                    {currentQuestion.solution && (
                      <p className="leading-relaxed">
                        {currentQuestion.solution}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* KARAR BUTONLARI + ALTINDA İLETİ KUTUSU */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleVote('APPROVE')}
                  className="py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50 text-white text-sm font-black shadow-md shadow-emerald-600/20 cursor-pointer transition-all"
                >
                  ✓ Olur
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleVote('REJECT')}
                  className="py-3.5 px-4 rounded-2xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] disabled:opacity-50 text-white text-sm font-black shadow-md shadow-rose-600/20 cursor-pointer transition-all"
                >
                  ✕ Olmaz
                </button>
              </div>

              <div className="space-y-1">
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Soruyla ilgili belirtmek istediğin bir şey varsa buraya yaz (opsiyonel)..."
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-medium text-slate-800 focus:bg-white focus:border-indigo-500 focus:outline-none"
                />
                <p className="text-[10px] text-slate-400">
                  Not eklemek istersen önce buraya yazıp yukarıdan Olur / Olmaz
                  seçebilirsin.
                </p>
              </div>

              {filteredQuestions.length > 1 && (
                <div className="flex items-center justify-between pt-1 text-xs">
                  <button
                    type="button"
                    disabled={currentIdx === 0}
                    onClick={() => {
                      setCurrentIdx((i) => Math.max(0, i - 1));
                      setShowSolution(false);
                    }}
                    className="font-bold text-slate-500 disabled:opacity-30 cursor-pointer"
                  >
                    ← Önceki
                  </button>
                  <button
                    type="button"
                    disabled={currentIdx >= filteredQuestions.length - 1}
                    onClick={() => {
                      setCurrentIdx((i) =>
                        Math.min(filteredQuestions.length - 1, i + 1)
                      );
                      setShowSolution(false);
                    }}
                    className="font-bold text-slate-500 disabled:opacity-30 cursor-pointer"
                  >
                    Atla / Sonraki →
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};