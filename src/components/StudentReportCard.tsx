import React, { useMemo, useState } from 'react';
import type { ExamDataset, OptionChoice } from '../types/exam';
import { SvgPreview } from './SvgPreview';

interface StudentReportCardProps {
  dataset: ExamDataset;
  classroomFilter?: string;
}

export const StudentReportCard: React.FC<StudentReportCardProps> = ({
  dataset,
  classroomFilter,
}) => {
  const [selectedStudentId, setSelectedStudentId] = useState<string>(
    dataset.students[0]?.id || ''
  );

  // Şube filtresine göre öğrencileri daralt ve Türkçe alfabetik sırala
  const sortedStudents = useMemo(() => {
    const filtered = classroomFilter
      ? dataset.students.filter((s) => s.classroom === classroomFilter)
      : dataset.students;

    return [...filtered].sort((a, b) =>
      a.full_name.localeCompare(b.full_name, 'tr')
    );
  }, [dataset.students, classroomFilter]);

  // Şube değiştiğinde önceki öğrenci yeni listede yoksa ilk öğrenciye geç
  const effectiveStudentId = useMemo(() => {
    if (sortedStudents.some((s) => s.id === selectedStudentId)) {
      return selectedStudentId;
    }
    return sortedStudents[0]?.id || '';
  }, [sortedStudents, selectedStudentId]);

  const currentStudent = useMemo(
    () => sortedStudents.find((s) => s.id === effectiveStudentId),
    [sortedStudents, effectiveStudentId]
  );

  // Seçilen öğrencinin cevaplarını, netini, telafi listesini ve kavram yanılgısı teşhislerini hesapla
  const reportData = useMemo(() => {
    if (!currentStudent) return null;

    const studentAnswers = new Map<string, OptionChoice>();
    for (const ans of dataset.answers) {
      if (ans.student_id === currentStudent.id) {
        studentAnswers.set(ans.question_id, ans.selected_option);
      }
    }

    let correctCount = 0;
    let wrongCount = 0;
    let blankCount = 0;

    const missedOutcomesMap = new Map<
      string,
      {
        outcome_code: string;
        outcome_title: string;
        subject: string;
        missedQuestions: number[];
      }
    >();

    const sortedQuestions = [...dataset.questions].sort(
      (a, b) => a.question_number - b.question_number
    );

    const detailedAnswers = sortedQuestions.map((q) => {
      const selected = studentAnswers.get(q.id) ?? null;
      const isCorrect = selected === q.correct_option;
      const isBlank = selected === null;

      if (isBlank) {
        blankCount++;
      } else if (isCorrect) {
        correctCount++;
      } else {
        wrongCount++;
      }

      if (!isCorrect) {
        let entry = missedOutcomesMap.get(q.outcome_code);
        if (!entry) {
          entry = {
            outcome_code: q.outcome_code,
            outcome_title: q.outcome_title,
            subject: q.subject,
            missedQuestions: [],
          };
          missedOutcomesMap.set(q.outcome_code, entry);
        }
        entry.missedQuestions.push(q.question_number);
      }

      // Öğrencinin seçtiği yanlış şıkka özel kavram yanılgısı notu
      const misconceptionNote =
        !isCorrect && !isBlank && selected
          ? q.distractor_analysis?.[selected] ?? null
          : null;

      return {
        questionId: q.id,
        questionNumber: q.question_number,
        subject: q.subject,
        outcomeCode: q.outcome_code,
        outcomeTitle: q.outcome_title,
        questionText: q.question_text ?? null,
        svgCode: q.svg_code ?? null,
        correctOption: q.correct_option,
        selectedOption: selected,
        isCorrect,
        isBlank,
        misconceptionNote,
        solution: q.solution ?? null,
      };
    });

    const diagnosticItems = detailedAnswers.filter(
      (ans) => !ans.isCorrect && (ans.misconceptionNote || ans.solution)
    );

    const netScore =
      correctCount - wrongCount * dataset.exam.wrong_penalty_ratio;
    const totalQuestions = dataset.questions.length;
    const successPercentage =
      totalQuestions > 0
        ? Math.round((correctCount / totalQuestions) * 100)
        : 0;

    return {
      correctCount,
      wrongCount,
      blankCount,
      netScore: Math.round(netScore * 100) / 100,
      successPercentage,
      detailedAnswers,
      remedialList: Array.from(missedOutcomesMap.values()),
      diagnosticItems,
    };
  }, [currentStudent, dataset]);

  if (!currentStudent || !reportData) {
    return (
      <div className="bg-white p-8 rounded-2xl shadow-xs border border-slate-200 text-slate-500 text-sm">
        Seçili kapsamda öğrenci verisi bulunamadı.
      </div>
    );
  }

  return (
    <div className="bg-white p-6 md:p-8 rounded-2xl shadow-xs border border-slate-200 space-y-6">
      {/* BAŞLIK VE ÖĞRENCİ SEÇİCİ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">
            Bireysel Öğrenci Karne ve Telafi Reçetesi
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Öğrencinin sınav dökümünü, tespit edilen kavram yanılgılarını ve
            çözüm rehberini inceleyin.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label
            htmlFor="student-select"
            className="text-xs font-semibold text-slate-500 uppercase tracking-wider shrink-0"
          >
            Öğrenci:
          </label>
          <select
            id="student-select"
            value={effectiveStudentId}
            onChange={(e) => setSelectedStudentId(e.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-xs focus:border-indigo-500 focus:outline-none cursor-pointer"
          >
            {sortedStudents.map((stu) => (
              <option key={stu.id} value={stu.id}>
                {stu.full_name} ({stu.classroom})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ÖĞRENCİ ÖZET KARTLARI */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5">
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
          <span className="text-xs text-slate-500 block font-semibold uppercase tracking-wider">
            Şube
          </span>
          <span className="text-xl font-black text-slate-900 mt-1 block">
            {currentStudent.classroom}
          </span>
        </div>
        <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200">
          <span className="text-xs text-emerald-700 block font-semibold uppercase tracking-wider">
            Doğru
          </span>
          <span className="text-xl font-black text-emerald-800 mt-1 block">
            {reportData.correctCount}
          </span>
        </div>
        <div className="p-4 rounded-xl bg-rose-50/70 border border-rose-200">
          <span className="text-xs text-rose-700 block font-semibold uppercase tracking-wider">
            Yanlış
          </span>
          <span className="text-xl font-black text-rose-800 mt-1 block">
            {reportData.wrongCount}
          </span>
        </div>
        <div className="p-4 rounded-xl bg-slate-100/80 border border-slate-200">
          <span className="text-xs text-slate-600 block font-semibold uppercase tracking-wider">
            Boş
          </span>
          <span className="text-xl font-black text-slate-800 mt-1 block">
            {reportData.blankCount}
          </span>
        </div>
        <div className="p-4 rounded-xl bg-indigo-50/80 border border-indigo-200 col-span-2 sm:col-span-1">
          <span className="text-xs text-indigo-700 block font-semibold uppercase tracking-wider">
            Net Puanı
          </span>
          <span className="text-xl font-black text-indigo-900 mt-1 block">
            {reportData.netScore}{' '}
            <span className="text-xs font-semibold text-indigo-500">
              (%{reportData.successPercentage})
            </span>
          </span>
        </div>
      </div>

      {/* BÖLÜM 1: ÖĞRENCİNİN TELAFİ ÇALIŞMA LİSTESİ */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
          {currentStudent.full_name} İçin Öncelikli Telafi Çalışma Reçetesi
        </h3>

        {reportData.remedialList.length === 0 ? (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold">
            Tebrikler! Bu sınavda hiçbir kazanımdan soru kaçırılmadı; tüm
            sorular doğru yanıtlandı.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {reportData.remedialList.map((item) => (
              <div
                key={item.outcome_code}
                className="p-4 rounded-xl border border-amber-200 bg-amber-50/50 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-900">
                    {item.outcome_code}
                  </span>
                  <span className="text-xs text-amber-800 font-semibold">
                    Kaçırılan Soru: {item.missedQuestions.join(', ')}
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-900 leading-relaxed">
                  {item.outcome_title}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BÖLÜM 2: KİŞİYE ÖZEL KAVRAM YANILGISI TEŞHİSİ VE ÇÖZÜMLER */}
      {reportData.diagnosticItems.length > 0 && (
        <div className="space-y-3 pt-2">
          <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
            Tespit Edilen Kavram Yanılgıları ve Adım Adım Çözümler
          </h3>

          <div className="space-y-4">
            {reportData.diagnosticItems.map((item) => (
              <div
                key={item.questionId}
                className="p-5 rounded-xl border border-rose-200/80 bg-rose-50/30 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-black">
                      Soru {item.questionNumber}
                    </span>
                    <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {item.outcomeCode}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <span className="px-2.5 py-0.5 rounded-md bg-rose-100 text-rose-800">
                      Öğrenci: {item.isBlank ? 'Boş' : item.selectedOption}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                      Doğru: {item.correctOption}
                    </span>
                  </div>
                </div>

                {item.misconceptionNote && (
                  <div className="p-3.5 rounded-lg bg-white border border-rose-200 text-xs text-slate-800 leading-relaxed">
                    <span className="font-extrabold text-rose-700 block mb-1">
                      Seçilen {item.selectedOption} Şıkkına Göre Olası Hata
                      Nedeni:
                    </span>
                    {item.misconceptionNote}
                  </div>
                )}

                {item.solution && (
                  <details className="rounded-lg bg-white border border-slate-200 p-3.5 text-xs">
                    <summary className="font-bold text-indigo-700 cursor-pointer select-none">
                      Adım Adım Çözümü ve Soruyu İncele
                    </summary>
                    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                      <SvgPreview svgCode={item.svgCode} />
                      {item.questionText && (
                        <p className="text-slate-700 leading-relaxed whitespace-pre-line">
                          {item.questionText}
                        </p>
                      )}
                      <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-950 leading-relaxed">
                        <span className="font-extrabold block mb-1">
                          Doğru Çözüm:
                        </span>
                        {item.solution}
                      </div>
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BÖLÜM 3: SORU BAZLI DETAYLI CEVAP LİSTESİ */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
          Soru Bazlı Yanıt Dökümü
        </h3>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700">
                <th className="p-3 border-b border-slate-200 font-bold">
                  Soru No
                </th>
                <th className="p-3 border-b border-slate-200 font-bold">
                  Ders / Alan
                </th>
                <th className="p-3 border-b border-slate-200 font-bold">
                  Kazanım Kodu
                </th>
                <th className="p-3 border-b border-slate-200 text-center font-bold">
                  Doğru Şık
                </th>
                <th className="p-3 border-b border-slate-200 text-center font-bold">
                  Öğrencinin Yanıtı
                </th>
                <th className="p-3 border-b border-slate-200 text-center font-bold">
                  Durum
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {reportData.detailedAnswers.map((ans) => (
                <tr
                  key={ans.questionNumber}
                  className="hover:bg-slate-50/80 transition-colors"
                >
                  <td className="p-3 font-bold text-slate-900">
                    Soru {ans.questionNumber}
                  </td>
                  <td className="p-3 text-slate-600">{ans.subject}</td>
                  <td className="p-3 font-mono font-semibold text-indigo-700">
                    {ans.outcomeCode}
                  </td>
                  <td className="p-3 text-center font-extrabold text-emerald-700">
                    {ans.correctOption}
                  </td>
                  <td
                    className={`p-3 text-center font-extrabold ${
                      ans.isBlank
                        ? 'text-slate-400'
                        : ans.isCorrect
                          ? 'text-emerald-700'
                          : 'text-rose-600'
                    }`}
                  >
                    {ans.isBlank ? 'Boş' : ans.selectedOption}
                  </td>
                  <td className="p-3 text-center">
                    {ans.isCorrect ? (
                      <span className="px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-semibold">
                        Doğru
                      </span>
                    ) : ans.isBlank ? (
                      <span className="px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-semibold">
                        Boş
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-md bg-rose-100 text-rose-800 font-semibold">
                        Yanlış
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};