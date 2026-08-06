/**
 * Album palette extraction — Apple Music / Plexamp style.
 *
 * Goal: the UI ambient color must READ as the album (deep red for red fire art,
 * pure grey for B&W). We never crush chromatic art into brown mud, and we never
 * invent random accent hues.
 *
 * Pipeline:
 *  1. Sample artwork pixels on a canvas
 *  2. Find the most *vivid* color (sat²-weighted hue peak) — not the average grey
 *  3. Detect true monochrome (B&W line art) separately
 *  4. Theme builder darkens the vivid color while KEEPING saturation high
 */
import { rgbToHsl, type HSL } from './colorUtils';

export interface AlbumPaletteResult {
  /** Vivid accent taken from the art (high sat when art has color) */
  primary: HSL;
  /** Secondary if distinct */
  secondary: HSL;
  palette: HSL[];
  /** True B&W / near-grey art — UI must stay neutral greys */
  isMonochrome: boolean;
  /** Fraction of opaque pixels with sat ≥ 12 */
  chromaticRatio: number;
  source: 'vivid-peak' | 'quantized' | 'monochrome' | 'empty';
}

const SAMPLE = 128;
const HUE_BINS = 36; // 10° bins

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function hueDist(a: number, b: number): number {
  return Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
}

export function imageToSampleData(
  img: HTMLImageElement | HTMLCanvasElement,
  size: number = SAMPLE
): ImageData | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    // Cover-style: slight crop of edges reduces black frames/borders dominating
    const inset = 0.04;
    const sw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width || size;
    const sh = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height || size;
    const sx = sw * inset;
    const sy = sh * inset;
    const sww = sw * (1 - inset * 2);
    const shh = sh * (1 - inset * 2);
    ctx.drawImage(img as CanvasImageSource, sx, sy, sww, shh, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size);
  } catch {
    return null;
  }
}

interface Pix {
  r: number;
  g: number;
  b: number;
  h: number;
  s: number;
  l: number;
}

function collect(imageData: ImageData): Pix[] {
  const { data } = imageData;
  const out: Pix[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 128) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const { h, s, l } = rgbToHsl(r, g, b);
    out.push({ r, g, b, h, s, l });
  }
  return out;
}

/**
 * Vivid peak: among chromatic pixels, pick the hue bin with max Σ(sat²).
 * This finds fire-red / logo color even when most of the cover is black.
 */
