import React, { useMemo } from 'react';
import type { PoolQuestion, ValidOption } from '../types/exam';
import { SvgPreview } from './SvgPreview';

interface QuestionHoverPreviewProps {
  question: PoolQuestion;
}

export const QuestionHoverPreview: React.FC<QuestionHoverPreviewProps> = ({
  question,
}) => {
  const availableOptions: ValidOption[] = useMemo(() => {
    const hasE =
      question.correct_option === 'E' || Boolean(question.options?.E);
    return hasE ? ['A', 'B', 'C', 'D', 'E'] : ['A', 'B', 'C', 'D'];
  }, [question]);

  return (
    <div
      aria-hidden="true"
      className="fixed top-1/2 -translate-y-1/2 right-6 z-50 pointer-events-none w-[540px] max-w-[92vw] max-h-[88vh] overflow-hidden rounded-2xl bg-white/98 backdrop-blur-md border border-slate-200 shadow-2xl ring-1 ring-slate-900/10"
    >
      {/* ÜST ÖĞRENCİ EKRANI ŞERİDİ */}
      <div className="px-5 py-3 bg-slate-900 text-white flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-200">
            Öğrenci Sınav Görünümü
          </span>
        </div>
        <span className="text-[11px] font-semibold text-slate-300 truncate">
          {question.grade ? `${question.grade}. Sınıf • ` : ''}
          {question.subject}
        </span>
      </div>

      {/* ÖĞRENCİ SORU KARTI (StudentExamView İLE BİREBİR GÖRÜNÜM) */}
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
          <div className="flex items-center gap-2.5">
            <span className="px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs font-black">
              Soru 1
            </span>
            <span className="text-xs text-slate-400 font-medium">
              Bu soruda geçen süre: 0 sn
            </span>
          </div>

          <span className="px-3 py-1 rounded-lg text-xs font-bold border bg-white border-slate-200 text-slate-500">
            ⚐ Sonra Bak
          </span>
        </div>

        {/* SVG GÖRSEL (YÜKSEK GÖRSELLERİN ŞIKLARI TAŞIRMAMASI İÇİN SINIRLI) */}
        {question.svg_code && (
          <div className="[&_svg]:max-h-[210px] [&_svg]:w-auto [&_svg]:mx-auto">
            <SvgPreview svgCode={question.svg_code} />
          </div>
        )}

        {/* SORU KÖKÜ */}
        <div className="text-base font-semibold text-slate-900 leading-relaxed whitespace-pre-line">
          {question.question_text ?? question.outcome_title}
        </div>

        {/* ŞIKLAR */}
        <div className="space-y-2.5">
          {availableOptions.map((opt) => {
            const optionLabel = question.options?.[opt] ?? `${opt} Seçeneği`;

            return (
              <div
                key={opt}
                className="w-full text-left p-3.5 rounded-xl border-2 border-slate-200 bg-white flex items-center gap-3.5"
              >
                <span className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs shrink-0 bg-slate-100 text-slate-700">
                  {opt}
                </span>
                <span className="text-sm font-semibold text-slate-800">
                  {optionLabel}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};