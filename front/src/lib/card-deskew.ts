/** Tilts the reader is told about; beyond this the photo is taken as it is. */
const MAX_TILT = 15;

/**
 * How far the card in [canvas] is turned, in degrees (clockwise positive):
 * the angle at which its ink lines up into the fewest, fullest rows. The
 * text lines and the card's own edges all agree on it; a plain table around
 * the card has no ink and does not count.
 */
export function tiltOf(canvas: HTMLCanvasElement): number {
  const width = Math.min(600, canvas.width);
  const scale = width / canvas.width;
  const height = Math.max(1, Math.round(canvas.height * scale));
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, width, height);
  const px = ctx.getImageData(0, 0, width, height).data;

  // Ink: clearly darker than the area around it (a mean over a small square,
  // from a summed-area table), so a dark table or a shadow is not ink.
  const sums = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += px[(y * width + x) * 4];
      sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1] + row;
    }
  }
  const r = 12;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      const area = (x1 - x0) * (y1 - y0);
      const mean = (sums[y1 * (width + 1) + x1] - sums[y0 * (width + 1) + x1] - sums[y1 * (width + 1) + x0] + sums[y0 * (width + 1) + x0]) / area;
      if (px[(y * width + x) * 4] < mean - 25) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  if (xs.length < 200) return 0;

  // Rows of ink at a given angle: the sum of squared row counts is largest when they line up.
  const bins = new Float64Array(width + height * 2 + 2);
  const score = (degrees: number) => {
    const a = (degrees * Math.PI) / 180;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    bins.fill(0);
    for (let i = 0; i < xs.length; i++) bins[Math.round(ys[i] * cos - xs[i] * sin) + width]++;
    let total = 0;
    for (let i = 0; i < bins.length; i++) total += bins[i] * bins[i];
    return total;
  };
  let best = 0;
  let bestScore = score(0);
  for (let d = -MAX_TILT; d <= MAX_TILT; d += 0.5) {
    const s = score(d);
    if (s > bestScore) [best, bestScore] = [d, s];
  }
  for (let d = best - 0.4; d <= best + 0.4; d += 0.1) {
    const s = score(d);
    if (s > bestScore) [best, bestScore] = [d, s];
  }
  return Math.abs(best) >= MAX_TILT ? 0 : best;
}

/**
 * [source] drawn at [width] x [height] and turned back by [degrees], on
 * white, grown to keep the corners: one resampling, so small print and the
 * dots of Arabic letters stay sharp.
 */
export function straighten(source: CanvasImageSource, width: number, height: number, degrees: number): HTMLCanvasElement {
  const a = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(a));
  const cos = Math.abs(Math.cos(a));
  const out = document.createElement('canvas');
  out.width = Math.round(width * cos + height * sin);
  out.height = Math.round(width * sin + height * cos);
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(-a);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, -width / 2, -height / 2, width, height);
  return out;
}
