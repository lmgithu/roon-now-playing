/**
 * Album-linked single-hue theme (Color Thief → role-staged CSS vars).
 *
 * Shared by RPi Facts Carousel and restored layouts for consistent
 * font/status-strip/progress colorization.
 */
import { computed, ref, watch, type CSSProperties, type MaybeRefOrGetter, toValue } from 'vue';
import type { Track } from '@roon-screen-cover/shared';
import { getSwatchesSync, getPaletteSync, type Color, type SwatchMap } from 'colorthief';
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

/**
 * Soft fallback accents — used when sampling fails OR art is B&W/neutral.
 * No cool-blue entries (those used to land on #6d87ba). Blue slots are
 * replaced by text-matching silver/white for consistency with fact text.
 * Seeded per track so colors still vary without flashing.
 */
const TEXT_ACCENT = '#f2f2f2'; // same family as fact text

const FALLBACK_ACCENTS: ReadonlyArray<{
  h: number;
  s: number;
  l: number;
  /** Use fact-text color for progress/dots (no tinted blue/gray) */
  matchText?: boolean;
}> = [
  { h: 28, s: 11, l: 50 }, // warm stone
  { h: 42, s: 10, l: 50 }, // soft sand
  { h: 95, s: 9, l: 49 }, // muted olive
  { h: 155, s: 10, l: 49 }, // sage
  { h: 0, s: 0, l: 62, matchText: true }, // text white / silver
  { h: 260, s: 9, l: 50 }, // dusty violet
  { h: 340, s: 10, l: 50 }, // rose ash
  { h: 0, s: 6, l: 50 }, // warm neutral gray
  { h: 0, s: 0, l: 58, matchText: true }, // text white again (weighted chance)
];

/** Hard caps so progress/dots never go neon (#4aceb3-style) on OLED. */
const ACCENT_S_MAX = 32;
const ACCENT_L_MAX = 50;
const ACCENT_L_MIN = 40;

