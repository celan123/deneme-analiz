import type { AgentQuestionInput, ValidOption } from '../types/exam';

/**
 * Soru ajanı JSON'u için mekanik kural doğrulayıcısı.
 * Anlamsal kontroller (hesap doğruluğu, müfredat sınırı) burada YOKTUR;
 * onlar yapay zekâ denetleyicisinin ve öğretmen incelemesinin işidir.
 */

export type IssueLevel = 'error' | 'warning';

export interface QuestionIssue {
  level: IssueLevel;
  message: string;
}

export interface ValidatedQuestion {
  index: number;
  label: string;
  question: AgentQuestionInput;
  issues: QuestionIssue[];
  /** Hata yoksa true (uyarılar kaydı engellemez) */
  isValid: boolean;
  /** Havuzda aynı soru varsa onun kimliği */
  existingPoolId: string | null;
  /** sinif alanı yoksa kazanım kodundan çıkarılan sınıf */
  resolvedGrade: number | null;
}

export const REQUIRED_OPTIONS: ValidOption[] = ['A', 'B', 'C', 'D'];
export const MIN_SVG_FONT_SIZE = 18;
export const MIN_SVG_ASPECT_RATIO = 2.1;

/** "MAT.5.1.1" -> 5, "FB.6.1.3, FB.6.1.4" -> 6, "DYS.DO.5.8" -> 5 */
export function inferGradeFromOutcomeCode(code?: string | null): number | null {
  if (!code) return null;
  const match = code.match(/\.(\d+)\./);
  if (!match) return null;
  const grade = Number(match[1]);
  return grade >= 1 && grade <= 12 ? grade : null;
}

