/**
 * Dominant-color extraction matching use-image-color (used by
 * frigopedro/Apple-Music-Background) — without React.
 *
 * Pipeline:
 *   canvas sample → every Nth pixel (windowSize) → MMCQ quantize → hex palette
 *
 * Uses the same `quantize` (Leptonica MMCQ) package as use-image-color.
 */
import quantize from 'quantize';

export type RgbTuple = [number, number, number];

export interface ExtractDominantColorsOptions {
  /** Max colors in the palette (demo uses 5) */
  colors?: number;
  /** Same meaning as use-image-color: sample every Nth pixel (default 50) */
  windowSize?: number;
  /** Prefer hex strings (demo default) or rgb() */
  format?: 'hex' | 'rgb';
}

function toHex([r, g, b]: RgbTuple): string {
  const h = (n: number) => {
    const s = Math.max(0, Math.min(255, Math.round(n))).toString(16);
    return s.length < 2 ? `0${s}` : s;
  };
  return `#${h(r)}${h(g)}${h(b)}`;
}

function toRgb([r, g, b]: RgbTuple): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * Sample ImageData into [r,g,b] pixels the way use-image-color does
 * (chunk with windowSize stride).
 */
export function samplePixels(
  data: Uint8ClampedArray | number[],
  windowSize: number = 50
): RgbTuple[] {
  const pixels: RgbTuple[] = [];
  const step = 4 * Math.max(1, windowSize);
  for (let i = 0; i + 3 < data.length; i += step) {
    const a = data[i + 3] ?? 255;
    if (a < 125) continue;
    pixels.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  }
  return pixels;
}

/**
 * Quantize pixel list → up to `maxColors` dominant RGB triples.
 * Same core as use-image-color / Apple-Music-Background.
 */
export function quantizePixels(pixels: RgbTuple[], maxColors: number = 5): RgbTuple[] {
  if (pixels.length === 0) return [];
  // quantize requires at least 1 pixel; maxColors must be >= 2 in some versions
  const n = Math.max(2, Math.min(256, maxColors));
  try {
    const cmap = quantize(pixels, n);
    if (!cmap) return [];
    const palette = cmap.palette() as RgbTuple[];
    return Array.isArray(palette) ? palette.slice(0, maxColors) : [];
  } catch {
    return [];
  }
}

/**
 * Load an image URL and return dominant CSS colors (hex by default).
 * Mirrors: useImageColor(src, { cors: true, colors: 5, format: 'hex' })
 */
export function extractDominantColorsFromUrl(
  url: string,
  options: ExtractDominantColorsOptions = {}
): Promise<string[]> {
  const colors = options.colors ?? 5;
  const windowSize = options.windowSize ?? 50;
  const format = options.format ?? 'hex';

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    img.onload = () => {
      try {
        // Downscale large art for speed (quantize quality stays good)
        const maxDim = 200;
        const nw = img.naturalWidth || img.width;
        const nh = img.naturalHeight || img.height;
        const scale = Math.min(1, maxDim / Math.max(nw, nh, 1));
        const w = Math.max(1, Math.round(nw * scale));
        const h = Math.max(1, Math.round(nh * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve([]);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        // Scale windowSize down if we already shrank the image
        const effectiveWindow = Math.max(1, Math.round(windowSize * scale));
        const pixels = samplePixels(data, effectiveWindow);
        let palette = quantizePixels(pixels, colors);

        // Drop pure black/white if we still have enough color (common on framed covers)
        if (palette.length > 2) {
          const vivid = palette.filter(([r, g, b]) => {
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const l = (max + min) / 2;
            return l > 12 && l < 248;
          });
          if (vivid.length >= 2) palette = vivid;
        }

        if (palette.length === 0) {
          resolve([]);
          return;
        }

        resolve(palette.map((c) => (format === 'rgb' ? toRgb(c) : toHex(c))));
      } catch {
        resolve([]);
      }
    };

    img.onerror = () => resolve([]);
    img.src = url;
  });
}
