import { useCallback, useEffect, useState } from 'react';
import { AdminPanel } from './components/AdminPanel';
import { AuthScreen } from './components/AuthScreen';
import { ExamAnalyticsDashboard } from './components/ExamAnalyticsDashboard';
import { ExamImportView } from './components/ExamImportView';
import { SmartboardModeView } from './components/SmartboardModeView';
import { StudentExamView } from './components/StudentExamView';
import { StudentLobby } from './components/StudentLobby';
import { StudentPostExamReport } from './components/StudentPostExamReport';
import { TeacherLobby } from './components/TeacherLobby';
import { useAuth } from './contexts/AuthContext';
import rawExamData from './data/mockExamData.json';
import { isSupabaseConfigured } from './lib/supabase';
import {
  fetchAllExams,
  fetchExamDataset,
  submitStudentExam,
} from './services/examService';
import type { SmartboardPayload } from './services/smartboardService';
import type {
  Exam,
  ExamDataset,
  ParticipationType,
  Student,
  StudentAnswer,
  StudentCompletedAttempt,
} from './types/exam';

type ViewMode =
  | 'TEACHER_LOBBY'
  | 'ANALYTICS'
  | 'STUDENT_LOBBY'
  | 'STUDENT_EXAM'
  | 'SAVED_REPORT'
  | 'IMPORT'
  | 'ADMIN';

