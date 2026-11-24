import type { Exam } from '../types/exam';

export type ExamSchedulePhase = 'ALWAYS_OPEN' | 'UPCOMING' | 'LIVE' | 'ENDED';

export interface ExamScheduleState {
  phase: ExamSchedulePhase;
  msUntilStart: number;
  msUntilEnd: number | null;
}

export function getExamScheduleState(
  exam: Pick<Exam, 'starts_at' | 'ends_at'>,
  nowMs: number = Date.now()
): ExamScheduleState {
  const startMs = exam.starts_at ? new Date(exam.starts_at).getTime() : null;
  const endMs = exam.ends_at ? new Date(exam.ends_at).getTime() : null;

  if (!startMs && !endMs) {
    return { phase: 'ALWAYS_OPEN', msUntilStart: 0, msUntilEnd: null };
  }

  if (startMs && nowMs < startMs) {
    return {
      phase: 'UPCOMING',
      msUntilStart: startMs - nowMs,
      msUntilEnd: endMs ? Math.max(0, endMs - nowMs) : null,
    };
  }

  if (endMs && nowMs >= endMs) {
    return { phase: 'ENDED', msUntilStart: 0, msUntilEnd: 0 };
  }

  return {
    phase: 'LIVE',
    msUntilStart: 0,
    msUntilEnd: endMs ? Math.max(0, endMs - nowMs) : null,
  };
}

export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const pad = (n: number) => String(n).padStart(2, '0');

  if (days > 0) {
    return `${days}g ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  }
  if (hours > 0) {
    return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export function formatScheduleWindow(
  startsAt?: string | null,
  endsAt?: string | null
): string | null {
  if (!startsAt && !endsAt) return null;

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
    });

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: 'short',
    });

  if (startsAt && endsAt) {
    const sDate = fmtDate(startsAt);
    const eDate = fmtDate(endsAt);
    if (sDate === eDate) {
      return `${sDate} • ${fmtTime(startsAt)} – ${fmtTime(endsAt)}`;
    }
    return `${sDate} ${fmtTime(startsAt)} – ${eDate} ${fmtTime(endsAt)}`;
  }

  if (startsAt) return `Başlangıç: ${fmtDate(startsAt)} ${fmtTime(startsAt)}`;
  return `Bitiş: ${fmtDate(endsAt!)} ${fmtTime(endsAt!)}`;
}

/** ISO tarihini HTML datetime-local input değerine çevirir */
export function toDatetimeLocalValue(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** HTML datetime-local input değerini Supabase TIMESTAMPTZ (ISO) formatına çevirir */
export function fromDatetimeLocalValue(localVal: string): string | null {
  if (!localVal.trim()) return null;
  const d = new Date(localVal);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}