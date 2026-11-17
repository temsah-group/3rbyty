import type { Worker } from 'tesseract.js';

import { straighten, tiltOf } from './card-deskew';
import { findPhone, parseCard, PHONE_CONFIDENCE, westernDigits, type CardDetails, type CardLine } from './card-parse';

/**
 * Reads a business card in the browser with Tesseract: free, nothing leaves
 * the phone. Used when the server has no Claude key, or Claude fails. Loaded
 * on first use (~8 MB, then cached by the browser).
 *
 * Two readers look at the same photo: an Arabic one for the words (with
 * English loaded too it takes bold or ornate Arabic words for English ones),
 * and an English one for the numbers (the Arabic one drops the zeros of small
 * Latin digits).
 */

let report: ((progress: number) => void) | null = null;
const PATHS = {
  // Served by the site itself (see `ocrAssets` in vite.config.ts).
  workerPath: '/ocr/worker.min.js',
  corePath: '/ocr/core',
  langPath: '/ocr/lang',
  // The browser keeps the model under this name, whatever folder it came
  // from: give it a new name with any new model, or visitors keep the old one.
  cachePath: 'ocr-v1',
  gzip: true,
};

const workers = new Map<string, Promise<Worker>>();

function getWorker(lang: 'ara' | 'eng'): Promise<Worker> {
  let worker = workers.get(lang);
  if (!worker) {
    worker = (async () => {
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      const w = await createWorker(lang, OEM.LSTM_ONLY, {
        ...PATHS,
        logger: (m) => {
          // Loading the data is most of the wait the first time; reading is the rest.
          if (m.status === 'recognizing text') report?.(0.5 + m.progress / 2);
          else if (m.status.startsWith('loading')) report?.(m.progress / 2);
        },
      });
      // Cards are a few scattered lines, not a page of text.
      await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
      return w;
    })();
    workers.set(lang, worker);
    // A failed load can be tried again.
    worker.catch(() => workers.delete(lang));
  }
  return worker;
}

/**
 * Grey, about 2000px on the long side (Tesseract reads small print better a
 * little enlarged, but worse much enlarged), light text on a dark card turned
 * dark on light, the light evened out (a shadow or a darker corner made white
 * like the rest of the paper), stretched contrast, and a tilted card turned
 * level (past a few degrees Tesseract loses whole lines).
 */
async function prepare(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(2.5, 2000 / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const grey = new Float32Array(px.length / 4);
  let sum = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    grey[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    sum += grey[j];
  }
  if (sum / grey.length < 110) for (let j = 0; j < grey.length; j++) grey[j] = 255 - grey[j];

  const paper = paperLight(grey, canvas.width, canvas.height);
  const histogram = new Uint32Array(256);
  for (let j = 0; j < grey.length; j++) {
    // Evened out only where the light is uneven: a scan or an evenly lit photo is left as it is.
    if (paper) grey[j] = Math.min(255, (grey[j] * 255) / Math.max(24, paper[j]));
    histogram[Math.round(grey[j])]++;
  }
  // Ignore the darkest and lightest 1% when stretching, so a glare spot or a logo does not set the range.
  const cut = grey.length * 0.01;
  let low = 0;
  let high = 255;
  for (let n = 0; low < 255 && (n += histogram[low]) < cut; low++);
  for (let n = 0; high > 0 && (n += histogram[high]) < cut; high--);
  const range = Math.max(1, high - low);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    px[i] = px[i + 1] = px[i + 2] = ((grey[j] - low) * 255) / range;
  }
  ctx.putImageData(image, 0, 0);
  // Turned level last, once the paper is white: the corners it adds are white too.
  // A card only slightly askew reads as well as it is, and is left alone.
  const tilt = tiltOf(canvas);
  return Math.abs(tilt) >= MIN_TILT ? straighten(canvas, canvas.width, canvas.height, tilt) : canvas;
}

/**
 * How bright the paper is around each pixel: the photo shrunk a lot, the
 * brightest of each small neighbourhood kept (so the dark print drops out),
 * and stretched back smoothly to full size. Null when it is about the same
 * everywhere.
 */
