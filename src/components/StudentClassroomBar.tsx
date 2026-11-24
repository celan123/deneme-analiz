import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchStudentClassrooms,
  joinClassroomByCode,
} from '../services/classroomService';
import type { StudentEnrolledClassroom } from '../types/classroom';
import type { Exam } from '../types/exam';

interface StudentClassroomBarProps {
  studentId: string;
  activeExam?: Exam | null;
}

export const StudentClassroomBar: React.FC<StudentClassroomBarProps> = ({
  studentId,
  activeExam,
}) => {
  const [enrolled, setEnrolled] = useState<StudentEnrolledClassroom[]>([]);
  const [inviteCode, setInviteCode] = useState<string>('');
  const [joining, setJoining] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const loadEnrolled = useCallback(async () => {
    try {
      const list = await fetchStudentClassrooms(studentId);
      setEnrolled(list);
    } catch {
      // Sessiz geç
    }
  }, [studentId]);

  useEffect(() => {
    loadEnrolled();
  }, [loadEnrolled]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;

    setJoining(true);
    setStatusMsg(null);
    try {
      const { classroomName } = await joinClassroomByCode(inviteCode, studentId);
      setInviteCode('');
      setStatusMsg({
        type: 'ok',
        text: `"${classroomName}" sınıfına başarıyla katıldın!`,
      });
      await loadEnrolled();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Sınıfa katılınamadı.';
      setStatusMsg({ type: 'err', text: msg });
    } finally {
      setJoining(false);
    }
  };

  // Aktif sınav bir sınıfa aitse, öğrencinin bu sınıfa kayıtlı olup olmadığını kontrol et
  const activeExamClassId = activeExam?.classroom_id ?? null;
  const matchedClass = activeExamClassId
    ? enrolled.find((c) => c.classroom_id === activeExamClassId)
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-5">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 sm:p-5 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* KAYITLI SINIFLAR */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 block">
              Kayıtlı Olduğun Sınıflar
            </span>

            {enrolled.length === 0 ? (
              <p className="text-xs text-slate-500">
                Henüz bir sınıfa katılmadın. Öğretmeninin verdiği 6 haneli davet
                kodunu sağdaki alana girebilirsin.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {enrolled.map((room) => (
                  <span
                    key={room.classroom_id}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-xs font-bold text-indigo-800"
                  >
                    <span>{room.name}</span>
                    <span className="text-[10px] font-medium text-indigo-500">
                      ({room.teacher_name})
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* DAVET KODU GİRİŞ FORMU */}
          <form
            onSubmit={handleJoin}
            className="flex items-center gap-2 shrink-0"
          >
            <input
  type="text"
  maxLength={12}
  placeholder="Davet Kodu (Örn: 8A-KALE)"
  value={inviteCode}
  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
  className="w-48 rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs font-bold uppercase text-slate-900 focus:border-indigo-500 focus:outline-none"
/>
            <button
              type="submit"
              disabled={joining || !inviteCode.trim()}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer transition-colors"
            >
              {joining ? 'Katılıyor...' : 'Sınıfa Katıl'}
            </button>
          </form>
        </div>

        {/* SINAV-SINIF EŞLEŞME BİLGİ ŞERİDİ */}
        {activeExamClassId && (
          <div
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold border ${
              matchedClass
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-800'
            }`}
          >
            {matchedClass
              ? `✓ Seçili sınav kayıtlı olduğun "${matchedClass.name}" sınıfına ait. Aşağıdan Resmi Katılım ile girebilirsin.`
              : 'Bu sınav başka bir sınıfa ait. Kurum ortalamasını etkilemeden kendini denemek için aşağıdan Misafir (Gölge) Katılım seçebilirsin.'}
          </div>
        )}

        {statusMsg && (
          <div
            className={`px-3.5 py-2 rounded-xl text-xs font-bold border ${
              statusMsg.type === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}
          >
            {statusMsg.text}
          </div>
        )}
      </div>
    </div>
  );
};