function findVividPeak(pixels: Pix[]): { color: HSL; mass: number } | null {
  type Bin = { w: number; x: number; y: number; sSum: number; lSum: number; n: number };
  const bins: Bin[] = Array.from({ length: HUE_BINS }, () => ({
    w: 0,
    x: 0,
    y: 0,
    sSum: 0,
    lSum: 0,
    n: 0,
  }));

  let chromatic = 0;
  for (const p of pixels) {
    // Include moderately sat dark reds (HSL sat collapses near black)
    // Use RGB chroma as a better dark-color signal:
    const max = Math.max(p.r, p.g, p.b);
    const min = Math.min(p.r, p.g, p.b);
    const rgbChroma = max - min; // 0–255
    if (rgbChroma < 18 && p.s < 10) continue; // truly grey
    chromatic++;

    // Weight: prefer saturated mid-tones but KEEP dark chromatic (embers, blood red)
    const satW = Math.max(p.s / 100, rgbChroma / 255);
    const weight = satW * satW * (p.l < 18 ? 1.6 : p.l > 88 ? 0.35 : 1.15);
    const bin = Math.floor(p.h / (360 / HUE_BINS)) % HUE_BINS;
    const b = bins[bin]!;
    const rad = (p.h * Math.PI) / 180;
    b.w += weight;
    b.x += Math.cos(rad) * weight;
    b.y += Math.sin(rad) * weight;
    b.sSum += Math.max(p.s, (rgbChroma / 255) * 100) * weight;
    b.lSum += Math.max(p.l, 20) * weight; // don't let pure black drag L to 0
    b.n += 1;
  }

  if (chromatic < 4) return null;

  let best: Bin | null = null;
  let bestScore = -1;
  for (const b of bins) {
    if (b.w <= 0) continue;
    // Score = mass (sat² weight). Favor bins that actually have chroma.
    const avgS = b.sSum / b.w;
    const score = b.w * (0.5 + avgS / 100);
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  if (!best || best.w < 0.001) return null;

  let h = (Math.atan2(best.y, best.x) * 180) / Math.PI;
  if (h < 0) h += 360;
  const s = clamp(Math.round(best.sSum / best.w), 8, 100);
  const l = clamp(Math.round(best.lSum / best.w), 18, 72);
  return { color: { h: Math.round(h) % 360, s, l }, mass: best.w };
}

/**
 * Simple median-cut for a secondary palette (optional).
 */
function quantize(pixels: Pix[], maxColors: number): HSL[] {
  if (pixels.length === 0) return [];
  type Box = { items: Pix[] };
  const boxes: Box[] = [{ items: pixels }];

  while (boxes.length < maxColors) {
    let bestIdx = -1;
    let bestRange = -1;
    let bestCh: 0 | 1 | 2 = 0;
    for (let i = 0; i < boxes.length; i++) {
      const items = boxes[i]!.items;
      if (items.length < 2) continue;
      let minR = 255,
        maxR = 0,
        minG = 255,
        maxG = 0,
        minB = 255,
        maxB = 0;
      for (const p of items) {
        if (p.r < minR) minR = p.r;
        if (p.r > maxR) maxR = p.r;
        if (p.g < minG) minG = p.g;
        if (p.g > maxG) maxG = p.g;
        if (p.b < minB) minB = p.b;
        if (p.b > maxB) maxB = p.b;
      }
      const ranges: Array<{ ch: 0 | 1 | 2; range: number }> = [
        { ch: 0, range: maxR - minR },
        { ch: 1, range: maxG - minG },
        { ch: 2, range: maxB - minB },
      ];
      ranges.sort((a, b) => b.range - a.range);
      const top = ranges[0]!;
      if (top.range > bestRange) {
        bestRange = top.range;
        bestIdx = i;
        bestCh = top.ch;
      }
    }
    if (bestIdx < 0 || bestRange < 8) break;
    const box = boxes[bestIdx]!;
    const key = bestCh === 0 ? 'r' : bestCh === 1 ? 'g' : 'b';
    box.items.sort((a, b) => a[key] - b[key]);
    const mid = Math.floor(box.items.length / 2);
    boxes.splice(bestIdx, 1, { items: box.items.slice(0, mid) }, { items: box.items.slice(mid) });
  }

  return boxes
    .map((box) => {
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (const p of box.items) {
        // Weight chromatic pixels more so black boxes don't win
        const w = 1 + p.s / 40;
        r += p.r * w;
        g += p.g * w;
        b += p.b * w;
        n += w;
      }
      if (n <= 0) return null;
      return rgbToHsl(Math.round(r / n), Math.round(g / n), Math.round(b / n));
    })
    .filter((c): c is HSL => !!c)
    .sort((a, b) => b.s - a.s);
}

function isTrueMonochrome(pixels: Pix[]): boolean {
  if (pixels.length === 0) return true;
  let chrom = 0;
  let maxRgbChroma = 0;
  for (const p of pixels) {
    const rgbChroma = Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);
    if (rgbChroma > maxRgbChroma) maxRgbChroma = rgbChroma;
    // Count only meaningfully colored pixels (ignore noise)
    if (rgbChroma >= 22 || p.s >= 12) chrom++;
  }
  const ratio = chrom / pixels.length;
  // B&W line art: almost no chroma; max channel delta stays tiny
  return ratio < 0.035 && maxRgbChroma < 40;
}