function paperLight(grey: Float32Array, width: number, height: number): Float32Array | null {
  const step = 24;
  const w = Math.max(3, Math.ceil(width / step));
  const h = Math.max(3, Math.ceil(height / step));
  let small = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // The brightest of the block, give or take a speck of glare: its 90th percentile.
      const values: number[] = [];
      for (let yy = y * step; yy < Math.min(height, (y + 1) * step); yy += 2)
        for (let xx = x * step; xx < Math.min(width, (x + 1) * step); xx += 2) values.push(grey[yy * width + xx]);
      values.sort((a, b) => a - b);
      small[y * w + x] = values[Math.floor(values.length * 0.9)] ?? 255;
    }
  }
  // Text bigger than a block: widen to the brightest neighbour, twice.
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let max = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = Math.min(h - 1, Math.max(0, y + dy));
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            max = Math.max(max, small[yy * w + xx]);
          }
        next[y * w + x] = max;
      }
    small = next;
  }
  // Paper about as bright everywhere (the darkest tenth within 12% of the
  // brightest tenth): nothing to even out.
  const sorted = Float32Array.from(small).sort();
  const dim = sorted[Math.floor(sorted.length * 0.1)]!;
  const bright = sorted[Math.floor(sorted.length * 0.9)]!;
  if (dim >= bright * 0.88) return null;
  // Back to full size, bilinear.
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) / step - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) / step - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = fx - x0;
      const top = small[y0 * w + x0] * (1 - tx) + small[y0 * w + x1] * tx;
      const bottom = small[y1 * w + x0] * (1 - tx) + small[y1 * w + x1] * tx;
      out[y * width + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/** Below this (degrees) a card is read as it is: turning it gains nothing and costs sharpness. */
const MIN_TILT = 3;

type Box = { x0: number; y0: number; x1: number; y1: number };

/** Every line one reader sees on the photo. */
async function readLines(w: Worker, canvas: HTMLCanvasElement): Promise<(CardLine & { box: Box })[]> {
  const { data } = await w.recognize(canvas, {}, { blocks: true });
  return (data.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.map((line) => ({
        text: line.text,
        height: line.rowAttributes?.rowHeight || line.bbox.y1 - line.bbox.y0,
        confidence: line.confidence,
        box: line.bbox,
      })),
    ),
  );
}

/**
 * The lines the numbers come from, read in English. A number the parser would
 * not take (unsure, or digits dropped, often the zeros of small print) is read
 * again on its own, enlarged and as digits only, and kept only if it has every
 * digit the first read had, in order.
 */
async function readNumbers(w: Worker, canvas: HTMLCanvasElement): Promise<CardLine[]> {
  const lines = await readLines(w, canvas);
  for (const line of lines) {
    const digits = westernDigits(line.text).replace(/\D/g, '');
    if (digits.length < 7 || (findPhone(line.text) && line.confidence >= PHONE_CONFIDENCE)) continue;
    const again = await readDigits(w, canvas, line.box, WESTERN);
    const phone = again && findPhone(again.text);
    // Compared as printed: in an Arabic line the groups can read in the other order.
    if (phone && isSubsequence(digits, again.text.replace(/\D/g, ''))) {
      line.text = `${line.text} ${phone}`;
      line.confidence = Math.max(line.confidence, PHONE_CONFIDENCE);
    }
  }
  return lines;
}

/** Whether every character of [part] appears in [whole], in order. */
function isSubsequence(part: string, whole: string): boolean {
  let at = 0;
  for (const ch of whole) if (ch === part[at]) at++;
  return at === part.length;
}

const WESTERN = '0123456789+-() ';
/** Line height digits are enlarged to: Tesseract reads digits best around this size. */
const DIGIT_HEIGHT = 64;

/**
 * One line read again knowing only [chars], in single-line mode, cut out and
 * enlarged on its own so small print (and its zeros) is not lost.
 */
async function readDigits(w: Worker, canvas: HTMLCanvasElement, box: Box, chars: string) {
  const { PSM } = await import('tesseract.js');
  const pad = Math.round((box.y1 - box.y0) * 0.35);
  const left = Math.max(0, box.x0 - pad);
  const top = Math.max(0, box.y0 - pad);
  const width = Math.min(canvas.width, box.x1 + pad) - left;
  const height = Math.min(canvas.height, box.y1 + pad) - top;
  if (width < 4 || height < 4) return null;
  const scale = Math.min(4, Math.max(1, (DIGIT_HEIGHT * 1.7) / height));
  const crop = document.createElement('canvas');
  crop.width = Math.round(width * scale);
  crop.height = Math.round(height * scale);
  const ctx = crop.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, left, top, width, height, 0, 0, crop.width, crop.height);
  await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: chars });
  try {
    const { data } = await w.recognize(crop);
    return { text: data.text, confidence: data.confidence };
  } catch {
    return null;
  } finally {
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '' });
  }
}

/** The card's lines: the words as the Arabic reader saw them, the numbers as the English one did. */
export async function readCardLines(file: File, onProgress?: (progress: number) => void): Promise<{ words: CardLine[]; numbers: CardLine[] }> {
  report = onProgress ?? null;
  try {
    const [arabic, canvas] = await Promise.all([getWorker('ara'), prepare(file)]);
    const words = await readLines(arabic, canvas);
    report = null;
    const numbers = await readNumbers(await getWorker('eng'), canvas);
    return { words, numbers };
  } finally {
    report = null;
  }
}

/** Reads the shop's details off a photo of its card, in the browser. */
export async function readCardLocally(file: File, onProgress?: (progress: number) => void): Promise<CardDetails> {
  const { words, numbers } = await readCardLines(file, onProgress);
  return parseCard(words, numbers);
}
