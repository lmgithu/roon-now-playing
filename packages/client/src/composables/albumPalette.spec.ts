/**
 * Multi-strategy album palette extraction (dark / B&W / logo-on-black).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  extractAlbumPaletteFromImageData,
  mergeExternalCandidates,
  solidImageData,
  twoToneImageData,
  rgb,
} from './albumPalette';
import { buildAlbumThemeFromPalette } from './useAlbumTheme';

// Polyfill ImageData for Node
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
  it('extracts solid red', () => {
    const data = solidImageData(32, 32, rgb(200, 30, 30));
    const r = extractAlbumPaletteFromImageData(data);
    expect(r.primary.h).toBeGreaterThanOrEqual(0);
    expect(r.primary.h).toBeLessThan(25); // reds wrap 0–15-ish
    expect(r.primary.s).toBeGreaterThan(40);
    expect(r.isMonochrome).toBe(false);
  });

  it('extracts solid blue (allowed — no blue ban)', () => {
    const data = solidImageData(32, 32, rgb(40, 80, 200));
    const r = extractAlbumPaletteFromImageData(data);
    expect(r.primary.h).toBeGreaterThan(190);
    expect(r.primary.h).toBeLessThan(250);
    expect(r.primary.s).toBeGreaterThan(30);
  });

  it('finds sparse red logo on black (rock cover pattern)', () => {
    // ~8% red pixels on near-black
    const data = twoToneImageData(40, 40, rgb(8, 8, 8), rgb(180, 40, 30), 0.08);
    const r = extractAlbumPaletteFromImageData(data);
    expect(r.primary.s).toBeGreaterThanOrEqual(8);
    // Hue near red
    const h = r.primary.h;
    expect(h < 40 || h > 330).toBe(true);
    expect(r.source === 'chromatic-peak' || r.source === 'quantized').toBe(true);
  });

  it('derives residual cast from warm gray (not random olive)', () => {
    // Warm near-gray film stock
    const data = solidImageData(32, 32, rgb(48, 44, 40));
    const r = extractAlbumPaletteFromImageData(data);
    // Should not invent strong chroma; may be residual-cast or mono
    expect(r.primary.s).toBeLessThan(25);
    if (r.primary.s >= 3) {
      // Warm cast → yellow-orange-red region
      expect(r.primary.h < 80 || r.primary.h > 300).toBe(true);
    }
  });

  it('handles pure black without throwing', () => {
    const data = solidImageData(16, 16, rgb(0, 0, 0));
    const r = extractAlbumPaletteFromImageData(data);
    expect(r.primary).toBeTruthy();
    expect(r.primary.l).toBeLessThan(30);
  });

  it('handles pure white', () => {
    const data = solidImageData(16, 16, rgb(255, 255, 255));
    const r = extractAlbumPaletteFromImageData(data);
    expect(r.primary).toBeTruthy();
  });
});

describe('mergeExternalCandidates', () => {
  it('prefers more chromatic external swatch when base is dull', () => {
    const base = extractAlbumPaletteFromImageData(solidImageData(16, 16, rgb(20, 20, 20)));
    const merged = mergeExternalCandidates(base, [{ h: 25, s: 55, l: 45 }]);
    expect(merged.primary.s).toBeGreaterThanOrEqual(40);
    expect(merged.primary.h).toBeGreaterThanOrEqual(15);
    expect(merged.primary.h).toBeLessThan(40);
  });
});

describe('buildAlbumThemeFromPalette', () => {
  it('builds chromatic theme with album-tinted progress', () => {
    const theme = buildAlbumThemeFromPalette({
      primary: { h: 18, s: 42, l: 40 },
      secondary: { h: 18, s: 30, l: 30 },
      palette: [{ h: 18, s: 42, l: 40 }],
      isMonochrome: false,
      chromaticRatio: 0.4,
      source: 'chromatic-peak',
    });
    expect(theme.progressFill).toMatch(/hsl/i);
    expect(theme.progressFill).not.toBe('#e8e8e8');
    expect(theme.background).toContain('radial-gradient');
    expect(theme.factText).toMatch(/hsl/i);
  });

  it('builds honest neutral for true mono without random accent hues', () => {
    const a = buildAlbumThemeFromPalette({
      primary: { h: 0, s: 0, l: 12 },
      secondary: { h: 0, s: 0, l: 12 },
      palette: [{ h: 0, s: 0, l: 12 }],
      isMonochrome: true,
      chromaticRatio: 0,
      source: 'luminance',
    });
    const b = buildAlbumThemeFromPalette({
      primary: { h: 0, s: 0, l: 12 },
      secondary: { h: 0, s: 0, l: 12 },
      palette: [{ h: 0, s: 0, l: 12 }],
      isMonochrome: true,
      chromaticRatio: 0,
      source: 'luminance',
    });
    // Deterministic — no seeded random olive/sage
    expect(a.progressFill).toBe(b.progressFill);
    expect(a.background).toBe(b.background);
  });

  it('keeps residual warm cast in mono UI tint', () => {
    const theme = buildAlbumThemeFromPalette({
      primary: { h: 30, s: 10, l: 35 },
      secondary: { h: 30, s: 8, l: 30 },
      palette: [{ h: 30, s: 10, l: 35 }],
      isMonochrome: true,
      chromaticRatio: 0.02,
      source: 'residual-cast',
    });
    // Progress should not be pure #e8e8e8 silver when cast exists
    expect(theme.progressFill).toMatch(/hsl/i);
  });
});
