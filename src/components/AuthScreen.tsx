import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import type { SmartboardPayload } from '../services/smartboardService';
import { SmartboardCodeLoginCard } from './SmartboardCodeLoginCard';

interface AuthScreenProps {
  onSmartboardEnter?: (payload: SmartboardPayload) => void;
}

type AuthMode = 'LOGIN' | 'SIGNUP';
type SignupRole = 'student' | 'teacher';

interface ClaimInviteResponse {
  ok: boolean;
  error?: string;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onSmartboardEnter,
}) => {
  const { signIn } = useAuth();

  const [mode, setMode] = useState<AuthMode>('LOGIN');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [fullName, setFullName] = useState<string>('');
  const [role, setRole] = useState<SignupRole>('student');
  const [inviteCode, setInviteCode] = useState<string>('');
  const [grade, setGrade] = useState<string>('5');
  const [schoolName, setSchoolName] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setError('Supabase bağlantısı yapılandırılmamış.');
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      if (mode === 'LOGIN') {
        await signIn(email, password);
      } else {
        if (!fullName.trim()) {
          throw new Error('Lütfen ad soyad bilginizi giriniz.');
        }

        const normalizedCode = inviteCode.trim().toUpperCase();
        if (role === 'teacher' && !normalizedCode) {
          throw new Error(
            'Öğretmen kaydı için tek kullanımlık davet kodu zorunludur.'
          );
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              role: 'student',
              grade: role === 'student' && grade ? Number(grade) : null,
              school_name: schoolName.trim() || null,
              invite_code: role === 'teacher' ? normalizedCode : null,
            },
          },
        });

        if (signUpError) throw signUpError;

        if (!data.session) {
          setInfo(
            role === 'teacher'
              ? 'Kayıt oluşturuldu. E-posta doğrulama linkini onayladıktan sonra giriş yapın; davet kodunuz doğrulanarak öğretmen yetkiniz tanımlanacaktır.'
              : 'Kayıt oluşturuldu. E-posta doğrulama linkini onayladıktan sonra giriş yapabilirsiniz.'
          );
          setMode('LOGIN');
          return;
        }

        if (role === 'teacher' && normalizedCode) {
          const { data: claimData, error: claimError } = await supabase.rpc(
            'claim_teacher_invite',
            {
              p_code: normalizedCode,
            }
          );

          if (claimError) {
            setInfo(
              'Hesabınız öğrenci olarak açıldı; ancak davet kodu doğrulanırken bir hata oluştu.'
            );
          } else {
            const result = claimData as ClaimInviteResponse | null;
            if (!result?.ok) {
              setInfo(
                `Hesabınız öğrenci olarak açıldı. Sebep: ${
                  result?.error ?? 'Davet kodu geçersiz veya süresi dolmuş.'
                }`
              );
            }
          }
        }
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'İşlem sırasında beklenmeyen bir hata oluştu.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100/80 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md space-y-4">
        {/* ÜST KART: STANDART E-POSTA / KULLANICI ADI & ŞİFRE GİRİŞ / KAYIT */}
        <div className="w-full bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white px-6 py-6 space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-base shadow-md">
                A
              </span>
              <div>
                <h1 className="text-lg font-extrabold tracking-tight leading-tight">
                  Deneme Analiz
                </h1>
                <p className="text-[11px] text-indigo-200 font-medium">
                  Çevrimiçi Sınav ve Kazanım Analiz Platformu
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 bg-slate-800/80 p-1 rounded-xl border border-slate-700">
              <button
                type="button"
                onClick={() => {
                  setMode('LOGIN');
                  setError(null);
                  setInfo(null);
                }}
                className={`py-2 rounded-lg text-xs font-extrabold cursor-pointer transition-all ${
                  mode === 'LOGIN'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Giriş Yap
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('SIGNUP');
                  setError(null);
                  setInfo(null);
                }}
                className={`py-2 rounded-lg text-xs font-extrabold cursor-pointer transition-all ${
                  mode === 'SIGNUP'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Hesap Oluştur
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700">
                {error}
              </div>
            )}

            {info && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800">
                {info}
              </div>
            )}

            {mode === 'SIGNUP' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRole('student');
                      setInviteCode('');
                      setError(null);
                    }}
                    className={`py-2.5 rounded-xl border-2 text-xs font-extrabold cursor-pointer transition-all ${
                      role === 'student'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    Öğrenci
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRole('teacher');
                      setError(null);
                    }}
                    className={`py-2.5 rounded-xl border-2 text-xs font-extrabold cursor-pointer transition-all ${
                      role === 'teacher'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    Öğretmen
                  </button>
                </div>

                {role === 'teacher' && (
                  <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 space-y-1.5">
                    <label className="block text-[11px] font-extrabold text-amber-900 uppercase">
                      Öğretmen Davet Kodu (Tek Kullanımlık)
                    </label>
                    <input
                      type="text"
                      required
                      value={inviteCode}
                      onChange={(e) =>
                        setInviteCode(e.target.value.toUpperCase())
                      }
                      placeholder="Örn: ARMA-7X4K"
                      maxLength={24}
                      className="w-full rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-sm font-extrabold tracking-wider uppercase text-slate-900 focus:border-indigo-500 focus:outline-none"
                    />
                    <p className="text-[11px] text-amber-800 font-medium">
                      Onaylı bir öğretmenden veya yöneticiden alacağınız tek
                      kullanımlık ve süreli kodu giriniz.
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Ad Soyad
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Örn: Ahmet Yılmaz"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {role === 'student' && (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                        Sınıf Seviyesi
                      </label>
                      <select
                        value={grade}
                        onChange={(e) => setGrade(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-800 focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="5">5. Sınıf</option>
                        <option value="6">6. Sınıf</option>
                        <option value="7">7. Sınıf</option>
                        <option value="8">8. Sınıf (LGS)</option>
                        <option value="9">9. Sınıf</option>
                        <option value="10">10. Sınıf</option>
                        <option value="11">11. Sınıf</option>
                        <option value="12">12. Sınıf / YKS</option>
                      </select>
                    </div>
                  )}

                  <div className={role === 'teacher' ? 'sm:col-span-2' : ''}>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      Okul (Opsiyonel)
                    </label>
                    <input
                      type="text"
                      value={schoolName}
                      onChange={(e) => setSchoolName(e.target.value)}
                      placeholder="Örn: Atatürk Ortaokulu"
                      className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                {mode === 'LOGIN' ? 'E-posta veya Kullanıcı Adı' : 'E-posta'}
              </label>
              <input
                type="text"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={
                  mode === 'LOGIN'
                    ? 'E-posta veya Kullanıcı Adı (Örn: GOKMEN)'
                    : 'ornek@okul.edu.tr'
                }
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                Şifre
              </label>
              <input
                type="password"
                required
                minLength={6}
                autoComplete={
                  mode === 'LOGIN' ? 'current-password' : 'new-password'
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-extrabold shadow-md shadow-indigo-600/20 cursor-pointer transition-colors"
            >
              {loading
                ? 'Lütfen bekleyin...'
                : mode === 'LOGIN'
                  ? 'Giriş Yap'
                  : 'Kayıt Ol ve Başla'}
            </button>
          </form>
        </div>

        {/* BAĞIMSIZ ALT KART: AKILLI TAHTA 5 HANELİ HIZLI GİRİŞ */}
        {onSmartboardEnter && (
          <SmartboardCodeLoginCard onSuccess={onSmartboardEnter} />
        )}
      </div>
    </div>
  );
};