import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createExamFromPoolSelection,
  deleteExam,
  deletePoolQuestion,
  fetchAllProfiles,
  fetchQuestionPool,
  importQuestionsToPool,
  updateExamSettings,
  updatePoolQuestion,
  updateUserRole,
} from '../services/adminService';
import { fetchAllExams } from '../services/examService';
import type { UserProfile, UserRole } from '../types/auth';
import type {
  AgentQuestionInput,
  Exam,
  ExamScope,
  ExamStatus,
  PoolQuestion,
  ValidOption,
} from '../types/exam';
import { QuestionHoverPreview } from './QuestionHoverPreview';
import { SvgPreview } from './SvgPreview';

interface AdminPanelProps {
  currentUserId?: string;
  onExamsChanged: (focusExamId?: string) => Promise<void>;
}

type AdminTab = 'POOL' | 'EXAMS' | 'USERS';

const OPTION_KEYS: ValidOption[] = ['A', 'B', 'C', 'D'];

function cleanJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  currentUserId,
  onExamsChanged,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('POOL');
  const [pool, setPool] = useState<PoolQuestion[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
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

  // CANLI SORU DÜZENLEME VE HOVER ÖNİZLEME STATE'LERİ
  const [editingQuestion, setEditingQuestion] = useState<PoolQuestion | null>(
    null
  );
  const [hoveredQuestion, setHoveredQuestion] = useState<PoolQuestion | null>(
    null
  );
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  // SINAV SİHİRBAZI STATE'LERİ
  const today = new Date().toISOString().slice(0, 10);
  const [wizTitle, setWizTitle] = useState<string>('');
  const [wizDate, setWizDate] = useState<string>(today);
  const [wizScope, setWizScope] = useState<ExamScope>('NATIONAL');
  const [wizStatus, setWizStatus] = useState<ExamStatus>('PUBLISHED');
  const [wizPenalty, setWizPenalty] = useState<number>(0.333);
  const [wizDuration, setWizDuration] = useState<number>(40);
  const [wizAllowGuests, setWizAllowGuests] = useState<boolean>(true);
  const [wizShowSolutions, setWizShowSolutions] = useState<boolean>(true);
  const [wizSubjectFilter, setWizSubjectFilter] = useState<string>('ALL');
  const [outcomeQuotas, setOutcomeQuotas] = useState<Record<string, number>>(
    {}
  );
  const [creatingExam, setCreatingExam] = useState<boolean>(false);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [poolData, examData, profileData] = await Promise.all([
        fetchQuestionPool(),
        fetchAllExams(),
        fetchAllProfiles(),
      ]);
      setPool(poolData);
      setExams(examData);
      setProfiles(profileData);
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

  // Sınav Sihirbazı için kazanım grupları
  const outcomeGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        outcome_code: string;
        outcome_title: string;
        subject: string;
        grade: number | null;
        questions: PoolQuestion[];
      }
    >();

    for (const q of pool) {
      if (wizSubjectFilter !== 'ALL' && q.subject !== wizSubjectFilter) {
        continue;
      }
      let grp = map.get(q.outcome_code);
      if (!grp) {
        grp = {
          outcome_code: q.outcome_code,
          outcome_title: q.outcome_title,
          subject: q.subject,
          grade: q.grade,
          questions: [],
        };
        map.set(q.outcome_code, grp);
      }
      grp.questions.push(q);
    }

    return Array.from(map.values()).sort((a, b) =>
      a.outcome_code.localeCompare(b.outcome_code, 'tr')
    );
  }, [pool, wizSubjectFilter]);

  const totalWizardQuestions = useMemo(
    () =>
      Object.values(outcomeQuotas).reduce(
        (sum, count) => sum + (count > 0 ? count : 0),
        0
      ),
    [outcomeQuotas]
  );

  // =========================================================================
  // AKSİYONLAR
  // =========================================================================

  const handleTabChange = (nextTab: AdminTab) => {
    setHoveredQuestion(null);
    setActiveTab(nextTab);
  };

  const handleImportToPool = async () => {
    if (!rawPoolJson.trim()) return;
    setImportingPool(true);
    setFeedback(null);

    try {
      const parsed = JSON.parse(cleanJsonText(rawPoolJson));
      const list = (
        Array.isArray(parsed) ? parsed : [parsed]
      ) as AgentQuestionInput[];
      if (list.length === 0) throw new Error('JSON dizisi boş.');

      const validQuestions: AgentQuestionInput[] = [];
      const brokenSvgIds: string[] = [];

      list.forEach((item, idx) => {
        const needsSvg = Boolean(item.gorselGerekliMi);
        const hasValidSvg =
          typeof item.svgKodu === 'string' && item.svgKodu.includes('<svg');

        if (needsSvg && !hasValidSvg) {
          brokenSvgIds.push(item.id || `#${idx + 1}`);
        } else {
          validQuestions.push(item);
        }
      });

      if (validQuestions.length === 0) {
        throw new Error(
          `Hiçbir soru eklenmedi. Bozuk SVG nedeniyle atlananlar: ${brokenSvgIds.join(', ')}`
        );
      }

      const addedCount = await importQuestionsToPool(
        validQuestions,
        currentUserId
      );
      setRawPoolJson('');
      setShowJsonImporter(false);
      setFeedback({
        type: brokenSvgIds.length > 0 ? 'err' : 'ok',
        text:
          brokenSvgIds.length > 0
            ? `${addedCount} sağlam soru havuza eklendi. Bozuk SVG nedeniyle eklenmeyenler (${brokenSvgIds.length}): ${brokenSvgIds.join(', ')}`
            : `${addedCount} soru Merkezi Soru Havuzuna başarıyla eklendi.`,
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

  const handleCreateExamFromWizard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wizTitle.trim() || totalWizardQuestions === 0) return;

    setCreatingExam(true);
    setFeedback(null);

    try {
      const selectedIds: string[] = [];

      for (const grp of outcomeGroups) {
        const quota = outcomeQuotas[grp.outcome_code] ?? 0;
        if (quota <= 0) continue;
        const picked = shuffleArray(grp.questions).slice(
          0,
          Math.min(quota, grp.questions.length)
        );
        selectedIds.push(...picked.map((q) => q.id));
      }

      const newExamId = await createExamFromPoolSelection({
        title: wizTitle,
        examDate: wizDate,
        wrongPenaltyRatio: wizPenalty,
        examScope: wizScope,
        allowGuests: wizAllowGuests,
        status: wizStatus,
        showSolutionsAfterFinish: wizShowSolutions,
        durationMinutes: wizDuration,
        questionIds: selectedIds,
        ownerId: currentUserId,
      });

      setWizTitle('');
      setOutcomeQuotas({});
      setFeedback({
        type: 'ok',
        text: `Yeni sınav (${selectedIds.length} soru) havuzdan otomatik oluşturuldu ve sisteme eklendi.`,
      });
      await loadAllData();
      await onExamsChanged(newExamId);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Sınav oluşturulamadı.';
      setFeedback({ type: 'err', text: msg });
    } finally {
      setCreatingExam(false);
    }
  };

  const handleExamToggle = async (
    examId: string,
    updates: Partial<
      Pick<
        Exam,
        'status' | 'allow_guests' | 'show_solutions_after_finish' | 'exam_scope'
      >
    >
  ) => {
    try {
      await updateExamSettings(examId, updates);
      setExams((prev) =>
        prev.map((ex) => (ex.id === examId ? { ...ex, ...updates } : ex))
      );
      await onExamsChanged();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Sınav ayarı güncellenemedi.';
      setFeedback({ type: 'err', text: msg });
    }
  };

  const handleDeleteExam = async (examId: string, title: string) => {
    if (
      !window.confirm(
        `"${title}" sınavını silmek istediğine emin misin? (Sorular havuzda korunur.)`
      )
    ) {
      return;
    }
    try {
      await deleteExam(examId);
      setExams((prev) => prev.filter((e) => e.id !== examId));
      setFeedback({
        type: 'ok',
        text: 'Sınav silindi; soruları Merkezi Havuzda korunmaya devam ediyor.',
      });
      await onExamsChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sınav silinemedi.';
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
            Admin Paneli — Havuz, Sihirbaz & Yetkiler
          </h1>
          <p className="text-sm text-slate-300 mt-1">
            Merkezi soru havuzunu düzenle, kazanım kotalarıyla tek tıkla sınav
            üret ve kullanıcı rollerini yönet.
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
              Tanımlı Sınav
            </span>
            <strong className="text-2xl font-black text-indigo-300">
              {exams.length}
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
          onClick={() => handleTabChange('EXAMS')}
          className={`flex-1 min-w-[180px] py-3 px-4 rounded-xl text-xs sm:text-sm font-bold cursor-pointer transition-all ${
            activeTab === 'EXAMS'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          2. Sınav Sihirbazı & Yayın ({exams.length})
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
          3. Kullanıcı & Rol Yönetimi ({profiles.length})
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
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={importingPool || !rawPoolJson.trim()}
                    onClick={handleImportToPool}
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer"
                  >
                    {importingPool ? 'Ekleniyor...' : 'Soruları Havuza Kaydet'}
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
            {filteredPool.map((q) => (
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
              </div>
            ))}

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
      {/* MODÜL 2: OTOMATİK SINAV SİHİRBAZI VE MEVCUT SINAV KONTROLÜ          */}
      {/* =================================================================== */}
      {activeTab === 'EXAMS' && (
        <section className="space-y-6">
          {/* KAZANIM KOTALI SINAV SİHİRBAZI */}
          <form
            onSubmit={handleCreateExamFromWizard}
            className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-5"
          >
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-lg font-extrabold text-slate-900">
                Otomatik Sınav Sihirbazı (Kazanım Kotalı Derleyici)
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Aşağıdaki kazanımlardan kaçar soru çekileceğini belirle; sistem
                havuzdan soruları otomatik seçip sınavı anında hazırlar.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Sınav Başlığı
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: 8. Sınıf Üslü İfadeler Türkiye Geneli Deneme-1"
                  value={wizTitle}
                  onChange={(e) => setWizTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Sınav Tarihi
                </label>
                <input
                  type="date"
                  value={wizDate}
                  onChange={(e) => setWizDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Kapsam
                </label>
                <select
                  value={wizScope}
                  onChange={(e) => setWizScope(e.target.value as ExamScope)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold"
                >
                  <option value="NATIONAL">Türkiye Geneli</option>
                  <option value="CLASSROOM">Sınıf / Kurum İçi</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Yayın Durumu
                </label>
                <select
                  value={wizStatus}
                  onChange={(e) => setWizStatus(e.target.value as ExamStatus)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold"
                >
                  <option value="PUBLISHED">Yayında</option>
                  <option value="DRAFT">Taslak</option>
                  <option value="CLOSED">Kapalı</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Yanlış Götürme
                </label>
                <select
                  value={wizPenalty}
                  onChange={(e) => setWizPenalty(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold"
                >
                  <option value={0.333}>3Y 1D (LGS)</option>
                  <option value={0.25}>4Y 1D (YKS)</option>
                  <option value={0}>Götürmesiz</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Süre (Dakika)
                </label>
                <input
                  type="number"
                  min={5}
                  max={240}
                  value={wizDuration}
                  onChange={(e) => setWizDuration(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-6 pt-1 text-xs font-semibold text-slate-700">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={wizAllowGuests}
                  onChange={(e) => setWizAllowGuests(e.target.checked)}
                  className="rounded accent-indigo-600"
                />
                Misafir (gölge) öğrenci katılımına izin ver
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={wizShowSolutions}
                  onChange={(e) => setWizShowSolutions(e.target.checked)}
                  className="rounded accent-indigo-600"
                />
                Sınav bitiminde öğrenciye çözümleri göster
              </label>
            </div>

            {/* KAZANIM SEÇİM TABLOSU */}
            <div className="space-y-3 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                  Havuzdaki Kazanımlardan Soru Kotası Seç
                </h3>
                <select
                  value={wizSubjectFilter}
                  onChange={(e) => setWizSubjectFilter(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold"
                >
                  <option value="ALL">Tüm Dersler</option>
                  {availableSubjects.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>

              <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 overflow-hidden">
                {outcomeGroups.map((grp) => {
                  const selected = outcomeQuotas[grp.outcome_code] ?? 0;
                  const maxCount = grp.questions.length;

                  return (
                    <div
                      key={grp.outcome_code}
                      className="p-3.5 bg-slate-50/40 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                            {grp.outcome_code}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-500">
                            {grp.subject} • Havuzda {maxCount} soru var
                          </span>
                        </div>
                        <p className="text-xs font-medium text-slate-800 mt-1 truncate">
                          {grp.outcome_title}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setOutcomeQuotas((prev) => ({
                              ...prev,
                              [grp.outcome_code]: Math.max(0, selected - 1),
                            }))
                          }
                          className="w-8 h-8 rounded-lg border border-slate-300 bg-white font-black text-slate-700 hover:bg-slate-100 cursor-pointer"
                        >
                          -
                        </button>
                        <span className="w-10 text-center text-sm font-black text-slate-900">
                          {selected}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setOutcomeQuotas((prev) => ({
                              ...prev,
                              [grp.outcome_code]: Math.min(
                                maxCount,
                                selected + 1
                              ),
                            }))
                          }
                          className="w-8 h-8 rounded-lg border border-slate-300 bg-white font-black text-slate-700 hover:bg-slate-100 cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={
                  creatingExam || !wizTitle.trim() || totalWizardQuestions === 0
                }
                className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold shadow-md shadow-indigo-600/20 cursor-pointer"
              >
                {creatingExam
                  ? 'Sınav Derleniyor...'
                  : `Sınavı Havuzdan Oluştur (${totalWizardQuestions} Soru)`}
              </button>
            </div>
          </form>

          {/* MEVCUT SINAVLAR YAYIN VE MİSAFİR KONTROL TABLOSU */}
          <div className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h2 className="text-lg font-extrabold text-slate-900">
              Mevcut Sınavlar ve Canlı Yayın Kontrolleri
            </h2>

            <div className="space-y-3">
              {exams.map((ex) => (
                <div
                  key={ex.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold text-slate-900">
                        {ex.title}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold uppercase">
                        {ex.exam_scope === 'CLASSROOM'
                          ? 'Sınıf İçi'
                          : 'Türkiye Geneli'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Tarih: {ex.exam_date} • Süre: {ex.duration_minutes ?? 40}{' '}
                      dk • Götürme: {ex.wrong_penalty_ratio}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 text-xs">
                    <select
                      value={ex.status ?? 'PUBLISHED'}
                      onChange={(e) =>
                        handleExamToggle(ex.id, {
                          status: e.target.value as ExamStatus,
                        })
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-bold text-slate-800 cursor-pointer"
                    >
                      <option value="DRAFT">Taslak</option>
                      <option value="PUBLISHED">Yayında</option>
                      <option value="CLOSED">Kapalı</option>
                    </select>

                    <button
                      type="button"
                      onClick={() =>
                        handleExamToggle(ex.id, {
                          allow_guests: !(ex.allow_guests ?? true),
                        })
                      }
                      className={`px-3 py-1.5 rounded-lg border font-bold cursor-pointer ${
                        ex.allow_guests ?? true
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          : 'bg-slate-100 border-slate-200 text-slate-500'
                      }`}
                    >
                      Misafir: {ex.allow_guests ?? true ? 'Açık' : 'Kapalı'}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleExamToggle(ex.id, {
                          show_solutions_after_finish: !(
                            ex.show_solutions_after_finish ?? true
                          ),
                        })
                      }
                      className={`px-3 py-1.5 rounded-lg border font-bold cursor-pointer ${
                        ex.show_solutions_after_finish ?? true
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                          : 'bg-slate-100 border-slate-200 text-slate-500'
                      }`}
                    >
                      Çözüm:{' '}
                      {ex.show_solutions_after_finish ?? true
                        ? 'Göster'
                        : 'Gizli'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteExam(ex.id, ex.title)}
                      className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold cursor-pointer"
                    >
                      Sil
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* MODÜL 3: KULLANICI VE ROL YÖNETİMİ                                  */}
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
    </div>
  );
};