export function extractAlbumPaletteFromImageData(imageData: ImageData): AlbumPaletteResult {
  const pixels = collect(imageData);
  if (pixels.length === 0) {
    return {
      primary: { h: 0, s: 0, l: 12 },
      secondary: { h: 0, s: 0, l: 12 },
      palette: [{ h: 0, s: 0, l: 12 }],
      isMonochrome: true,
      chromaticRatio: 0,
      source: 'empty',
    };
  }

  const mono = isTrueMonochrome(pixels);
  const chromCount = pixels.filter((p) => {
    const c = Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);
    return c >= 18 || p.s >= 10;
  }).length;
  const chromaticRatio = chromCount / pixels.length;

  if (mono) {
    // Honest greys from average luminance — no warm beige cast
    let lSum = 0;
    for (const p of pixels) lSum += p.l;
    const avgL = Math.round(lSum / pixels.length);
    const primary = { h: 0, s: 0, l: clamp(avgL, 6, 40) };
    return {
      primary,
      secondary: primary,
      palette: [primary],
      isMonochrome: true,
      chromaticRatio,
      source: 'monochrome',
    };
  }

  const peak = findVividPeak(pixels);
  const quantized = quantize(pixels, 6);

  let primary: HSL;
  let source: AlbumPaletteResult['source'];

  if (peak && peak.color.s >= 12) {
    primary = peak.color;
    source = 'vivid-peak';
    // Boost whisper-chroma so dark reds stay red (not brown) in theme builder
    if (primary.s < 35) {
      primary = { ...primary, s: clamp(Math.round(primary.s * 1.45), primary.s, 55) };
    }
  } else if (quantized.some((c) => c.s >= 12)) {
    primary = quantized.reduce((a, b) => (b.s > a.s ? b : a));
    source = 'quantized';
    if (primary.s < 35) {
      primary = { ...primary, s: clamp(Math.round(primary.s * 1.4), primary.s, 55) };
    }
  } else {
    // Weak color only — still use it, but mark near-mono
    primary = peak?.color ?? quantized[0] ?? { h: 0, s: 0, l: 12 };
    source = peak ? 'vivid-peak' : 'quantized';
  }

  // Ensure L is usable for accent derivation (not stuck at pure black)
  primary = {
    h: ((primary.h % 360) + 360) % 360,
    s: clamp(primary.s, 0, 100),
    l: clamp(primary.l, 22, 70),
  };

  const palette = [primary, ...quantized.filter((c) => hueDist(c.h, primary.h) >= 25)].slice(0, 8);
  const secondary = palette[1] ?? primary;

  return {
    primary,
    secondary,
    palette,
    isMonochrome: false,
    chromaticRatio,
    source,
  };
}

export function extractAlbumPaletteFromImage(img: HTMLImageElement): AlbumPaletteResult {
  const data = imageToSampleData(img, SAMPLE);
  if (!data) {
    return {
      primary: { h: 0, s: 0, l: 12 },
      secondary: { h: 0, s: 0, l: 12 },
      palette: [{ h: 0, s: 0, l: 12 }],
      isMonochrome: true,
      chromaticRatio: 0,
      source: 'empty',
    };
  }
  return extractAlbumPaletteFromImageData(data);
}

// ---- test helpers ----

export function solidImageData(width: number, height: number, color: { r: number; g: number; b: number }): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = color.r;
    data[i * 4 + 1] = color.g;
    data[i * 4 + 2] = color.b;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, width, height);
}

export function twoToneImageData(
  width: number,
  height: number,
  bg: { r: number; g: number; b: number },
  fg: { r: number; g: number; b: number },
  fgRatio: number
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  const threshold = Math.floor(width * height * (1 - fgRatio));
  for (let i = 0; i < width * height; i++) {
    const c = i < threshold ? bg : fg;
    data[i * 4] = c.r;
    data[i * 4 + 1] = c.g;
    data[i * 4 + 2] = c.b;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, width, height);
}

export function rgb(r: number, g: number, b: number) {
  return { r, g, b };
}
