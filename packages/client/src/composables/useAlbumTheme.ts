/**
 * Album-linked theme — Apple Music / Plexamp ambient style.
 *
 * Rule: darken the album's vivid color, do NOT desaturate it into brown mud.
 *   Red fire art  → deep crimson field + bright red/orange bar
 *   B&W line art  → pure greys, no warm beige cast
 *
 * Color Thief removed. Pixel vivid-peak extraction only (albumPalette.ts).
 */
import { computed, ref, watch, type CSSProperties, type MaybeRefOrGetter, toValue } from 'vue';
import type { Track } from '@roon-screen-cover/shared';
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

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function hslCss(h: number, s: number, l: number, a?: number): string {
  return hslToString(h, s, l, a);
}

function makeNeutralTheme(): AlbumTheme {
  // Pure cool-neutral greys — never warm stone/olive
  return {
    background:
      'radial-gradient(ellipse at 28% 85%, hsl(0, 0%, 12%) 0%, hsl(0, 0%, 8%) 50%, hsl(0, 0%, 4%) 100%)',
    factText: '#f0f0f0',
    factMuted: 'rgba(240, 240, 240, 0.7)',
    title: '#f0f0f0',
    artist: 'rgba(240, 240, 240, 0.85)',
    meta: 'rgba(240, 240, 240, 0.68)',
    sep: 'rgba(240, 240, 240, 0.4)',
    progressTrack: 'rgba(255, 255, 255, 0.22)',
    progressFill: 'rgba(240, 240, 240, 0.92)',
    dot: 'rgba(240, 240, 240, 0.3)',
    dotActive: 'rgba(240, 240, 240, 0.95)',
    coverRing: 'rgba(255, 255, 255, 0.1)',
  };
}

function ensureTextOn(midRgb: RGB, t: HSL, minRatio: number): HSL {
  let cur = { ...t };
  for (let i = 0; i < 8; i++) {
    if (getContrastRatio(midRgb, hslToRgb(cur.h, cur.s, cur.l)) >= minRatio) break;
    cur.l = Math.min(96, cur.l + 3);
  }
  return cur;
}

/**
 * Map extracted palette → full UI theme (Apple-style ambient).
 *
 * Critical difference from the old code: background keeps HIGH saturation at
 * LOW lightness so red art stays deep red, not brown.
 */
export function buildAlbumThemeFromPalette(result: AlbumPaletteResult): AlbumTheme {
  if (result.isMonochrome || result.primary.s < 8) {
    return makeNeutralTheme();
  }

  const H = ((result.primary.h % 360) + 360) % 360;
  // Source vividness — boost weak extractions so theme still reads as color
  const srcS = clamp(result.primary.s, 0, 100);

  // --- Ambient field: same hue, HIGH sat, LOW light (deep album wash) ---
  // Old bug: bgS = srcS * 0.55 capped at 30 → brown mud for reds/oranges.
  // Apple/Plex: darken the vibrant color, keep chroma.
  const bgS = clamp(Math.max(srcS * 0.9, 48), 42, 78);
  const bgL = 14;
  const midS = clamp(bgS * 0.92, 38, 72);
  const midL = 10;
  const edgeS = clamp(bgS * 0.8, 32, 65);
  const edgeL = 5;

  const bgCenter = hslToString(H, bgS, bgL);
  const bgMid = hslToString(H, midS, midL);
  const bgEdge = hslToString(H, edgeS, edgeL);
  const midRgb = hslToRgb(H, midS, midL);

  // --- Progress fill: vivid accent (the “status bar” color people notice) ---
  const barS = clamp(Math.max(srcS, 50), 48, 82);
  let barL = clamp(result.primary.l > 45 ? 56 : 52, 48, 62);
  if (getContrastRatio(midRgb, hslToRgb(H, barS, barL)) < 2.8) {
    barL = Math.min(64, barL + 8);
  }
  const progressFill = hslCss(H, barS, barL);

  // Track: light translucent tint of same hue (visible, not muddy)
  const progressTrack = hslCss(H, clamp(barS * 0.55, 20, 45), 72, 0.28);

  // --- Text: soft tinted ivory (hue visible at couch distance) ---
  const factS = clamp(srcS * 0.25, 8, 22);
  const fact = ensureTextOn(midRgb, { h: H, s: factS, l: 90 }, 4.5);
  const title = ensureTextOn(midRgb, { h: H, s: clamp(factS * 0.9, 6, 18), l: 92 }, 4.5);
  const artist = ensureTextOn(midRgb, { h: H, s: clamp(factS * 0.7, 4, 14), l: 84 }, 3.5);
  const meta = ensureTextOn(midRgb, { h: H, s: clamp(factS * 0.5, 2, 12), l: 78 }, 3.0);

  const dotIdle = hslCss(H, clamp(barS * 0.4, 10, 30), 80, 0.35);

  return {
    background: `radial-gradient(ellipse at 26% 88%, ${bgCenter} 0%, ${bgMid} 48%, ${bgEdge} 100%)`,
    factText: hslCss(fact.h, fact.s, fact.l),
    factMuted: hslCss(fact.h, fact.s, fact.l, 0.72),
    title: hslCss(title.h, title.s, title.l),
    artist: hslCss(artist.h, artist.s, artist.l, 0.9),
    meta: hslCss(meta.h, meta.s, meta.l, 0.78),
    sep: hslCss(meta.h, clamp(meta.s * 0.8, 0, 12), meta.l, 0.45),
    progressTrack,
    progressFill,
    dot: dotIdle,
    dotActive: progressFill,
    coverRing: hslCss(H, clamp(bgS * 0.5, 10, 30), clamp(bgL + 8, 12, 28), 0.4),
  };
}

/** @deprecated alias */
export type RpiTheme = AlbumTheme;

export interface UseAlbumThemeOptions {
  artworkUrl: MaybeRefOrGetter<string | null>;
  track?: MaybeRefOrGetter<Track | null | undefined>;
  progress?: MaybeRefOrGetter<number>;
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
        const palette = extractAlbumPaletteFromImage(img);
        theme.value = buildAlbumThemeFromPalette(palette);
      } catch (err) {
        console.warn('[album-theme] extraction failed', err);
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
