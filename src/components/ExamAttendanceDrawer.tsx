import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  fetchExamAttendanceMap,
  type ExamAttendanceEntry,
} from '../services/classroomService';
import {
  fetchWaitingStudents,
  startExamNow,
  type WaitingStudentEntry,
} from '../services/waitingRoomService';
import type { ClassroomWithDetails } from '../types/classroom';
import type { Exam } from '../types/exam';
import {
  formatCountdown,
  getExamScheduleState,
} from '../utils/examSchedule';

interface ExamAttendanceDrawerProps {
  exam: Exam;
  assignedClassrooms: ClassroomWithDetails[];
  onClose: () => void;
  onExamStartedEarly?: () => Promise<void>;
}

export const ExamAttendanceDrawer: React.FC<ExamAttendanceDrawerProps> = ({
  exam,
  assignedClassrooms,
  onClose,
  onExamStartedEarly,
}) => {
  const [attendanceMap, setAttendanceMap] = useState<
    Record<string, ExamAttendanceEntry>
  >({});
  const [waitingMap, setWaitingMap] = useState<
    Record<string, WaitingStudentEntry>
  >({});
  const [loading, setLoading] = useState<boolean>(true);
  const [startingNow, setStartingNow] = useState<boolean>(false);
  const [startedEarly, setStartedEarly] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [selectedClassId, setSelectedClassId] = useState<string>(
    assignedClassrooms[0]?.id ?? 'ALL'
  );
  const [copiedReminder, setCopiedReminder] = useState<boolean>(false);

  const scheduleState = useMemo(() => {
    if (startedEarly) {
      return { phase: 'LIVE' as const, msUntilStart: 0, msUntilEnd: null };
    }
    return getExamScheduleState(exam, nowMs);
  }, [exam, nowMs, startedEarly]);

  const isWaitingMode = scheduleState.phase === 'UPCOMING';

  const loadLiveStatus = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const [attData, waitList] = await Promise.all([
          fetchExamAttendanceMap(exam.id),
          fetchWaitingStudents(exam.id),
        ]);
        setAttendanceMap(attData);

        const nextWait: Record<string, WaitingStudentEntry> = {};
        for (const w of waitList) {
          nextWait[w.user_id] = w;
        }
        setWaitingMap(nextWait);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Yoklama verisi yüklenemedi.'
        );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [exam.id]
  );

  // İlk yükleme + her 3 saniyede canlı yoklama yenileme + Realtime dinleme
  useEffect(() => {
    loadLiveStatus(false);

    const clockId = window.setInterval(() => setNowMs(Date.now()), 1000);
    const pollId = window.setInterval(() => loadLiveStatus(true), 3000);

    const channel = supabase
      ? supabase
          .channel(`waiting-room-${exam.id}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'exam_waiting_room',
              filter: `exam_id=eq.${exam.id}`,
            },
            () => {
              loadLiveStatus(true);
            }
          )
          .subscribe()
      : null;

    return () => {
      window.clearInterval(clockId);
      window.clearInterval(pollId);
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [exam.id, loadLiveStatus]);

  const perClassStats = useMemo(() => {
    return assignedClassrooms.map((room) => {
      const present = room.members.filter((m) =>
        isWaitingMode
          ? Boolean(waitingMap[m.student_id])
          : Boolean(attendanceMap[m.student_id])
      );
      const missing = room.members.filter((m) =>
        isWaitingMode
          ? !waitingMap[m.student_id]
          : !attendanceMap[m.student_id]
      );
      return {
        room,
        present,
        missing,
        total: room.members.length,
      };
    });
  }, [assignedClassrooms, attendanceMap, waitingMap, isWaitingMode]);

  const activeData = useMemo(() => {
    if (selectedClassId === 'ALL') {
      const presentMap = new Map<
        string,
        { full_name: string; roomName: string; timestamp: string }
      >();
      const missingMap = new Map<
        string,
        { full_name: string; roomName: string; inProgress: boolean }
      >();

      for (const st of perClassStats) {
        for (const m of st.present) {
          if (!presentMap.has(m.student_id)) {
            presentMap.set(m.student_id, {
              full_name: m.full_name,
              roomName: st.room.name,
              timestamp: isWaitingMode
                ? waitingMap[m.student_id]?.joined_at ?? ''
                : attendanceMap[m.student_id]?.created_at ?? '',
            });
          }
        }
        for (const m of st.missing) {
          if (!missingMap.has(m.student_id)) {
            missingMap.set(m.student_id, {
              full_name: m.full_name,
              roomName: st.room.name,
              inProgress: !isWaitingMode && Boolean(waitingMap[m.student_id]),
            });
          }
        }
      }

      return {
        label: 'Tüm Atanan Sınıflar',
        present: Array.from(presentMap.entries()).map(([id, v]) => ({
          id,
          ...v,
        })),
        missing: Array.from(missingMap.entries()).map(([id, v]) => ({
          id,
          ...v,
        })),
      };
    }

    const match = perClassStats.find((s) => s.room.id === selectedClassId);
    if (!match) {
      return { label: '', present: [], missing: [] };
    }

    return {
      label: match.room.name,
      present: match.present.map((m) => ({
        id: m.student_id,
        full_name: m.full_name,
        roomName: match.room.name,
        timestamp: isWaitingMode
          ? waitingMap[m.student_id]?.joined_at ?? ''
          : attendanceMap[m.student_id]?.created_at ?? '',
      })),
      missing: match.missing.map((m) => ({
        id: m.student_id,
        full_name: m.full_name,
        roomName: match.room.name,
        inProgress: !isWaitingMode && Boolean(waitingMap[m.student_id]),
      })),
    };
  }, [perClassStats, selectedClassId, attendanceMap, waitingMap, isWaitingMode]);

  const totalCount = activeData.present.length + activeData.missing.length;
  const completionPct =
    totalCount > 0 ? Math.round((activeData.present.length / totalCount) * 100) : 0;
  const allReady = isWaitingMode && totalCount > 0 && activeData.missing.length === 0;

  const handleStartExamEarly = async () => {
    const confirmMsg = allReady
      ? `Tüm öğrenciler hazır! "${exam.title}" sınavını şimdi başlatmak istiyor musun?`
      : `"${exam.title}" sınavını planlanan saatten önce başlatmak istiyor musun? Bekleme odasındaki öğrencilerin soruları anında açılacaktır.`;

    if (!window.confirm(confirmMsg)) return;

    setStartingNow(true);
    setError(null);
    try {
      await startExamNow(exam.id, exam.duration_minutes ?? 40);
      setStartedEarly(true);
      await onExamStartedEarly?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Sınav başlatılırken hata oluştu.'
      );
    } finally {
      setStartingNow(false);
    }
  };

  const handleCopyWhatsAppReminder = async () => {
    if (activeData.missing.length === 0) return;
    const names = activeData.missing
      .map((m, idx) => `${idx + 1}. ${m.full_name}`)
      .join('\n');

    const text = isWaitingMode
      ? `Merhaba değerli velilerimiz,\n"${exam.title}" (${activeData.label}) sınavı birazdan başlıyor. Henüz bekleme odasına katılmayan öğrencilerimiz:\n\n${names}\n\nGiriş yapıp bekleme odasına geçmelerini rica ederim.`
      : `Merhaba değerli velilerimiz,\n"${exam.title}" (${activeData.label}) denemesini henüz tamamlamayan öğrencilerimiz:\n\n${names}\n\n${exam.exam_code ? `Sınav Kodu: ${exam.exam_code}\n` : ''}Tamamlamalarını rica ederim.`;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedReminder(true);
      window.setTimeout(() => setCopiedReminder(false), 2000);
    } catch {
      setError('Metin panoya kopyalanamadı.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-3xl max-h-[88vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* ÜST BAŞLIK */}
        <div className="bg-slate-900 text-white px-6 py-4 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-300">
                {isWaitingMode
                  ? `Canlı Bekleme Odası • Başlamasına ${formatCountdown(scheduleState.msUntilStart)}`
                  : 'Canlı Katılım Yoklaması'}
              </span>
            </div>
            <h2 className="text-lg font-extrabold leading-snug">
              {exam.title}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isWaitingMode && (
              <button
                type="button"
                disabled={startingNow}
                onClick={handleStartExamEarly}
                className={`px-4 py-1.5 rounded-lg text-xs font-black cursor-pointer transition-colors shadow-md ${
                  allReady
                    ? 'bg-emerald-400 hover:bg-emerald-300 text-slate-950 animate-pulse'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                }`}
              >
                {startingNow
                  ? 'Başlatılıyor...'
                  : allReady
                    ? '🚀 Sınıf Tamam — Şimdi Başlat'
                    : '🚀 Sınavı Şimdi Başlat'}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white cursor-pointer"
            >
              Kapat
            </button>
          </div>
        </div>

        {/* ŞUBE SEKMELERİ */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
          {assignedClassrooms.length > 1 && (
            <button
              type="button"
              onClick={() => setSelectedClassId('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                selectedClassId === 'ALL'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white border border-slate-300 text-slate-700 hover:border-indigo-400'
              }`}
            >
              Tümü
            </button>
          )}

          {perClassStats.map((st) => {
            const active = selectedClassId === st.room.id;
            return (
              <button
                key={st.room.id}
                type="button"
                onClick={() => setSelectedClassId(st.room.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5 ${
                  active
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-white border border-slate-300 text-slate-700 hover:border-indigo-400'
                }`}
              >
                <span>{st.room.name}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                    active
                      ? 'bg-indigo-500 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {st.present.length}/{st.total}
                </span>
              </button>
            );
          })}
        </div>

        {/* İLERLEME ÇUBUĞU VE WHATSAPP HATIRLATMA */}
        <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-slate-700">
                {activeData.label}: {activeData.present.length} / {totalCount}{' '}
                {isWaitingMode ? 'öğrenci bekleme odasında hazır' : 'öğrenci tamamladı'}
              </span>
              <span className="text-indigo-700">%{completionPct}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>

          {activeData.missing.length > 0 && (
            <button
              type="button"
              onClick={handleCopyWhatsAppReminder}
              className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer shrink-0 transition-colors ${
                copiedReminder
                  ? 'bg-emerald-600 text-white'
                  : 'bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300'
              }`}
            >
              {copiedReminder
                ? '✓ Hatırlatma Metni Kopyalandı'
                : `WhatsApp Hatırlatma Kopyala (${activeData.missing.length})`}
            </button>
          )}
        </div>

        {/* LİSTE İÇERİĞİ */}
        <div className="p-6 overflow-y-auto flex-1">
          {startedEarly && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800">
              ✓ Sınav erken başlatıldı! Bekleme odasındaki öğrencilerin soruları
              otomatik açıldı.
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-center text-xs font-bold text-slate-500 py-8">
              Canlı katılım kontrol ediliyor...
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* BEKLEME ODASINDA HAZIR / TAMAMLAYANLAR */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 flex items-center justify-between">
                  <span>
                    {isWaitingMode ? 'Bekleme Odasında Hazır' : 'Tamamlayanlar'}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    {activeData.present.length}
                  </span>
                </h3>

                {activeData.present.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-500 text-center">
                    {isWaitingMode
                      ? 'Henüz bekleme odasına katılan öğrenci yok.'
                      : 'Henüz tamamlayan öğrenci yok.'}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 rounded-xl border border-emerald-200 overflow-hidden">
                    {activeData.present.map((m) => (
                      <div
                        key={m.id}
                        className="px-3.5 py-2.5 bg-emerald-50/40 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                          <span className="font-bold text-slate-900">
                            {m.full_name}
                          </span>
                          {selectedClassId === 'ALL' && (
                            <span className="text-[10px] text-slate-500 font-semibold">
                              ({m.roomName})
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[11px] font-bold text-emerald-700">
                          {m.timestamp
                            ? new Date(m.timestamp).toLocaleTimeString(
                                'tr-TR',
                                { hour: '2-digit', minute: '2-digit' }
                              )
                            : '✓'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* HENÜZ KATILMAYANLAR / GİRMEYENLER */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-rose-700 flex items-center justify-between">
                  <span>
                    {isWaitingMode
                      ? 'Henüz Bekleme Odasına Gelmeyenler'
                      : 'Henüz Bitirmeyenler'}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                    {activeData.missing.length}
                  </span>
                </h3>

                {activeData.missing.length === 0 ? (
                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 text-center">
                    {isWaitingMode
                      ? '✓ Sınıf eksiksiz hazır! İstersen sınavı hemen başlatabilirsin.'
                      : '✓ Bu şubedeki tüm öğrenciler sınavı tamamladı!'}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 rounded-xl border border-rose-200 overflow-hidden">
                    {activeData.missing.map((m) => (
                      <div
                        key={m.id}
                        className="px-3.5 py-2.5 bg-rose-50/30 flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="font-bold text-slate-900">
                          {m.full_name}
                        </span>
                        {m.inProgress ? (
                          <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">
                            Şu An Çözüyor
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-rose-600 bg-rose-100 px-2 py-0.5 rounded">
                            {selectedClassId === 'ALL'
                              ? m.roomName
                              : 'Bekleniyor'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};