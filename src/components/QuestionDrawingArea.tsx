import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface DrawingPoint {
  x: number; // 0..1 arası normalize yatay koordinat
  y: number; // 0..1 arası normalize dikey koordinat
}

export interface DrawingStroke {
  mode: 'pen' | 'eraser';
  color: string;
  width: number;
  points: DrawingPoint[];
}

interface QuestionDrawingAreaProps {
  strokes: DrawingStroke[];
  onStrokesChange: (nextStrokes: DrawingStroke[]) => void;
  children: React.ReactNode;
}

type ToolMode = 'NONE' | 'PEN' | 'ERASER';

const PEN_COLORS = [
  { name: 'Çivit', hex: '#4f46e5' },
  { name: 'Kırmızı', hex: '#e11d48' },
  { name: 'Koyu', hex: '#0f172a' },
  { name: 'Yeşil', hex: '#059669' },
  { name: 'Turuncu', hex: '#d97706' },
];

export const QuestionDrawingArea: React.FC<QuestionDrawingAreaProps> = ({
  strokes,
  onStrokesChange,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef<boolean>(false);
  const activeStrokeRef = useRef<DrawingStroke | null>(null);

  const [tool, setTool] = useState<ToolMode>('NONE');
  const [activeColor, setActiveColor] = useState<string>(PEN_COLORS[0].hex);
  const [colorMenuOpen, setColorMenuOpen] = useState<boolean>(false);

  const drawSingleStroke = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      stroke: DrawingStroke,
      width: number,
      height: number
    ) => {
      if (stroke.points.length === 0) return;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke.width;

      if (stroke.mode === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.fillStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
      }

      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        ctx.beginPath();
        ctx.arc(p.x * width, p.y * height, stroke.width / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }

      ctx.beginPath();
      const first = stroke.points[0];
      ctx.moveTo(first.x * width, first.y * height);

      for (let i = 1; i < stroke.points.length; i++) {
        const prev = stroke.points[i - 1];
        const curr = stroke.points[i];
        const midX = ((prev.x + curr.x) / 2) * width;
        const midY = ((prev.y + curr.y) / 2) * height;
        ctx.quadraticCurveTo(prev.x * width, prev.y * height, midX, midY);
      }

      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x * width, last.y * height);
      ctx.stroke();
      ctx.restore();
    },
    []
  );

  const syncAndRedraw = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    for (const stroke of strokes) {
      drawSingleStroke(ctx, stroke, rect.width, rect.height);
    }

    if (activeStrokeRef.current) {
      drawSingleStroke(ctx, activeStrokeRef.current, rect.width, rect.height);
    }
  }, [strokes, drawSingleStroke]);

  // Soru değiştikçe veya çizim listesi güncellendikçe yeniden çiz
  useEffect(() => {
    syncAndRedraw();
  }, [syncAndRedraw]);

  // Ekran boyutu, SVG yüklenmesi veya tablet döndürme durumlarında tuvali hizala
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      syncAndRedraw();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [syncAndRedraw]);

  const getNormalizedPoint = (
    e: React.PointerEvent<HTMLCanvasElement>
  ): DrawingPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'NONE') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    setColorMenuOpen(false);
    const point = getNormalizedPoint(e);
    if (!point) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;

    const newStroke: DrawingStroke = {
      mode: tool === 'ERASER' ? 'eraser' : 'pen',
      color: activeColor,
      width: tool === 'ERASER' ? 20 : 2.6,
      points: [point],
    };

    activeStrokeRef.current = newStroke;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      const rect = canvas.getBoundingClientRect();
      drawSingleStroke(ctx, newStroke, rect.width, rect.height);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !activeStrokeRef.current) return;

    const point = getNormalizedPoint(e);
    if (!point) return;

    const stroke = activeStrokeRef.current;
    const prev = stroke.points[stroke.points.length - 1];
    stroke.points.push(point);

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx && prev) {
      const rect = canvas.getBoundingClientRect();
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke.width;

      if (stroke.mode === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
      }

      ctx.beginPath();
      ctx.moveTo(prev.x * rect.width, prev.y * rect.height);
      ctx.lineTo(point.x * rect.width, point.y * rect.height);
      ctx.stroke();
      ctx.restore();
    }
  };

  const finishStroke = () => {
    if (!isDrawingRef.current || !activeStrokeRef.current) return;

    isDrawingRef.current = false;
    const finished = activeStrokeRef.current;
    activeStrokeRef.current = null;

    if (finished.points.length > 0) {
      onStrokesChange([...strokes, finished]);
    }
  };

  // Seçili kalem renginde ince blur border
  const containerBorderStyle: React.CSSProperties | undefined =
    tool === 'PEN'
      ? {
          borderColor: activeColor,
          boxShadow: `0 0 0 1px ${activeColor}66, 0 0 18px -2px ${activeColor}66, inset 0 0 10px -4px ${activeColor}30`,
        }
      : tool === 'ERASER'
        ? {
            borderColor: '#94a3b8',
            boxShadow: '0 0 0 1px #94a3b866, 0 0 14px -2px #64748b44',
          }
        : undefined;

  return (
    <div
      ref={containerRef}
      style={containerBorderStyle}
      className="relative rounded-2xl border border-slate-200/80 bg-white transition-all duration-200 p-4 sm:p-5"
    >
      {/* EN ÜSTTE 4 KÜÇÜK SİMGELİ ÇİZİM ARAÇ ÇUBUĞU */}
      <div className="relative z-20 flex items-center justify-end mb-3">
        <div className="relative inline-flex items-center gap-1 rounded-xl bg-slate-100/90 backdrop-blur-xs border border-slate-200/80 p-1 shadow-xs">
          {/* 1. KALEM */}
          <button
            type="button"
            title={tool === 'PEN' ? 'Kalemi Kapat' : 'Kalemle Çiz'}
            onClick={() => {
              setColorMenuOpen(false);
              setTool((prev) => (prev === 'PEN' ? 'NONE' : 'PEN'));
            }}
            style={
              tool === 'PEN'
                ? { backgroundColor: activeColor, color: '#ffffff' }
                : undefined
            }
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
              tool === 'PEN'
                ? 'shadow-xs'
                : 'text-slate-600 hover:bg-white hover:text-slate-900'
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>

          {/* 2. RENK SEÇİCİ */}
          <button
            type="button"
            title="Kalem Rengi"
            onClick={() => setColorMenuOpen((prev) => !prev)}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white transition-all cursor-pointer"
          >
            <span
              className="w-4 h-4 rounded-full border-2 border-white shadow-xs ring-1 ring-slate-300"
              style={{ backgroundColor: activeColor }}
            />
          </button>

          {/* 3. SİLGİ */}
          <button
            type="button"
            title={tool === 'ERASER' ? 'Silgiyi Kapat' : 'Silgi'}
            onClick={() => {
              setColorMenuOpen(false);
              setTool((prev) => (prev === 'ERASER' ? 'NONE' : 'ERASER'));
            }}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
              tool === 'ERASER'
                ? 'bg-slate-800 text-white shadow-xs'
                : 'text-slate-600 hover:bg-white hover:text-slate-900'
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
            >
              <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
              <path d="M22 21H7" />
              <path d="m5 11 9 9" />
            </svg>
          </button>

          {/* 4. TÜMÜNÜ SİL */}
          <button
            type="button"
            title="Tüm Çizimleri Temizle"
            disabled={strokes.length === 0}
            onClick={() => {
              setColorMenuOpen(false);
              onStrokesChange([]);
            }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-slate-600 transition-all cursor-pointer disabled:cursor-not-allowed"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
            >
              <path d="M3 6h18" />
              <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            </svg>
          </button>

          {/* AÇILIR MİNİ RENK PALETİ */}
          {colorMenuOpen && (
            <div className="absolute right-0 top-11 z-30 flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 p-2 shadow-lg">
              {PEN_COLORS.map((c) => {
                const isSelected = activeColor === c.hex;
                return (
                  <button
                    key={c.hex}
                    type="button"
                    title={c.name}
                    onClick={() => {
                      setActiveColor(c.hex);
                      setTool('PEN');
                      setColorMenuOpen(false);
                    }}
                    className={`w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110 ${
                      isSelected ? 'ring-2 ring-offset-2 ring-slate-900' : ''
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* SORU İÇERİĞİ (SVG + SORU METNİ + İSTENİRSE ŞIKLAR) */}
      <div className={tool !== 'NONE' ? 'select-none' : undefined}>
        {children}
      </div>

      {/* ŞEFFAF ÇİZİM KATMANI (KALEM/SİLGİ KAPALIYKEN TIKLAMALARI ALTA GEÇİRİR) */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        className={`absolute inset-0 z-10 w-full h-full rounded-2xl ${
          tool === 'NONE'
            ? 'pointer-events-none'
            : tool === 'ERASER'
              ? 'pointer-events-auto touch-none cursor-cell'
              : 'pointer-events-auto touch-none cursor-crosshair'
        }`}
      />
    </div>
  );
};