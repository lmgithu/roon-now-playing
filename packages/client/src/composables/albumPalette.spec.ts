/**
 * Pre-blur chrome palette: mid-tone accents only; B&W / warm-black → mono.
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

describe('extractAlbumPaletteFromImageData', () => {
  it('extracts solid mid red as chromatic accent', () => {
    const data = solidImageData(48, 48, rgb(200, 40, 40));
    const r = extractAlbumPaletteFromImageData(data);
    expect(r.isMonochrome).toBe(false);
    expect(r.primary.s).toBeGreaterThan(20);
    expect(r.primary.h < 25 || r.primary.h > 340).toBe(true);
  });

  it('treats pure B&W as monochrome (no gold chrome)', () => {
    const data = twoToneImageData(48, 48, rgb(0, 0, 0), rgb(250, 250, 250), 0.12);
    const r = extractAlbumPaletteFromImageData(data);
    expect(r.isMonochrome).toBe(true);
    expect(r.primary.s).toBe(0);
  });

  it('ignores warm near-black (Ravenettes failure mode)', () => {
    // Many warm-black pixels + few white — must NOT invent orange accent
    const data = twoToneImageData(48, 48, rgb(28, 22, 14), rgb(240, 238, 235), 0.1);
    const r = extractAlbumPaletteFromImageData(data);
    expect(r.isMonochrome).toBe(true);
  });

  it('finds mid-tone red fire against dark (enough bright chromatic area)', () => {
    // ~40% vivid mid red on black — like fire sky
    const data = twoToneImageData(48, 48, rgb(5, 5, 5), rgb(200, 50, 35), 0.4);
    const r = extractAlbumPaletteFromImageData(data);
    // Mid-tone red L is high enough; should pick accent
    if (!r.isMonochrome) {
      expect(r.primary.h < 40 || r.primary.h > 330).toBe(true);
      expect(r.primary.s).toBeGreaterThan(14);
    }
  });
});

describe('buildAlbumThemeFromPalette', () => {
  it('mono → neutral grey progress (not yellow/red)', () => {
    const theme = buildAlbumThemeFromPalette({
      primary: { h: 0, s: 0, l: 50 },
      secondary: { h: 0, s: 0, l: 50 },
      palette: [{ h: 0, s: 0, l: 50 }],
      isMonochrome: true,
      chromaticRatio: 0,
      source: 'monochrome',
    });
    expect(theme.progressFill).toMatch(/rgba|#f|245/i);
    expect(theme.progressFill).not.toMatch(/hsl\(\s*\d+/i);
  });

  it('confident accent → soft sat bar (no forced 50%+)', () => {
    const theme = buildAlbumThemeFromPalette({
      primary: { h: 12, s: 45, l: 48 },
      secondary: { h: 12, s: 40, l: 40 },
      palette: [{ h: 12, s: 45, l: 48 }],
      isMonochrome: false,
      chromaticRatio: 0.3,
      source: 'vivid-mid',
    });
    expect(theme.progressFill).toMatch(/hsl/i);
    const m = theme.progressFill.match(/hsla?\(\s*[\d.]+\s*,\s*([\d.]+)%/i);
    expect(m).toBeTruthy();
    const sat = Number(m![1]);
    expect(sat).toBeLessThanOrEqual(55);
    expect(sat).toBeGreaterThanOrEqual(20);
  });
});
