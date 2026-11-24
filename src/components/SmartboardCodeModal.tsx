import React, { useEffect, useState } from 'react';
import {
  createSmartboardCode,
  type CreatedSmartboardCode,
  type SmartboardPayload,
} from '../services/smartboardService';
import type { Exam } from '../types/exam';
import { formatCountdown } from '../utils/examSchedule';

interface SmartboardCodeModalProps {
  teacherId: string;
  teacherName: string;
  exams: Exam[];
  initialExamId?: string | null;
  onClose: () => void;
  onOpenLocalSmartboard: (payload: SmartboardPayload) => void;
}

export const SmartboardCodeModal: React.FC<SmartboardCodeModalProps> = ({
  teacherId,
  teacherName,
  exams,
  initialExamId,
  onClose,
  onOpenLocalSmartboard,
}) => {
  const [selectedExamId, setSelectedExamId] = useState<string>(
    initialExamId || exams[0]?.id || ''
  );
  const [generating, setGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedSmartboardCode | null>(null);
  const [remainingMs, setRemainingMs] = useState<number>(0);

  useEffect(() => {
    if (!created) return;
    const expiryMs = new Date(created.expiresAt).getTime();

    const tick = () => {
      setRemainingMs(Math.max(0, expiryMs - Date.now()));
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [created]);

  const handleGenerate = async () => {
    if (!selectedExamId) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await createSmartboardCode({
        examId: selectedExamId,
        teacherId,
        teacherName,
      });
      setCreated(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Tahta kodu oluşturulamadı.'
      );
    } finally {
      setGenerating(false);
    }
  };

  const isExpired = Boolean(created) && remainingMs === 0;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-300 block">
              Güvenli Akıllı Tahta Girişi
            </span>
            <h2 className="text-base font-extrabold mt-0.5">
              5 Haneli Tahta Kodu Oluştur
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1.5">
              Tahtada Çözülecek Sınav
            </label>
            <select
              value={selectedExamId}
              onChange={(e) => {
                setSelectedExamId(e.target.value);
                setCreated(null);
              }}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              {exams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.title} {ex.exam_code ? `(${ex.exam_code})` : ''}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
              {error}
            </div>
          )}

          {created ? (
            <div className="p-5 rounded-2xl bg-slate-900 text-white text-center space-y-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-300 block">
                Akıllı Tahtaya Yazılacak Tek Kullanımlık Kod
              </span>

              <div
                className={`font-mono text-4xl font-black tracking-[0.25em] py-2 ${
                  isExpired ? 'text-slate-500 line-through' : 'text-emerald-300'
                }`}
              >
                {created.code}
              </div>

              {isExpired ? (
                <p className="text-xs font-bold text-rose-400">
                  3 dakikalık süre doldu. Yeni kod üretebilirsin.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs font-bold text-amber-300 font-mono">
                    ⏳ Kalan Süre: {formatCountdown(remainingMs)}
                  </p>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-400 transition-all duration-1000"
                      style={{ width: `${(remainingMs / 180_000) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={generating}
                  onClick={handleGenerate}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 cursor-pointer"
                >
                  ↻ Yeni Kod Üret
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenLocalSmartboard(created.payload);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white cursor-pointer"
                >
                  Bu Ekranda Tahtayı Aç →
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100 text-xs text-indigo-950 leading-relaxed">
              Tahtada şifre girmeden sadece bu sınavın <strong>en çok yanlış yapılan sorularını</strong> ve çizim kalemini açar. Kod <strong>3 dakika</strong> geçerlidir ve kullanıldığı an iptal olur.
            </div>
          )}

          {!created && (
            <button
              type="button"
              disabled={generating || !selectedExamId}
              onClick={handleGenerate}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-extrabold cursor-pointer transition-colors"
            >
              {generating ? 'Kod Hazırlanıyor...' : '5 Haneli Tahta Kodu Üret'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};