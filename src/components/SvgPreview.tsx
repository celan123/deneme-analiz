import React, { useMemo } from 'react';

interface SvgPreviewProps {
  svgCode?: string | null;
}

function normalizeAndSanitizeSvg(raw: string): string | null {
  let cleaned = raw.trim();

  // Markdown ```svg ... ``` sarmalı varsa temizle
  const fenced = cleaned.match(/^```(?:svg|xml|html)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) cleaned = fenced[1].trim();

  // HTML entity (&lt;svg ...&gt;) olarak geldiyse çöz
  if (cleaned.includes('&lt;svg')) {
    cleaned = cleaned
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  // Sadece <svg ... </svg> aralığını al
  const svgMatch = cleaned.match(/<svg[\s\S]*?<\/svg>/i);
  if (!svgMatch) return null;

  return svgMatch[0]
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '');
}

export const SvgPreview: React.FC<SvgPreviewProps> = ({ svgCode }) => {
  const safeSvg = useMemo(() => {
    if (!svgCode || typeof svgCode !== 'string') return null;
    return normalizeAndSanitizeSvg(svgCode);
  }, [svgCode]);

  if (!safeSvg) return null;

  return (
    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 overflow-x-auto">
      {/* Flex yerine block + sabit max-width: viewBox'lu SVG'lerin 0px'e çökmesini engeller */}
      <div
        className="w-full max-w-[480px] mx-auto [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: safeSvg }}
      />
    </div>
  );
};