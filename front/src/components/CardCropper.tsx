import { RotateCcw, RotateCw } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { straighten } from '@/lib/card-deskew';
import { useI18n } from '@/lib/i18n';

import { Button, Dialog } from './ui';

/** The crop as fractions of the turned photo: left, top, right, bottom. */
type Box = { l: number; t: number; r: number; b: number };
type Grip = 'move' | 'tl' | 'tr' | 'bl' | 'br';

/** Big enough to read small print, small enough to stay quick on a phone. */
const WORK_SIZE = 2400;
const MIN_SIDE = 0.15;
const START: Box = { l: 0.04, t: 0.04, r: 0.96, b: 0.96 };

/**
 * Before a card photo is read: the owner turns it upright and frames just the
 * card, so the table, hand and background aren't read as text. Hands back the
 * framed card as a new photo, or the photo as it was with "read it all".
 */
export function CardCropper({ file, onDone, onCancel }: { file: File | null; onDone: (file: File) => void; onCancel: () => void }) {
  const { tr } = useI18n();
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  const [quarter, setQuarter] = useState(0);
  const [tilt, setTilt] = useState(0);
  const [box, setBox] = useState<Box>(START);
  const [busy, setBusy] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ grip: Grip; x: number; y: number; box: Box } | null>(null);

  // The photo, shrunk to the working size once.
  useEffect(() => {
    setImage(null);
    setQuarter(0);
    setTilt(0);
    setBox(START);
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, WORK_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setImage(canvas);
      URL.revokeObjectURL(url);
    };
    // Not a picture the browser can show: read it as it is.
    img.onerror = () => {
      URL.revokeObjectURL(url);
      onDone(file);
    };
    img.src = url;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const degrees = quarter * 90 + tilt;
  /** The photo turned by [degrees] (straighten turns the other way). */
  const turned = (source: HTMLCanvasElement) => (degrees === 0 ? source : straighten(source, source.width, source.height, -degrees));

  // A small copy on screen, redrawn when turned.
  useEffect(() => {
    const canvas = preview.current;
    if (!image || !canvas) return;
    const scale = Math.min(1, 900 / Math.max(image.width, image.height));
    const small = document.createElement('canvas');
    small.width = Math.round(image.width * scale);
    small.height = Math.round(image.height * scale);
    small.getContext('2d')!.drawImage(image, 0, 0, small.width, small.height);
    const shown = turned(small);
    canvas.width = shown.width;
    canvas.height = shown.height;
    canvas.getContext('2d')!.drawImage(shown, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, degrees]);

  const turnQuarter = (by: 1 | -1) => {
    setQuarter((q) => (q + by + 4) % 4);
    setBox(START);
  };

  const grab = (grip: Grip) => (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    frame.current?.setPointerCapture(event.pointerId);
    drag.current = { grip, x: event.clientX, y: event.clientY, box };
  };

  const move = (event: ReactPointerEvent) => {
    const d = drag.current;
    const rect = frame.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const dx = (event.clientX - d.x) / rect.width;
    const dy = (event.clientY - d.y) / rect.height;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const b = { ...d.box };
    if (d.grip === 'move') {
      const w = b.r - b.l;
      const h = b.b - b.t;
      b.l = clamp(b.l + dx, 0, 1 - w);
      b.t = clamp(b.t + dy, 0, 1 - h);
      b.r = b.l + w;
      b.b = b.t + h;
    } else {
      if (d.grip.includes('l')) b.l = clamp(b.l + dx, 0, b.r - MIN_SIDE);
      if (d.grip.includes('r')) b.r = clamp(b.r + dx, b.l + MIN_SIDE, 1);
      if (d.grip.includes('t')) b.t = clamp(b.t + dy, 0, b.b - MIN_SIDE);
      if (d.grip.includes('b')) b.b = clamp(b.b + dy, b.t + MIN_SIDE, 1);
    }
    setBox(b);
  };

  const finish = async () => {
    if (!image || !file) return;
    setBusy(true);
    try {
      const whole = turned(image);
      const x = Math.round(box.l * whole.width);
      const y = Math.round(box.t * whole.height);
      const w = Math.round((box.r - box.l) * whole.width);
      const h = Math.round((box.b - box.t) * whole.height);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      out.getContext('2d')!.drawImage(whole, x, y, w, h, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/jpeg', 0.93));
      onDone(blob ? new File([blob], 'card.jpg', { type: 'image/jpeg' }) : file);
    } finally {
      setBusy(false);
    }
  };

  const corner = (grip: Exclude<Grip, 'move'>, place: string) => (
    <span
      onPointerDown={grab(grip)}
      className={`absolute h-7 w-7 touch-none rounded-full border-[3px] border-white bg-orange shadow ${place}`}
      style={{ cursor: grip === 'tl' || grip === 'br' ? 'nwse-resize' : 'nesw-resize' }}
    />
  );

  return (
    <Dialog open={Boolean(file)} onClose={onCancel} title={tr('ظبّط صورة الكارت', 'Frame the card')} wide>
      <p className="mb-3 text-sm text-ink-soft">{tr('لف الصورة لحد ما الكلام يبقى معدول، واسحب الأركان على حدود الكارت بس.', 'Turn the photo until the text is upright, and drag the corners to the edges of the card.')}</p>
      {!image ? (
        <div className="h-64 animate-pulse rounded-xl bg-canvas" />
      ) : (
        <div className="flex justify-center">
          <div ref={frame} className="relative touch-none select-none" onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
            <canvas ref={preview} className="block max-h-[50vh] max-w-full rounded-lg" />
            {/* Everything outside the card, dimmed. */}
            <div
              onPointerDown={grab('move')}
              className="absolute cursor-move rounded-sm ring-2 ring-orange"
              style={{
                left: `${box.l * 100}%`,
                top: `${box.t * 100}%`,
                width: `${(box.r - box.l) * 100}%`,
                height: `${(box.b - box.t) * 100}%`,
                boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
              }}
            >
              {corner('tl', '-left-3.5 -top-3.5')}
              {corner('tr', '-right-3.5 -top-3.5')}
              {corner('bl', '-bottom-3.5 -left-3.5')}
              {corner('br', '-bottom-3.5 -right-3.5')}
            </div>
          </div>
        </div>
      )}
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={() => turnQuarter(-1)} className="rounded-lg p-2 ring-1 ring-line hover:ring-navy" aria-label={tr('لف شمال', 'Turn left')} title={tr('لف شمال', 'Turn left')}>
          <RotateCcw className="h-5 w-5" />
        </button>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-bold text-ink-soft">
          <span className="shrink-0">{tr('ميل', 'Tilt')}</span>
          <input type="range" min={-20} max={20} step={0.5} value={tilt} onChange={(e) => setTilt(Number(e.target.value))} className="min-w-0 flex-1 accent-orange" aria-label={tr('عدّل ميل الصورة', 'Adjust the tilt')} />
        </label>
        <button type="button" onClick={() => turnQuarter(1)} className="rounded-lg p-2 ring-1 ring-line hover:ring-navy" aria-label={tr('لف يمين', 'Turn right')} title={tr('لف يمين', 'Turn right')}>
          <RotateCw className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" type="button" onClick={() => file && onDone(file)} disabled={busy}>
          {tr('اقرا الصورة زي ما هي', 'Read it as it is')}
        </Button>
        <Button type="button" onClick={() => void finish()} disabled={!image || busy}>
          {tr('اقرا الكارت', 'Read the card')}
        </Button>
      </div>
    </Dialog>
  );
}
