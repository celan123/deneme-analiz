import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase'; // Kendi supabase client yoluna göre kontrol et

interface ReviewRow {
  id: string;
  question_id: string;
  reviewer_id: string;
  decision: string;
  note: string | null;
  created_at: string;
  reviewer?: {
    full_name: string | null;
    subject: string | null;
  } | null;
  question?: {
    id: string;
    subject: string | null;
    question_text: string | null;
  } | null;
}

interface ReviewTrackingTabProps {
  onSelectQuestion?: (questionId: string) => void;
}

export const ReviewTrackingTab: React.FC<ReviewTrackingTabProps> = ({
  onSelectQuestion,
}) => {
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedTeacher, setSelectedTeacher] = useState<string>('ALL');
  const [selectedDecision, setSelectedDecision] = useState<string>('ALL');
  const [onlyWithNotes, setOnlyWithNotes] = useState<boolean>(false);

  const fetchReviews = async () => {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('question_reviews')
      .select(`
        id,
        question_id,
        reviewer_id,
        decision,
        note,
        created_at,
        reviewer:profiles!question_reviews_reviewer_id_fkey (
          full_name,
          subject
        ),
        question:question_pool!question_reviews_question_id_fkey (
          id,
          subject,
          question_text
        )
      `)
      .order('created_at', { ascending: false })
      .limit(500);

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setReviews((data as unknown as ReviewRow[]) || []);
    }
    if (!supabase) {
  setError('Supabase bağlantısı yapılandırılmamış.');
  setLoading(false);
  return;
}
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
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'tr'));
  }, [reviews]);

  const filteredReviews = useMemo(() => {
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
      return true;
    });
  }, [reviews, selectedTeacher, selectedDecision, onlyWithNotes]);

  const stats = useMemo(() => {
    const total = filteredReviews.length;
    const approved = filteredReviews.filter((r) => isApprove(r.decision)).length;
    const rejected = total - approved;
    const withNotes = filteredReviews.filter((r) => r.note && r.note.trim() !== '').length;
    return { total, approved, rejected, withNotes };
  }, [filteredReviews]);

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">İncelemeler yükleniyor...</div>;
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
          onClick={fetchReviews}
          className="ml-auto px-3 py-2 text-sm font-medium bg-slate-100 hover:bg-slate-200 rounded-lg"
        >
          Yenile
        </button>
      </div>

      {/* Özet Kartları */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <div className="text-xs text-slate-500">Toplam İnceleme</div>
          <div className="text-xl font-bold text-slate-800">{stats.total}</div>
        </div>
        <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
          <div className="text-xs text-emerald-700">Olur</div>
          <div className="text-xl font-bold text-emerald-800">{stats.approved}</div>
        </div>
        <div className="bg-rose-50 p-3 rounded-xl border border-rose-200">
          <div className="text-xs text-rose-700">Olmaz</div>
          <div className="text-xl font-bold text-rose-800">{stats.rejected}</div>
        </div>
        <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
          <div className="text-xs text-amber-700">Not Bırakılan</div>
          <div className="text-xl font-bold text-amber-800">{stats.withNotes}</div>
        </div>
      </div>

      {/* Liste */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="p-3">Tarih</th>
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
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="p-3 whitespace-nowrap text-xs text-slate-500">
                    {new Date(r.created_at).toLocaleString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="p-3 font-medium text-slate-800">
                    {r.reviewer?.full_name || 'Bilinmiyor'}
                  </td>
                  <td className="p-3">
                    <div className="font-mono text-xs text-slate-700">{r.question_id}</div>
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
                    {r.note ? r.note : <span className="text-slate-400">—</span>}
                  </td>
                  {onSelectQuestion && (
                    <td className="p-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => onSelectQuestion(r.question_id)}
                        className="px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg"
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
                <td colSpan={6} className="p-6 text-center text-slate-400">
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