import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  assignExamToClassroom,
  createClassroom,
  deleteClassroom,
  fetchTeacherClassrooms,
  regenerateClassroomCode,
  removeStudentFromClassroom,
} from '../services/classroomService';
import type { ClassroomWithDetails } from '../types/classroom';
import type { Exam } from '../types/exam';

interface TeacherPanelProps {
  teacherId: string;
  isAdmin: boolean;
  exams: Exam[];
  onExamsChanged: () => Promise<void>;
  onOpenAnalytics: (examId: string) => void;
}

export const TeacherPanel: React.FC<TeacherPanelProps> = ({
  teacherId,
  isAdmin,
  exams,
  onExamsChanged,
  onOpenAnalytics,
}) => {
  const [classrooms, setClassrooms] = useState<ClassroomWithDetails[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  // Yeni sınıf formu
  const [newClassName, setNewClassName] = useState<string>('');
  const [newGrade, setNewGrade] = useState<string>('8');
  const [creating, setCreating] = useState<boolean>(false);

  // Kopyalama bildirimi ve her sınıf için sınav atama seçicisi
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedExamByClass, setSelectedExamByClass] = useState<
    Record<string, string>
  >({});

  const loadClassrooms = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchTeacherClassrooms(teacherId, isAdmin);
      setClassrooms(data);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Sınıflar yüklenemedi.';
      setFeedback({ type: 'err', text: msg });
    } finally {
      setLoading(false);
    }
  }, [teacherId, isAdmin]);

  useEffect(() => {
    loadClassrooms();
  }, [loadClassrooms]);

  const totalStudents = useMemo(
    () => classrooms.reduce((sum, c) => sum + c.members.length, 0),
    [classrooms]
  );

  const assignedExamCount = useMemo(
    () => exams.filter((e) => Boolean(e.classroom_id)).length,
    [exams]
  );

  const handleCreateClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClassName.trim()) return;

    setCreating(true);
    setFeedback(null);
    try {
      await createClassroom({
        teacherId,
        name: newClassName,
        grade: newGrade ? Number(newGrade) : null,
      });
      setNewClassName('');
      setFeedback({
        type: 'ok',
        text: 'Sınıf oluşturuldu ve benzersiz davet kodu üretildi.',
      });
      await loadClassrooms();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Sınıf oluşturulamadı.';
      setFeedback({ type: 'err', text: msg });
    } finally {
      setCreating(false);
    }
  };

  const handleCopyCode = async (classroomId: string, code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(classroomId);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      setFeedback({
        type: 'err',
        text: `Kopyalanamadı, kodu elle paylaşabilirsin: ${code}`,
      });
    }
  };

  const handleRegenerateCode = async (room: ClassroomWithDetails) => {
    if (
      !window.confirm(
        `"${room.name}" sınıfının davet kodunu yenilemek istiyor musun? Eski kod artık geçersiz olur.`
      )
    ) {
      return;
    }
    try {
      const nextCode = await regenerateClassroomCode(room.id, room.name);
      setClassrooms((prev) =>
        prev.map((c) => (c.id === room.id ? { ...c, invite_code: nextCode } : c))
      );
      setFeedback({
        type: 'ok',
        text: `"${room.name}" için yeni davet kodu üretildi: ${nextCode}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Kod yenilenemedi.';
      setFeedback({ type: 'err', text: msg });
    }
  };

  const handleDeleteClassroom = async (room: ClassroomWithDetails) => {
    if (
      !window.confirm(
        `"${room.name}" sınıfını silmek istediğine emin misin? Öğrenci hesapları silinmez, sadece sınıf bağı kalkar.`
      )
    ) {
      return;
    }
    try {
      await deleteClassroom(room.id);
      setClassrooms((prev) => prev.filter((c) => c.id !== room.id));
      setFeedback({ type: 'ok', text: `"${room.name}" sınıfı silindi.` });
      await onExamsChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sınıf silinemedi.';
      setFeedback({ type: 'err', text: msg });
    }
  };

  const handleRemoveStudent = async (
    classroomId: string,
    studentId: string,
    studentName: string
  ) => {
    if (
      !window.confirm(
        `${studentName} adlı öğrenciyi bu sınıftan çıkarmak istiyor musun?`
      )
    ) {
      return;
    }
    try {
      await removeStudentFromClassroom(classroomId, studentId);
      setClassrooms((prev) =>
        prev.map((c) =>
          c.id === classroomId
            ? {
                ...c,
                members: c.members.filter((m) => m.student_id !== studentId),
              }
            : c
        )
      );
      setFeedback({ type: 'ok', text: `${studentName} sınıftan çıkarıldı.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Öğrenci çıkarılamadı.';
      setFeedback({ type: 'err', text: msg });
    }
  };

  const handleAssignExam = async (classroomId: string) => {
    const examId = selectedExamByClass[classroomId];
    if (!examId) return;

    try {
      await assignExamToClassroom(examId, classroomId);
      setSelectedExamByClass((prev) => ({ ...prev, [classroomId]: '' }));
      setFeedback({
        type: 'ok',
        text: 'Sınav sınıfa atandı ve kapsamı "Sınıf İçi" olarak güncellendi.',
      });
      await onExamsChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sınav atanamadı.';
      setFeedback({ type: 'err', text: msg });
    }
  };

  const handleUnassignExam = async (examId: string) => {
    try {
      await assignExamToClassroom(examId, null);
      setFeedback({
        type: 'ok',
        text: 'Sınav sınıftan ayrıldı ve tekrar Türkiye Geneli kapsamına alındı.',
      });
      await onExamsChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sınav ayrılamadı.';
      setFeedback({ type: 'err', text: msg });
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 md:p-8 space-y-6">
      {/* ÜST BAŞLIK */}
      <header className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-7 rounded-2xl shadow-lg border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <span className="inline-block px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-200 text-xs font-bold uppercase tracking-wider">
            Öğretmen Yönetim Paneli
          </span>
          <h1 className="text-2xl font-extrabold mt-2">
            Sınıflarım, Davet Kodları & Sınav Atama
          </h1>
          <p className="text-sm text-slate-300 mt-1">
            Sınıf oluştur, 6 haneli davet kodunu öğrencilerinle paylaş ve
            denemelerini doğrudan sınıflarına ata.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 shrink-0">
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 text-center">
            <span className="text-[11px] text-slate-400 font-semibold block">
              Aktif Sınıf
            </span>
            <strong className="text-2xl font-black text-white">
              {classrooms.length}
            </strong>
          </div>
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 text-center">
            <span className="text-[11px] text-slate-400 font-semibold block">
              Kayıtlı Öğrenci
            </span>
            <strong className="text-2xl font-black text-emerald-300">
              {totalStudents}
            </strong>
          </div>
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 text-center">
            <span className="text-[11px] text-slate-400 font-semibold block">
              Atanan Sınav
            </span>
            <strong className="text-2xl font-black text-indigo-300">
              {assignedExamCount}
            </strong>
          </div>
        </div>
      </header>

      {/* BİLDİRİM */}
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

      {/* YENİ SINIF OLUŞTURMA FORMU */}
      <form
        onSubmit={handleCreateClassroom}
        className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-end gap-4"
      >
        <div className="flex-1">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
            Yeni Sınıf / Grup Adı
          </label>
          <input
            type="text"
            required
            placeholder="Örn: 8-A Matematik veya 5-B LGS Hazırlık"
            value={newClassName}
            onChange={(e) => setNewClassName(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="w-full md:w-44">
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
            Sınıf Seviyesi
          </label>
          <select
            value={newGrade}
            onChange={(e) => setNewGrade(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-800 focus:border-indigo-500 focus:outline-none"
          >
            <option value="5">5. Sınıf</option>
            <option value="6">6. Sınıf</option>
            <option value="7">7. Sınıf</option>
            <option value="8">8. Sınıf (LGS)</option>
            <option value="9">9. Sınıf</option>
            <option value="10">10. Sınıf</option>
            <option value="11">11. Sınıf</option>
            <option value="12">12. Sınıf (YKS)</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={creating || !newClassName.trim()}
          className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold shadow-md shadow-indigo-600/20 cursor-pointer shrink-0"
        >
          {creating ? 'Oluşturuluyor...' : '+ Sınıf Oluştur & Kod Üret'}
        </button>
      </form>

      {/* SINIF LİSTESİ */}
      {loading ? (
        <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-sm font-bold text-slate-500">
          Sınıflar yükleniyor...
        </div>
      ) : classrooms.length === 0 ? (
        <div className="bg-white p-10 rounded-2xl border border-slate-200 text-center space-y-2">
          <p className="text-base font-extrabold text-slate-900">
            Henüz oluşturulmuş bir sınıfın yok
          </p>
          <p className="text-xs text-slate-500">
            Yukarıdan ilk sınıfını oluşturduğunda öğrencilerinle paylaşacağın
            davet kodu otomatik üretilecektir.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {classrooms.map((room) => {
            const roomExams = exams.filter((e) => e.classroom_id === room.id);
            const assignableExams = exams.filter(
              (e) => e.classroom_id !== room.id
            );

            return (
              <div
                key={room.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col"
              >
                {/* KART ÜSTÜ: SINIF ADI + DAVET KODU */}
                <div className="p-6 border-b border-slate-100 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-extrabold text-slate-900">
                          {room.name}
                        </h2>
                        {room.grade && (
                          <span className="px-2.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-100 text-xs font-bold">
                            {room.grade}. Sınıf
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Öğretmen: <strong>{room.teacher_name}</strong> •{' '}
                        {room.members.length} öğrenci kayıtlı
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteClassroom(room)}
                      className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer"
                    >
                      Sil
                    </button>
                  </div>

                  {/* DAVET KODU KUTUSU */}
                  <div className="p-4 rounded-xl bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-300 block">
                        Sınıf Davet Kodu
                      </span>
                      <span className="font-mono text-2xl font-black tracking-widest text-white">
                        {room.invite_code}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyCode(room.id, room.invite_code)}
                        className={`px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                          copiedId === room.id
                            ? 'bg-emerald-500 text-white'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                        }`}
                      >
                        {copiedId === room.id ? '✓ Kopyalandı' : 'Kodu Kopyala'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRegenerateCode(room)}
                        title="Yeni Davet Kodu Üret"
                        className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold cursor-pointer"
                      >
                        Yenile
                      </button>
                    </div>
                  </div>
                </div>

                {/* SINIFA ATANAN SINAVLAR */}
                <div className="p-6 border-b border-slate-100 space-y-3 bg-slate-50/50">
                  <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                    Bu Sınıfa Atanan Sınavlar ({roomExams.length})
                  </h3>

                  {roomExams.length > 0 ? (
                    <div className="space-y-2">
                      {roomExams.map((ex) => (
                        <div
                          key={ex.id}
                          className="p-3 rounded-xl bg-white border border-slate-200 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 truncate">
                              {ex.title}
                            </p>
                            <span className="text-[11px] text-slate-500">
                              {ex.exam_date} •{' '}
                              {ex.allow_guests ?? true
                                ? 'Misafir Açık'
                                : 'Sadece Sınıf'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => onOpenAnalytics(ex.id)}
                              className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold cursor-pointer"
                            >
                              Analiz
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUnassignExam(ex.id)}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 font-bold cursor-pointer"
                            >
                              Kaldır
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">
                      Henüz bu sınıfa özel atanmış sınav yok.
                    </p>
                  )}

                  {assignableExams.length > 0 && (
                    <div className="flex items-center gap-2 pt-1">
                      <select
                        value={selectedExamByClass[room.id] ?? ''}
                        onChange={(e) =>
                          setSelectedExamByClass((prev) => ({
                            ...prev,
                            [room.id]: e.target.value,
                          }))
                        }
                        className="flex-1 min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                      >
                        <option value="">Sınıfa atamak için sınav seç...</option>
                        {assignableExams.map((ex) => (
                          <option key={ex.id} value={ex.id}>
                            {ex.title}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!selectedExamByClass[room.id]}
                        onClick={() => handleAssignExam(room.id)}
                        className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer shrink-0"
                      >
                        Sınav Ata
                      </button>
                    </div>
                  )}
                </div>

                {/* KAYITLI ÖĞRENCİ LİSTESİ */}
                <div className="p-6 space-y-3 flex-1">
                  <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                    Sınıf Listesi ({room.members.length} Öğrenci)
                  </h3>

                  {room.members.length === 0 ? (
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Henüz öğrenci katılmadı. Yukarıdaki{' '}
                      <strong className="text-slate-600">
                        {room.invite_code}
                      </strong>{' '}
                      kodunu öğrencilerle paylaşarak sınıfa katılmalarını
                      sağlayabilirsin.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                      {room.members.map((m) => (
                        <div
                          key={m.student_id}
                          className="p-3 bg-white flex items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <p className="font-bold text-slate-900">
                              {m.full_name}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {m.school_name || 'Okul belirtilmemiş'}
                              {m.classroom ? ` • ${m.classroom}` : ''}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              handleRemoveStudent(
                                room.id,
                                m.student_id,
                                m.full_name
                              )
                            }
                            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 font-bold cursor-pointer"
                          >
                            Çıkar
                          </button>
                        </div>
                      ))}
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