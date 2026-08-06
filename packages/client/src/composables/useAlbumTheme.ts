/**
 * Album-linked single-hue theme from real artwork pixels.
 *
 * Multi-strategy extraction (canvas quantizer + chromatic peak + residual cast
 * + Color Thief merge). Random accent tables are gone — dark / B&W covers keep
 * their residual warm/cool cast or honest neutrals derived from the image.
 */
import { computed, ref, watch, type CSSProperties, type MaybeRefOrGetter, toValue } from 'vue';
import type { Track } from '@roon-screen-cover/shared';
import { getSwatchesSync, getPaletteSync, type Color, type SwatchMap } from 'colorthief';
import {
  extractAlbumPaletteFromImage,
  type AlbumPaletteResult,
} from './albumPalette';
import {
  hslToString,
  hslToRgb,
  getContrastRatio,
  type HSL,
  type RGB,
} from './colorUtils';

export interface AlbumTheme {
  /** CSS background (gradient) */
  background: string;
  factText: string;
  factMuted: string;
  title: string;
  artist: string;
  meta: string;
  sep: string;
  progressTrack: string;
  progressFill: string;
  dot: string;
  dotActive: string;
  coverRing: string;
}

/** Soft caps so progress never goes neon on OLED — still allows real album hue. */
const ACCENT_S_MAX = 42;
const ACCENT_L_MIN = 42;
const ACCENT_L_MAX = 58;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function hslCss(h: number, s: number, l: number, a?: number): string {
  return hslToString(h, s, l, a);
}

/** Technical failure only — no random seeded accents. */
function makeNeutralTheme(): AlbumTheme {
  return {
    background: 'radial-gradient(ellipse at 28% 85%, hsl(0, 0%, 14%) 0%, hsl(0, 0%, 9%) 52%, hsl(0, 0%, 5%) 100%)',
    factText: '#f2f2f2',
    factMuted: 'rgba(242, 242, 242, 0.7)',
    title: '#f2f2f2',
    artist: 'rgba(242, 242, 242, 0.85)',
    meta: 'rgba(242, 242, 242, 0.7)',
    sep: 'rgba(242, 242, 242, 0.45)',
    progressTrack: 'rgba(242, 242, 242, 0.4)',
    progressFill: '#e8e8e8',
    dot: 'rgba(242, 242, 242, 0.32)',
    dotActive: '#e8e8e8',
    coverRing: 'rgba(242, 242, 242, 0.12)',
  };
}

function colorToHsl(c: Color): HSL {
  const { h, s, l } = c.hsl();
  return { h, s, l };
}

/** Collect Color Thief HSL candidates (best-effort; never required). */
function collectThiefCandidates(img: HTMLImageElement): HSL[] {
  const out: HSL[] = [];
  const passes: Array<{ colorCount: number; quality: number; colorSpace?: 'oklch' | 'rgb' }> = [
    { colorCount: 12, quality: 3, colorSpace: 'oklch' },
    { colorCount: 10, quality: 5, colorSpace: 'rgb' },
    { colorCount: 8, quality: 8 },
  ];

  for (const opts of passes) {
    try {
      const swatches = getSwatchesSync(img, opts as Parameters<typeof getSwatchesSync>[1]);
      const palette = getPaletteSync(img, opts as Parameters<typeof getPaletteSync>[1]) ?? [];
      if (swatches) {
        const keys: Array<keyof SwatchMap> = [
          'Vibrant',
          'DarkVibrant',
          'Muted',
          'DarkMuted',
          'LightVibrant',
          'LightMuted',
        ];
        for (const key of keys) {
          const sw = swatches[key];
          if (sw) out.push(colorToHsl(sw.color));
        }
      }
      for (const c of palette) {
        out.push(colorToHsl(c));
      }
      if (out.length >= 4) break;
    } catch {
      // try next pass
    }
  }
  return out;
}

