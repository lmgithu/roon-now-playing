/**
 * Multi-strategy album palette extraction.
 *
 * Goal: almost always derive UI colors from real artwork pixels —
 * including dark / near-B&W rock covers that Color Thief alone treats
 * as “no color”. Random accent tables are intentionally not used here.
 */
import { rgbToHsl, type HSL, type RGB } from './colorUtils';

export interface AlbumPaletteResult {
  /** Primary accent hue for UI (always present when pixels exist) */
  primary: HSL;
  /** Secondary hue if distinct enough, else same as primary */
  secondary: HSL;
  /** Full ranked palette (chromatic first, then neutrals) */
  palette: HSL[];
  /** True when artwork is essentially monochrome (but may still have warm/cool cast) */
  isMonochrome: boolean;
  /** Fraction of opaque pixels with sat >= 8 */
  chromaticRatio: number;
  /** How we chose primary */
  source: 'chromatic-peak' | 'quantized' | 'residual-cast' | 'luminance';
}

const SAMPLE = 96; // canvas edge for analysis (good detail, cheap)

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function hueDist(a: number, b: number): number {
  return Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
}

/** Draw image into analysis canvas; returns null if canvas unavailable. */
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

interface PixelSample {
  r: number;
  g: number;
  b: number;
  h: number;
  s: number;
  l: number;
  /** chroma-ish weight for clustering */
  weight: number;
}

function collectPixels(imageData: ImageData): PixelSample[] {
  const { data } = imageData;
  const out: PixelSample[] = [];
  // stride 1 = every pixel on SAMPLE×SAMPLE
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 128) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    // Skip pure extremes that dominate logo/frames
    if ((r < 6 && g < 6 && b < 6) || (r > 250 && g > 250 && b > 250)) {
      // still keep a thinned sample so all-black covers aren't empty
      if ((i / 4) % 17 !== 0) continue;
    }
    const hsl = rgbToHsl(r, g, b);
    // Weight: boost mid-chroma and mid-lightness (readable accents);
    // still include dark chromatic (deep reds/golds on black covers).
    const chromaBoost = hsl.s >= 6 ? 1 + hsl.s / 40 : 0.25;
    const midL = 1 - Math.abs(hsl.l - 45) / 55;
    const weight = chromaBoost * (0.45 + 0.55 * clamp(midL, 0, 1));
    out.push({ r, g, b, h: hsl.h, s: hsl.s, l: hsl.l, weight });
  }
  return out;
}

