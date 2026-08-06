/**
 * Conservative chrome palette from pre-blurred artwork (Apple / Plexamp path).
 *
 * Field color is NOT invented here — the UI uses a blurred cover as the room.
 * This module only decides progress/dots/text tint:
 *  - Pre-blur the art so warm-black JPEG noise cannot invent gold/red accents
 *  - Ignore near-black / near-white
 *  - If overall chroma is low → monochrome chrome (neutral greys)
 *  - Never force high saturation
 */
import { rgbToHsl, type HSL } from './colorUtils';

export interface AlbumPaletteResult {
  primary: HSL;
  secondary: HSL;
  palette: HSL[];
  isMonochrome: boolean;
  chromaticRatio: number;
  source: 'vivid-mid' | 'monochrome' | 'empty';
}

const SAMPLE = 64;
const BLUR_PX = 10;
const HUE_BINS = 24;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function hueDist(a: number, b: number): number {
  return Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
}

/**
 * Draw artwork into a small canvas, apply CSS-canvas blur, return ImageData.
 * Blur averages residual casts so B&W covers stay neutral.
 */
export function imageToBlurredSampleData(
  img: HTMLImageElement | HTMLCanvasElement,
  size: number = SAMPLE,
  blurPx: number = BLUR_PX
): ImageData | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const sw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width || size;
    const sh = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height || size;
    // Crop edges slightly (frames/borders)
    const inset = 0.08;
    const sx = sw * inset;
    const sy = sh * inset;
    const sww = sw * (1 - inset * 2);
    const shh = sh * (1 - inset * 2);

    // Center crop region into square sample
    ctx.filter = `blur(${blurPx}px)`;
    ctx.drawImage(img as CanvasImageSource, sx, sy, sww, shh, 0, 0, size, size);
    ctx.filter = 'none';
    return ctx.getImageData(0, 0, size, size);
  } catch {
    return null;
  }
}

/** Unblurred sample (tests / fallback) */
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
    ctx.drawImage(img as CanvasImageSource, 0, 0, size, size);
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
 * Mid-tone vivid peak only. Near-black/near-white never contribute.
 * Requires meaningful RGB chroma *before* any boost.
 */
function findMidtoneAccent(pixels: Pix[]): { color: HSL; mass: number } | null {
  type Bin = { w: number; x: number; y: number; sSum: number; lSum: number; n: number };
  const bins: Bin[] = Array.from({ length: HUE_BINS }, () => ({
    w: 0,
    x: 0,
    y: 0,
    sSum: 0,
    lSum: 0,
    n: 0,
  }));

  let usable = 0;
  for (const p of pixels) {
    // Kill warm-black / pure white noise (the Ravenettes / Serein failure mode)
    if (p.l < 18 || p.l > 88) continue;
    const rgbChroma = Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);
    // Need real chroma — not 5% cast in dark greys
    if (rgbChroma < 28 && p.s < 18) continue;
    if (p.s < 14) continue;

    usable++;
    const satW = p.s / 100;
    // Prefer mid lightness (subjects, not frames)
    const mid = 1 - Math.abs(p.l - 48) / 48;
    const weight = satW * satW * (0.4 + 0.6 * clamp(mid, 0, 1));
    const bin = Math.floor(p.h / (360 / HUE_BINS)) % HUE_BINS;
    const b = bins[bin]!;
    const rad = (p.h * Math.PI) / 180;
    b.w += weight;
    b.x += Math.cos(rad) * weight;
    b.y += Math.sin(rad) * weight;
    b.sSum += p.s * weight;
    b.lSum += p.l * weight;
    b.n += 1;
  }

  if (usable < 6) return null;

  let best: Bin | null = null;
  let bestScore = -1;
  for (const b of bins) {
    if (b.w <= 0 || b.n < 2) continue;
    const avgS = b.sSum / b.w;
    if (avgS < 16) continue;
    const score = b.w * (avgS / 100);
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  if (!best || best.w < 0.02) return null;

  let h = (Math.atan2(best.y, best.x) * 180) / Math.PI;
  if (h < 0) h += 360;
  return {
    color: {
      h: Math.round(h) % 360,
      s: clamp(Math.round(best.sSum / best.w), 14, 70),
      l: clamp(Math.round(best.lSum / best.w), 28, 65),
    },
    mass: best.w,
  };
}

function overallChromaticRatio(pixels: Pix[]): number {
  if (!pixels.length) return 0;
  let n = 0;
  for (const p of pixels) {
    if (p.l < 12 || p.l > 92) continue;
    const c = Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);
    if (c >= 28 || p.s >= 18) n++;
  }
  return n / pixels.length;
}

export function extractAlbumPaletteFromImageData(imageData: ImageData): AlbumPaletteResult {
  const pixels = collect(imageData);
  if (pixels.length === 0) {
    return {
      primary: { h: 0, s: 0, l: 50 },
      secondary: { h: 0, s: 0, l: 50 },
      palette: [{ h: 0, s: 0, l: 50 }],
      isMonochrome: true,
      chromaticRatio: 0,
      source: 'empty',
    };
  }

  const chromaticRatio = overallChromaticRatio(pixels);
  const peak = findMidtoneAccent(pixels);

  // Low overall chroma OR no confident mid-tone accent → neutral chrome
  if (chromaticRatio < 0.06 || !peak || peak.color.s < 16) {
    return {
      primary: { h: 0, s: 0, l: 50 },
      secondary: { h: 0, s: 0, l: 50 },
      palette: [{ h: 0, s: 0, l: 50 }],
      isMonochrome: true,
      chromaticRatio,
      source: 'monochrome',
    };
  }

  const primary = peak.color;
  return {
    primary,
    secondary: primary,
    palette: [primary],
    isMonochrome: false,
    chromaticRatio,
    source: 'vivid-mid',
  };
}

export function extractAlbumPaletteFromImage(img: HTMLImageElement): AlbumPaletteResult {
  const data = imageToBlurredSampleData(img, SAMPLE, BLUR_PX) ?? imageToSampleData(img, SAMPLE);
  if (!data) {
    return {
      primary: { h: 0, s: 0, l: 50 },
      secondary: { h: 0, s: 0, l: 50 },
      palette: [{ h: 0, s: 0, l: 50 }],
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

export { hueDist, clamp };