function ensureTextOn(midRgb: RGB, t: HSL, minRatio: number): HSL {
  let cur = { ...t };
  for (let i = 0; i < 6; i++) {
    if (getContrastRatio(midRgb, hslToRgb(cur.h, cur.s, cur.l)) >= minRatio) break;
    cur.l = Math.min(94, cur.l + 3);
    cur.s = Math.max(0, cur.s * 0.97);
  }
  return cur;
}

/**
 * Map extracted palette → full album UI theme.
 * Always uses the image-derived primary (including mono residual cast).
 */
export function buildAlbumThemeFromPalette(result: AlbumPaletteResult): AlbumTheme {
  let H = ((result.primary.h % 360) + 360) % 360;
  let baseS = clamp(result.primary.s, 0, 100);
  const mono = result.isMonochrome || baseS < 5;

  // Usable tint: amplify whisper chroma for UI roles without inventing hues
  const uiS = mono
    ? clamp(Math.max(baseS, result.primary.s > 0 ? 8 : 0), 0, 16)
    : clamp(Math.max(baseS, 10), 10, 48);

  const chromatic = uiS >= 5;

  // --- Background wash from album temperature ---
  const bgS = chromatic ? clamp(uiS * 0.55, 10, 30) : 0;
  const bgL = chromatic ? 16 : 11;
  const midS = chromatic ? clamp(bgS * 0.9, 8, 26) : 0;
  const midL = chromatic ? 12 : 8;
  const edgeS = chromatic ? clamp(bgS * 0.75, 6, 22) : 0;
  const edgeL = chromatic ? 7 : 5;

  const bgCenter = hslToString(H, bgS, bgL);
  const bgMid = hslToString(H, midS, midL);
  const bgEdge = hslToString(H, edgeS, edgeL);
  const midRgb = hslToRgb(H, midS, midL);

  // --- Progress accent: same hue, readable sat ---
  let barH = H;
  let barS = chromatic ? clamp(uiS * 0.75, 16, ACCENT_S_MAX) : 0;
  let barL = chromatic ? clamp(50 + (uiS > 30 ? -2 : 2), ACCENT_L_MIN, ACCENT_L_MAX) : 54;
  if (!chromatic) {
    barH = 0;
    barS = 0;
    barL = 54;
  }
  if (getContrastRatio(midRgb, hslToRgb(barH, barS, barL)) < 2.6) {
    barL = Math.min(60, barL + 8);
  }

  // --- Fact / strip text: tinted ivory when chromatic ---
  const factS = chromatic ? clamp(uiS * 0.55, 10, 28) : 0;
  const fact = ensureTextOn(midRgb, { h: H, s: factS, l: chromatic ? 86 : 91 }, 4.5);

  const stripS = chromatic ? clamp(uiS * 0.45, 8, 22) : 0;
  const title = ensureTextOn(midRgb, { h: H, s: stripS, l: 90 }, 4.5);
  const artist = ensureTextOn(
    midRgb,
    { h: H, s: chromatic ? clamp(stripS * 0.9, 6, 18) : 0, l: 82 },
    3.5
  );
  const meta = ensureTextOn(
    midRgb,
    { h: H, s: chromatic ? clamp(stripS * 0.75, 4, 14) : 0, l: 76 },
    3.0
  );

  const progressFill = hslCss(barH, barS, barL);
  const progressTrack = chromatic
    ? hslCss(barH, clamp(barS, 0, 20), clamp(bgL + 24, 32, 42), 0.52)
    : 'rgba(242, 242, 242, 0.4)';

  const dotIdle = chromatic
    ? hslCss(H, clamp(stripS * 0.65, 0, 14), 88, 0.34)
    : 'rgba(242, 242, 242, 0.32)';

  return {
    background: `radial-gradient(ellipse at 26% 88%, ${bgCenter} 0%, ${bgMid} 48%, ${bgEdge} 100%)`,
    factText: hslCss(fact.h, fact.s, fact.l),
    factMuted: hslCss(fact.h, fact.s, fact.l, 0.72),
    title: hslCss(title.h, title.s, title.l),
    artist: hslCss(artist.h, artist.s, artist.l, 0.9),
    meta: hslCss(meta.h, meta.s, meta.l, 0.78),
    sep: hslCss(meta.h, clamp(meta.s * 0.85, 0, 12), meta.l, 0.5),
    progressTrack,
    progressFill,
    dot: dotIdle,
    dotActive: progressFill,
    coverRing: chromatic
      ? hslCss(barH, clamp(bgS, 0, 18), clamp(bgL + 10, 14, 26), 0.45)
      : 'rgba(242, 242, 242, 0.12)',
  };
}

