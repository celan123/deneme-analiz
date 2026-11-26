import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PoolQuestion } from '../types/exam';

export type PoolQuestionWithWeek = PoolQuestion & {
  curriculum_week?: number | null;
};

export interface SubjectCurriculumSelection {
  subject: string;
  questionCount: number;
  allTopics: boolean;
  excludedOutcomeCodes: string[];
}

interface CurriculumTimelineSelectorProps {
  pool: PoolQuestionWithWeek[];
  startWeek: number;
  endWeek: number;
  onRangeChange: (startWeek: number, endWeek: number) => void;
  subjectSelections: Record<string, SubjectCurriculumSelection>;
  onSubjectSelectionChange: (
    subject: string,
    next: SubjectCurriculumSelection
  ) => void;
  isQuestionCountLocked: boolean;
  visibleSubjects?: string[];
}

interface MonthSegment {
  label: string;
  shortLabel: string;
  startWeek: number;
  endWeek: number;
  weight: number; // Eylül ve Haziran: 0.5 (2 hafta), diğerleri: 1 (4 hafta)
}

const ACADEMIC_MONTHS: MonthSegment[] = [
  { label: 'Eylül', shortLabel: 'Eyl', startWeek: 1, endWeek: 2, weight: 0.5 },
  { label: 'Ekim', shortLabel: 'Eki', startWeek: 3, endWeek: 6, weight: 1 },
  { label: 'Kasım', shortLabel: 'Kas', startWeek: 7, endWeek: 10, weight: 1 },
  { label: 'Aralık', shortLabel: 'Ara', startWeek: 11, endWeek: 14, weight: 1 },
  { label: 'Ocak', shortLabel: 'Oca', startWeek: 15, endWeek: 18, weight: 1 },
  { label: 'Şubat', shortLabel: 'Şub', startWeek: 19, endWeek: 22, weight: 1 },
  { label: 'Mart', shortLabel: 'Mar', startWeek: 23, endWeek: 26, weight: 1 },
  { label: 'Nisan', shortLabel: 'Nis', startWeek: 27, endWeek: 30, weight: 1 },
  { label: 'Mayıs', shortLabel: 'May', startWeek: 31, endWeek: 34, weight: 1 },
  {
    label: 'Haziran',
    shortLabel: 'Haz',
    startWeek: 35,
    endWeek: 36,
    weight: 0.5,
  },
];

const TOTAL_WEEKS = 36;

interface OutcomeSummary {
  outcome_code: string;
  outcome_title: string;
  subject: string;
  minWeek: number;
  questionCount: number;
}

function getMonthForWeek(week: number): MonthSegment {
  return (
    ACADEMIC_MONTHS.find((m) => week >= m.startWeek && week <= m.endWeek) ??
    ACADEMIC_MONTHS[0]
  );
}

export const CurriculumTimelineSelector: React.FC<
  CurriculumTimelineSelectorProps
