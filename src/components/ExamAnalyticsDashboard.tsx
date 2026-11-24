import React, { useMemo, useState } from 'react';
import type {
  ExamDataset,
  ItemQualityStatus,
  Question,
  QuestionCorrelation,
} from '../types/exam';
import {
  analyzeBehaviorTelemetry,
  analyzeItemQuality,
  analyzeOutcomes,
  calculateQuestionCorrelations,
} from '../utils/examAnalyzer';
import { StudentReportCard } from './StudentReportCard';
import { SvgPreview } from './SvgPreview';
import { TelemetryPanel } from './TelemetryPanel';

interface ExamAnalyticsDashboardProps {
  dataset: ExamDataset;
}

type ActiveTab =
  | 'OUTCOMES'
  | 'CORRELATIONS'
  | 'ITEM_QUALITY'
  | 'STUDENT_REPORT'
  | 'TELEMETRY';

export const ExamAnalyticsDashboard: React.FC<ExamAnalyticsDashboardProps> = ({
  dataset,
}) => {
  const [selectedClassroom, setSelectedClassroom] = useState<string>('ALL');
  const [includeGuests, setIncludeGuests] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('OUTCOMES');
  const [activeCorrelation, setActiveCorrelation] =
    useState<QuestionCorrelation | null>(null);

  // Resmi / Misafir (Gölge) katılımcı izolasyonu
  const guestCount = useMemo(
    () =>
      dataset.students.filter((s) => s.participation_type === 'GUEST').length,
    [dataset.students]
  );

  const officialCount = dataset.students.length - guestCount;

  const scopedDataset = useMemo<ExamDataset>(() => {
    if (includeGuests) return dataset;
    const allowedStudents = dataset.students.filter(
      (s) => (s.participation_type ?? 'OFFICIAL') === 'OFFICIAL'
    );
    const allowedIds = new Set(allowedStudents.map((s) => s.id));
    return {
      ...dataset,
      students: allowedStudents,
      answers: dataset.answers.filter((a) => allowedIds.has(a.student_id)),
    };
  }, [dataset, includeGuests]);

  const classrooms = useMemo(() => {
    const unique = new Set(scopedDataset.students.map((s) => s.classroom));
    return Array.from(unique).sort();
  }, [scopedDataset.students]);

  const activeFilter =
    selectedClassroom === 'ALL' ? undefined : selectedClassroom;

  // 4 Analiz Motorunu Seçili Kapsam (Sadece Resmi veya Büyük Sıralama) Üzerinde Çalıştır
  const outcomeResults = useMemo(
    () => analyzeOutcomes(scopedDataset, activeFilter),
    [scopedDataset, activeFilter]
  );

  const correlationResults = useMemo(
    () => calculateQuestionCorrelations(scopedDataset, activeFilter),
    [scopedDataset, activeFilter]
  );

  const itemQualityResults = useMemo(
    () => analyzeItemQuality(scopedDataset, activeFilter),
    [scopedDataset, activeFilter]
  );

  const telemetryReport = useMemo(
    () => analyzeBehaviorTelemetry(scopedDataset, activeFilter),
    [scopedDataset, activeFilter]
  );

  const sortedQuestions = useMemo(
    () =>
      [...scopedDataset.questions].sort(
        (a, b) => a.question_number - b.question_number
      ),
    [scopedDataset.questions]
  );

  const correlationMap = useMemo(() => {
    const map = new Map<string, QuestionCorrelation>();
    for (const item of correlationResults) {
      map.set(`${item.source_question}-${item.target_question}`, item);
    }
    return map;
  }, [correlationResults]);

  const questionMap = useMemo(() => {
    const map = new Map<string, Question>();
    for (const q of scopedDataset.questions) {
      map.set(q.id, q);
    }
    return map;
  }, [scopedDataset.questions]);

  const filteredStudentCount = useMemo(() => {
    if (!activeFilter) return scopedDataset.students.length;
    return scopedDataset.students.filter((s) => s.classroom === activeFilter)
      .length;
  }, [scopedDataset.students, activeFilter]);

  const criticalOutcomeCount = useMemo(
    () => outcomeResults.filter((o) => o.success_rate < 50).length,
    [outcomeResults]
  );

  const problematicQuestionCount = useMemo(
    () =>
      itemQualityResults.filter(
        (q) =>
          q.quality_status === 'DEFECTIVE' ||
          q.quality_status === 'WEAK' ||
          q.quality_status === 'NEEDS_REVISION'
      ).length,
    [itemQualityResults]
  );

  const getHeatmapCellStyle = (phi: number): string => {
    if (phi >= 0.5) return 'bg-emerald-600 text-white font-semibold shadow-xs';
    if (phi >= 0.3) return 'bg-emerald-400 text-slate-900 font-medium';
    if (phi >= 0.15) return 'bg-emerald-100 text-emerald-900';
    if (phi <= -0.2) return 'bg-rose-500 text-white font-semibold shadow-xs';
    return 'bg-slate-100 text-slate-600';
  };

  const getPedagogicalInsight = (corr: QuestionCorrelation): string => {
    if (corr.phi_coefficient >= 0.4) {
      return `Güçlü Yapısal Bağ: ${corr.source_question}. soruyu doğru yapan öğrencilerin %${corr.conditional_probability}'i ${corr.target_question}. soruyu da yaptı. Bu iki soru ortak ön koşul beceriyi ölçüyor.`;
    }
    if (corr.phi_coefficient >= 0.2) {
      return `Orta Düzey İlişki: ${corr.source_question}. soruyu çözenlerin %${corr.conditional_probability}'i ${corr.target_question}. soruda başarılı oldu.`;
    }
    if (corr.phi_coefficient < 0) {
      return `Ters İlişki (Dikkat): ${corr.source_question}. soruyu çözenler ${corr.target_question}. soruda düşük performans gösterdi. Soru kökü incelenmeli.`;
    }
    return `Bağımsız Sorular: ${corr.source_question}. ve ${corr.target_question}. sorular arasında belirgin ön koşul bağı yok (Koşullu başarı: %${corr.conditional_probability}).`;
  };

  const getDifficultyLabel = (p: number): string => {
    if (p >= 0.8) return 'Çok Kolay';
    if (p >= 0.6) return 'Kolay';
    if (p >= 0.4) return 'İdeal Orta';
    if (p >= 0.2) return 'Zor';
    return 'Çok Zor';
  };

  const getQualityBadge = (status: ItemQualityStatus) => {
    switch (status) {
      case 'EXCELLENT':
        return {
          label: 'Çok İyi Ayırt Edici',
          style: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        };
      case 'GOOD':
        return {
          label: 'İyi Madde',
          style: 'bg-teal-50 text-teal-700 border-teal-200',
        };
      case 'NEEDS_REVISION':
        return {
          label: 'Gözden Geçirilmeli',
          style: 'bg-amber-50 text-amber-700 border-amber-200',
        };
      case 'WEAK':
        return {
          label: 'Zayıf Ayırt Edicilik',
          style: 'bg-orange-50 text-orange-700 border-orange-200',
        };
      case 'DEFECTIVE':
        return {
          label: 'Hatalı Soru Alarmı',
          style: 'bg-rose-50 text-rose-700 border-rose-300 font-bold',
        };
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 md:p-8 space-y-8 bg-slate-100/70 min-h-screen text-slate-800">
      {/* MODERN SAAS HEADER */}
      <header className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-8 rounded-2xl shadow-xl border border-slate-800">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/15 via-transparent to-transparent pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-semibold tracking-wide uppercase">
              Psikometrik Analiz Motoru v2.0
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
              {dataset.exam.title}
            </h1>
            <p className="text-sm text-slate-300">
              Sınav Tarihi:{' '}
              <span className="font-medium text-white">
                {dataset.exam.exam_date}
              </span>{' '}
              • Yanlış Götürme Katsayısı:{' '}
              <span className="font-medium text-white">
                {dataset.exam.wrong_penalty_ratio}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* RESMİ / BÜYÜK SIRALAMA GEÇİŞ DÜĞMESİ */}
            <button
              type="button"
              onClick={() => {
                setIncludeGuests((prev) => !prev);
                setSelectedClassroom('ALL');
                setActiveCorrelation(null);
              }}
              className={`px-3.5 py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                includeGuests
                  ? 'bg-fuchsia-600 border-fuchsia-400 text-white shadow-sm'
                  : 'bg-slate-800/80 border-slate-700 text-emerald-300 hover:bg-slate-800'
              }`}
            >
              {includeGuests
                ? `Büyük Sıralama (${officialCount} Resmi + ${guestCount} Misafir)`
                : `Sadece Resmi (${officialCount})${guestCount > 0 ? ` • +${guestCount} Misafir Hariç` : ''}`}
            </button>

            {/* ŞUBE KAPSAM SEÇİCİ */}
            <div className="flex items-center gap-3 bg-slate-800/80 backdrop-blur-md p-2 rounded-xl border border-slate-700 shadow-inner">
              <label
                htmlFor="classroom-select"
                className="text-xs font-semibold text-slate-300 uppercase tracking-wider pl-2"
              >
                Şube:
              </label>
              <select
                id="classroom-select"
                value={selectedClassroom}
                onChange={(e) => {
                  setSelectedClassroom(e.target.value);
                  setActiveCorrelation(null);
                }}
                className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm font-medium text-white shadow-sm focus:border-indigo-500 focus:outline-none cursor-pointer"
              >
                <option value="ALL">Tümü ({scopedDataset.students.length})</option>
                {classrooms.map((cls) => (
                  <option key={cls} value={cls}>
                    {cls} Şubesi
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* HIZLI ÖZET METRİK KARTLARI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
            İncelenen Öğrenci
          </p>
          <p className="text-3xl font-black text-slate-900 mt-2">
            {filteredStudentCount}
          </p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
            Soru / Kazanım
          </p>
          <p className="text-3xl font-black text-slate-900 mt-2">
            {scopedDataset.questions.length}{' '}
            <span className="text-lg text-slate-400 font-normal">
              / {outcomeResults.length}
            </span>
          </p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
            Telafi Gerektiren Kazanım
          </p>
          <p className="text-3xl font-black text-rose-600 mt-2">
            {criticalOutcomeCount}
          </p>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
            İncelenecek Soru
          </p>
          <p className="text-3xl font-black text-amber-600 mt-2">
            {problematicQuestionCount}
          </p>
        </div>
      </div>

      {/* MODERN SAAS TAB MENÜSÜ */}
      <div className="flex flex-wrap gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-xs">
        <button
          onClick={() => setActiveTab('OUTCOMES')}
          className={`flex-1 min-w-[160px] px-3.5 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
            activeTab === 'OUTCOMES'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-transparent text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
          }`}
        >
          1. Kazanım Analizi
        </button>

        <button
          onClick={() => setActiveTab('CORRELATIONS')}
          className={`flex-1 min-w-[160px] px-3.5 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
            activeTab === 'CORRELATIONS'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-transparent text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
          }`}
        >
          2. Korelasyon Matrisi
        </button>

        <button
          onClick={() => setActiveTab('ITEM_QUALITY')}
          className={`flex-1 min-w-[160px] px-3.5 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
            activeTab === 'ITEM_QUALITY'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-transparent text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
          }`}
        >
          3. Madde & Çeldirici
        </button>

        <button
          onClick={() => setActiveTab('STUDENT_REPORT')}
          className={`flex-1 min-w-[160px] px-3.5 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
            activeTab === 'STUDENT_REPORT'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-transparent text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
          }`}
        >
          4. Öğrenci Karnesi
        </button>

        <button
          onClick={() => setActiveTab('TELEMETRY')}
          className={`flex-1 min-w-[160px] px-3.5 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
            activeTab === 'TELEMETRY'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-transparent text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
          }`}
        >
          5. Süre & Telemetri
        </button>
      </div>

      {/* =================================================================== */}
      {/* SEKME 1: KAZANIM BAZLI BAŞARI VE HATA TÜRÜ ANALİZİ                  */}
      {/* =================================================================== */}
      {activeTab === 'OUTCOMES' && (
        <section className="bg-white p-6 md:p-8 rounded-2xl shadow-xs border border-slate-200 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
            <div>
              <h2 className="text-xl font-extrabold text-slate-900">
                Kazanım Hakimiyet ve Telafi Öncelik Listesi
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Doğru (yeşil), yanlış/kavram yanılgısı (kırmızı) ve boş
                oranlarının dağılımı.
              </p>
            </div>
            <div className="flex items-center gap-5 text-xs font-semibold">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-md bg-emerald-500 inline-block shadow-xs" />
                Doğru
              </span>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-md bg-rose-500 inline-block shadow-xs" />
                Yanlış
              </span>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-md bg-slate-300 inline-block shadow-xs" />
                Boş
              </span>
            </div>
          </div>

          <div className="space-y-4">
            {outcomeResults.map((item) => {
              const isMisconceptionDominant =
                item.success_rate < 60 && item.wrong_rate > item.blank_rate;
              const isBlankDominant =
                item.success_rate < 60 && item.blank_rate >= item.wrong_rate;

              return (
                <div
                  key={item.outcome_code}
                  className="p-5 rounded-xl border border-slate-200/80 bg-slate-50/50 hover:bg-slate-50 transition-colors space-y-3.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                          {item.outcome_code}
                        </span>
                        <span className="text-xs text-slate-500 font-medium">
                          Sorular: {item.question_numbers.join(', ')}
                        </span>
                        {isMisconceptionDominant && (
                          <span className="text-xs px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 border border-rose-200 font-semibold">
                            Kavram Yanılgısı Baskın
                          </span>
                        )}
                        {isBlankDominant && (
                          <span className="text-xs px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                            Konu Eksikliği Baskın
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 mt-2">
                        {item.outcome_title}
                      </h3>
                    </div>

                    <div className="flex items-center gap-3 text-xs shrink-0">
                      <span className="text-emerald-700 font-semibold">
                        Doğru:{' '}
                        <strong className="font-extrabold">
                          %{item.success_rate}
                        </strong>
                      </span>
                      <span className="text-rose-600 font-semibold">
                        Yanlış:{' '}
                        <strong className="font-extrabold">
                          %{item.wrong_rate}
                        </strong>
                      </span>
                      <span className="text-slate-500 font-semibold">
                        Boş:{' '}
                        <strong className="font-extrabold">
                          %{item.blank_rate}
                        </strong>
                      </span>
                      <span className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-900 font-bold shadow-xs">
                        Net: {item.average_net}
                      </span>
                    </div>
                  </div>

                  {/* İlerleme Çubuğu */}
                  <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden flex shadow-inner">
                    <div
                      className="bg-emerald-500 h-3 transition-all duration-300"
                      style={{ width: `${item.success_rate}%` }}
                    />
                    <div
                      className="bg-rose-500 h-3 transition-all duration-300"
                      style={{ width: `${item.wrong_rate}%` }}
                    />
                    <div
                      className="bg-slate-300 h-3 transition-all duration-300"
                      style={{ width: `${item.blank_rate}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* SEKME 2: SORULAR ARASI KORELASYON MATRİSİ                           */}
      {/* =================================================================== */}
      {activeTab === 'CORRELATIONS' && (
        <section className="bg-white p-6 md:p-8 rounded-2xl shadow-xs border border-slate-200 space-y-6">
          <div className="border-b border-slate-100 pb-5">
            <h2 className="text-xl font-extrabold text-slate-900">
              Sorular Arası İlişki Matrisi (Phi Korelasyon Katsayısı)
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Ön koşul bağını ve koşullu başarıyı görmek için matristeki
              hücrelere tıklayın.
            </p>
          </div>

          <div className="p-5 rounded-xl bg-indigo-50/70 border border-indigo-100 text-sm text-indigo-950 shadow-xs">
            {activeCorrelation ? (
              <p className="font-semibold leading-relaxed">
                {getPedagogicalInsight(activeCorrelation)}
              </p>
            ) : (
              <p className="text-indigo-700 font-medium">
                İpucu: Satırdaki soruyu doğru yapanların sütundaki soruyu yapma
                eğilimini görmek için bir kesişim hücresi seçin.
              </p>
            )}
          </div>

          <div className="overflow-x-auto pb-2">
            <table className="border-collapse text-xs text-center w-full">
              <thead>
                <tr>
                  <th className="p-3 border border-slate-200 bg-slate-100 text-slate-600 font-bold">
                    Kaynak \ Hedef
                  </th>
                  {sortedQuestions.map((q) => (
                    <th
                      key={q.id}
                      className="p-3 border border-slate-200 bg-slate-100 font-extrabold text-slate-700 min-w-[56px]"
                    >
                      S{q.question_number}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedQuestions.map((rowQ) => (
                  <tr key={rowQ.id}>
                    <th className="p-3 border border-slate-200 bg-slate-100 font-extrabold text-slate-700">
                      S{rowQ.question_number}
                    </th>
                    {sortedQuestions.map((colQ) => {
                      if (rowQ.question_number === colQ.question_number) {
                        return (
                          <td
                            key={colQ.id}
                            className="p-3 border border-slate-200 bg-slate-200/70 text-slate-400 font-bold"
                          >
                            —
                          </td>
                        );
                      }

                      const corr = correlationMap.get(
                        `${rowQ.question_number}-${colQ.question_number}`
                      );
                      if (!corr) return <td key={colQ.id} />;

                      const isSelected =
                        activeCorrelation?.source_question ===
                          corr.source_question &&
                        activeCorrelation?.target_question ===
                          corr.target_question;

                      return (
                        <td
                          key={colQ.id}
                          onClick={() => setActiveCorrelation(corr)}
                          title={`S${corr.source_question} -> S${corr.target_question} | Koşullu Başarı: %${corr.conditional_probability}`}
                          className={`p-3 border border-slate-200 cursor-pointer transition-all hover:scale-105 ${getHeatmapCellStyle(
                            corr.phi_coefficient
                          )} ${isSelected ? 'ring-3 ring-indigo-600 z-10 relative' : ''}`}
                        >
                          {corr.phi_coefficient.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* SEKME 3: MADDE KALİTESİ VE ÇELDİRİCİ ANALİZİ                        */}
      {/* =================================================================== */}
      {activeTab === 'ITEM_QUALITY' && (
        <section className="space-y-6">
          <div className="bg-white p-6 md:p-8 rounded-2xl shadow-xs border border-slate-200">
            <h2 className="text-xl font-extrabold text-slate-900">
              Madde (Soru) Kalitesi ve Çeldirici Dağılım Raporu
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Üst %27 ve Alt %27 öğrenci gruplarına göre ayırt edicilik, güçlük
              ve yanlış şık analizleri.
            </p>
          </div>

          {itemQualityResults.map((item) => {
            const badge = getQualityBadge(item.quality_status);
            const questionObj = questionMap.get(item.question_id);

            return (
              <div
                key={item.question_id}
                className="bg-white p-6 md:p-8 rounded-2xl shadow-xs border border-slate-200 space-y-6"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="px-3 py-1 rounded-lg bg-slate-900 text-white text-xs font-black shadow-xs">
                        Soru {item.question_number}
                      </span>
                      <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {item.outcome_code}
                      </span>
                      <span
                        className={`text-xs px-3 py-1 rounded-full border font-semibold ${badge.style}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-slate-800 mt-3">
                      {item.outcome_title}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs shrink-0">
                    <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 shadow-xs">
                      <span className="text-slate-400 block font-medium">
                        Güçlük (p)
                      </span>
                      <span className="font-extrabold text-slate-900 text-sm">
                        {item.difficulty_index.toFixed(2)}{' '}
                        <span className="text-xs text-slate-500 font-normal">
                          ({getDifficultyLabel(item.difficulty_index)})
                        </span>
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 shadow-xs">
                      <span className="text-slate-400 block font-medium">
                        Ayırt Edicilik (r)
                      </span>
                      <span
                        className={`font-extrabold text-sm ${
                          item.discrimination_index < 0
                            ? 'text-rose-600'
                            : item.discrimination_index >= 0.3
                              ? 'text-emerald-700'
                              : 'text-amber-600'
                        }`}
                      >
                        {item.discrimination_index.toFixed(2)}
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 shadow-xs">
                      <span className="text-slate-400 block font-medium">
                        En Güçlü Çeldirici
                      </span>
                      <span className="font-extrabold text-rose-600 text-sm">
                        {item.strongest_distractor
                          ? `${item.strongest_distractor} Şıkkı`
                          : 'Yok'}
                      </span>
                    </div>
                    <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 shadow-xs">
                      <span className="text-slate-400 block font-medium">
                        Boş Oranı
                      </span>
                      <span className="font-extrabold text-slate-800 text-sm">
                        %{item.blank_rate}
                      </span>
                    </div>
                  </div>
                </div>

                {/* ŞIK KARTLARI GRİDİ */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {item.options.map((opt) => {
                    let cardStyle = 'border-slate-200 bg-slate-50/40';
                    if (opt.is_correct) {
                      cardStyle =
                        'border-emerald-300 bg-emerald-50/60 ring-1 ring-emerald-200 shadow-xs';
                    } else if (opt.is_misleading_upper) {
                      cardStyle = 'border-rose-300 bg-rose-50/60 shadow-xs';
                    } else if (opt.is_dead_distractor) {
                      cardStyle = 'border-slate-200 bg-slate-100/50 opacity-70';
                    }

                    return (
                      <div
                        key={opt.option}
                        className={`p-4 rounded-xl border text-xs space-y-3 ${cardStyle}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-black text-sm text-slate-900">
                            {opt.option} Şıkkı
                          </span>
                          {opt.is_correct && (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white font-bold text-[10px] uppercase tracking-wider">
                              Doğru
                            </span>
                          )}
                          {opt.is_dead_distractor && (
                            <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-700 font-semibold text-[10px]">
                              Ölü Çeldirici
                            </span>
                          )}
                          {opt.is_misleading_upper && (
                            <span className="px-2 py-0.5 rounded-md bg-rose-600 text-white font-bold text-[10px] uppercase tracking-wider">
                              Üst Grubu Yanıltıyor
                            </span>
                          )}
                        </div>

                        <div className="flex items-baseline justify-between pt-1">
                          <span className="text-slate-500 font-medium">
                            Seçilme:
                          </span>
                          <span className="font-black text-slate-900 text-sm">
                            %{opt.total_percentage}{' '}
                            <span className="text-xs text-slate-400 font-normal">
                              ({opt.total_count} kişi)
                            </span>
                          </span>
                        </div>

                        <div className="pt-2.5 border-t border-slate-200/80 flex justify-between text-[11px] text-slate-600 font-medium">
                          <span>
                            Üst Grup:{' '}
                            <strong className="text-slate-900">
                              {opt.upper_group_count}
                            </strong>
                          </span>
                          <span>
                            Alt Grup:{' '}
                            <strong className="text-slate-900">
                              {opt.lower_group_count}
                            </strong>
                          </span>
                        </div>

                        {!opt.is_correct &&
                          questionObj?.distractor_analysis?.[opt.option] && (
                            <div className="pt-2.5 border-t border-slate-200/80 text-[11px] text-slate-700 leading-relaxed">
                              <span className="font-bold text-rose-700 block mb-0.5">
                                Olası Kavram Yanılgısı:
                              </span>
                              {questionObj.distractor_analysis[opt.option]}
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>

                {/* AÇILIR SORU METNİ, SVG VE ÇÖZÜM KUTUSU */}
                {(questionObj?.question_text || questionObj?.solution) && (
                  <details className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs">
                    <summary className="font-bold text-indigo-700 cursor-pointer select-none">
                      Soru Metni, Görsel ve Adım Adım Çözümü Göster
                    </summary>
                    <div className="mt-4 space-y-3 border-t border-slate-200 pt-3">
                      <SvgPreview svgCode={questionObj.svg_code} />
                      {questionObj.question_text && (
                        <p className="text-slate-800 font-medium leading-relaxed whitespace-pre-line">
                          {questionObj.question_text}
                        </p>
                      )}
                      {questionObj.solution && (
                        <div className="p-3.5 rounded-lg bg-emerald-50/80 border border-emerald-200 text-emerald-950 leading-relaxed">
                          <span className="font-extrabold block mb-1">
                            Çözüm:
                          </span>
                          {questionObj.solution}
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* =================================================================== */}
      {/* SEKME 4: ÖĞRENCİ KARNE REÇETESİ                                     */}
      {/* =================================================================== */}
      {activeTab === 'STUDENT_REPORT' && (
        <StudentReportCard
          dataset={scopedDataset}
          classroomFilter={activeFilter}
        />
      )}

      {/* =================================================================== */}
      {/* SEKME 5: SÜRE VE DAVRANIŞ TELEMETRİSİ                               */}
      {/* =================================================================== */}
      {activeTab === 'TELEMETRY' && <TelemetryPanel report={telemetryReport} />}
    </div>
  );
};