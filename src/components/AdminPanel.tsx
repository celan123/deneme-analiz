import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deletePoolQuestion,
  fetchAllProfiles,
  fetchPoolFingerprintMap,
  fetchQuestionPool,
  importQuestionsToPool,
  updatePoolQuestion,
  updateUserRole,
} from '../services/adminService';
import {
  fetchAllQuestionReviews,
  type AdminQuestionReviewRow,
} from '../services/questionReviewService';
import type { UserProfile, UserRole } from '../types/auth';
import type { PoolQuestion, ValidOption } from '../types/exam';
import { validateAgentQuestions } from '../utils/questionValidator';
import { ImportValidationReport } from './ImportValidationReport';
import { QuestionHoverPreview } from './QuestionHoverPreview';
import { ReviewTrackingTab } from './ReviewTrackingTab';
import { SvgPreview } from './SvgPreview';

interface AdminPanelProps {
  currentUserId?: string;
  onExamsChanged: (focusExamId?: string) => Promise<void>;
}

type AdminTab = 'POOL' | 'USERS' | 'REVIEWS';

const OPTION_KEYS: ValidOption[] = ['A', 'B', 'C', 'D'];

function cleanJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  currentUserId,
  onExamsChanged,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('POOL');
  const [pool, setPool] = useState<PoolQuestion[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [reviews, setReviews] = useState<AdminQuestionReviewRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  // HAVUZ FİLTRE VE EKLEME STATE'LERİ
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [gradeFilter, setGradeFilter] = useState<string>('ALL');
  const [subjectFilter, setSubjectFilter] = useState<string>('ALL');
  const [showJsonImporter, setShowJsonImporter] = useState<boolean>(false);
  const [rawPoolJson, setRawPoolJson] = useState<string>('');
  const [importingPool, setImportingPool] = useState<boolean>(false);
  const [poolFingerprints, setPoolFingerprints] = useState<Map<
    string,
    string
  > | null>(null);

  // CANLI SORU DÜZENLEME VE HOVER ÖNİZLEME STATE'LERİ
  const [editingQuestion, setEditingQuestion] = useState<PoolQuestion | null>(
    null
  );
  const [hoveredQuestion, setHoveredQuestion] = useState<PoolQuestion | null>(
    null
  );
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [poolData, profileData, reviewData] = await Promise.all([
        fetchQuestionPool(),
        fetchAllProfiles(),
        fetchAllQuestionReviews(),
      ]);
      setPool(poolData);
      setProfiles(profileData);
      setReviews(reviewData);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Admin verileri yüklenemedi.';
      setFeedback({ type: 'err', text: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // JSON ekleme açıldığında kopya kontrolü için havuz parmak izlerini çek
  useEffect(() => {
    if (!showJsonImporter || poolFingerprints) return;
    let cancelled = false;
    fetchPoolFingerprintMap()
      .then((map) => {
        if (!cancelled) setPoolFingerprints(map);
      })
      .catch((err) => {
        if (!cancelled)
          setFeedback({
            type: 'err',
            text: `Kopya kontrolü için havuz okunamadı: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [showJsonImporter, poolFingerprints]);

  // Yapıştırılan JSON'u canlı ayrıştır ve kurallara göre doğrula
  const poolImport = useMemo(() => {
    if (!rawPoolJson.trim()) return { results: [], parseError: null };
    try {
      const parsed = JSON.parse(cleanJsonText(rawPoolJson));
      const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      return {
        results: validateAgentQuestions(list, poolFingerprints ?? new Map()),
        parseError: list.length === 0 ? 'JSON dizisi boş.' : null,
      };
    } catch (err) {
      return {
        results: [],
        parseError: `JSON ayrıştırma hatası: ${
          err instanceof Error ? err.message : 'geçersiz format'
        }`,
      };
    }
  }, [rawPoolJson, poolFingerprints]);

  const poolImportReady = poolImport.results.filter(
    (r) => r.isValid && !r.existingPoolId
  );

  // Havuzdaki benzersiz sınıf ve dersler
  const availableGrades = useMemo(() => {
    const set = new Set<number>();
    pool.forEach((q) => {
      if (typeof q.grade === 'number') set.add(q.grade);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [pool]);

  const availableSubjects = useMemo(() => {
    const set = new Set<string>();
    pool.forEach((q) => {
      if (q.subject) set.add(q.subject);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [pool]);

  const filteredPool = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return pool.filter((q) => {
      if (gradeFilter !== 'ALL' && String(q.grade ?? '') !== gradeFilter) {
        return false;
      }
      if (subjectFilter !== 'ALL' && q.subject !== subjectFilter) {
        return false;
      }
      if (term) {
        const hay =
          `${q.outcome_code} ${q.outcome_title} ${q.question_text ?? ''} ${q.unit ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [pool, gradeFilter, subjectFilter, searchTerm]);

  // Öğretmen adları ve soru bazlı değerlendirmeler
  const profileNameMap = useMemo(() => {
    const map = new Map<string, string>();
    profiles.forEach((p) => map.set(p.id, p.full_name));
    return map;
  }, [profiles]);

  const reviewsByQuestion = useMemo(() => {
    const map = new Map<string, AdminQuestionReviewRow[]>();
    reviews.forEach((r) => {
      const list = map.get(r.question_id) ?? [];
      list.push(r);
      map.set(r.question_id, list);
    });
    return map;
  }, [reviews]);

  // =========================================================================
  // AKSİYONLAR
  // =========================================================================

  const handleTabChange = (nextTab: AdminTab) => {
    setHoveredQuestion(null);
    setActiveTab(nextTab);
  };

  const handleOpenQuestionFromReview = (questionId: string) => {
    const found = pool.find((q) => q.id === questionId);
    if (!found) {
      setFeedback({
        type: 'err',
        text: `Soru havuzda bulunamadı (${questionId}).`,
      });
      return;
    }
    setActiveTab('POOL');
    setHoveredQuestion(null);
    setEditingQuestion(found);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleImportToPool = async () => {
    if (!rawPoolJson.trim() || !poolFingerprints) return;
    setImportingPool(true);
    setFeedback(null);

    try {
      if (poolImport.parseError) throw new Error(poolImport.parseError);
      if (poolImportReady.length === 0) {
        throw new Error(
          'Eklenecek soru yok: tüm sorular ya kurallara uymuyor ya da havuzda zaten var.'
        );
      }

      const skippedErrors = poolImport.results.filter((r) => !r.isValid);
      const skippedExisting = poolImport.results.filter(
        (r) => r.isValid && r.existingPoolId
      );

      const addedCount = await importQuestionsToPool(
        poolImportReady.map((r) => r.question),
        currentUserId
      );

      const notes: string[] = [];
      if (skippedErrors.length > 0)
        notes.push(
          `kurallara uymadığı için atlanan ${skippedErrors.length} soru: ${skippedErrors
            .map((r) => r.label)
            .join(', ')}`
        );
      if (skippedExisting.length > 0)
        notes.push(`havuzda zaten olan ${skippedExisting.length} soru atlandı`);

      setRawPoolJson('');
      setShowJsonImporter(false);
      setPoolFingerprints(null);
      setFeedback({
        type: notes.length > 0 ? 'err' : 'ok',
        text:
          `${addedCount} soru Merkezi Soru Havuzuna eklendi.` +
          (notes.length > 0 ? ` Not: ${notes.join('; ')}.` : ''),
      });
      await loadAllData();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'JSON havuza aktarılamadı.';
      setFeedback({ type: 'err', text: msg });
    } finally {
      setImportingPool(false);
    }
  };

  const handleSaveQuestionEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuestion) return;

    setSavingEdit(true);
    setFeedback(null);
    try {
      const updated = await updatePoolQuestion(
        editingQuestion.id,
        editingQuestion
      );
      setPool((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item))
      );
      setEditingQuestion(null);
      setFeedback({ type: 'ok', text: 'Soru havuzda güncellendi.' });
      await onExamsChanged();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Soru güncellenemedi.';
      setFeedback({ type: 'err', text: msg });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    if (
      !window.confirm('Bu soruyu havuzdan kalıcı olarak silmek istiyor musun?')
    ) {
      return;
    }
    try {
      setHoveredQuestion(null);
      await deletePoolQuestion(id);
      setPool((prev) => prev.filter((q) => q.id !== id));
      setFeedback({ type: 'ok', text: 'Soru havuzdan silindi.' });
      await onExamsChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Soru silinemedi.';
      setFeedback({ type: 'err', text: msg });
    }
  };

  const handleRoleChange = async (userId: string, nextRole: UserRole) => {
    try {
      await updateUserRole(userId, nextRole);
      setProfiles((prev) =>
        prev.map((p) => (p.id === userId ? { ...p, role: nextRole } : p))
      );
      setFeedback({ type: 'ok', text: 'Kullanıcı rolü güncellendi.' });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Rol güncellenemedi.';
      setFeedback({ type: 'err', text: msg });
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-8 text-center text-sm font-bold text-slate-500">
        Admin yönetim paneli yükleniyor...
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 md:p-8 space-y-6">
      {/* ÜST BAŞLIK VE METRİKLER */}
      <header className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-7 rounded-2xl shadow-lg border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <span className="inline-block px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-200 text-xs font-bold uppercase tracking-wider">
            Sistem Yönetim Merkezi
          </span>
          <h1 className="text-2xl font-extrabold mt-2">
            Admin Paneli — Havuz, İnceleme & Yetkiler
          </h1>
          <p className="text-sm text-slate-300 mt-1">
            Merkezi soru havuzunu düzenle, öğretmen incelemelerini takip et ve
            kullanıcı rollerini yönet.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 shrink-0">
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 text-center">
            <span className="text-[11px] text-slate-400 font-semibold block">
              Havuz Sorusu
            </span>
            <strong className="text-2xl font-black text-white">
              {pool.length}
            </strong>
          </div>
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 text-center">
            <span className="text-[11px] text-slate-400 font-semibold block">
              İnceleme Kaydı
            </span>
            <strong className="text-2xl font-black text-indigo-300">
              {reviews.length}
            </strong>
          </div>
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 text-center">
            <span className="text-[11px] text-slate-400 font-semibold block">
              Kayıtlı Üye
            </span>
            <strong className="text-2xl font-black text-emerald-300">
              {profiles.length}
            </strong>
          </div>
        </div>
      </header>

      {/* BİLDİRİM ŞERİDİ */}
      {feedback && (
        <div
          className={`p-4 rounded-xl border text-xs font-bold flex items-center justify-between ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="underline cursor-pointer"
          >
            Kapat
          </button>
        </div>
      )}

      {/* ALT SEKME ÇUBUĞU */}
      <div className="flex flex-wrap gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-xs">
        <button
          type="button"
          onClick={() => handleTabChange('POOL')}
          className={`flex-1 min-w-[180px] py-3 px-4 rounded-xl text-xs sm:text-sm font-bold cursor-pointer transition-all ${
            activeTab === 'POOL'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          1. Merkezi Soru Havuzu ({pool.length})
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('USERS')}
          className={`flex-1 min-w-[180px] py-3 px-4 rounded-xl text-xs sm:text-sm font-bold cursor-pointer transition-all ${
            activeTab === 'USERS'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          2. Kullanıcı & Rol Yönetimi ({profiles.length})
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('REVIEWS')}
          className={`flex-1 min-w-[180px] py-3 px-4 rounded-xl text-xs sm:text-sm font-bold cursor-pointer transition-all ${
            activeTab === 'REVIEWS'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          3. İnceleme Takibi ({reviews.length})
        </button>
      </div>

      {/* =================================================================== */}
      {/* MODÜL 1: MERKEZİ SORU HAVUZU                                        */}
      {/* =================================================================== */}
      {activeTab === 'POOL' && (
        <section className="space-y-5">
          {/* FİLTRE VE HAVUZA JSON EKLEME ÇUBUĞU */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 flex-1">
                <input
                  type="text"
                  placeholder="Kazanım kodu, ünite veya soru metni ara..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="flex-1 min-w-[220px] rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none"
                />
                <select
                  value={gradeFilter}
                  onChange={(e) => setGradeFilter(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                >
                  <option value="ALL">Tüm Sınıflar</option>
                  {availableGrades.map((g) => (
                    <option key={g} value={String(g)}>
                      {g}. Sınıf
                    </option>
                  ))}
                </select>
                <select
                  value={subjectFilter}
                  onChange={(e) => setSubjectFilter(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                >
                  <option value="ALL">Tüm Dersler</option>
                  {availableSubjects.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => setShowJsonImporter((prev) => !prev)}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer transition-colors"
              >
                {showJsonImporter ? 'Kapat' : '+ Havuza Ajan JSON Ekle'}
              </button>
            </div>

            {showJsonImporter && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <p className="text-xs font-bold text-slate-700">
                  Soru ajanından aldığın JSON dizisini doğrudan havuza ekle
                  (sınav açmadan havuzda birikir):
                </p>
                <textarea
                  rows={6}
                  value={rawPoolJson}
                  onChange={(e) => setRawPoolJson(e.target.value)}
                  placeholder='[{"id": "MAT5-U1-001", "sinif": 5, ...}]'
                  className="w-full rounded-xl border border-slate-300 p-3 font-mono text-xs bg-white focus:border-indigo-500 focus:outline-none"
                />
                {poolImport.parseError && (
                  <p className="text-xs font-semibold text-rose-600">
                    {poolImport.parseError}
                  </p>
                )}
                <ImportValidationReport
                  results={poolImport.results}
                  mode="pool"
                  checkingPool={!poolFingerprints}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={
                      importingPool ||
                      !poolFingerprints ||
                      poolImportReady.length === 0
                    }
                    onClick={handleImportToPool}
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
                  >
                    {importingPool
                      ? 'Ekleniyor...'
                      : `Geçerli ${poolImportReady.length} Soruyu Havuza Kaydet`}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* CANLI DÜZENLEME FORMU (BİR SORU SEÇİLDİYSE) */}
          {editingQuestion && (
            <form
              onSubmit={handleSaveQuestionEdit}
              className="bg-white p-6 rounded-2xl border-2 border-indigo-400 shadow-md space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-extrabold text-indigo-900">
                  Soru Düzenleyici ({editingQuestion.id})
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingQuestion(null)}
                  className="text-xs font-bold text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  İptal ✕
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                    Kazanım Kodu
                  </label>
                  <input
                    type="text"
                    value={editingQuestion.outcome_code}
                    onChange={(e) =>
                      setEditingQuestion({
                        ...editingQuestion,
                        outcome_code: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono font-bold"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                    Kazanım Açıklaması
                  </label>
                  <input
                    type="text"
                    value={editingQuestion.outcome_title}
                    onChange={(e) =>
                      setEditingQuestion({
                        ...editingQuestion,
                        outcome_title: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                    Doğru Şık
                  </label>
                  <select
                    value={editingQuestion.correct_option}
                    onChange={(e) =>
                      setEditingQuestion({
                        ...editingQuestion,
                        correct_option: e.target.value as ValidOption,
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold"
                  >
                    {['A', 'B', 'C', 'D', 'E'].map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                  Soru Metni
                </label>
                <textarea
                  rows={3}
                  value={editingQuestion.question_text ?? ''}
                  onChange={(e) =>
                    setEditingQuestion({
                      ...editingQuestion,
                      question_text: e.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 p-3 text-xs"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                    SVG Görsel Kodu (Canlı Önizleme Sağda)
                  </label>
                  <textarea
                    rows={5}
                    value={editingQuestion.svg_code ?? ''}
                    onChange={(e) =>
                      setEditingQuestion({
                        ...editingQuestion,
                        svg_code: e.target.value || null,
                      })
                    }
                    placeholder="<svg viewBox='0 0 400 250' ...>...</svg>"
                    className="w-full rounded-lg border border-slate-300 p-3 font-mono text-[11px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                    Canlı SVG Önizleme
                  </label>
                  {editingQuestion.svg_code ? (
                    <SvgPreview svgCode={editingQuestion.svg_code} />
                  ) : (
                    <div className="h-[115px] rounded-xl border border-dashed border-slate-300 flex items-center justify-center text-xs text-slate-400">
                      Görsel kodu girilmedi
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">
                  Adım Adım Çözüm
                </label>
                <textarea
                  rows={2}
                  value={editingQuestion.solution ?? ''}
                  onChange={(e) =>
                    setEditingQuestion({
                      ...editingQuestion,
                      solution: e.target.value || null,
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 p-3 text-xs"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {OPTION_KEYS.filter(
                  (k) => k !== editingQuestion.correct_option
                ).map((k) => (
                  <div key={k}>
                    <label className="block text-[11px] font-bold text-rose-600 uppercase mb-1">
                      {k} Şıkkı Çeldirici / Kavram Yanılgısı
                    </label>
                    <input
                      type="text"
                      value={editingQuestion.distractor_analysis?.[k] ?? ''}
                      onChange={(e) =>
                        setEditingQuestion({
                          ...editingQuestion,
                          distractor_analysis: {
                            ...(editingQuestion.distractor_analysis ?? {}),
                            [k]: e.target.value,
                          },
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingQuestion(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                >
                  {savingEdit ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
                </button>
              </div>
            </form>
          )}

          {/* HAVUZ LİSTESİ (FARE İLE ÜSTÜNE GELİNCE HAYALET ÖĞRENCİ ÖNİZLEMESİ AÇILIR) */}
          <div className="space-y-3">
            {filteredPool.map((q) => {
              const qReviews = reviewsByQuestion.get(q.id) ?? [];
              const approves = qReviews.filter(
                (r) => r.decision === 'APPROVE'
              ).length;
              const rejects = qReviews.filter(
                (r) => r.decision === 'REJECT'
              ).length;
              const reviewStatus =
                approves >= 2 && approves > rejects
                  ? 'APPROVED'
                  : rejects >= 2 && rejects >= approves
                    ? 'REJECTED'
                    : 'PENDING';
              const reviewNotes = qReviews.filter(
                (r) => r.note && r.note.trim().length > 0
              );

              return (
                <div
                  key={q.id}
                  onMouseEnter={() => setHoveredQuestion(q)}
                  onMouseLeave={() => setHoveredQuestion(null)}
                  className="bg-white p-5 rounded-2xl border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all shadow-xs space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100 font-mono text-xs font-bold">
                        {q.outcome_code}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-700 text-xs font-bold">
                        {q.grade ? `${q.grade}. Sınıf • ` : ''}
                        {q.subject}
                      </span>
                      {q.difficulty && (
                        <span className="px-2.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
                          {q.difficulty}
                        </span>
                      )}
                      <span className="px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
                        Doğru: {q.correct_option}
                      </span>
                      {q.svg_code && (
                        <span className="px-2.5 py-0.5 rounded-md bg-sky-50 text-sky-700 border border-sky-200 text-xs font-semibold">
                          SVG Görselli
                        </span>
                      )}
                      <span
                        className={`px-2.5 py-0.5 rounded-md border text-xs font-bold ${
                          reviewStatus === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                            : reviewStatus === 'REJECTED'
                              ? 'bg-rose-100 text-rose-800 border-rose-300'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {reviewStatus === 'APPROVED'
                          ? '✓ Onaylı'
                          : reviewStatus === 'REJECTED'
                            ? '✕ Reddedildi'
                            : '⏳ Bekliyor'}{' '}
                        ({approves} Olur / {rejects} Olmaz)
                      </span>
                    </div>

                    <div
                      className="flex items-center gap-2"
                      onMouseEnter={() => setHoveredQuestion(null)}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setHoveredQuestion(null);
                          setEditingQuestion(q);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold cursor-pointer"
                      >
                        Düzenle
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteQuestion(q.id)}
                        className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer"
                      >
                        Sil
                      </button>
                    </div>
                  </div>

                  <p className="text-xs font-semibold text-slate-500">
                    {q.outcome_title}
                  </p>
                  <p className="text-sm font-medium text-slate-900 line-clamp-2">
                    {q.question_text}
                  </p>

                  {reviewNotes.length > 0 && (
                    <div className="pt-2 border-t border-slate-100 space-y-1.5">
                      {reviewNotes.map((n) => (
                        <div
                          key={n.id}
                          className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-start justify-between gap-2"
                        >
                          <div>
                            <span className="font-extrabold text-slate-800">
                              {profileNameMap.get(n.reviewer_id) ?? 'Öğretmen'}:
                            </span>{' '}
                            <span className="text-slate-700">{n.note}</span>
                          </div>
                          <span
                            className={`shrink-0 font-bold text-[10px] px-2 py-0.5 rounded ${
                              n.decision === 'APPROVE'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {n.decision === 'APPROVE' ? 'Olur' : 'Olmaz'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {filteredPool.length === 0 && (
              <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-sm text-slate-500">
                Filtreye uyan havuz sorusu bulunamadı.
              </div>
            )}
          </div>

          {/* HAYALET ÖĞRENCİ ÖNİZLEME PENCERESİ */}
          {hoveredQuestion && !editingQuestion && (
            <QuestionHoverPreview question={hoveredQuestion} />
          )}
        </section>
      )}

      {/* =================================================================== */}
      {/* MODÜL 2: KULLANICI VE ROL YÖNETİMİ                                  */}
      {/* =================================================================== */}
      {activeTab === 'USERS' && (
        <section className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">
              Kayıtlı Kullanıcılar ve Rol Yetkilendirme
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Öğretmen başvurularını onaylayabilir veya yetki seviyelerini
              anında değiştirebilirsin.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700">
                  <th className="p-3 font-bold">Ad Soyad</th>
                  <th className="p-3 font-bold">Okul</th>
                  <th className="p-3 font-bold">Şube</th>
                  <th className="p-3 font-bold">Rol</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {profiles.map((u) => {
                  const isSelf = u.id === currentUserId;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-900">
                        {u.full_name}{' '}
                        {isSelf && (
                          <span className="ml-1 text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">
                            Sen
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-slate-600">
                        {u.school_name || '—'}
                      </td>
                      <td className="p-3 text-slate-600">
                        {u.classroom || '—'}
                      </td>
                      <td className="p-3">
                        <select
                          disabled={isSelf}
                          value={u.role}
                          onChange={(e) =>
                            handleRoleChange(u.id, e.target.value as UserRole)
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-bold text-slate-800 disabled:opacity-50 cursor-pointer"
                        >
                          <option value="student">Öğrenci</option>
                          <option value="teacher">Öğretmen</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* MODÜL 3: ÖĞRETMEN İNCELEME TAKİBİ                                   */}
      {/* =================================================================== */}
      {activeTab === 'REVIEWS' && (
        <section>
          <ReviewTrackingTab onSelectQuestion={handleOpenQuestionFromReview} />
        </section>
      )}
    </div>
  );
};