> = ({
  pool,
  startWeek,
  endWeek,
  onRangeChange,
  subjectSelections,
  onSubjectSelectionChange,
  isQuestionCountLocked,
  visibleSubjects,
}) => {
  const [hoveredOutcome, setHoveredOutcome] = useState<OutcomeSummary | null>(
    null
  );
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | null>(
    null
  );
  const barRef = useRef<HTMLDivElement | null>(null);

  // Sürükleme sırasında en güncel start/end değerlerine erişmek için ref
  const rangeRef = useRef({ startWeek, endWeek, onRangeChange });
  rangeRef.current = { startWeek, endWeek, onRangeChange };

  useEffect(() => {
    if (!draggingHandle) return;

    const handlePointerMove = (e: PointerEvent) => {
      const bar = barRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      if (rect.width <= 0) return;

      const ratio = Math.min(
        1,
        Math.max(0, (e.clientX - rect.left) / rect.width)
      );
      const week = Math.min(
        TOTAL_WEEKS,
        Math.max(1, Math.round(ratio * (TOTAL_WEEKS - 1)) + 1)
      );

      const {
        startWeek: curStart,
        endWeek: curEnd,
        onRangeChange: notify,
      } = rangeRef.current;

      if (draggingHandle === 'start') {
        const clampedStart = Math.min(week, curEnd);
        if (clampedStart !== curStart) {
          notify(clampedStart, curEnd);
        }
      } else {
        const clampedEnd = Math.max(week, curStart);
        if (clampedEnd !== curEnd) {
          notify(curStart, clampedEnd);
        }
      }
    };

    const handlePointerUp = () => {
      setDraggingHandle(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [draggingHandle]);

  // Havuzu ders -> kazanım bazında grupla
  const outcomesBySubject = useMemo(() => {
    const subjectMap = new Map<string, Map<string, OutcomeSummary>>();

    for (const q of pool) {
      const subject = q.subject || 'Genel';
      if (visibleSubjects && !visibleSubjects.includes(subject)) continue;

      let outcomeMap = subjectMap.get(subject);
      if (!outcomeMap) {
        outcomeMap = new Map<string, OutcomeSummary>();
        subjectMap.set(subject, outcomeMap);
      }

      const week =
        typeof q.curriculum_week === 'number' && q.curriculum_week >= 1
          ? q.curriculum_week
          : 1;

      const existing = outcomeMap.get(q.outcome_code);
      if (!existing) {
        outcomeMap.set(q.outcome_code, {
          outcome_code: q.outcome_code,
          outcome_title: q.outcome_title,
          subject,
          minWeek: week,
          questionCount: 1,
        });
      } else {
        existing.questionCount += 1;
        if (week < existing.minWeek) {
          existing.minWeek = week;
        }
      }
    }

    const result = new Map<string, OutcomeSummary[]>();
    for (const [subject, outcomeMap] of subjectMap.entries()) {
      result.set(
        subject,
        Array.from(outcomeMap.values()).sort((a, b) =>
          a.outcome_code.localeCompare(b.outcome_code, 'tr')
        )
      );
    }
    return result;
  }, [pool, visibleSubjects]);

  const subjects = useMemo(() => {
    if (visibleSubjects && visibleSubjects.length > 0) {
      return visibleSubjects;
    }
    return Array.from(outcomesBySubject.keys()).sort((a, b) =>
      a.localeCompare(b, 'tr')
    );
  }, [outcomesBySubject, visibleSubjects]);

  const leftPercent = ((startWeek - 1) / TOTAL_WEEKS) * 100;
  const widthPercent = ((endWeek - startWeek + 1) / TOTAL_WEEKS) * 100;

  const startMonth = getMonthForWeek(startWeek);
  const endMonth = getMonthForWeek(endWeek);

  const handleWeekClick = (week: number) => {
    if (draggingHandle) return;
    if (week < startWeek) {
      onRangeChange(week, endWeek);
    } else if (week > endWeek) {
      onRangeChange(startWeek, week);
    } else {
      const distToStart = Math.abs(week - startWeek);
      const distToEnd = Math.abs(endWeek - week);
      if (distToStart <= distToEnd) {
        onRangeChange(week, endWeek);
      } else {
        onRangeChange(startWeek, week);
      }
    }
  };

  const handleMonthClick = (m: MonthSegment) => {
    if (startWeek === m.startWeek && endWeek === m.endWeek) {
      onRangeChange(1, m.endWeek);
      return;
    }
    onRangeChange(m.startWeek, m.endWeek);
  };

  const getSelection = (subject: string): SubjectCurriculumSelection =>
    subjectSelections[subject] ?? {
      subject,
      questionCount: 0,
      allTopics: false,
      excludedOutcomeCodes: [],
    };

  const handleToggleOutcome = (subject: string, code: string) => {
    const current = getSelection(subject);
    const isExcluded = current.excludedOutcomeCodes.includes(code);
    onSubjectSelectionChange(subject, {
      ...current,
      excludedOutcomeCodes: isExcluded
        ? current.excludedOutcomeCodes.filter((c) => c !== code)
        : [...current.excludedOutcomeCodes, code],
    });
  };

  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
      {/* 1. MÜFREDAT ZAMAN ÇİZELGESİ BARI */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
              Müfredat Sınırı Zaman Çizelgesi
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Seçili aralık:{' '}
              <strong className="text-indigo-700">
                {startMonth.label} ({startWeek}. Hafta) – {endMonth.label} (
                {endWeek}. Hafta)
              </strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={startWeek}
              onChange={(e) => {
                const nextStart = Number(e.target.value);
                onRangeChange(nextStart, Math.max(nextStart, endWeek));
              }}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-800"
              title="Başlangıç haftası"
            >
              {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  Başlangıç: {w}. Hafta
                </option>
              ))}
            </select>

            <span className="text-xs font-bold text-slate-400">–</span>

            <select
              value={endWeek}
              onChange={(e) => {
                const nextEnd = Number(e.target.value);
                onRangeChange(Math.min(startWeek, nextEnd), nextEnd);
              }}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-800"
              title="Bitiş haftası"
            >
              {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  Bitiş: {w}. Hafta
                </option>
              ))}
            </select>

            {startWeek > 1 && (
              <button
                type="button"
                onClick={() => onRangeChange(1, endWeek)}
                className="px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-bold cursor-pointer"
              >
                1. Haftadan Başla
              </button>
            )}
          </div>
        </div>

        {/* ÜSTTE AY ADLARI + ORTADA SÜRÜKLENEBİLİR BAR + ALTTA HAFTA NUMARALARI */}
        <div className="space-y-1.5 select-none">
          <div className="flex w-full text-[10px] sm:text-[11px] font-bold text-slate-600">
            {ACADEMIC_MONTHS.map((m) => {
              const isInRange =
                m.endWeek >= startWeek && m.startWeek <= endWeek;
              return (
                <button
                  key={m.label}
                  type="button"
                  style={{ flexGrow: m.weight, flexBasis: 0 }}
                  onClick={() => handleMonthClick(m)}
                  className={`text-center py-0.5 truncate cursor-pointer transition-colors ${
                    isInRange
                      ? 'text-indigo-700 font-extrabold'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                  title={`Sadece ${m.label} (${m.startWeek}-${m.endWeek}. hafta) seçmek için tıkla`}
                >
                  <span className="hidden sm:inline">{m.label}</span>
                  <span className="sm:hidden">{m.shortLabel}</span>
                </button>
              );
            })}
          </div>

          {/* İnteraktif Sürüklenebilir Aralık Barı */}
          <div
            ref={barRef}
            className="relative h-9 rounded-xl bg-slate-200/90 border border-slate-300 touch-none"
          >
            {/* Animasyonlu Dolum (Başlangıç -> Bitiş) */}
            <div
              className={`absolute inset-y-0 rounded-lg bg-gradient-to-r from-indigo-500 via-indigo-600 to-emerald-500 ${
                draggingHandle ? '' : 'transition-all duration-200 ease-out'
              }`}
              style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
            />

            {/* Ay ayırıcı çizgiler */}
            <div className="absolute inset-0 flex pointer-events-none">
              {ACADEMIC_MONTHS.map((m, idx) => (
                <div
                  key={m.label}
                  style={{ flexGrow: m.weight, flexBasis: 0 }}
                  className={
                    idx < ACADEMIC_MONTHS.length - 1
                      ? 'border-r border-white/70'
                      : ''
                  }
                />
              ))}
            </div>

            {/* 36 Hafta tıklanabilir dilimleri */}
            <div
              className="relative z-10 grid h-full"
              style={{ gridTemplateColumns: 'repeat(36, minmax(0, 1fr))' }}
            >
              {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map(
                (week) => (
                  <button
                    key={week}
                    type="button"
                    onClick={() => handleWeekClick(week)}
                    title={`${week}. Eğitim Haftası`}
                    className="h-full cursor-pointer hover:bg-white/25 focus:outline-none"
                  />
                )
              )}
            </div>

            {/* SOL SÜRÜKLEME TUTAMACI (BAŞLANGIÇ) */}
            <button
              type="button"
              aria-label="Başlangıç haftasını sürükle"
              title="Başlangıç haftasını sürükleyerek ayarla"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDraggingHandle('start');
              }}
              style={{ left: `${leftPercent}%` }}
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 w-5 h-7 rounded-md bg-white border-2 border-indigo-600 shadow-md flex items-center justify-center cursor-ew-resize touch-none transition-transform ${
                draggingHandle === 'start'
                  ? 'scale-110 ring-2 ring-indigo-300'
                  : 'hover:scale-105'
              }`}
            >
              <span className="flex gap-0.5 pointer-events-none">
                <span className="w-0.5 h-3 bg-indigo-600 rounded-full" />
                <span className="w-0.5 h-3 bg-indigo-600 rounded-full" />
              </span>
            </button>

            {/* SAĞ SÜRÜKLEME TUTAMACI (BİTİŞ) */}
            <button
              type="button"
              aria-label="Bitiş haftasını sürükle"
              title="Bitiş haftasını sürükleyerek ayarla"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDraggingHandle('end');
              }}
              style={{ left: `${leftPercent + widthPercent}%` }}
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 w-5 h-7 rounded-md bg-white border-2 border-emerald-600 shadow-md flex items-center justify-center cursor-ew-resize touch-none transition-transform ${
                draggingHandle === 'end'
                  ? 'scale-110 ring-2 ring-emerald-300'
                  : 'hover:scale-105'
              }`}
            >
              <span className="flex gap-0.5 pointer-events-none">
                <span className="w-0.5 h-3 bg-emerald-600 rounded-full" />
                <span className="w-0.5 h-3 bg-emerald-600 rounded-full" />
              </span>
            </button>
          </div>

          {/* Altta hafta sayıları */}
          <div className="flex w-full text-[9px] sm:text-[10px] font-mono font-bold text-slate-400">
            {ACADEMIC_MONTHS.map((m) => (
              <div
                key={m.label}
                style={{ flexGrow: m.weight, flexBasis: 0 }}
                className="text-center"
              >
                {m.startWeek === m.endWeek
                  ? `${m.endWeek}`
                  : `${m.startWeek}-${m.endWeek}`}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* HOVER KAZANIM METNİ BİLGİ ŞERİDİ */}
      <div className="min-h-[2.25rem] px-3.5 py-2 rounded-xl bg-white border border-indigo-100 flex items-center justify-between gap-2 text-xs">
        {hoveredOutcome ? (
          <>
            <div className="min-w-0">
              <span className="font-mono font-black text-indigo-800 mr-2">
                {hoveredOutcome.outcome_code}
              </span>
              <span className="font-semibold text-slate-800">
                {hoveredOutcome.outcome_title}
              </span>
            </div>
            <span className="shrink-0 text-[11px] font-bold text-indigo-700">
              {hoveredOutcome.questionCount} soru • {hoveredOutcome.minWeek}.
              hafta
            </span>
          </>
        ) : (
          <span className="text-[11px] text-slate-500 font-medium">
            Uçlardaki tutamaçları sürükleyerek tarih aralığını daraltıp
            genişletebilir, kazanım koduna tıklayarak kapsamdan çıkarabilirsin.
          </span>
        )}
      </div>

      {/* 2. DİKEY DERS KARTLARI */}
      {subjects.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-slate-300 bg-white text-center text-xs text-slate-500">
          Seçili seviye/kapsam için havuzda henüz ders bulunmuyor.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {subjects.map((subject) => {
            const sel = getSelection(subject);
            const allOutcomes = outcomesBySubject.get(subject) ?? [];
            const visibleOutcomes = sel.allTopics
              ? allOutcomes
              : allOutcomes.filter(
                  (o) => o.minWeek >= startWeek && o.minWeek <= endWeek
                );

            const activeOutcomes = visibleOutcomes.filter(
              (o) => !sel.excludedOutcomeCodes.includes(o.outcome_code)
            );
            const maxAvailableQuestions = activeOutcomes.reduce(
              (sum, o) => sum + o.questionCount,
              0
            );

            return (
              <div
                key={subject}
                className="bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col overflow-hidden"
              >
                {/* KART ÜSTÜ: DERS ADI + SORU SAYISI + TÜM KONULAR */}
                <div className="p-3.5 bg-slate-900 text-white space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-extrabold truncate">
                      {subject}
                    </h4>
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        type="number"
                        min={0}
                        max={Math.max(maxAvailableQuestions, sel.questionCount)}
                        readOnly={isQuestionCountLocked}
                        value={sel.questionCount}
                        onChange={(e) =>
                          onSubjectSelectionChange(subject, {
                            ...sel,
                            questionCount: Math.max(
                              0,
                              Number(e.target.value) || 0
                            ),
                          })
                        }
                        className={`w-14 rounded-lg px-2 py-1 text-xs font-black text-center ${
                          isQuestionCountLocked
                            ? 'bg-slate-800 text-indigo-200 border border-slate-700 cursor-not-allowed'
                            : 'bg-white text-slate-900 border border-indigo-400 focus:outline-none'
                        }`}
                        title={
                          isQuestionCountLocked
                            ? 'Resmî sınav modunda soru sayısı kilitlidir'
                            : 'Bu dersten sorulacak soru sayısı'
                        }
                      />
                      <span className="text-[10px] text-slate-300 font-bold">
                        soru
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-slate-200 font-semibold">
                      <input
                        type="checkbox"
                        checked={sel.allTopics}
                        onChange={(e) =>
                          onSubjectSelectionChange(subject, {
                            ...sel,
                            allTopics: e.target.checked,
                          })
                        }
                        className="accent-emerald-400"
                      />
                      Tüm Konular
                    </label>
                    <span className="text-[10px] text-slate-400 font-bold">
                      Havuz: {maxAvailableQuestions}
                    </span>
                  </div>
                </div>

                {/* KART GÖVDESİ: SADECE KAZANIM KODLARI */}
                <div className="p-3 flex-1 max-h-52 overflow-y-auto">
                  {visibleOutcomes.length === 0 ? (
                    <p className="text-[11px] text-slate-400 text-center py-4">
                      {startWeek}–{endWeek}. haftalar arasında kazanım yok.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {visibleOutcomes.map((o) => {
                        const isExcluded = sel.excludedOutcomeCodes.includes(
                          o.outcome_code
                        );
                        return (
                          <button
                            key={o.outcome_code}
                            type="button"
                            onMouseEnter={() => setHoveredOutcome(o)}
                            onMouseLeave={() => setHoveredOutcome(null)}
                            onFocus={() => setHoveredOutcome(o)}
                            onClick={() =>
                              handleToggleOutcome(subject, o.outcome_code)
                            }
                            title={`${o.outcome_title} (${o.questionCount} soru)`}
                            className={`font-mono text-[11px] font-bold px-2 py-1 rounded-lg border cursor-pointer transition-all ${
                              isExcluded
                                ? 'bg-slate-100 border-slate-200 text-slate-400 line-through'
                                : 'bg-indigo-50 border-indigo-200 text-indigo-800 hover:bg-indigo-100'
                            }`}
                          >
                            {o.outcome_code}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};