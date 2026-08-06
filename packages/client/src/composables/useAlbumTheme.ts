/**
 * Chrome theme only (progress, dots, text tint).
 *
 * Ambient FIELD is the blurred artwork (DynamicBackground / gradient-simple),
 * not a synthetic HSL radial — that was inventing gold/red bars on B&W covers.
 *
 * Accents come from pre-blurred mid-tone sampling (albumPalette). Low-chroma
 * art → pure neutral greys. Never force high saturation.
 */
import { computed, ref, watch, type CSSProperties, type MaybeRefOrGetter, toValue } from 'vue';
import type { Track } from '@roon-screen-cover/shared';
import {
  extractAlbumPaletteFromImage,
  type AlbumPaletteResult,
} from './albumPalette';
import { hslToString, type HSL } from './colorUtils';

export interface AlbumTheme {
  /** Unused for field when blur ambient is on; kept for compat */
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

/** Neutral light chrome over dark blur field */
function makeNeutralTheme(): AlbumTheme {
  return {
    background: 'transparent',
    factText: '#f2f2f2',
    factMuted: 'rgba(242, 242, 242, 0.72)',
    title: '#f2f2f2',
    artist: 'rgba(242, 242, 242, 0.88)',
    meta: 'rgba(242, 242, 242, 0.7)',
    sep: 'rgba(242, 242, 242, 0.42)',
    progressTrack: 'rgba(255, 255, 255, 0.28)',
    progressFill: 'rgba(245, 245, 245, 0.95)',
    dot: 'rgba(245, 245, 245, 0.32)',
    dotActive: 'rgba(245, 245, 245, 0.95)',
    coverRing: 'rgba(0, 0, 0, 0.35)',
  };
}

/**
 * Soft chrome from a confident mid-tone accent. No min-sat inventing.
 */
export function buildAlbumThemeFromPalette(result: AlbumPaletteResult): AlbumTheme {
  if (result.isMonochrome || result.primary.s < 14) {
    return makeNeutralTheme();
  }

  const H = ((result.primary.h % 360) + 360) % 360;
  // Soft accent — visible but not neon; only as chromatic as the source
  const srcS = clamp(result.primary.s, 14, 55);
  const barS = clamp(srcS * 0.85, 22, 52);
  const barL = clamp(result.primary.l, 48, 62);

  const progressFill = hslCss(H, barS, barL);
  const progressTrack = 'rgba(255, 255, 255, 0.28)';
  const factS = clamp(srcS * 0.2, 0, 12);

  return {
    background: 'transparent',
    factText: factS > 4 ? hslCss(H, factS, 92) : '#f2f2f2',
    factMuted: factS > 4 ? hslCss(H, factS, 90, 0.72) : 'rgba(242, 242, 242, 0.72)',
    title: '#f2f2f2',
    artist: 'rgba(242, 242, 242, 0.88)',
    meta: 'rgba(242, 242, 242, 0.7)',
    sep: 'rgba(242, 242, 242, 0.42)',
    progressTrack,
    progressFill,
    dot: 'rgba(245, 245, 245, 0.32)',
    dotActive: progressFill,
    coverRing: 'rgba(0, 0, 0, 0.35)',
  };
}

/** @deprecated alias */
export type RpiTheme = AlbumTheme;

export interface UseAlbumThemeOptions {
  artworkUrl: MaybeRefOrGetter<string | null>;
  track?: MaybeRefOrGetter<Track | null | undefined>;
  progress?: MaybeRefOrGetter<number>;
  /** @deprecated Field is blurred art; background CSS is not applied */
  includeBackground?: boolean;
}

export function useAlbumTheme(options: UseAlbumThemeOptions) {
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
        console.warn('[album-theme] chrome extraction failed', err);
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
    return {
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
  });

  return {
    theme,
    cssVars,
    progressScale,
  };
}
