import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

interface RawReviewRow {
  id: string;
  question_id: string;
  reviewer_id: string;
  decision: string;
  note: string | null;
  created_at: string;
  updated_at?: string | null;
  duration_seconds?: number | null;
}

interface ProfileLite {
  id: string;
  full_name: string | null;
  subject: string | null;
}

interface QuestionLite {
  id: string;
  subject: string | null;
  question_text: string | null;
}

interface ReviewRow extends RawReviewRow {
  reviewer?: ProfileLite | null;
  question?: QuestionLite | null;
}

type DateFilterMode = 'ALL' | 'TODAY' | 'LAST_7_DAYS' | 'CUSTOM';

interface ReviewTrackingTabProps {
  onSelectQuestion?: (questionId: string) => void;
}

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatFullDateTime(iso: string): string {
  return new Date(iso).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (diffSec < 60) return 'Az önce';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} dk önce`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} sa önce`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} gün önce`;
}

function formatDuration(seconds?: number | null): string {
  if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds < 0) {
    return '—';
  }
  if (seconds < 60) return `${seconds} sn`;
  const mins = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  return remSec === 0 ? `${mins} dk` : `${mins} dk ${remSec} sn`;
}

export const ReviewTrackingTab: React.FC<ReviewTrackingTabProps> = ({
  onSelectQuestion,
}) => {
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedTeacher, setSelectedTeacher] = useState<string>('ALL');
  const [selectedDecision, setSelectedDecision] = useState<string>('ALL');
  const [dateFilter, setDateFilter] = useState<DateFilterMode>('ALL');
  const [customDate, setCustomDate] = useState<string>(() =>
    toLocalDateKey(new Date())
  );
  const [onlyWithNotes, setOnlyWithNotes] = useState<boolean>(false);

  const fetchReviews = async () => {
    setLoading(true);
    setError(null);

    if (!supabase) {
      setError('Supabase bağlantısı yapılandırılmamış.');
      setLoading(false);
      return;
    }

    const [reviewsRes, profilesRes, questionsRes] = await Promise.all([
      supabase
        .from('question_reviews')
        .select(
          'id, question_id, reviewer_id, decision, note, created_at, updated_at, duration_seconds'
        )
        .order('created_at', { ascending: false })
        .limit(500),
      supabase.from('profiles').select('id, full_name, subject'),
      supabase.from('question_pool').select('id, subject, question_text'),
    ]);

    if (reviewsRes.error) {
      setError(reviewsRes.error.message);
      setLoading(false);
      return;
    }
    if (profilesRes.error) {
      setError(profilesRes.error.message);
      setLoading(false);
      return;
    }
    if (questionsRes.error) {
      setError(questionsRes.error.message);
      setLoading(false);
      return;
    }

    const profileMap = new Map<string, ProfileLite>();
    ((profilesRes.data as ProfileLite[]) || []).forEach((p) => {
      profileMap.set(p.id, p);
    });

    const questionMap = new Map<string, QuestionLite>();
    ((questionsRes.data as QuestionLite[]) || []).forEach((q) => {
      questionMap.set(q.id, q);
    });

    const merged: ReviewRow[] = ((reviewsRes.data as RawReviewRow[]) || []).map(
      (r) => ({
        ...r,
        reviewer: profileMap.get(r.reviewer_id) ?? null,
        question: questionMap.get(r.question_id) ?? null,
      })
    );

    setReviews(merged);
    setLoading(false);
  };

  useEffect(() => {
    fetchReviews();
  }, []);

  const isApprove = (decision: string) =>
    ['approve', 'approved'].includes(decision.toLowerCase());

  const teachers = useMemo(() => {
    const map = new Map<string, string>();
    reviews.forEach((r) => {
      const name = r.reviewer?.full_name || 'İsimsiz Öğretmen';
      map.set(r.reviewer_id, name);
    });
    return Array.from(map.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], 'tr')
    );
  }, [reviews]);

  const filteredReviews = useMemo(() => {
    const todayKey = toLocalDateKey(new Date());
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();

    return reviews.filter((r) => {
      if (selectedTeacher !== 'ALL' && r.reviewer_id !== selectedTeacher) {
        return false;
      }
      if (selectedDecision === 'APPROVE' && !isApprove(r.decision)) {
        return false;
      }
      if (selectedDecision === 'REJECT' && isApprove(r.decision)) {
        return false;
      }
      if (onlyWithNotes && (!r.note || r.note.trim() === '')) {
        return false;
      }
      if (dateFilter !== 'ALL') {
        const reviewDate = new Date(r.created_at);
        const reviewKey = toLocalDateKey(reviewDate);
        if (dateFilter === 'TODAY' && reviewKey !== todayKey) {
          return false;
        }
        if (
          dateFilter === 'LAST_7_DAYS' &&
          nowMs - reviewDate.getTime() > sevenDaysMs
        ) {
          return false;
        }
        if (dateFilter === 'CUSTOM' && customDate && reviewKey !== customDate) {
          return false;
        }
      }
      return true;
    });
  }, [
    reviews,
    selectedTeacher,
    selectedDecision,
    onlyWithNotes,
    dateFilter,
    customDate,
  ]);

  const stats = useMemo(() => {
    const total = filteredReviews.length;
    const approved = filteredReviews.filter((r) => isApprove(r.decision)).length;
    const rejected = total - approved;
    const withNotes = filteredReviews.filter(
      (r) => r.note && r.note.trim() !== ''
    ).length;

    const timed = filteredReviews.filter(
      (r) => typeof r.duration_seconds === 'number' && r.duration_seconds >= 0
    );
    const avgDuration =
      timed.length > 0
        ? Math.round(
            timed.reduce((sum, r) => sum + (r.duration_seconds ?? 0), 0) /
              timed.length
          )
        : null;

    return { total, approved, rejected, withNotes, avgDuration };
  }, [filteredReviews]);

  if (loading) {
    return (
      <div className="p-6 text-sm text-slate-500">
        İncelemeler yükleniyor...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-50 text-red-700 text-sm">
        Veri çekilirken hata oluştu: {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Üst Filtre Çubuğu */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-4 rounded-xl border border-slate-200">
        <select
          value={selectedTeacher}
          onChange={(e) => setSelectedTeacher(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          <option value="ALL">Tüm Öğretmenler</option>
          {teachers.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>

        <select
          value={selectedDecision}
          onChange={(e) => setSelectedDecision(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          <option value="ALL">Tüm Kararlar</option>
          <option value="APPROVE">Sadece Olur</option>
          <option value="REJECT">Sadece Olmaz</option>
        </select>

        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as DateFilterMode)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          <option value="ALL">Tüm Tarihler</option>
          <option value="TODAY">Bugün</option>
          <option value="LAST_7_DAYS">Son 7 Gün</option>
          <option value="CUSTOM">Belirli Gün</option>
        </select>

        {dateFilter === 'CUSTOM' && (
          <input
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
          />
        )}

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={onlyWithNotes}
            onChange={(e) => setOnlyWithNotes(e.target.checked)}
            className="rounded border-slate-300"
          />
          Sadece Not Bırakılanlar
        </label>

        <button
          type="button"
          onClick={fetchReviews}
          className="ml-auto px-3 py-2 text-sm font-medium bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
        >
          Yenile
        </button>
      </div>

      {/* Özet Kartları */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <div className="text-xs text-slate-500">Toplam İnceleme</div>
          <div className="text-xl font-bold text-slate-800">{stats.total}</div>
        </div>
        <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
          <div className="text-xs text-emerald-700">Olur</div>
          <div className="text-xl font-bold text-emerald-800">
            {stats.approved}
          </div>
        </div>
        <div className="bg-rose-50 p-3 rounded-xl border border-rose-200">
          <div className="text-xs text-rose-700">Olmaz</div>
          <div className="text-xl font-bold text-rose-800">
            {stats.rejected}
          </div>
        </div>
        <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
          <div className="text-xs text-amber-700">Not Bırakılan</div>
          <div className="text-xl font-bold text-amber-800">
            {stats.withNotes}
          </div>
        </div>
        <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-200">
          <div className="text-xs text-indigo-700">Ort. Süre</div>
          <div className="text-xl font-bold text-indigo-800">
            {formatDuration(stats.avgDuration)}
          </div>
        </div>
      </div>

      {/* Liste */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="p-3">İnceleme Zamanı</th>
              <th className="p-3">Süre</th>
              <th className="p-3">Öğretmen</th>
              <th className="p-3">Soru ID / Ders</th>
              <th className="p-3">Karar</th>
              <th className="p-3">Öğretmen Notu</th>
              {onSelectQuestion && <th className="p-3 text-right">İşlem</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredReviews.map((r) => {
              const ok = isApprove(r.decision);
              const isUpdated =
                Boolean(r.updated_at) &&
                Math.abs(
                  new Date(r.updated_at as string).getTime() -
                    new Date(r.created_at).getTime()
                ) > 5000;

              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="p-3 whitespace-nowrap text-xs">
                    <div className="font-semibold text-slate-700">
                      {formatFullDateTime(r.created_at)}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {formatRelativeTime(r.created_at)}
                    </div>
                    {isUpdated && r.updated_at && (
                      <div className="text-[10px] text-amber-600 mt-0.5">
                        Güncellendi: {formatFullDateTime(r.updated_at)}
                      </div>
                    )}
                  </td>
                  <td className="p-3 whitespace-nowrap text-xs font-mono font-semibold text-slate-600">
                    {formatDuration(r.duration_seconds)}
                  </td>
                  <td className="p-3 font-medium text-slate-800">
                    {r.reviewer?.full_name || 'Bilinmiyor'}
                  </td>
                  <td className="p-3">
                    <div className="font-mono text-xs text-slate-700">
                      {r.question_id}
                    </div>
                    <div className="text-xs text-slate-500 truncate max-w-xs">
                      {r.question?.subject} — {r.question?.question_text}
                    </div>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        ok
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {ok ? '✓ Olur' : '✕ Olmaz'}
                    </span>
                  </td>
                  <td className="p-3 text-slate-700 max-w-sm">
                    {r.note ? (
                      r.note
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  {onSelectQuestion && (
                    <td className="p-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onSelectQuestion(r.question_id)}
                        className="px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg cursor-pointer"
                      >
                        Soruyu Aç
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {filteredReviews.length === 0 && (
              <tr>
                <td
                  colSpan={onSelectQuestion ? 7 : 6}
                  className="p-6 text-center text-slate-400"
                >
                  Seçilen filtrelere uygun inceleme bulunamadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};