/** @deprecated alias */
export type RpiTheme = AlbumTheme;

export interface UseAlbumThemeOptions {
  artworkUrl: MaybeRefOrGetter<string | null>;
  track?: MaybeRefOrGetter<Track | null | undefined>;
  progress?: MaybeRefOrGetter<number>;
  /** When true (default), include background gradient in cssVars */
  includeBackground?: boolean;
}

export function useAlbumTheme(options: UseAlbumThemeOptions) {
  const includeBackground = options.includeBackground !== false;
  const theme = ref<AlbumTheme>(makeNeutralTheme());
  let sampleGeneration = 0;

  function sampleFromArtwork(url: string | null): void {
    const gen = ++sampleGeneration;

    if (!url) {
      theme.value = makeNeutralTheme();
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    img.onload = () => {
      if (gen !== sampleGeneration) return;
      try {
        // 1) Color Thief (optional merge)
        const thief = collectThiefCandidates(img);
        // 2) Canvas multi-strategy (primary source of truth)
        const palette = extractAlbumPaletteFromImage(img, thief);
        theme.value = buildAlbumThemeFromPalette(palette);
      } catch (err) {
        console.warn('[album-theme] extraction failed; neutral theme', err);
        if (gen === sampleGeneration) theme.value = makeNeutralTheme();
      }
    };

    img.onerror = () => {
      console.warn('[album-theme] artwork failed to load', url);
      if (gen === sampleGeneration) theme.value = makeNeutralTheme();
    };

    img.src = url;
  }

  watch(
    () => toValue(options.artworkUrl),
    (url) => {
      sampleFromArtwork(url);
    },
    { immediate: true }
  );

  const progressScale = computed(() => {
    const p = options.progress !== undefined ? Number(toValue(options.progress)) : 0;
    const n = Number.isFinite(p) ? p : 0;
    return Math.min(100, Math.max(0, n)) / 100;
  });

  const cssVars = computed((): CSSProperties => {
    const t = theme.value;
    const vars: CSSProperties = {
      ['--rpi-fact' as string]: t.factText,
      ['--rpi-fact-muted' as string]: t.factMuted,
      ['--rpi-title' as string]: t.title,
      ['--rpi-artist' as string]: t.artist,
      ['--rpi-meta' as string]: t.meta,
      ['--rpi-sep' as string]: t.sep,
      ['--rpi-progress-track' as string]: t.progressTrack,
      ['--rpi-progress-fill' as string]: t.progressFill,
      ['--rpi-dot' as string]: t.dot,
      ['--rpi-dot-active' as string]: t.dotActive,
      ['--rpi-cover-ring' as string]: t.coverRing,
      ['--rpi-progress' as string]: String(progressScale.value),
      ['--progress-bar-bg' as string]: t.progressTrack,
      ['--progress-bar-fill' as string]: t.progressFill,
      ['--text-color' as string]: t.title,
      ['--text-primary' as string]: t.title,
      ['--text-secondary' as string]: t.artist,
      ['--text-tertiary' as string]: t.meta,
    };
    if (includeBackground) {
      (vars as Record<string, string>).background = t.background;
    }
    return vars;
  });

  return {
    theme,
    cssVars,
    progressScale,
  };
}
