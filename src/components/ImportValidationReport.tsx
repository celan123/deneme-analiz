import React from 'react';
import type { ValidatedQuestion } from '../utils/questionValidator';

interface ImportValidationReportProps {
  results: ValidatedQuestion[];
  /** pool: havuzda olan soru atlanır. exam: havuzdaki mevcut soru kullanılır. */
  mode: 'pool' | 'exam';
  checkingPool?: boolean;
}

export const ImportValidationReport: React.FC<ImportValidationReportProps> = ({
  results,
  mode,
  checkingPool = false,
}) => {
  if (results.length === 0) return null;

  const errorCount = results.filter((r) => !r.isValid).length;
  const inPool = results.filter((r) => r.isValid && r.existingPoolId).length;
  const warningCount = results.filter(
    (r) => r.isValid && r.issues.some((i) => i.level === 'warning')
  ).length;
  const readyCount =
    mode === 'pool' ? results.length - errorCount - inPool : results.length - errorCount;

  const problemRows = results.filter(
    (r) => r.issues.length > 0 || (mode === 'pool' && r.existingPoolId)
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
        <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
          ✓ {readyCount} soru hazır
        </span>
        {errorCount > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
            ✕ {errorCount} soru kurallara uymuyor
          </span>
        )}
        {inPool > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
            {mode === 'pool'
              ? `↺ ${inPool} soru havuzda zaten var (atlanacak)`
              : `↺ ${inPool} soru havuzda var (mevcut soru kullanılacak)`}
          </span>
        )}
        {warningCount > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
            ! {warningCount} soruda uyarı
          </span>
        )}
        {checkingPool && (
          <span className="text-slate-400 font-semibold">Havuz kontrol ediliyor…</span>
        )}
      </div>

      {problemRows.length > 0 && (
        <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 text-xs">
          {problemRows.map((r) => (
            <li key={r.index} className="py-2 space-y-1">
              <p className="font-bold text-slate-800">
                {r.index + 1}. {r.label !== `${r.index + 1}. soru` ? `(${r.label})` : ''}
                {mode === 'pool' && r.existingPoolId && (
                  <span className="ml-2 font-semibold text-sky-700">
                    Havuzda var: {r.existingPoolId}
                  </span>
                )}
              </p>
              {r.issues.map((issue, i) => (
                <p
                  key={i}
                  className={
                    issue.level === 'error'
                      ? 'text-rose-700 font-semibold'
                      : 'text-amber-700'
                  }
                >
                  {issue.level === 'error' ? '✕ ' : '! '}
                  {issue.message}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