function normalizeForCompare(value: unknown): string {
  return String(value ?? '')
    .toLocaleLowerCase('tr')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Soru metni + A–D şıklarından kopya tespiti için parmak izi üretir. */
export function questionFingerprint(
  questionText: unknown,
  options: Partial<Record<string, unknown>> | null | undefined
): string {
  const opts = REQUIRED_OPTIONS.map((k) => normalizeForCompare(options?.[k]));
  return `${normalizeForCompare(questionText)}||${opts.join('|')}`;
}

function checkSvg(svg: string, issues: QuestionIssue[]) {
  const svgMatch = svg.match(/<svg[\s\S]*<\/svg>/i);
  if (!svgMatch) {
    issues.push({ level: 'error', message: 'SVG kodunda <svg>…</svg> bulunamadı.' });
    return;
  }
  const code = svgMatch[0];

  if (/<script/i.test(code) || /\son\w+\s*=/i.test(code) || /javascript:/i.test(code)) {
    issues.push({
      level: 'error',
      message: 'SVG içinde script veya olay (onload vb.) kodu var.',
    });
  }

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(code, 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
      issues.push({ level: 'error', message: 'SVG geçerli bir XML değil (bozuk etiket).' });
    }
  }

  const vb = code.match(
    /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i
  );
  if (!vb) {
    issues.push({ level: 'error', message: 'SVG viewBox tanımlı değil.' });
  } else {
    const w = Number(vb[1]);
    const h = Number(vb[2]);
    if (h > 0) {
      const ratio = w / h;
      if (ratio < MIN_SVG_ASPECT_RATIO) {
        issues.push({
          level: 'error',
          message: `SVG oranı ${ratio.toFixed(2)} (${w}×${h}); en az ${MIN_SVG_ASPECT_RATIO} olmalı (yatay çizim).`,
        });
      }
    }
  }

  const sizes = Array.from(
    code.matchAll(/font-size\s*[:=]\s*["']?\s*([\d.]+)/gi),
    (m) => Number(m[1])
  ).filter((n) => !Number.isNaN(n));

  if (sizes.length > 0) {
    const min = Math.min(...sizes);
    if (min < MIN_SVG_FONT_SIZE) {
      issues.push({
        level: 'error',
        message: `SVG yazı boyutu ${min}; en az ${MIN_SVG_FONT_SIZE} olmalı (mobilde okunurluk).`,
      });
    }
  } else if (/<text/i.test(code)) {
    issues.push({
      level: 'warning',
      message: 'SVG yazılarında font-size belirtilmemiş (tarayıcı varsayılanı 16).',
    });
  }
}

export function validateAgentQuestions(
  rawList: unknown[],
  existingPool: Map<string, string> = new Map()
): ValidatedQuestion[] {
  const seenInBatch = new Map<string, number>();

  return rawList.map((raw, index) => {
    const issues: QuestionIssue[] = [];
    const q = (raw && typeof raw === 'object' ? raw : {}) as AgentQuestionInput;
    const label = q.id?.toString().trim() || `${index + 1}. soru`;

    if (!raw || typeof raw !== 'object') {
      issues.push({ level: 'error', message: 'Geçerli bir JSON nesnesi değil.' });
    }

    // Zorunlu alanlar
    if (!q.ders?.toString().trim()) issues.push({ level: 'error', message: '"ders" alanı boş.' });
    if (!q.kazanimKodu?.toString().trim())
      issues.push({ level: 'error', message: '"kazanimKodu" alanı boş.' });
    if (!q.soruMetni?.toString().trim())
      issues.push({ level: 'error', message: '"soruMetni" alanı boş.' });

    // Şıklar ve doğru cevap
    const options = (q.secenekler ?? {}) as Record<string, unknown>;
    const optionKeys = Object.keys(options);
    const missing = REQUIRED_OPTIONS.filter((k) => !String(options[k] ?? '').trim());
    const extra = optionKeys.filter((k) => !REQUIRED_OPTIONS.includes(k as ValidOption));
    if (missing.length > 0)
      issues.push({ level: 'error', message: `Eksik/boş şık: ${missing.join(', ')}.` });
    if (extra.length > 0)
      issues.push({ level: 'error', message: `Fazla şık: ${extra.join(', ')} (yalnızca A–D).` });

    const correct = String(q.dogruCevap ?? '').trim().toUpperCase();
    const correctValid = REQUIRED_OPTIONS.includes(correct as ValidOption);
    if (!correctValid)
      issues.push({
        level: 'error',
        message: `"dogruCevap" geçersiz: "${q.dogruCevap ?? ''}" (A, B, C veya D olmalı).`,
      });

    // Çeldirici analizi: yalnızca 3 yanlış şık
    if (!q.celdiriciAnalizi || Object.keys(q.celdiriciAnalizi).length === 0) {
      issues.push({ level: 'warning', message: 'Çeldirici analizi yok.' });
    } else if (correctValid) {
      const daKeys = Object.keys(q.celdiriciAnalizi).sort();
      const expected = REQUIRED_OPTIONS.filter((k) => k !== correct).sort();
      if (daKeys.join() !== expected.join()) {
        issues.push({
          level: 'error',
          message: `Çeldirici analizi tam olarak yanlış şıkları (${expected.join(', ')}) açıklamalı; gelen: ${daKeys.join(', ') || '—'}.`,
        });
      }
    }

    // Metin biçimi
    const text = String(q.soruMetni ?? '');
    if (text.trim()) {
      if (!text.includes('\n\n')) {
        issues.push({ level: 'warning', message: 'Soru kökü ayrı paragrafta değil (\\n\\n yok).' });
      } else {
        const lastPara = text.split('\n\n').pop()?.trim() ?? '';
        if (!/^\*\*[\s\S]*\*\*$/.test(lastPara)) {
          issues.push({ level: 'warning', message: 'Son paragraf (soru kökü) **kalın** değil.' });
        }
      }
      const capsWords = Array.from(
        text.replace(/<[^>]+>/g, ' ').matchAll(/(?:^|[^\p{L}])(\p{Lu}{4,})(?=[^\p{L}]|$)/gu),
        (m) => m[1]
      );
      if (capsWords.length > 0) {
        issues.push({
          level: 'warning',
          message: `Büyük harfle vurgu olabilir: ${Array.from(new Set(capsWords)).join(', ')} (kısaltma ise sorun yok).`,
        });
      }
    }

    // SVG
    const hasSvg = typeof q.svgKodu === 'string' && q.svgKodu.includes('<svg');
    if (q.gorselGerekliMi && !hasSvg) {
      issues.push({ level: 'error', message: 'gorselGerekliMi = true ama geçerli SVG yok.' });
    }
    if (hasSvg) checkSvg(q.svgKodu as string, issues);

    // Sınıf
    const inferred = inferGradeFromOutcomeCode(q.kazanimKodu);
    const resolvedGrade = typeof q.sinif === 'number' ? q.sinif : inferred;
    if (typeof q.sinif === 'number' && inferred !== null && inferred !== q.sinif) {
      issues.push({
        level: 'warning',
        message: `"sinif" (${q.sinif}) ile kazanım kodundaki sınıf (${inferred}) farklı.`,
      });
    }
    if (resolvedGrade === null) {
      issues.push({ level: 'warning', message: 'Sınıf belirlenemedi ("sinif" yok, kazanım kodundan da çıkmadı).' });
    }

    // Kopya kontrolü
    const fp = questionFingerprint(q.soruMetni, options);
    const existingPoolId = existingPool.get(fp) ?? null;
    const firstIndex = seenInBatch.get(fp);
    if (firstIndex !== undefined) {
      issues.push({
        level: 'error',
        message: `Bu JSON içinde kopya: ${firstIndex + 1}. soru ile aynı.`,
      });
    } else {
      seenInBatch.set(fp, index);
    }

    return {
      index,
      label,
      question: q,
      issues,
      isValid: !issues.some((i) => i.level === 'error'),
      existingPoolId,
      resolvedGrade,
    };
  });
}
