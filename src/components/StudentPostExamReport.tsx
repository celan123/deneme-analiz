import React, { useMemo, useState } from 'react';
import type {
  ExamDataset,
  Student,
  StudentAnswer,
} from '../types/exam';
import { calculateShadowRanking } from '../utils/shadowRanking';
import { SvgPreview } from './SvgPreview';

interface StudentPostExamReportProps {
  dataset: ExamDataset;
  student: Student;
  answers: StudentAnswer[];
  isStaff: boolean;
  onRetake: () => void;
  onGoToDashboard?: () => void;
}

type LeaderboardTab = 'OFFICIAL' | 'GRAND';

export const StudentPostExamReport: React.FC<StudentPostExamReportProps> = ({
  dataset,
  student,
  answers,
  isStaff,
  onRetake,
  onGoToDashboard,
}) => {
  const isGuest = (student.participation_type ?? 'OFFICIAL') === 'GUEST';
  const [boardTab, setBoardTab] = useState<LeaderboardTab>(
    isGuest ? 'GRAND' : 'OFFICIAL'
  );

  // Öğrencinin yeni tamamladığı kayıt dataset'e henüz yansımadıysa yerel olarak birleştir
  const mergedDataset = useMemo<ExamDataset>(() => {
    const alreadyExists = dataset.students.some((s) => s.id === student.id);
    if (alreadyExists) return dataset;

    return {
      ...dataset,
      students: [...dataset.students, student],
      answers: [...dataset.answers, ...answers],
    };
  }, [dataset, student, answers]);

  const ranking = useMemo(
    () => calculateShadowRanking(mergedDataset, student.id),
    [mergedDataset, student.id]
  );

  // Kişisel telemetri, telafi listesi ve kavram yanılgısı teşhisleri
  const personalAnalysis = useMemo(() => {
    const ansMap = new Map(answers.map((a) => [a.question_id, a]));
    const sortedQuestions = [...dataset.questions].sort(
      (a, b) => a.question_number - b.question_number
    );

    let totalTimeSeconds = 0;
    let totalChanges = 0;
    let rapidGuessCount = 0;

    const missedOutcomesMap = new Map<
      string,
      {
        outcome_code: string;
        outcome_title: string;
        missedNumbers: number[];
      }
    >();

    const details = sortedQuestions.map((q) => {
      const ans = ansMap.get(q.id);
      const selected = ans?.selected_option ?? null;
      const timeSpent = ans?.time_spent_seconds ?? 0;
      const changes = ans?.change_count ?? 0;

      totalTimeSeconds += timeSpent;
      totalChanges += changes;
      if (selected !== null && timeSpent < 6) rapidGuessCount++;

      const isCorrect = selected === q.correct_option;
      const isBlank = selected === null;

      if (!isCorrect) {
        let entry = missedOutcomesMap.get(q.outcome_code);
        if (!entry) {
          entry = {
            outcome_code: q.outcome_code,
            outcome_title: q.outcome_title,
            missedNumbers: [],
          };
          missedOutcomesMap.set(q.outcome_code, entry);
        }
        entry.missedNumbers.push(q.question_number);
      }

      const misconceptionNote =
        !isCorrect && !isBlank && selected
          ? q.distractor_analysis?.[selected] ?? null
          : null;

      return {
        question: q,
        selected,
        timeSpent,
        changes,
        isCorrect,
        isBlank,
        misconceptionNote,
      };
    });

    const avgTime =
      sortedQuestions.length > 0
        ? Math.round((totalTimeSeconds / sortedQuestions.length) * 10) / 10
        : 0;

    return {
      totalTimeSeconds,
      avgTime,
      totalChanges,
      rapidGuessCount,
      missedOutcomes: Array.from(missedOutcomesMap.values()),
      details,
      wrongOrBlankItems: details.filter((d) => !d.isCorrect),
    };
  }, [answers, dataset.questions]);

  const showSolutions = dataset.exam.show_solutions_after_finish ?? true;

  if (!ranking) return null;

  const activeLeaderboard =
    boardTab === 'OFFICIAL'
      ? ranking.official_leaderboard
      : ranking.grand_leaderboard;

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m} dk ${s} sn` : `${s} sn`;
  };

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-6">
      {/* ÜST KARNE BAŞLIĞI */}
      <header className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-7 md:p-8 rounded-2xl shadow-xl border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider border ${
                  isGuest
                    ? 'bg-fuchsia-500/20 border-fuchsia-400/40 text-fuchsia-200'
                    : 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200'
                }`}
              >
                {isGuest
                  ? 'Misafir (Gölge) Katılım Karnesi'
                  : 'Resmi Katılım Karnesi'}
              </span>
              <span className="text-xs text-slate-300 font-semibold">
                {student.full_name} • {student.classroom}
                {student.school_name ? ` (${student.school_name})` : ''}
              </span>
            </div>

            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
              {dataset.exam.title}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300">
              {isGuest
                ? 'Kurumun resmi ortalamasını ve sıralamasını etkilemeden kendi gölge performansını ölçtün.'
                : 'Sonuçların resmi kurum sıralamasına ve psikometrik analiz raporlarına işlendi.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onRetake}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-white cursor-pointer transition-colors"
            >
              Yeni Deneme / Tekrar
            </button>
            {isStaff && onGoToDashboard && (
              <button
                type="button"
                onClick={onGoToDashboard}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white cursor-pointer transition-colors"
              >
                Öğretmen Analiz Paneli →
              </button>
            )}
          </div>
        </div>
      </header>

      {/* TEMEL PUAN VE SÜRE KARTLARI */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase">
            Net Puanın
          </span>
          <p className="text-2xl font-black text-indigo-700 mt-1">
            {ranking.target.net_score}
          </p>
          <span className="text-[11px] text-slate-500 font-medium">
            Başarı: %{ranking.target.success_rate}
          </span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs">
          <span className="text-[11px] font-bold text-emerald-600 uppercase">
            Doğru
          </span>
          <p className="text-2xl font-black text-emerald-700 mt-1">
            {ranking.target.correct_count}
          </p>
          <span className="text-[11px] text-slate-400">
            / {dataset.questions.length} soru
          </span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-rose-200 shadow-xs">
          <span className="text-[11px] font-bold text-rose-600 uppercase">
            Yanlış
          </span>
          <p className="text-2xl font-black text-rose-700 mt-1">
            {ranking.target.wrong_count}
          </p>
          <span className="text-[11px] text-slate-400">
            Boş: {ranking.target.blank_count}
          </span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase">
            Toplam Süre
          </span>
          <p className="text-2xl font-black text-slate-900 mt-1">
            {formatDuration(personalAnalysis.totalTimeSeconds)}
          </p>
          <span className="text-[11px] text-slate-500">
            Ort: {personalAnalysis.avgTime} sn/soru
          </span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs col-span-2 sm:col-span-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase">
            Karar Sinyali
          </span>
          <p className="text-2xl font-black text-amber-600 mt-1">
            {personalAnalysis.totalChanges}
          </p>
          <span className="text-[11px] text-slate-500">
            Şık değişimi • {personalAnalysis.rapidGuessCount} hızlı
          </span>
        </div>
      </div>

      {/* RESMİ / GÖLGE SIRALAMA VE BÜYÜK SIRALAMA MOTORU */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* SOL KART: RESMİ VEYA GÖLGE SIRALAMA */}
        <div
          className={`p-6 rounded-2xl border shadow-xs space-y-3 ${
            isGuest
              ? 'bg-gradient-to-br from-fuchsia-50/80 to-indigo-50/70 border-fuchsia-200'
              : 'bg-gradient-to-br from-emerald-50/80 to-teal-50/60 border-emerald-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span
              className={`text-xs font-extrabold uppercase tracking-wider ${
                isGuest ? 'text-fuchsia-800' : 'text-emerald-800'
              }`}
            >
              {isGuest
                ? 'Gölge Sıralaman (Resmi Kurum Havuzunda)'
                : 'Resmi Kurum Sıralaman'}
            </span>
            <span className="text-xs font-bold text-slate-600">
              Resmi Ort: {ranking.official_avg_net} net
            </span>
          </div>

          {ranking.shadow_or_official_rank !== null ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black text-slate-900">
                  {ranking.shadow_or_official_rank}.
                </span>
                <span className="text-sm font-bold text-slate-600">
                  / {ranking.shadow_pool_size} kişi{' '}
                  {ranking.shadow_percentile !== null &&
                    `(İlk %${ranking.shadow_percentile})`}
                </span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">
                {isGuest
                  ? `Bu sınavın ${ranking.official_count} resmi katılımcısı arasına girseydin ${ranking.shadow_or_official_rank}. sırada yer alacaktın. Kurum öğrencilerinin resmi listesinde adın görünmez.`
                  : `Sınavın ${ranking.official_count} resmi katılımcısı arasındaki güncel sıralaman. Misafir katılımcılar bu sırayı etkilemez.`}
              </p>
            </>
          ) : (
            <p className="text-xs font-semibold text-slate-600 pt-2">
              Bu sınavda henüz resmi katılımcı bulunmuyor; resmi öğrenciler
              çözdükçe gölge sıralaman otomatik oluşacaktır.
            </p>
          )}
        </div>

        {/* SAĞ KART: BÜYÜK SIRALAMA (HERKES DAHİL) */}
        <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-700">
              Büyük Sıralama (Resmi + Misafir)
            </span>
            <span className="text-xs font-bold text-slate-500">
              Genel Ort: {ranking.grand_avg_net} net
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-black text-indigo-700">
              {ranking.grand_rank}.
            </span>
            <span className="text-sm font-bold text-slate-600">
              / {ranking.total_count} katılımcı (İlk %{ranking.grand_percentile})
            </span>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            {ranking.official_count} resmi + {ranking.guest_count} misafir
            öğrencinin tamamının dahil edildiği büyük sıralama.
          </p>
        </div>
      </section>

      {/* LİDERLİK TABLOSU (RESMİ / BÜYÜK SIRALAMA GEÇİŞLİ) */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">
              Sıralama Tablosu
            </h2>
            <p className="text-xs text-slate-500">
              Diğer öğrencilerin gizliliği için soyadları maskelenerek
              gösterilir.
            </p>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setBoardTab('OFFICIAL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                boardTab === 'OFFICIAL'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Resmi Sıralama ({ranking.official_count})
            </button>
            <button
              type="button"
              onClick={() => setBoardTab('GRAND')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                boardTab === 'GRAND'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Büyük Sıralama ({ranking.total_count})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700">
                <th className="p-3 font-bold">Sıra</th>
                <th className="p-3 font-bold">Katılımcı</th>
                <th className="p-3 font-bold">Şube / Tür</th>
                <th className="p-3 text-center font-bold">D / Y / B</th>
                <th className="p-3 text-right font-bold">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {activeLeaderboard.slice(0, 15).map((row) => {
                const isMe = row.student_id === student.id;
                return (
                  <tr
                    key={row.student_id}
                    className={
                      isMe ? 'bg-indigo-50/80 font-bold' : 'hover:bg-slate-50'
                    }
                  >
                    <td className="p-3 font-black text-slate-900">
                      #{row.rank}
                    </td>
                    <td className="p-3 text-slate-900">
                      {isMe ? row.full_name : row.masked_name}{' '}
                      {isMe && (
                        <span className="ml-1.5 px-2 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-bold">
                          Sen
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className="text-slate-600">{row.classroom}</span>
                      {row.participation_type === 'GUEST' && (
                        <span className="ml-2 px-2 py-0.5 rounded bg-fuchsia-100 text-fuchsia-800 text-[10px] font-bold">
                          Misafir
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-center text-slate-700">
                      {row.correct_count} / {row.wrong_count} /{' '}
                      {row.blank_count}
                    </td>
                    <td className="p-3 text-right font-black text-indigo-700">
                      {row.net_score}
                    </td>
                  </tr>
                );
              })}

              {activeLeaderboard.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="p-5 text-center text-slate-500 font-medium"
                  >
                    Bu kategoride henüz katılımcı yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* KİŞİSEL TELAFİ REÇETESİ */}
      <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <h2 className="text-base font-extrabold text-slate-900">
          Kişisel Telafi Çalışma Reçeten
        </h2>

        {personalAnalysis.missedOutcomes.length === 0 ? (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-bold">
            Kusursuz performans! Bu sınavdaki tüm kazanımları tam olarak
            karşıladın.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {personalAnalysis.missedOutcomes.map((item) => (
              <div
                key={item.outcome_code}
                className="p-4 rounded-xl border border-amber-200 bg-amber-50/60 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900">
                    {item.outcome_code}
                  </span>
                  <span className="text-xs font-bold text-amber-800">
                    Sorular: {item.missedNumbers.join(', ')}
                  </span>
                </div>
                <p className="text-xs font-semibold text-slate-800 leading-relaxed">
                  {item.outcome_title}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* KAVRAM YANILGISI TEŞHİSİ VE ÇÖZÜM REHBERİ */}
      {personalAnalysis.wrongOrBlankItems.length > 0 && (
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <h2 className="text-base font-extrabold text-slate-900">
            Kaçırdığın Sorular: Kavram Yanılgısı Teşhisi ve Çözümler
          </h2>

          {!showSolutions ? (
            <div className="p-4 rounded-xl bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700">
              Sınav yöneticisi bu sınav için cevap anahtarı ve çözüm görünümünü
              geçici olarak kilitledi. Sınav kapandığında çözümler burada
              açılacaktır.
            </div>
          ) : (
            <div className="space-y-4">
              {personalAnalysis.wrongOrBlankItems.map((item) => (
                <div
                  key={item.question.id}
                  className="p-5 rounded-xl border border-rose-200/80 bg-rose-50/30 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-black">
                        Soru {item.question.question_number}
                      </span>
                      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {item.question.outcome_code}
                      </span>
                      <span className="text-xs text-slate-500 font-medium">
                        Harcanan süre: {item.timeSpent} sn
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-bold">
                      <span className="px-2.5 py-0.5 rounded bg-rose-100 text-rose-800">
                        Senin Yanıtın: {item.isBlank ? 'Boş' : item.selected}
                      </span>
                      <span className="px-2.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        Doğru: {item.question.correct_option}
                      </span>
                    </div>
                  </div>

                  {item.misconceptionNote && (
                    <div className="p-3.5 rounded-lg bg-white border border-rose-200 text-xs text-slate-800 leading-relaxed">
                      <span className="font-extrabold text-rose-700 block mb-1">
                        Neden {item.selected} Şıkkına Yöneldin? (Olası Kavram
                        Yanılgısı):
                      </span>
                      {item.misconceptionNote}
                    </div>
                  )}

                  <details className="rounded-lg bg-white border border-slate-200 p-3.5 text-xs">
                    <summary className="font-bold text-indigo-700 cursor-pointer select-none">
                      Soruyu ve Adım Adım Çözümü İncele
                    </summary>
                    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                      <SvgPreview svgCode={item.question.svg_code} />
                      {item.question.question_text && (
                        <p className="text-slate-700 font-medium leading-relaxed whitespace-pre-line">
                          {item.question.question_text}
                        </p>
                      )}
                      {item.question.solution ? (
                        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-950 leading-relaxed">
                          <span className="font-extrabold block mb-1">
                            Adım Adım Çözüm:
                          </span>
                          {item.question.solution}
                        </div>
                      ) : (
                        <p className="text-slate-400 italic">
                          Bu soru için adım adım çözüm metni girilmemiş.
                        </p>
                      )}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};