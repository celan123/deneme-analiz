import React, { useEffect, useMemo, useState } from 'react';
import { fetchPoolFingerprintMap } from '../services/adminService';
import { createExamFromAgentJson } from '../services/examService';
import type { AgentQuestionInput, ValidOption } from '../types/exam';
import { validateAgentQuestions } from '../utils/questionValidator';
import { ImportValidationReport } from './ImportValidationReport';
import { SvgPreview } from './SvgPreview';

interface ExamImportViewProps {
  isLiveDb: boolean;
  onExamCreated: (newExamId: string) => void;
  onCancel: () => void;
}

const OPTION_KEYS: ValidOption[] = ['A', 'B', 'C', 'D', 'E'];

// SVG içeriğinden olası script/event kalıntılarını temizler

// Kopyalanan metindeki ```json ... ``` işaretlerini otomatik ayıklar
function cleanJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export const ExamImportView: React.FC<ExamImportViewProps> = ({
  isLiveDb,
  onExamCreated,
  onCancel,
}) => {
  const today = new Date().toISOString().slice(0, 10);

  const [title, setTitle] = useState<string>('');
  const [examDate, setExamDate] = useState<string>(today);
  const [penaltyRatio, setPenaltyRatio] = useState<number>(0.333);
  const [rawJson, setRawJson] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Kopya kontrolü için havuzdaki soruların parmak izleri
  const [poolFingerprints, setPoolFingerprints] = useState<Map<
    string,
    string
  > | null>(null);

  useEffect(() => {
    if (!isLiveDb) return;
    let cancelled = false;
    fetchPoolFingerprintMap()
      .then((map) => {
        if (!cancelled) setPoolFingerprints(map);
      })
      .catch(() => {
        // Havuz okunamazsa kopya kontrolü olmadan devam et
        if (!cancelled) setPoolFingerprints(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [isLiveDb]);

  // Yapıştırılan JSON'u canlı olarak ayrıştır ve kurallara göre doğrula
  const parseResult = useMemo(() => {
    if (!rawJson.trim()) {
      return {
        questions: [] as AgentQuestionInput[],
        validation: [] as ReturnType<typeof validateAgentQuestions>,
        error: null as string | null,
      };
    }

    try {
      const parsed = JSON.parse(cleanJsonText(rawJson));
      const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

      if (list.length === 0) {
        return { questions: [], validation: [], error: 'JSON dizisi boş görünüyor.' };
      }

      const validation = validateAgentQuestions(list, poolFingerprints ?? new Map());
      return {
        questions: validation.map((v) => v.question),
        validation,
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Geçersiz JSON formatı.';
      return { questions: [], validation: [], error: `JSON ayrıştırma hatası: ${msg}` };
    }
  }, [rawJson, poolFingerprints]);

  const invalidCount = parseResult.validation.filter((v) => !v.isValid).length;
  const canSave =
    isLiveDb &&
    !saving &&
    poolFingerprints !== null &&
    parseResult.questions.length > 0 &&
    invalidCount === 0 &&
    title.trim().length > 0;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    setSaving(true);
    setSaveError(null);

    try {
      const newExamId = await createExamFromAgentJson({
        title,
        examDate,
        wrongPenaltyRatio: penaltyRatio,
        agentQuestions: parseResult.questions,
        existingPoolIds: parseResult.validation.map((v) => v.existingPoolId),
      });
      onExamCreated(newExamId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sınav kaydedilemedi.';
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-6 md:p-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="inline-block px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-200 text-xs font-semibold uppercase tracking-wider">
              Soru Ajanı Entegrasyonu
            </span>
            <h1 className="text-2xl font-extrabold mt-2">
              JSON ile Yeni Deneme Sınavı Oluştur
            </h1>
            <p className="text-sm text-slate-300 mt-1">
              Soru havuzu ajanından aldığın JSON dizisini yapıştır; SVG görseller,
              çözümler ve çeldirici analizleri otomatik aktarılsın.
            </p>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 cursor-pointer"
          >
            ← Panele Dön
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 md:p-8 space-y-6">
          {!isLiveDb && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800">
              Yeni sınav kaydetmek için Supabase bağlantısının aktif olması gerekir.
            </div>
          )}

          {/* SINAV BİLGİLERİ */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label
                htmlFor="exam-title"
                className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5"
              >
                Deneme Sınavı Başlığı
              </label>
              <input
                id="exam-title"
                type="text"
                required
                placeholder="Örn: 5. Sınıf Matematik — Geometrik Şekiller Tarama"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="exam-date"
                  className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5"
                >
                  Tarih
                </label>
                <input
                  id="exam-date"
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="penalty-ratio"
                  className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5"
                >
                  Yanlış Oranı
                </label>
                <select
                  id="penalty-ratio"
                  value={penaltyRatio}
                  onChange={(e) => setPenaltyRatio(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
                >
                  <option value={0.333}>3Y 1D (LGS)</option>
                  <option value={0.25}>4Y 1D (YKS)</option>
                  <option value={0}>Götürmesiz</option>
                </select>
              </div>
            </div>
          </div>

          {/* JSON YAPIŞTIRMA ALANI */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="agent-json"
                className="block text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                Soru Ajanı JSON Çıktısı
              </label>
              {parseResult.questions.length > 0 && (
                <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                  ✓ {parseResult.questions.length} soru algılandı
                </span>
              )}
            </div>

            <textarea
              id="agent-json"
              rows={9}
              placeholder='[{"id": "MAT5-U1-001", "sinif": 5, "ders": "Matematik", ...}]'
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              className="w-full rounded-xl border border-slate-300 p-4 font-mono text-xs text-slate-800 bg-slate-50 focus:bg-white focus:border-indigo-500 focus:outline-none"
            />

            {parseResult.error && (
              <p className="mt-2 text-xs font-semibold text-rose-600">
                {parseResult.error}
              </p>
            )}

            <div className="mt-3">
              <ImportValidationReport
                results={parseResult.validation}
                mode="exam"
                checkingPool={isLiveDb && poolFingerprints === null}
              />
              {invalidCount > 0 && (
                <p className="mt-2 text-xs font-semibold text-rose-700">
                  Sınavı kaydetmek için kurallara uymayan {invalidCount} soruyu
                  JSON'da düzeltin veya çıkarın.
                </p>
              )}
            </div>
          </div>

          {saveError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
              Kayıt Hatası: {saveError}
            </div>
          )}

          {/* KAYDET BUTONU */}
          <div className="flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={!canSave}
              className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm shadow-md shadow-indigo-600/20 transition-colors cursor-pointer"
            >
              {saving
                ? 'Veritabanına Kaydediliyor...'
                : `Sınavı Kaydet (${parseResult.questions.length} Soru)`}
            </button>
          </div>
        </form>
      </div>

      {/* CANLI ÖNİZLEME (SVG VE ÇELDİRİCİ KONTROLÜ) */}
      {parseResult.questions.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-extrabold text-slate-700 uppercase tracking-wider px-1">
            Canlı Soru ve SVG Önizleme ({parseResult.questions.length} Soru)
          </h2>
          {parseResult.questions.map((q, idx) => {
            const issues = parseResult.validation[idx]?.issues ?? [];

            const distractorCount = q.celdiriciAnalizi
              ? Object.keys(q.celdiriciAnalizi).length
              : 0;

            return (
              <div
                key={q.id ?? idx}
                className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-black">
                    Soru {idx + 1}
                  </span>
                  {q.sinif && (
                    <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 text-xs font-bold">
                      {q.sinif}. Sınıf • {q.ders}
                    </span>
                  )}
                  <span className="px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100 text-xs font-mono font-bold">
                    {q.kazanimKodu}
                  </span>
                  {q.zorluk && (
                    <span className="px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
                      {q.zorluk}
                    </span>
                  )}
                  {distractorCount > 0 && (
                    <span className="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                      {distractorCount} Çeldirici Analizi Hazır
                    </span>
                  )}
                </div>
                  <SvgPreview svgCode={q.svgKodu} />
                {issues.length > 0 && (
                  <ul className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                    {issues.map((issue, i) => (
                      <li
                        key={i}
                        className={
                          issue.level === 'error'
                            ? 'text-rose-700 font-semibold'
                            : 'text-amber-700'
                        }
                      >
                        {issue.level === 'error' ? '✕ ' : '! '}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-sm font-semibold text-slate-900 leading-relaxed whitespace-pre-line">
                  {q.soruMetni}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {OPTION_KEYS.filter((k) => q.secenekler?.[k]).map((k) => {
                    const isCorrect =
                      q.dogruCevap.trim().toUpperCase() === k;
                    return (
                      <div
                        key={k}
                        className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                          isCorrect
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-bold'
                            : 'bg-slate-50 border-slate-200 text-slate-700'
                        }`}
                      >
                        <span
                          className={`px-2 py-0.5 rounded font-black shrink-0 ${
                            isCorrect
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {k}
                        </span>
                        <span>{q.secenekler[k]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
};