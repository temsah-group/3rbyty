import type { Worker } from 'tesseract.js';

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
 * Grey, stretched contrast, about 2000px on the long side (Tesseract reads
 * small print better a little enlarged, but worse much enlarged), and light
 * text on a dark card turned dark on light.
 */
async function prepare(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(2.5, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const grey = new Uint8ClampedArray(px.length / 4);
  const histogram = new Uint32Array(256);
  let sum = 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    grey[j] = g;
    histogram[g]++;
    sum += g;
  }
  // Ignore the darkest and lightest 1% when stretching, so a glare spot or a logo does not set the range.
  const cut = grey.length * 0.01;
  let low = 0;
  let high = 255;
  for (let n = 0; low < 255 && (n += histogram[low]) < cut; low++);
  for (let n = 0; high > 0 && (n += histogram[high]) < cut; high--);
  const range = Math.max(1, high - low);
  const invert = sum / grey.length < 110;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    let v = ((grey[j] - low) * 255) / range;
    if (invert) v = 255 - v;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

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
