import React from 'react';
import type { BehaviorFlag, TelemetryReport } from '../types/exam';

interface TelemetryPanelProps {
  report: TelemetryReport;
}

function getBehaviorBadge(flag: BehaviorFlag) {
  switch (flag) {
    case 'TIME_TRAP':
      return {
        label: 'Zaman Tuzağı',
        style: 'bg-rose-50 text-rose-700 border-rose-200 font-bold',
      };
    case 'RAPID_GUESSING':
      return {
        label: 'Hızlı İşaretleme / Sallama',
        style: 'bg-amber-50 text-amber-800 border-amber-200 font-bold',
      };
    case 'HIGH_HESITATION':
      return {
        label: 'Yüksek Kararsızlık (Şık Değişimi)',
        style: 'bg-indigo-50 text-indigo-700 border-indigo-200 font-bold',
      };
    case 'NORMAL':
      return {
        label: 'Dengeli Çözüm',
        style: 'bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold',
      };
  }
}

export const TelemetryPanel: React.FC<TelemetryPanelProps> = ({ report }) => {
  if (report.tracked_student_count === 0) {
    return (
      <section className="bg-white p-8 rounded-2xl shadow-xs border border-slate-200 text-center space-y-3">
        <div className="w-12 h-12 mx-auto rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl font-bold">
          ⏱
        </div>
        <h2 className="text-lg font-extrabold text-slate-900">
          Henüz Telemetri Verisi Bulunmuyor
        </h2>
        <p className="text-sm text-slate-500 max-w-lg mx-auto leading-relaxed">
          Mevcut örnek öğrencilerde süre ve şık değiştirme kaydı yoktur. Üst
          menüden <strong>Öğrenci Sınav Ekranı</strong>'na geçip bir deneme
          çözdüğünde, soru başı süre ve kararsızlık verileri burada otomatik
          olarak analiz edilecektir.
        </p>
      </section>
    );
  }

  const maxQuestionTime = Math.max(
    ...report.questions.map((q) => q.avg_time_seconds),
    1
  );

  return (
    <section className="space-y-6">
      {/* ÜST TELEMETRİ ÖZET KARTLARI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
            Telemetrili Öğrenci
          </p>
          <p className="text-3xl font-black text-slate-900 mt-2">
            {report.tracked_student_count}
          </p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
            Soru Başı Ort. Süre
          </p>
          <p className="text-3xl font-black text-indigo-700 mt-2">
            {report.overall_avg_question_time}{' '}
            <span className="text-base font-semibold text-slate-400">sn</span>
          </p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
            Hızlı İşaretleme (&lt;6 sn)
          </p>
          <p className="text-3xl font-black text-amber-600 mt-2">
            {report.total_rapid_guesses}
          </p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
            Toplam Şık Değişimi
          </p>
          <p className="text-3xl font-black text-rose-600 mt-2">
            {report.total_option_changes}
          </p>
        </div>
      </div>

      {/* SORU BAZLI SÜRE VE DAVRANIŞ LİSTESİ */}
      <div className="bg-white p-6 md:p-8 rounded-2xl shadow-xs border border-slate-200 space-y-5">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-xl font-extrabold text-slate-900">
            Soru Bazlı Süre, Kararsızlık ve Sallama Analizi
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Doğru ve yanlış yapan öğrencilerin harcadığı süre farkı ile şık
            değiştirme oranlarını karşılaştırın.
          </p>
        </div>

        <div className="space-y-4">
          {report.questions.map((q) => {
            const badge = getBehaviorBadge(q.behavior_flag);
            const barWidth = Math.min(
              100,
              Math.round((q.avg_time_seconds / maxQuestionTime) * 100)
            );

            return (
              <div
                key={q.question_id}
                className="p-5 rounded-xl border border-slate-200/80 bg-slate-50/50 space-y-4"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-black">
                        Soru {q.question_number}
                      </span>
                      <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {q.outcome_code}
                      </span>
                      <span
                        className={`text-xs px-2.5 py-1 rounded-full border ${badge.style}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-slate-800 mt-2">
                      {q.outcome_title}
                    </p>
                  </div>

                  {/* METRİK KUTULARI */}
                  <div className="flex flex-wrap items-center gap-2.5 text-xs shrink-0">
                    <div className="px-3 py-2 rounded-lg bg-white border border-slate-200">
                      <span className="text-slate-400 block">Ort. Süre</span>
                      <strong className="text-slate-900 text-sm">
                        {q.avg_time_seconds} sn
                      </strong>
                    </div>
                    <div className="px-3 py-2 rounded-lg bg-white border border-slate-200">
                      <span className="text-emerald-600 block">Doğru / Yanlış</span>
                      <strong className="text-slate-900 text-sm">
                        {q.avg_time_correct !== null
                          ? `${q.avg_time_correct}s`
                          : '—'}{' '}
                        /{' '}
                        {q.avg_time_wrong !== null ? `${q.avg_time_wrong}s` : '—'}
                      </strong>
                    </div>
                    <div className="px-3 py-2 rounded-lg bg-white border border-slate-200">
                      <span className="text-indigo-600 block">Şık Değişimi</span>
                      <strong className="text-slate-900 text-sm">
                        %{q.hesitation_rate}{' '}
                        <span className="text-slate-400 font-normal">
                          ({q.total_changes})
                        </span>
                      </strong>
                    </div>
                    <div className="px-3 py-2 rounded-lg bg-white border border-slate-200">
                      <span className="text-amber-600 block">Hızlı Tahmin</span>
                      <strong className="text-slate-900 text-sm">
                        %{q.rapid_guess_rate}{' '}
                        <span className="text-slate-400 font-normal">
                          ({q.rapid_guess_count})
                        </span>
                      </strong>
                    </div>
                  </div>
                </div>

                {/* GÖRELİ SÜRE ÇUBUĞU */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-semibold text-slate-500">
                    <span>Soru Süresi Yoğunluğu (Sınav Ort: {report.overall_avg_question_time} sn)</span>
                    <span>Telemetrili Grup Başarısı: %{q.tracked_success_rate}</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-2.5 rounded-full transition-all duration-300 ${
                        q.behavior_flag === 'TIME_TRAP'
                          ? 'bg-rose-500'
                          : q.behavior_flag === 'RAPID_GUESSING'
                            ? 'bg-amber-500'
                            : q.behavior_flag === 'HIGH_HESITATION'
                              ? 'bg-indigo-500'
                              : 'bg-emerald-500'
                      }`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};