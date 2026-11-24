import React, { useState } from 'react';
import {
  claimSmartboardCode,
  type SmartboardPayload,
} from '../services/smartboardService';

interface SmartboardCodeLoginCardProps {
  onSuccess: (payload: SmartboardPayload) => void;
}

export const SmartboardCodeLoginCard: React.FC<
  SmartboardCodeLoginCardProps
> = ({ onSuccess }) => {
  const [code, setCode] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = code.replace(/\s+/g, '').toUpperCase();
    if (cleaned.length !== 5) {
      setError('Lütfen 5 haneli kodu eksiksiz yazınız.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const payload = await claimSmartboardCode(cleaned);
      setCode('');
      onSuccess(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kod doğrulanamadı.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-6 space-y-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-slate-900 text-emerald-300 flex items-center justify-center text-xs font-black">
            🖥
          </span>
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 leading-tight">
              Akıllı Tahta Hızlı Giriş
            </h2>
            <p className="text-[11px] text-slate-500">
              Şifre girmeden 5 haneli tek kullanımlık kod ile aç
            </p>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-extrabold">
          Güvenli Mod
        </span>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
        <input
          type="text"
          maxLength={5}
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => {
            setError(null);
            setCode(
              e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
            );
          }}
          placeholder="Oturum açmak için kodu yazınız"
          className="flex-1 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white px-4 py-2.5 text-sm font-mono font-bold tracking-widest uppercase text-slate-900 placeholder:font-sans placeholder:tracking-normal placeholder:font-medium placeholder:normal-case focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || code.length !== 5}
          className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs sm:text-sm font-extrabold cursor-pointer transition-colors shrink-0"
        >
          {loading ? 'Açılıyor...' : 'Tahtayı Aç →'}
        </button>
      </form>

      {error && (
        <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
};