/** Simple median-cut style quantization on RGB. */
function quantize(pixels: PixelSample[], maxColors: number): Array<{ color: HSL; count: number; weight: number }> {
  if (pixels.length === 0) return [];

  type Box = { items: PixelSample[] };
  const boxes: Box[] = [{ items: pixels }];

  while (boxes.length < maxColors) {
    // Split box with largest channel range among weighted chromatic preference
    let bestIdx = -1;
    let bestRange = -1;
    let bestChannel: 0 | 1 | 2 = 0;

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
      // Prefer boxes with more chromatic mass
      const chromaMass = items.reduce((s, p) => s + p.s * p.weight, 0) / items.length;
      const score = top.range * (1 + chromaMass / 80);
      if (score > bestRange) {
        bestRange = score;
        bestIdx = i;
        bestChannel = top.ch;
      }
    }

    if (bestIdx < 0 || bestRange < 1) break;
    const box = boxes[bestIdx]!;
    const key = bestChannel === 0 ? 'r' : bestChannel === 1 ? 'g' : 'b';
    box.items.sort((a, b) => a[key] - b[key]);
    const mid = Math.floor(box.items.length / 2);
    const left = box.items.slice(0, mid);
    const right = box.items.slice(mid);
    boxes.splice(bestIdx, 1, { items: left }, { items: right });
  }

  return boxes
    .map((box) => {
      let wSum = 0;
      let r = 0,
        g = 0,
        b = 0;
      for (const p of box.items) {
        const w = p.weight;
        wSum += w;
        r += p.r * w;
        g += p.g * w;
        b += p.b * w;
      }
      if (wSum <= 0) return null;
      const rgb = {
        r: Math.round(r / wSum),
        g: Math.round(g / wSum),
        b: Math.round(b / wSum),
      };
      return {
        color: rgbToHsl(rgb.r, rgb.g, rgb.b),
        count: box.items.length,
        weight: wSum,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Find chromatic peak: average of high-sat pixels, weighted by sat².
 * Works when only a few % of cover is colored (logo, title, one instrument).
 */
function chromaticPeak(pixels: PixelSample[]): { color: HSL; mass: number } | null {
  let mass = 0;
  let x = 0,
    y = 0; // unit circle for hue
  let sSum = 0,
    lSum = 0;

  for (const p of pixels) {
    if (p.s < 6) continue;
    // Soft-include dark reds (sat can read lower in HSL when L is low)
    const darkBoost = p.l < 25 && p.s >= 4 ? 1.4 : 1;
    const w = (p.s / 100) ** 2 * p.weight * darkBoost;
    if (w <= 0) continue;
    const rad = (p.h * Math.PI) / 180;
    x += Math.cos(rad) * w;
    y += Math.sin(rad) * w;
    sSum += p.s * w;
    lSum += p.l * w;
    mass += w;
  }

  if (mass < 0.001) return null;
  let h = (Math.atan2(y, x) * 180) / Math.PI;
  if (h < 0) h += 360;
  return {
    color: {
      h: Math.round(h) % 360,
      s: Math.round(sSum / mass),
      l: Math.round(lSum / mass),
    },
    mass,
  };
}

/**
 * Residual warm/cool cast for near-B&W art (film grain, print bias).
 * Uses average RGB delta — never invents a random accent hue.
 */
function residualCast(pixels: PixelSample[]): HSL | null {
  if (pixels.length === 0) return null;
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (const p of pixels) {
    // Prefer mid-tones; skip pure black/white for cast
    if (p.l < 4 || p.l > 96) continue;
    r += p.r;
    g += p.g;
    b += p.b;
    n++;
  }
  if (n < 8) {
    r = g = b = n = 0;
    for (const p of pixels) {
      r += p.r;
      g += p.g;
      b += p.b;
      n++;
    }
  }
  if (n === 0) return null;
  r /= n;
  g /= n;
  b /= n;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  const avgL = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  // Truly neutral
  if (span < 2.5) {
    return { h: 0, s: 0, l: Math.round(avgL * 100) };
  }

  const hsl = rgbToHsl(Math.round(r), Math.round(g), Math.round(b));
  // Amplify tiny cast into a usable UI tint (still subtle)
  const amplifiedS = clamp(Math.max(hsl.s, span * 0.45), 4, 18);
  return {
    h: hsl.h,
    s: Math.round(amplifiedS),
    l: Math.round(clamp(hsl.l, 20, 70)),
  };
}

function averageLuminance(pixels: PixelSample[]): number {
  if (!pixels.length) return 12;
  let s = 0;
  for (const p of pixels) s += p.l;
  return s / pixels.length;
}

/**
 * Merge external candidates (e.g. Color Thief) with our samples.
 * External HSL assumed 0–100 sat/light.
 */
export function mergeExternalCandidates(
  base: AlbumPaletteResult,
  external: HSL[]
): AlbumPaletteResult {
  if (!external.length) return base;
  const scored = [...base.palette];
  for (const c of external) {
    if (!c || !Number.isFinite(c.h)) continue;
    scored.push({
      h: ((Math.round(c.h) % 360) + 360) % 360,
      s: clamp(Math.round(c.s), 0, 100),
      l: clamp(Math.round(c.l), 0, 100),
    });
  }
  // Re-pick primary: prefer highest usable chroma that isn't neon junk
  let best = base.primary;
  let bestScore = scoreCandidate(best, base.chromaticRatio);
  for (const c of scored) {
    const sc = scoreCandidate(c, base.chromaticRatio);
    if (sc > bestScore) {
      bestScore = sc;
      best = c;
    }
  }
  // Dedup palette
  const palette = dedupePalette([best, ...scored, base.secondary], 10);
  const secondary = palette.find((p) => hueDist(p.h, best.h) >= 28 && p.s >= 6) ?? best;
  return {
    ...base,
    primary: best,
    secondary,
    palette,
    source: best.s >= 6 ? base.source : base.source,
  };
}

function scoreCandidate(c: HSL, chromaticRatio: number): number {
  // Prefer real chroma; soft-penalize extreme neon and pure black/white
  let score = c.s * 1.4;
  if (c.l >= 12 && c.l <= 78) score += 18;
  if (c.l < 8 || c.l > 92) score -= 20;
  // Slight preference for warm earth tones common on rock covers (not a ban on blue)
  if (c.h >= 10 && c.h <= 55 && c.s >= 8) score += 4;
  if (c.h >= 185 && c.h <= 230 && c.s > 45) score -= 6; // only hot cyan-blue
  // When art is mostly mono, small sat still wins over pure gray
  if (chromaticRatio < 0.08 && c.s >= 3 && c.s <= 25) score += 12;
  if (c.s < 2) score -= 30;
  return score;
}

function dedupePalette(colors: HSL[], max: number): HSL[] {
  const out: HSL[] = [];
  for (const c of colors) {
    if (out.some((e) => hueDist(e.h, c.h) < 18 && Math.abs(e.s - c.s) < 12)) continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Extract album palette from ImageData (unit-testable, no DOM Image needed).
 */
export function extractAlbumPaletteFromImageData(imageData: ImageData): AlbumPaletteResult {
  const pixels = collectPixels(imageData);
  if (pixels.length === 0) {
    return {
      primary: { h: 0, s: 0, l: 12 },
      secondary: { h: 0, s: 0, l: 12 },
      palette: [{ h: 0, s: 0, l: 12 }],
      isMonochrome: true,
      chromaticRatio: 0,
      source: 'luminance',
    };
  }

  const chromaticCount = pixels.filter((p) => p.s >= 8).length;
  const chromaticRatio = chromaticCount / pixels.length;
  const peak = chromaticPeak(pixels);
  const quantized = quantize(pixels, 8);
  const cast = residualCast(pixels);
  const avgL = averageLuminance(pixels);

  const quantColors = quantized.map((q) => q.color);
  const mono = chromaticRatio < 0.06 && (!peak || peak.color.s < 10);

  let primary: HSL;
  let source: AlbumPaletteResult['source'];

  if (peak && peak.color.s >= 8 && peak.mass > 0.02) {
    primary = peak.color;
    source = 'chromatic-peak';
  } else if (quantColors.some((c) => c.s >= 6)) {
    primary = quantColors.find((c) => c.s >= 6)!;
    // Prefer highest sat among quantized
    for (const c of quantColors) {
      if (c.s > primary.s && c.l >= 8 && c.l <= 90) primary = c;
    }
    source = 'quantized';
  } else if (cast && cast.s >= 3) {
    primary = cast;
    source = 'residual-cast';
  } else if (cast) {
    primary = { h: cast.h, s: cast.s, l: cast.l };
    source = 'residual-cast';
  } else {
    primary = { h: 0, s: 0, l: Math.round(clamp(avgL, 8, 40)) };
    source = 'luminance';
  }

  // Soft-boost very low but real chroma so UI roles have a tint to work with
  if (primary.s > 0 && primary.s < 12 && !mono) {
    primary = { ...primary, s: clamp(primary.s * 1.6, primary.s, 18) };
  }
  if (mono && primary.s >= 2 && primary.s < 10) {
    primary = { ...primary, s: clamp(Math.max(primary.s, 8), 6, 14) };
  }

  const palette = dedupePalette(
    [
      primary,
      ...quantColors,
      ...(peak ? [peak.color] : []),
      ...(cast ? [cast] : []),
    ],
    10
  );
  const secondary =
    palette.find((p) => hueDist(p.h, primary.h) >= 28 && p.s >= 5) ??
    palette[1] ??
    primary;

  return {
    primary,
    secondary,
    palette,
    isMonochrome: mono,
    chromaticRatio,
    source,
  };
}

/**
 * Extract from a loaded HTMLImageElement (browser).
 */
export function extractAlbumPaletteFromImage(
  img: HTMLImageElement,
  external?: HSL[]
): AlbumPaletteResult {
  const data = imageToSampleData(img, SAMPLE);
  if (!data) {
    // No canvas — last resort neutral from external if any
    if (external?.length) {
      const best = external.reduce((a, b) => (b.s > a.s ? b : a));
      return {
        primary: best,
        secondary: best,
        palette: external.slice(0, 8),
        isMonochrome: best.s < 8,
        chromaticRatio: best.s >= 8 ? 0.2 : 0,
        source: 'quantized',
      };
    }
    return {
      primary: { h: 0, s: 0, l: 12 },
      secondary: { h: 0, s: 0, l: 12 },
      palette: [{ h: 0, s: 0, l: 12 }],
      isMonochrome: true,
      chromaticRatio: 0,
      source: 'luminance',
    };
  }
  const base = extractAlbumPaletteFromImageData(data);
  return external?.length ? mergeExternalCandidates(base, external) : base;
}

/** RGB helper for tests */
export function rgb(r: number, g: number, b: number): RGB {
  return { r, g, b };
}

/** Build solid ImageData for tests */
export function solidImageData(width: number, height: number, color: RGB): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = color.r;
    data[i * 4 + 1] = color.g;
    data[i * 4 + 2] = color.b;
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, width, height);
}

/** Build two-tone / logo-on-black ImageData for tests */
export function twoToneImageData(
  width: number,
  height: number,
  bg: RGB,
  fg: RGB,
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