function App() {
  const { user, profile, authLoading, signOut, refreshProfile } = useAuth();

  const [exams, setExams] = useState<Exam[]>([]);
  const [activeExamId, setActiveExamId] = useState<string>('exam-2026-02');
  const [dataset, setDataset] = useState<ExamDataset | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [isLiveDb, setIsLiveDb] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<ViewMode>('TEACHER_LOBBY');

  // Güvenli Akıllı Tahta Modu (yalnızca bellekte tutulur, çıkışta/yenilemede sıfırlanır)
  const [smartboardPayload, setSmartboardPayload] =
    useState<SmartboardPayload | null>(null);

  // Öğretmen Önizleme modu (veritabanına yazmaz, ara giriş ekranını atlar)
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);

  // Öğrenci lobisinden girerken kilitlenen Resmi/Misafir türü
  const [lockedParticipation, setLockedParticipation] = useState<
    ParticipationType | undefined
  >(undefined);

  // Daha önce tamamlanmış sınav karnesini açmak için öğrenci ID'si
  const [savedReportStudentId, setSavedReportStudentId] = useState<
    string | null
  >(null);

  const isAdmin = profile?.role === 'admin';
  const isStaff =
    !isSupabaseConfigured ||
    profile?.role === 'admin' ||
    profile?.role === 'teacher';

  useEffect(() => {
    if (profile?.role === 'student') {
      setViewMode((prev) =>
        prev === 'STUDENT_EXAM' || prev === 'SAVED_REPORT'
          ? prev
          : 'STUDENT_LOBBY'
      );
    } else if (profile?.role === 'admin' || profile?.role === 'teacher') {
      setViewMode((prev) =>
        prev === 'ADMIN' ||
        prev === 'ANALYTICS' ||
        prev === 'STUDENT_LOBBY' ||
        prev === 'STUDENT_EXAM' ||
        prev === 'IMPORT'
          ? prev
          : 'TEACHER_LOBBY'
      );
    }
  }, [profile?.role]);

  const loadExamsAndDataset = useCallback(async (preferredExamId?: string) => {
    setLoading(true);
    setDbError(null);

    if (!isSupabaseConfigured) {
      const mock = rawExamData as unknown as ExamDataset;
      setExams([mock.exam]);
      setActiveExamId(mock.exam.id);
      setDataset(mock);
      setIsLiveDb(false);
      setLoading(false);
      return;
    }

    try {
      const examList = await fetchAllExams();
      setExams(examList);
      setIsLiveDb(true);

      if (examList.length === 0) {
        setDataset(null);
        setLoading(false);
        return;
      }

      const targetId =
        preferredExamId && examList.some((e) => e.id === preferredExamId)
          ? preferredExamId
          : examList[0].id;

      setActiveExamId(targetId);
      const liveData = await fetchExamDataset(targetId);
      setDataset(liveData);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Veritabanı bağlantısı başarısız.';
      setDbError(message);
      const mock = rawExamData as unknown as ExamDataset;
      setExams([mock.exam]);
      setDataset(mock);
      setIsLiveDb(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured && !user) return;
    loadExamsAndDataset();
  }, [user, loadExamsAndDataset]);

  const refreshExamListOnly = async () => {
    if (!isLiveDb) return;
    try {
      const refreshed = await fetchAllExams();
      setExams(refreshed);
    } catch {
      // Sessiz geç
    }
  };

  const handleSelectExam = async (examId: string) => {
    setActiveExamId(examId);
    if (!isLiveDb) return;

    setLoading(true);
    setDbError(null);
    try {
      const liveData = await fetchExamDataset(examId);
      setDataset(liveData);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Sınav verileri yüklenemedi.';
      setDbError(message);
    } finally {
      setLoading(false);
    }
  };

  // Öğretmen lobisinden Analiz veya Kayıtsız Direkt Önizleme açma
  const handleTeacherOpenAnalytics = async (examId: string) => {
    setIsPreviewMode(false);
    await handleSelectExam(examId);
    setViewMode('ANALYTICS');
  };

  const handleTeacherPreviewExam = async (examId: string) => {
    setIsPreviewMode(true);
    setLockedParticipation(undefined);
    await handleSelectExam(examId);
    setViewMode('STUDENT_EXAM');
  };

  // Öğrenci lobisinden gerçek sınava veya geçmiş karneye giriş
  const handleStudentStartExam = async (
    exam: Exam,
    participationType: ParticipationType
  ) => {
    setIsPreviewMode(false);
    setLockedParticipation(participationType);
    setSavedReportStudentId(null);
    await handleSelectExam(exam.id);
    setViewMode('STUDENT_EXAM');
  };

  const handleStudentViewReport = async (
    exam: Exam,
    attempt: StudentCompletedAttempt
  ) => {
    setIsPreviewMode(false);
    setSavedReportStudentId(attempt.student_id);
    await handleSelectExam(exam.id);
    setViewMode('SAVED_REPORT');
  };

  const handleBackToStudentLobby = async () => {
    setIsPreviewMode(false);
    setLockedParticipation(undefined);
    setSavedReportStudentId(null);
    setViewMode('STUDENT_LOBBY');
    await refreshExamListOnly();
  };

  const handleBackToTeacherLobby = async () => {
    setIsPreviewMode(false);
    setLockedParticipation(undefined);
    setViewMode('TEACHER_LOBBY');
    await refreshExamListOnly();
  };

  const handleExamComplete = async (
    newStudent: Student,
    newAnswers: StudentAnswer[]
  ) => {
    // Önizleme modunda kesinlikle veritabanına ve canlı veriye yazma
    if (isPreviewMode) return;

    setDataset((prev) =>
      prev
        ? {
            ...prev,
            students: [...prev.students, newStudent],
            answers: [...prev.answers, ...newAnswers],
          }
        : prev
    );

    if (isLiveDb) {
      try {
        await submitStudentExam(newStudent, newAnswers, user?.id);
        await refreshExamListOnly();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Cevaplar kaydedilemedi.';
        setDbError(`Kayıt hatası: ${message}`);
      }
    }
  };

  const handleExamCreated = async (newExamId: string) => {
    setIsPreviewMode(false);
    await loadExamsAndDataset(newExamId);
    setViewMode('TEACHER_LOBBY');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-100/70 flex items-center justify-center p-6">
        <div className="bg-white px-8 py-6 rounded-2xl border border-slate-200 shadow-xs text-sm font-bold text-slate-700">
          Oturum kontrol ediliyor...
        </div>
      </div>
    );
  }

  // Güvenli Akıllı Tahta Modu (oturum gerektirmez, salt okunur)
  if (smartboardPayload) {
    return (
      <SmartboardModeView
        payload={smartboardPayload}
        onClose={() => setSmartboardPayload(null)}
      />
    );
  }

  if (isSupabaseConfigured && !user) {
    return (
      <AuthScreen
        onSmartboardEnter={(payload) => setSmartboardPayload(payload)}
      />
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100/70 flex items-center justify-center p-6">
        <div className="bg-white px-8 py-6 rounded-2xl border border-slate-200 shadow-xs text-center space-y-2">
          <p className="text-sm font-extrabold text-slate-900">
            Veriler yükleniyor...
          </p>
          <p className="text-xs text-slate-500">
            Supabase veritabanı ile bağlantı kuruluyor.
          </p>
        </div>
      </div>
    );
  }

  const roleBadgeLabel =
    profile?.role === 'admin'
      ? 'Admin'
      : profile?.role === 'teacher'
        ? 'Öğretmen'
        : 'Öğrenci';

  const savedStudent =
    viewMode === 'SAVED_REPORT' && dataset && savedReportStudentId
      ? dataset.students.find((s) => s.id === savedReportStudentId) ?? null
      : null;

  const savedAnswers =
    viewMode === 'SAVED_REPORT' && dataset && savedReportStudentId
      ? dataset.answers.filter((a) => a.student_id === savedReportStudentId)
      : [];

  return (
    <div className="min-h-screen bg-slate-100/70">
      {/* SADELEŞMİŞ SAAS ÜST GEZİNTİ ÇUBUĞU */}
      <nav className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200 px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() =>
              isStaff ? handleBackToTeacherLobby() : handleBackToStudentLobby()
            }
            className="flex items-center gap-2.5 cursor-pointer"
          >
            <span className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-black text-sm">
              A
            </span>
            <span className="font-extrabold text-slate-900 tracking-tight">
              Deneme Analiz
            </span>
          </button>

          <div className="flex flex-wrap items-center gap-3">
            {isStaff ? (
              <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={handleBackToTeacherLobby}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    viewMode === 'TEACHER_LOBBY' ||
                    viewMode === 'ANALYTICS' ||
                    viewMode === 'IMPORT' ||
                    (viewMode === 'STUDENT_EXAM' && isPreviewMode)
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Öğretmen Lobisi
                </button>

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsPreviewMode(false);
                      setViewMode('ADMIN');
                    }}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      viewMode === 'ADMIN'
                        ? 'bg-slate-900 text-amber-300 shadow-xs'
                        : 'text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    Admin Paneli
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleBackToStudentLobby}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    viewMode === 'STUDENT_LOBBY' ||
                    viewMode === 'SAVED_REPORT' ||
                    (viewMode === 'STUDENT_EXAM' && !isPreviewMode)
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Öğrenci Gözüyle Gör
                </button>
              </div>
            ) : (
              viewMode !== 'STUDENT_LOBBY' && (
                <button
                  type="button"
                  onClick={handleBackToStudentLobby}
                  className="px-3.5 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-bold cursor-pointer hover:bg-indigo-100"
                >
                  ← Lobim
                </button>
              )
            )}

            {profile && (
              <div className="flex items-center gap-2.5 pl-2 border-l border-slate-200">
                <div className="text-right">
                  <p className="text-xs font-bold text-slate-900 leading-tight">
                    {profile.full_name}
                  </p>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-600">
                    {roleBadgeLabel}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={signOut}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition-colors cursor-pointer"
                >
                  Çıkış
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {dbError && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center justify-between gap-3">
            <span>Supabase Uyarı: {dbError}</span>
            <button
              type="button"
              onClick={() => loadExamsAndDataset(activeExamId)}
              className="px-3 py-1 rounded-lg bg-rose-600 text-white font-bold cursor-pointer"
            >
              Tekrar Dene
            </button>
          </div>
        </div>
      )}

      {/* EKRAN YÖNLENDİRME */}
      {isAdmin && viewMode === 'ADMIN' ? (
        <AdminPanel
          currentUserId={user?.id}
          onExamsChanged={(focusId) =>
            loadExamsAndDataset(focusId ?? activeExamId)
          }
        />
      ) : isStaff && viewMode === 'IMPORT' ? (
        <ExamImportView
          isLiveDb={isLiveDb}
          onExamCreated={handleExamCreated}
          onCancel={handleBackToTeacherLobby}
        />
      ) : isStaff && viewMode === 'TEACHER_LOBBY' && user ? (
        <TeacherLobby
          teacherId={user.id}
          teacherName={profile?.full_name ?? 'Öğretmen'}
          isAdmin={isAdmin}
          exams={exams}
          onExamsChanged={(focusId) =>
            loadExamsAndDataset(focusId ?? activeExamId)
          }
          onOpenAnalytics={handleTeacherOpenAnalytics}
          onPreviewExam={handleTeacherPreviewExam}
          onOpenJsonImport={() => setViewMode('IMPORT')}
          onOpenSmartboardLocal={(payload) => setSmartboardPayload(payload)}
        />
      ) : isStaff && viewMode === 'ANALYTICS' && dataset ? (
        <div>
          <div className="max-w-7xl mx-auto px-6 md:px-8 pt-6 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleBackToTeacherLobby}
              className="px-4 py-2 rounded-xl bg-white border border-slate-200 shadow-xs text-xs font-bold text-slate-700 hover:text-indigo-700 hover:border-indigo-300 cursor-pointer"
            >
              ← Öğretmen Lobisine Dön
            </button>
            {dataset.exam.exam_code && (
              <span className="font-mono text-xs font-extrabold px-3 py-1.5 rounded-xl bg-slate-900 text-indigo-200">
                Sınav Kodu: {dataset.exam.exam_code}
              </span>
            )}
          </div>
          <ExamAnalyticsDashboard key={dataset.exam.id} dataset={dataset} />
        </div>
      ) : viewMode === 'STUDENT_LOBBY' && user ? (
        <StudentLobby
          studentId={user.id}
          profile={profile}
          exams={exams}
          onStartExam={handleStudentStartExam}
          onViewCompletedReport={handleStudentViewReport}
          onProfileUpdated={refreshProfile}
        />
      ) : viewMode === 'SAVED_REPORT' && dataset && savedStudent ? (
        <div>
          <div className="max-w-5xl mx-auto px-6 md:px-8 pt-6">
            <button
              type="button"
              onClick={handleBackToStudentLobby}
              className="px-4 py-2 rounded-xl bg-white border border-slate-200 shadow-xs text-xs font-bold text-slate-700 hover:text-indigo-700 hover:border-indigo-300 cursor-pointer"
            >
              ← Öğrenci Lobisine Dön
            </button>
          </div>
          <StudentPostExamReport
            dataset={dataset}
            student={savedStudent}
            answers={savedAnswers}
            isStaff={isStaff}
            onRetake={handleBackToStudentLobby}
            onGoToDashboard={() => setViewMode('ANALYTICS')}
          />
        </div>
      ) : dataset ? (
        <StudentExamView
          key={`${dataset.exam.id}-${isPreviewMode ? 'preview' : (lockedParticipation ?? 'free')}`}
          exam={dataset.exam}
          questions={dataset.questions}
          dataset={dataset}
          profile={profile}
          isStaff={isStaff}
          isPreviewMode={isPreviewMode}
          lockedParticipationType={lockedParticipation}
          onComplete={handleExamComplete}
          onGoToDashboard={() => {
            setIsPreviewMode(false);
            setViewMode(isStaff ? 'ANALYTICS' : 'STUDENT_LOBBY');
          }}
          onBackToLobby={
            user
              ? isStaff && (isPreviewMode || !lockedParticipation)
                ? handleBackToTeacherLobby
                : handleBackToStudentLobby
              : undefined
          }
        />
      ) : (
        <div className="max-w-xl mx-auto p-10 text-center">
          <div className="bg-white p-8 rounded-2xl border border-slate-200 text-sm text-slate-600">
            Henüz tanımlı sınav yok. Öğretmen Lobisi veya Admin Paneli üzerinden
            ilk sınavını oluşturabilirsin.
          </div>
        </div>
      )}
    </div>
  );
}

export default App;