/** Cool-blue band that used to produce the unwanted #6d87ba look */
function isUnwantedBlueHue(h: number, s: number): boolean {
  if (s < 5) return false;
  return h >= 190 && h <= 235;
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

/** Build a dark, quiet fallback / neutral theme. */
function makeFallbackAlbumTheme(seed: string = ''): AlbumTheme {
  const idx = seed
    ? hashSeed(seed) % FALLBACK_ACCENTS.length
    : Math.floor(Math.random() * FALLBACK_ACCENTS.length);
  const edgeIdx = seed
    ? hashSeed(seed + ':edge') % FALLBACK_ACCENTS.length
    : (idx + 3) % FALLBACK_ACCENTS.length;

  const a = FALLBACK_ACCENTS[idx]!;
  const e = FALLBACK_ACCENTS[edgeIdx]!;

  // Soft dark field (aligned with album-theme lift — not pure void)
  const bgCenter = a.matchText
    ? 'hsl(0, 0%, 14%)'
    : hslToString(a.h, clamp(a.s + 6, 10, 22), 16);
  const bgMid = a.matchText
    ? 'hsl(0, 0%, 10%)'
    : hslToString(e.h, clamp(e.s + 2, 8, 18), 12);
  const bgEdge = a.matchText
    ? 'hsl(0, 0%, 6%)'
    : hslToString(e.h, clamp(e.s, 6, 14), 8);

  // Progress/dots: text white when matchText, or soft non-blue muted hue
  let accent: string;
  let accentSoft: string;
  let track: string;
  let coverRing: string;

  if (a.matchText || isUnwantedBlueHue(a.h, a.s)) {
    accent = TEXT_ACCENT;
    accentSoft = 'rgba(242, 242, 242, 0.35)';
    // Status-bar track: readable on dark fields (was ~0.18 and blended away)
    track = 'rgba(242, 242, 242, 0.38)';
    coverRing = 'rgba(242, 242, 242, 0.1)';
  } else {
    const muted = muteAccent(a.h, a.s, a.l);
    if (isUnwantedBlueHue(muted.h, muted.s)) {
      accent = TEXT_ACCENT;
      accentSoft = 'rgba(242, 242, 242, 0.35)';
      track = 'rgba(242, 242, 242, 0.38)';
      coverRing = 'rgba(242, 242, 242, 0.1)';
    } else {
      accent = hslToString(muted.h, muted.s, muted.l);
      accentSoft = hslToString(muted.h, muted.s, muted.l, 0.32);
      track = hslToString(muted.h, clamp(muted.s, 4, 14), 34, 0.5);
      coverRing = hslToString(a.h, clamp(a.s, 5, 14), 18, 0.45);
    }
  }

  return {
    background: `radial-gradient(ellipse at 28% 85%, ${bgCenter} 0%, ${bgMid} 52%, ${bgEdge} 100%)`,
    factText: TEXT_ACCENT,
    factMuted: 'rgba(242, 242, 242, 0.7)',
    title: TEXT_ACCENT,
    artist: 'rgba(242, 242, 242, 0.8)',
    meta: 'rgba(242, 242, 242, 0.68)',
    sep: 'rgba(242, 242, 242, 0.42)',
    progressTrack: track,
    progressFill: accent,
    dot: accentSoft,
    dotActive: accent,
    coverRing,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Keep UI accents subtle: preserve hue, clamp sat/lightness so vivid album
 * colors (cyan, lime, hot pink) cannot become neon progress bars.
 * Near-gray sources stay silver (not pure white).
 */
function muteAccent(h: number, s: number, l: number): { h: number; s: number; l: number } {
  if (s < 6) {
    return { h: 0, s: 0, l: clamp(l > 35 ? 54 : 48, ACCENT_L_MIN, 58) };
  }
  // Color Thief "Muted" is already soft — keep more of its sat; only crush neon
  const softS = s > 50 ? s * 0.4 : s > 30 ? s * 0.75 : s;
  const softL = l > 55 ? 48 : l;
  return {
    h,
    s: clamp(softS, 10, ACCENT_S_MAX),
    l: clamp(softL, ACCENT_L_MIN, ACCENT_L_MAX),
  };
}

function colorToHsl(c: Color): HSL {
  const { h, s, l } = c.hsl();
  return { h, s, l };
}

function hslCss(h: number, s: number, l: number, a?: number): string {
  return hslToString(h, s, l, a);
}

function hueDistance(a: number, b: number): number {
  return Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
}

/**
 * Pick one album hue for the whole UI. Prefer soft chromatic swatches that
 * agree with LightMuted (when present) so quote, bar, and field share temperature.
 */
function pickAlbumHue(swatches: SwatchMap, palette: Color[]): HSL | null {
  const candidates: HSL[] = [];
  const keys: Array<keyof SwatchMap> = [
    'Muted',
    'DarkMuted',
    'LightMuted',
    'Vibrant',
    'DarkVibrant',
    'LightVibrant',
  ];
  for (const key of keys) {
    const sw = swatches[key];
    if (sw) candidates.push(colorToHsl(sw.color));
  }
  for (const c of palette.slice(0, 8)) {
    candidates.push(colorToHsl(c));
  }
  if (!candidates.length) return null;

  const lightMuted = swatches.LightMuted ? colorToHsl(swatches.LightMuted.color) : null;
  const muted = swatches.Muted ? colorToHsl(swatches.Muted.color) : null;
  const ref: HSL =
    lightMuted && lightMuted.s >= 6
      ? lightMuted
      : muted && muted.s >= 6
        ? muted
        : (candidates.find((c) => c.s >= 8) ?? candidates[0]!);

  let best: HSL | null = null;
  let bestScore = -Infinity;

  for (const c of candidates) {
    if (c.s < 4) continue;
    const dh = hueDistance(c.h, ref.h);
    // Prefer moderate chroma; punish neon and cool-blue mud
    const satScore = c.s > 55 ? 55 - (c.s - 55) * 0.55 : c.s;
    const hueAgree = 42 - Math.min(dh, 42);
    let score = satScore + hueAgree;
    if (c.l >= 22 && c.l <= 78) score += 10;
    if (isUnwantedBlueHue(c.h, c.s) && c.s >= 12) score -= 40;
    // Prefer LightMuted / Muted neighbourhood of lightness for stable H
    if (c.s >= 10 && c.s <= 40) score += 6;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (best) return best;

  // Gray-heavy art: still return something so we can build a neutral theme
  return lightMuted ?? muted ?? candidates[0] ?? null;
}

/** Ensure light text stays readable on the dark mid-field (preserve tint). */
function ensureTextOn(midRgb: RGB, t: HSL, minRatio: number): HSL {
  let cur = { ...t };
  for (let i = 0; i < 5; i++) {
    if (getContrastRatio(midRgb, hslToRgb(cur.h, cur.s, cur.l)) >= minRatio) break;
    cur.l = Math.min(93, cur.l + 3);
    // Prefer lifting L over killing saturation so album hue stays visible
    cur.s = Math.max(0, cur.s * 0.96);
  }
  return cur;
}

/**
 * Single-hue role map from Color Thief:
 *   bg (dark wash) · facts (soft tinted ivory) · strip (near-white ladder)
 *   progress/active dot (clear muted accent)
 * Not too neon (S/L caps), not too dull (present bg + visible bar).
 */
function buildAlbumThemeFromThief(swatches: SwatchMap, palette: Color[]): AlbumTheme | null {
  const album = pickAlbumHue(swatches, palette);
  if (!album) return null;

  let H = album.h;
  let baseS = album.s;

  // Cool-blue mud → neutralize (keeps #6d87ba-class accents away)
  if (isUnwantedBlueHue(H, baseS) && baseS >= 12) {
    H = 0;
    baseS = 0;
  }

  const chromatic = baseS >= 8;

  // --- Background: same H, richer wash (readable color room, still OLED-safe) ---
  // Previous L~4–9 read as near-black; lift + a bit more sat so cover temperature
  // fills the screen without competing with facts / strip.
  const bgS = chromatic ? clamp(baseS * 0.48, 14, 28) : 0;
  const bgL = chromatic ? 17 : 11;
  const midS = chromatic ? clamp(bgS * 0.92, 12, 24) : 0;
  const midL = chromatic ? 13 : 8;
  const edgeS = chromatic ? clamp(bgS * 0.78, 10, 20) : 0;
  const edgeL = chromatic ? 8 : 5;

  const bgCenter = hslToString(H, bgS, bgL);
  const bgMid = hslToString(H, midS, midL);
  const bgEdge = hslToString(H, edgeS, edgeL);
  const midRgb = hslToRgb(H, midS, midL);

  // --- Progress: primary accent (moderate sat, mid L) ---
  let barH = H;
  let barS = chromatic ? clamp(baseS * 0.55, 18, 28) : 0;
  let barL = chromatic ? 52 : 54;
  if (!chromatic) {
    barH = 0;
    barS = 0;
    barL = 54;
  }
  // Extra safety vs muteAccent neon path for hot Vibrant-derived H
  barS = clamp(barS, 0, ACCENT_S_MAX);
  barL = clamp(barL, ACCENT_L_MIN, 56);
  if (getContrastRatio(midRgb, hslToRgb(barH, barS, barL)) < 2.6) {
    barL = Math.min(58, barL + 8);
  }

  // --- Facts: soft tinted light with clear album temperature (not chalk white) ---
  // Slightly lower L + higher S makes hue readable at couch distance without neon.
  let factH = H;
  let factS = chromatic ? clamp(baseS * 0.52, 14, 26) : 0;
  let factL = 84;
  if (!chromatic) {
    factH = 0;
    factS = 0;
    factL = 90;
  }
  const fact = ensureTextOn(midRgb, { h: factH, s: factS, l: factL }, 4.5);

  // --- Strip: same album hue, readable ladder (stronger tint than pure white) ---
  // Progress/dots stay the bolder accent; strip is lighter but clearly related.
  let stripS = chromatic ? clamp(baseS * 0.42, 10, 20) : 0;
  const title = ensureTextOn(midRgb, { h: H, s: stripS, l: 88 }, 4.5);
  const artist = ensureTextOn(
    midRgb,
    { h: H, s: chromatic ? clamp(stripS * 0.9, 8, 18) : 0, l: 80 },
    3.5
  );
  const meta = ensureTextOn(
    midRgb,
    { h: H, s: chromatic ? clamp(stripS * 0.75, 6, 14) : 0, l: 74 },
    3.0
  );
  // Soft hierarchy via alpha on top of tinted values
  const artistColor = hslCss(artist.h, artist.s, artist.l, 0.9);
  const metaColor = hslCss(meta.h, meta.s, meta.l, 0.78);
  const sepColor = hslCss(meta.h, clamp(meta.s * 0.85, 0, 12), meta.l, 0.5);

  const progressFill = hslCss(barH, barS, barL);
  // Status-bar track: lighter + higher alpha so it separates from the page wash
  // (previous ~L16–24 @ 0.32 alpha read as almost invisible on Simple Gradient).
  const progressTrack = hslCss(barH, clamp(barS, 0, 18), clamp(bgL + 22, 30, 40), 0.5);
  // Idle dots: soft album-tinted (active remains bar) — leave accent balance as-is
  const dotIdle = chromatic
    ? hslCss(H, clamp(stripS * 0.6, 0, 12), 88, 0.3)
    : 'rgba(242, 242, 242, 0.28)';

  return {
    background: `radial-gradient(ellipse at 26% 88%, ${bgCenter} 0%, ${bgMid} 48%, ${bgEdge} 100%)`,
    factText: hslCss(fact.h, fact.s, fact.l),
    factMuted: hslCss(fact.h, fact.s, fact.l, 0.72),
    title: hslCss(title.h, title.s, title.l),
    artist: artistColor,
    meta: metaColor,
    sep: sepColor,
    progressTrack,
    progressFill,
    dot: dotIdle,
    dotActive: progressFill,
    coverRing: hslCss(barH, clamp(bgS, 0, 18), clamp(bgL + 10, 14, 24), 0.45),
  };
}


/** @deprecated alias — same as AlbumTheme */
export type RpiTheme = AlbumTheme;

export interface UseAlbumThemeOptions {
  artworkUrl: MaybeRefOrGetter<string | null>;
  track?: MaybeRefOrGetter<Track | null | undefined>;
  progress?: MaybeRefOrGetter<number>;
  /** When true (default), include background gradient in cssVars */
  includeBackground?: boolean;
}

function themeSeedFromTrackOrUrl(
  url: string | null,
  track: Track | null | undefined
): string {
  if (track) {
    return `${track.artist}::${track.album}::${track.title}`;
  }
  if (url) return url;
  return `rnd:${Date.now()}`;
}

export function useAlbumTheme(options: UseAlbumThemeOptions) {
  const includeBackground = options.includeBackground !== false;
  const theme = ref<AlbumTheme>(makeFallbackAlbumTheme());
  let sampleGeneration = 0;

  function sampleFromArtwork(url: string | null): void {
    const gen = ++sampleGeneration;
    const track = options.track !== undefined ? toValue(options.track) : null;
    const seed = themeSeedFromTrackOrUrl(url, track ?? null);

    if (!url) {
      theme.value = makeFallbackAlbumTheme(seed);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    img.onload = () => {
      if (gen !== sampleGeneration) return;
      try {
        const opts = { colorCount: 10, quality: 5, colorSpace: 'oklch' as const };
        const swatches = getSwatchesSync(img, opts);
        const palette = getPaletteSync(img, opts) ?? [];

        const built = buildAlbumThemeFromThief(swatches, palette);
        if (built) {
          theme.value = built;
        } else {
          console.warn('[album-theme] Color Thief returned no usable swatches; soft fallback');
          theme.value = makeFallbackAlbumTheme(seed);
        }
      } catch (err) {
        console.warn('[album-theme] Color Thief failed; soft fallback', err);
        if (gen === sampleGeneration) theme.value = makeFallbackAlbumTheme(seed);
      }
    };

    img.onerror = () => {
      console.warn('[album-theme] Artwork failed to load; soft fallback', url);
      if (gen === sampleGeneration) theme.value = makeFallbackAlbumTheme(seed);
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
      // Album chrome (text / progress / dots)
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
      // ProgressBar component compat
      ['--progress-bar-bg' as string]: t.progressTrack,
      ['--progress-bar-fill' as string]: t.progressFill,
      // Generic text roles used by older layouts
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
