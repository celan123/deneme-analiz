import React, { useMemo, useState } from 'react';
import type { SmartboardPayload } from '../services/smartboardService';
import type { ValidOption } from '../types/exam';
import {
  QuestionDrawingArea,
  type DrawingStroke,
} from './QuestionDrawingArea';
import { SvgPreview } from './SvgPreview';

interface SmartboardModeViewProps {
  payload: SmartboardPayload;
  onClose: () => void;
}

type SortMode = 'MOST_MISSED' | 'ORDER';

export const SmartboardModeView: React.FC<SmartboardModeViewProps> = ({
  payload,
  onClose,
}) => {
  const [selectedClass, setSelectedClass] = useState<string>(
    payload.classrooms.length === 1 ? payload.classrooms[0] : 'ALL'
  );
  const [sortMode, setSortMode] = useState<SortMode>('MOST_MISSED');
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [revealAnswer, setRevealAnswer] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [drawingsByQuestion, setDrawingsByQuestion] = useState<
    Record<string, DrawingStroke[]>
  >({});

  const orderedQuestions = useMemo(() => {
    const list = [...payload.questions];
    if (sortMode === 'ORDER') {
      return list.sort((a, b) => a.question_number - b.question_number);
    }
    return list.sort((a, b) => {
      const rateA = a.statsByClass[selectedClass]?.missRate ?? 0;
      const rateB = b.statsByClass[selectedClass]?.missRate ?? 0;
      if (rateB !== rateA) return rateB - rateA;
      return a.question_number - b.question_number;
    });
  }, [payload.questions, sortMode, selectedClass]);

  const safeIndex = Math.min(
    activeIndex,
    Math.max(0, orderedQuestions.length - 1)
  );
  const currentQ = orderedQuestions[safeIndex];

  const handleSelectQuestion = (idx: number) => {
    setActiveIndex(idx);
    setRevealAnswer(false);
  };

  const handleClassChange = (nextClass: string) => {
    setSelectedClass(nextClass);
    setActiveIndex(0);
    setRevealAnswer(false);
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // Desteklemeyen tarayıcıda sessiz geç
    }
  };

  const handleExit = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    onClose();
  };

  if (!currentQ) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-4">
          <p className="text-base font-bold">Bu sınavda soru bulunmuyor.</p>
          <button
            type="button"
            onClick={handleExit}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold cursor-pointer"
          >
            Oturumu Kapat
          </button>
        </div>
      </div>
    );
  }

  const stat = currentQ.statsByClass[selectedClass] ?? {
    total: 0,
    correct: 0,
    wrong: 0,
    blank: 0,
    missRate: 0,
    optionCounts: { A: 0, B: 0, C: 0, D: 0, E: 0, BLANK: 0 },
  };

  const availableOptions: ValidOption[] =
    currentQ.correct_option === 'E' || Boolean(currentQ.options?.E)
      ? ['A', 'B', 'C', 'D', 'E']
      : ['A', 'B', 'C', 'D'];

  const topDistractor = availableOptions
    .filter((o) => o !== currentQ.correct_option)
    .reduce<{ opt: ValidOption | null; count: number }>(
      (best, opt) => {
        const c = stat.optionCounts[opt] ?? 0;
        return c > best.count ? { opt, count: c } : best;
      },
      { opt: null, count: 0 }
    );

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* ÜST TAHTA KONTROL ÇUBUĞU */}
      <header className="sticky top-0 z-30 bg-slate-900 text-white border-b border-slate-800 px-4 sm:px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[11px] font-extrabold uppercase tracking-wider shrink-0">
              🔒 Güvenli Tahta Modu
            </span>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-extrabold truncate">
                {payload.examTitle}
              </h1>
              <p className="text-[11px] text-slate-400 truncate">
                {payload.teacherName} • Salt Okunur Ders Ekranı
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* ŞUBE FİLTRESİ */}
            <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-xl border border-slate-700">
              <button
                type="button"
                onClick={() => handleClassChange('ALL')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  selectedClass === 'ALL'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Tümü ({payload.classSizes.ALL ?? 0})
              </button>
              {payload.classrooms.map((cls) => (
                <button
                  key={cls}
                  type="button"
                  onClick={() => handleClassChange(cls)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    selectedClass === cls
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {cls} ({payload.classSizes[cls] ?? 0})
                </button>
              ))}
            </div>

            {/* SIRALAMA */}
            <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-xl border border-slate-700">
              <button
                type="button"
                onClick={() => {
                  setSortMode('MOST_MISSED');
                  setActiveIndex(0);
                  setRevealAnswer(false);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                  sortMode === 'MOST_MISSED'
                    ? 'bg-rose-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                🔥 En Çok Hata
              </button>
              <button
                type="button"
                onClick={() => {
                  setSortMode('ORDER');
                  setActiveIndex(0);
                  setRevealAnswer(false);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                  sortMode === 'ORDER'
                    ? 'bg-slate-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                1 → {orderedQuestions.length}
              </button>
            </div>

            <button
              type="button"
              onClick={toggleFullscreen}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 cursor-pointer"
            >
              {isFullscreen ? 'Tam Ekrandan Çık' : '⛶ Tam Ekran'}
            </button>

            <button
              type="button"
              onClick={handleExit}
              className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-extrabold text-white cursor-pointer"
            >
              Tahtayı Kapat
            </button>
          </div>
        </div>
      </header>

      {/* ANA TAHTA ALANI */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* SOL/ORTA: TAM PANEL ÇİZİLEBİLİR SORU TAHTASI */}
        <section className="lg:col-span-9 flex flex-col">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm flex-1 flex flex-col overflow-hidden">
            {/* SORU ÜST ŞERİDİ (KALEM AÇIKKEN DE TIKLANABİLİR) */}
            <div className="px-5 sm:px-7 py-3.5 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="px-3.5 py-1.5 rounded-xl bg-indigo-600 text-white text-sm font-black">
                  Soru {currentQ.question_number}
                </span>

                {stat.total > 0 && (
                  <span
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border ${
                      stat.missRate >= 50
                        ? 'bg-rose-50 text-rose-800 border-rose-200'
                        : stat.missRate >= 25
                          ? 'bg-amber-50 text-amber-900 border-amber-200'
                          : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    }`}
                  >
                    %{stat.missRate} Hata/Boş • {stat.wrong} Yanlış,{' '}
                    {stat.blank} Boş, {stat.correct} Doğru
                  </span>
                )}

                {currentQ.outcome_code && (
                  <span className="font-mono px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-bold">
                    {currentQ.outcome_code}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setRevealAnswer((v) => !v)}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-extrabold cursor-pointer transition-all shadow-xs ${
                  revealAnswer
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-slate-900 hover:bg-slate-800 text-amber-300'
                }`}
              >
                {revealAnswer
                  ? `✓ Doğru Cevap: ${currentQ.correct_option} (Gizle)`
                  : '👁 Cevabı ve Dağılımı Göster'}
              </button>
            </div>

            {/* TAM PANEL YAZIM ALANI: KAZANIM + SVG + SORU KÖKÜ + ŞIKLAR + ÇÖZÜM + BOŞ İŞLEM ALANI */}
            <div className="flex-1 p-5 sm:p-7">
              <QuestionDrawingArea
                key={currentQ.id}
                strokes={drawingsByQuestion[currentQ.id] ?? []}
                onStrokesChange={(nextStrokes) =>
                  setDrawingsByQuestion((prev) => ({
                    ...prev,
                    [currentQ.id]: nextStrokes,
                  }))
                }
              >
                <div className="min-h-[62vh] w-full flex flex-col gap-5 pb-12">
                  {currentQ.outcome_title && (
                    <p className="text-xs font-bold text-indigo-700 bg-indigo-50/70 px-3.5 py-2 rounded-xl border border-indigo-100">
                      Kazanım: {currentQ.outcome_title}
                    </p>
                  )}

                  {/* SORU SVG GÖRSELİ */}
                  {currentQ.svg_code && (
                    <div className="w-full min-w-0">
                      <SvgPreview
                        key={currentQ.id}
                        svgCode={currentQ.svg_code}
                      />
                    </div>
                  )}

                  {/* SORU KÖKÜ */}
                  <div className="text-lg sm:text-xl font-semibold text-slate-900 leading-relaxed whitespace-pre-line">
                    {currentQ.question_text}
                  </div>

                  {/* ŞIKLAR VE CEVAP DAĞILIMI (ÜZERİNE ÇİZİLEBİLİR / ELENEBİLİR) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    {availableOptions.map((opt) => {
                      const isCorrect = opt === currentQ.correct_option;
                      const isTopDistractor =
                        revealAnswer &&
                        topDistractor.opt === opt &&
                        topDistractor.count > 0;
                      const count = stat.optionCounts[opt] ?? 0;
                      const pct =
                        stat.total > 0
                          ? Math.round((count / stat.total) * 100)
                          : 0;

                      return (
                        <div
                          key={opt}
                          className={`p-4 rounded-2xl border-2 transition-all space-y-2 ${
                            revealAnswer && isCorrect
                              ? 'border-emerald-500 bg-emerald-50/80 shadow-sm'
                              : isTopDistractor
                                ? 'border-rose-300 bg-rose-50/60'
                                : 'border-slate-200 bg-slate-50/40'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <span
                                className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${
                                  revealAnswer && isCorrect
                                    ? 'bg-emerald-600 text-white'
                                    : isTopDistractor
                                      ? 'bg-rose-600 text-white'
                                      : 'bg-slate-200 text-slate-800'
                                }`}
                              >
                                {opt}
                              </span>
                              <span className="text-base font-semibold text-slate-900 pt-1">
                                {currentQ.options?.[opt] ?? `${opt} Seçeneği`}
                              </span>
                            </div>

                            {revealAnswer && stat.total > 0 && (
                              <span
                                className={`px-2 py-0.5 rounded-lg text-xs font-black shrink-0 ${
                                  isCorrect
                                    ? 'bg-emerald-200 text-emerald-950'
                                    : isTopDistractor
                                      ? 'bg-rose-200 text-rose-950'
                                      : 'bg-slate-200 text-slate-700'
                                }`}
                              >
                                %{pct} ({count})
                              </span>
                            )}
                          </div>

                          {revealAnswer && stat.total > 0 && (
                            <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                              <div
                                className={`h-full transition-all duration-300 ${
                                  isCorrect
                                    ? 'bg-emerald-500'
                                    : isTopDistractor
                                      ? 'bg-rose-500'
                                      : 'bg-slate-400'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* ÇÖZÜM AÇIKLAMASI */}
                  {revealAnswer && currentQ.solution_text && (
                    <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-950 space-y-1">
                      <strong className="text-xs uppercase tracking-wider text-emerald-800 block">
                        Çözüm Notu
                      </strong>
                      <p className="leading-relaxed whitespace-pre-line">
                        {currentQ.solution_text}
                      </p>
                    </div>
                  )}

                  {/* ALT SERBEST İŞLEM BOŞLUĞU */}
                  <div className="flex-1 min-h-[140px]" />
                </div>
              </QuestionDrawingArea>
            </div>

            {/* ALT İLERİ / GERİ DOKUNMATİK ÇUBUĞU (KALEM AÇIKKEN DE TIKLANABİLİR) */}
            <div className="px-5 sm:px-7 py-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={safeIndex === 0}
                onClick={() => handleSelectQuestion(Math.max(0, safeIndex - 1))}
                className="px-6 py-2.5 rounded-2xl border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-35 text-sm font-extrabold text-slate-800 cursor-pointer"
              >
                ← Önceki Soru
              </button>

              <span className="text-xs font-bold text-slate-500">
                {safeIndex + 1} / {orderedQuestions.length}
              </span>

              <button
                type="button"
                disabled={safeIndex >= orderedQuestions.length - 1}
                onClick={() =>
                  handleSelectQuestion(
                    Math.min(orderedQuestions.length - 1, safeIndex + 1)
                  )
                }
                className="px-6 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-35 text-sm font-extrabold text-white cursor-pointer"
              >
                Sonraki Soru →
              </button>
            </div>
          </div>
        </section>

        {/* SAĞ PANEL: HATA ORANINA GÖRE SORU LİSTESİ */}
        <aside className="lg:col-span-3">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 space-y-3 lg:sticky lg:top-20 max-h-[82vh] flex flex-col">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                {sortMode === 'MOST_MISSED'
                  ? 'En Çok Takılınan Sorular'
                  : 'Soru Sırası'}
              </h2>
              <span className="text-[11px] font-bold text-indigo-700">
                {selectedClass === 'ALL' ? 'Tüm Şubeler' : selectedClass}
              </span>
            </div>

            <div className="overflow-y-auto space-y-1.5 pr-1 flex-1">
              {orderedQuestions.map((q, idx) => {
                const qStat = q.statsByClass[selectedClass];
                const miss = qStat?.missRate ?? 0;
                const isActive = idx === safeIndex;
                const hasDrawing = (drawingsByQuestion[q.id]?.length ?? 0) > 0;

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => handleSelectQuestion(idx)}
                    className={`w-full px-3.5 py-2.5 rounded-xl border text-left flex items-center justify-between gap-2 transition-all cursor-pointer ${
                      isActive
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                        : 'bg-slate-50/70 border-slate-200 hover:border-indigo-300 text-slate-800'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-black block">
                        Soru {q.question_number}
                        {hasDrawing ? ' ✎' : ''}
                      </span>
                      <span
                        className={`text-[10px] truncate block ${
                          isActive ? 'text-indigo-100' : 'text-slate-500'
                        }`}
                      >
                        {q.outcome_code || q.outcome_title}
                      </span>
                    </div>

                    {qStat && qStat.total > 0 && (
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[11px] font-black shrink-0 ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : miss >= 50
                              ? 'bg-rose-100 text-rose-800'
                              : miss >= 25
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        %{miss}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
};