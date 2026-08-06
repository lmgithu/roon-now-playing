/**
 * Album palette — must keep red fire red, B&W pure grey (no brown mud).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  extractAlbumPaletteFromImageData,
  solidImageData,
  twoToneImageData,
  rgb,
} from './albumPalette';
import { buildAlbumThemeFromPalette } from './useAlbumTheme';

class ImageDataPolyfill {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, width: number, height?: number) {
    this.data = data;
    this.width = width;
    this.height = height ?? data.length / 4 / width;
  }
}
beforeAll(() => {
  if (typeof globalThis.ImageData === 'undefined') {
    (globalThis as unknown as { ImageData: typeof ImageDataPolyfill }).ImageData =
      ImageDataPolyfill;
  }
});

/** Parse hsl()/hsla() from theme strings */
function parseHsl(css: string): { h: number; s: number; l: number } | null {
  const m = css.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
  if (!m) return null;
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

describe('extractAlbumPaletteFromImageData', () => {
  it('extracts vivid solid red (not brown)', () => {
    const data = solidImageData(48, 48, rgb(200, 30, 30));
    const r = extractAlbumPaletteFromImageData(data);
    expect(r.isMonochrome).toBe(false);
    expect(r.primary.s).toBeGreaterThan(40);
    expect(r.primary.h < 25 || r.primary.h > 340).toBe(true);
  });

  it('finds red fire on mostly-black cover (Katatonia pattern)', () => {
    // ~20% vivid red-orange on near-black — like fire sky on dark cover
    const data = twoToneImageData(64, 64, rgb(8, 6, 5), rgb(210, 55, 30), 0.22);
    const r = extractAlbumPaletteFromImageData(data);
    expect(r.isMonochrome).toBe(false);
    expect(r.primary.s).toBeGreaterThanOrEqual(30);
    const h = r.primary.h;
    expect(h < 35 || h > 330).toBe(true); // red–orange band
  });

  it('treats pure B&W line art as monochrome (no warm cast)', () => {
    // Black + white only (cat line art)
    const data = twoToneImageData(48, 48, rgb(0, 0, 0), rgb(250, 250, 250), 0.12);
    const r = extractAlbumPaletteFromImageData(data);
    expect(r.isMonochrome).toBe(true);
    expect(r.primary.s).toBe(0);
  });

  it('extracts solid blue', () => {
    const data = solidImageData(32, 32, rgb(40, 80, 210));
    const r = extractAlbumPaletteFromImageData(data);
    expect(r.primary.h).toBeGreaterThan(190);
    expect(r.primary.h).toBeLessThan(250);
    expect(r.primary.s).toBeGreaterThan(40);
  });
});

describe('buildAlbumThemeFromPalette — no brown mud', () => {
  it('red fire art → deep red field + vivid red bar (high sat, low L bg)', () => {
    const theme = buildAlbumThemeFromPalette({
      primary: { h: 10, s: 55, l: 45 },
      secondary: { h: 10, s: 40, l: 30 },
      palette: [{ h: 10, s: 55, l: 45 }],
      isMonochrome: false,
      chromaticRatio: 0.3,
      source: 'vivid-peak',
    });

    // Background is a radial-gradient containing hsl with high S
    expect(theme.background).toContain('radial-gradient');
    // Pull first hsl from gradient
    const bgMatch = theme.background.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
    expect(bgMatch).toBeTruthy();
    const bgS = Number(bgMatch![2]);
    const bgL = Number(bgMatch![3]);
    // MUST stay highly saturated (was ~20% → brown). Target ≥ 42.
    expect(bgS).toBeGreaterThanOrEqual(42);
    expect(bgL).toBeLessThan(22);
    // Hue still red/orange
    const bgH = Number(bgMatch![1]);
    expect(bgH < 30 || bgH > 340).toBe(true);

    const bar = parseHsl(theme.progressFill);
    expect(bar).toBeTruthy();
    expect(bar!.s).toBeGreaterThanOrEqual(48);
    expect(bar!.h < 30 || bar!.h > 340).toBe(true);
  });

  it('true mono → pure grey theme (no beige progress)', () => {
    const theme = buildAlbumThemeFromPalette({
      primary: { h: 0, s: 0, l: 12 },
      secondary: { h: 0, s: 0, l: 12 },
      palette: [{ h: 0, s: 0, l: 12 }],
      isMonochrome: true,
      chromaticRatio: 0,
      source: 'monochrome',
    });
    // Neutral greys — progress fill is rgba white-ish, not hsl brown
    expect(theme.progressFill).toMatch(/rgba?\(|#|hsl\(0/i);
    expect(theme.background).toContain('0%'); // zero saturation greys
    // Deterministic
    const again = buildAlbumThemeFromPalette({
      primary: { h: 0, s: 0, l: 12 },
      secondary: { h: 0, s: 0, l: 12 },
      palette: [{ h: 0, s: 0, l: 12 }],
      isMonochrome: true,
      chromaticRatio: 0,
      source: 'monochrome',
    });
    expect(theme.background).toBe(again.background);
    expect(theme.progressFill).toBe(again.progressFill);
  });
});
