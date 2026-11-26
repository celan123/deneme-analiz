import React from 'react';

interface FormattedQuestionTextProps {
  text: string;
  className?: string;
}

function renderInlineFormatting(
  input: string,
  keyPrefix = 't'
): React.ReactNode[] {
  const tokenRegex = /(\*\*[\s\S]+?\*\*|<u>[\s\S]+?<\/u>)/g;
  const parts = input.split(tokenRegex);

  return parts.map((part, idx) => {
    const key = `${keyPrefix}-${idx}`;

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const inner = part.slice(2, -2);
      return (
        <strong key={key} className="font-extrabold text-slate-950">
          {renderInlineFormatting(inner, `${key}-b`)}
        </strong>
      );
    }

    if (part.startsWith('<u>') && part.endsWith('</u>') && part.length > 7) {
      const inner = part.slice(3, -4);
      return (
        <u key={key} className="underline decoration-2 underline-offset-4">
          {renderInlineFormatting(inner, `${key}-u`)}
        </u>
      );
    }

    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

export const FormattedQuestionText: React.FC<FormattedQuestionTextProps> = ({
  text,
  className = '',
}) => {
  return (
    <div className={`whitespace-pre-line ${className}`}>
      {renderInlineFormatting(text)}
    </div>
  );
};