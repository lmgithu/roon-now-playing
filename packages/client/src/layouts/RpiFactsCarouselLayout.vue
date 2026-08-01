<script setup lang="ts">
/**
 * RPi Facts Carousel — Facts-carousel hierarchy, Pi 3–safe rendering.
 *
 * Color system (Color Thief → single album hue, staged by role):
 * - Pick one chromatic hue from the cover (prefer Muted/LightMuted agreement)
 * - Background / facts / strip / progress all share that H at different S/L
 * - Strip + facts: same H with readable album tint; progress is the bolder accent
 * - Soft neutral fallback only when art is gray or sampling fails
 * - Anti-neon clamps; no dual fighting tints (e.g. cream facts + purple dock)
 */
import { computed, ref, watch, onUnmounted, type CSSProperties } from 'vue';
import type { Track, PlaybackState, BackgroundType } from '@roon-screen-cover/shared';
import { getSwatchesSync, getPaletteSync, type Color, type SwatchMap } from 'colorthief';
import { useFacts } from '../composables/useFacts';
import {
  hslToString,
  hslToRgb,
  getContrastRatio,
  type HSL,
  type RGB,
} from '../composables/colorUtils';

const props = defineProps<{
  track: Track | null;
  state: PlaybackState;
  isPlaying: boolean;
  progress: number;
  currentTime: string;
  duration: string;
  artworkUrl: string | null;
  zoneName: string;
  background: BackgroundType;
}>();

const trackRef = computed(() => props.track);
const stateRef = computed(() => props.state);

const { facts, currentFactIndex, currentFact, isLoading, error } = useFacts(trackRef, stateRef);

/**
 * Sequential fact transition (no overlap):
 *   visible → fade out old → swap text (invisible) → fade in new
 * Never shows two facts at once.
 */
const FADE_MS = 320;

const displayFact = ref<string | null>(null);
/** 0 = hidden, 1 = fully visible */
const factOpacity = ref(1);
const factPhase = ref<'idle' | 'out' | 'in'>('idle');

let factFadeTimer: ReturnType<typeof setTimeout> | null = null;
let factToken = 0;
/** Queue the latest fact if a transition is already running */
let pendingFact: string | null | undefined = undefined;

function clearFactTimer(): void {
  if (factFadeTimer !== null) {
    clearTimeout(factFadeTimer);
    factFadeTimer = null;
  }
}

function setFactVisible(text: string | null): void {
  displayFact.value = text;
  factOpacity.value = text ? 1 : 0;
  factPhase.value = 'idle';
}

function runFactTransition(next: string | null): void {
  const token = ++factToken;
  clearFactTimer();
  pendingFact = undefined;

  // First paint / no previous text — appear without a messy half-fade
  if (!displayFact.value) {
    displayFact.value = next;
    factOpacity.value = next ? 1 : 0;
    factPhase.value = 'idle';
    return;
  }

  // Same text — nothing to do
  if (displayFact.value === next) {
    factOpacity.value = next ? 1 : 0;
    factPhase.value = 'idle';
    return;
  }

  // Phase 1: fade out current fact completely
  factPhase.value = 'out';
  factOpacity.value = 0;

  factFadeTimer = setTimeout(() => {
    if (token !== factToken) return;

    // Swap while fully invisible (no overlap with the old string)
    displayFact.value = next;
    factPhase.value = 'in';

    // Next frame: fade in (lets the browser apply opacity 0 with new text first)
    requestAnimationFrame(() => {
      if (token !== factToken) return;
      requestAnimationFrame(() => {
        if (token !== factToken) return;
        factOpacity.value = next ? 1 : 0;

        factFadeTimer = setTimeout(() => {
          if (token !== factToken) return;
          factPhase.value = 'idle';
          factFadeTimer = null;

          // Drain queue if another fact arrived during the transition
          if (pendingFact !== undefined) {
            const queued = pendingFact;
            pendingFact = undefined;
            if (queued !== displayFact.value) {
              runFactTransition(queued);
            }
          }
        }, FADE_MS);
      });
    });
  }, FADE_MS);
}

watch(
  currentFact,
  (next) => {
    // While loading/errors, still drive the slot
    if (factPhase.value !== 'idle') {
      pendingFact = next;
      return;
    }
    if (displayFact.value === next) return;
    if (!displayFact.value && next) {
      setFactVisible(next);
      return;
    }
    runFactTransition(next);
  },
  { immediate: true }
);

// Reset fact slot immediately on track change (avoid fading between tracks)
watch(
  () => (props.track ? `${props.track.artist}::${props.track.title}` : null),
  () => {
    factToken++;
    clearFactTimer();
    pendingFact = undefined;
    // Next currentFact watch will set content; clear so we don't cross-fade across tracks
    displayFact.value = null;
    factOpacity.value = 0;
    factPhase.value = 'idle';
  }
);

onUnmounted(() => {
  factToken++;
  clearFactTimer();
});

export interface RpiTheme {
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
function makeFallbackTheme(seed: string = ''): RpiTheme {
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
    track = 'rgba(242, 242, 242, 0.18)';
    coverRing = 'rgba(242, 242, 242, 0.1)';
  } else {
    const muted = muteAccent(a.h, a.s, a.l);
    if (isUnwantedBlueHue(muted.h, muted.s)) {
      accent = TEXT_ACCENT;
      accentSoft = 'rgba(242, 242, 242, 0.35)';
      track = 'rgba(242, 242, 242, 0.18)';
      coverRing = 'rgba(242, 242, 242, 0.1)';
    } else {
      accent = hslToString(muted.h, muted.s, muted.l);
      accentSoft = hslToString(muted.h, muted.s, muted.l, 0.32);
      track = hslToString(muted.h, clamp(muted.s, 4, 12), 22, 0.4);
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

const theme = ref<RpiTheme>(makeFallbackTheme());

const LIGHT_TEXT: RGB = { r: 245, g: 245, b: 245 };
const DARK_TEXT: RGB = { r: 26, g: 26, b: 26 };

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

function pickReadableText(bg: RGB): { text: string; secondary: string; tertiary: string } {
  const lightC = getContrastRatio(bg, LIGHT_TEXT);
  const darkC = getContrastRatio(bg, DARK_TEXT);
  // Prefer light text on dark OLED themes; only use dark text if it clearly wins
  if (lightC >= 4.5 || lightC >= darkC) {
    return {
      text: '#f5f5f5',
      secondary: 'rgba(245, 245, 245, 0.82)',
      tertiary: 'rgba(245, 245, 245, 0.7)',
    };
  }
  return {
    text: '#1a1a1a',
    secondary: 'rgba(26, 26, 26, 0.8)',
    tertiary: 'rgba(26, 26, 26, 0.65)',
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
function buildRpiThemeFromThief(swatches: SwatchMap, palette: Color[]): RpiTheme | null {
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
  const progressTrack = hslCss(barH, clamp(barS, 0, 16), clamp(bgL + 12, 16, 24), 0.32);
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

function themeSeedFromTrackOrUrl(url: string | null): string {
  if (props.track) {
    return `${props.track.artist}::${props.track.album}::${props.track.title}`;
  }
  if (url) return url;
  return `rnd:${Date.now()}`;
}

let sampleGeneration = 0;

function sampleFromArtwork(url: string | null): void {
  const gen = ++sampleGeneration;
  const seed = themeSeedFromTrackOrUrl(url);

  if (!url) {
    // Only hard fallback: no artwork to give Color Thief
    theme.value = makeFallbackTheme(seed);
    return;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';

  img.onload = () => {
    if (gen !== sampleGeneration) return;
    try {
      // Color Thief v3: OKLCH + Muted/DarkMuted (status bar). Pi-friendly quality.
      const opts = { colorCount: 10, quality: 5, colorSpace: 'oklch' as const };
      const swatches = getSwatchesSync(img, opts);
      const palette = getPaletteSync(img, opts) ?? [];

      const built = buildRpiThemeFromThief(swatches, palette);
      if (built) {
        theme.value = built;
      } else {
        console.warn('[rpi-theme] Color Thief returned no usable swatches; soft fallback');
        theme.value = makeFallbackTheme(seed);
      }
    } catch (err) {
      console.warn('[rpi-theme] Color Thief failed; soft fallback', err);
      if (gen === sampleGeneration) theme.value = makeFallbackTheme(seed);
    }
  };

  img.onerror = () => {
    console.warn('[rpi-theme] Artwork failed to load; soft fallback', url);
    if (gen === sampleGeneration) theme.value = makeFallbackTheme(seed);
  };

  img.src = url;
}

watch(
  () => props.artworkUrl,
  (url) => {
    sampleFromArtwork(url);
  },
  { immediate: true }
);

/**
 * Smooth progress: useNowPlaying already interpolates ~10 Hz.
 * We drive width via transform: scaleX (compositor-friendly on Pi) and a short
 * linear CSS transition so each step eases into the next — no visible jumps.
 */
const progressScale = computed(() => {
  const p = Number.isFinite(props.progress) ? props.progress : 0;
  return Math.min(100, Math.max(0, p)) / 100;
});

const layoutStyle = computed(
  (): CSSProperties => ({
    background: theme.value.background,
    // CSS variables for the strip / facts (readable + album-linked)
    ['--rpi-fact' as string]: theme.value.factText,
    ['--rpi-fact-muted' as string]: theme.value.factMuted,
    ['--rpi-title' as string]: theme.value.title,
    ['--rpi-artist' as string]: theme.value.artist,
    ['--rpi-meta' as string]: theme.value.meta,
    ['--rpi-sep' as string]: theme.value.sep,
    ['--rpi-progress-track' as string]: theme.value.progressTrack,
    ['--rpi-progress-fill' as string]: theme.value.progressFill,
    ['--rpi-dot' as string]: theme.value.dot,
    ['--rpi-dot-active' as string]: theme.value.dotActive,
    ['--rpi-cover-ring' as string]: theme.value.coverRing,
    ['--rpi-progress' as string]: String(progressScale.value),
  })
);
</script>

<template>
  <div class="rpi-facts-carousel-layout" :style="layoutStyle">
    <div class="content">
      <div class="safe-zone">
        <!-- Fact (hero) -->
        <div class="facts-area">
          <div v-if="!track" class="no-playback">
            <p class="no-playback-text">No playback</p>
            <p class="zone-hint">{{ zoneName }}</p>
          </div>

          <template v-else>
            <p v-if="isLoading && !displayFact" class="loading-hint">Loading facts…</p>
            <p
              v-else-if="displayFact"
              class="fact-text"
              :style="{ opacity: factOpacity }"
            >{{ displayFact }}</p>
            <p v-else-if="error && error.type === 'no-key'" class="error-hint">
              Configure API key in <a href="/admin">Admin</a>
            </p>

            <div v-if="facts.length > 1" class="fact-dots">
              <span
                v-for="(_, index) in facts"
                :key="index"
                class="dot"
                :class="{ active: index === currentFactIndex }"
              />
            </div>
          </template>
        </div>

        <!-- Bottom: cover + now-playing strip (colors from album theme) -->
        <div v-if="track" class="now-playing-row">
          <div class="cover-wrap">
            <img
              v-if="artworkUrl"
              :src="artworkUrl"
              alt=""
              class="cover-art"
              decoding="async"
            />
            <div v-else class="cover-placeholder" />
          </div>

          <div class="now-playing">
            <div class="np-line">
              <span class="np-title">{{ track.title }}</span>
              <span class="np-sep">·</span>
              <span class="np-artist">{{ track.artist }}</span>
            </div>
            <div class="progress-line">
              <div class="progress-fill" />
            </div>
            <div class="np-meta">
              <span class="meta-left">
                <span class="zone-name">{{ zoneName }}</span>
                <template v-if="track.source_label">
                  <span class="meta-dot" aria-hidden="true">·</span>
                  <span class="source-label">{{ track.source_label }}</span>
                </template>
                <template v-if="track.quality_label">
                  <span class="meta-dot" aria-hidden="true">·</span>
                  <span class="quality-label">{{ track.quality_label }}</span>
                </template>
              </span>
              <span class="time-info">{{ currentTime }} / {{ duration }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rpi-facts-carousel-layout {
  container-type: inline-size;
  container-name: layout;

  position: relative;
  width: 100%;
  height: 100%;
  /* Fallback before first sample — neutral dark, not blue */
  background: radial-gradient(ellipse at 28% 85%, hsl(0, 0%, 14%) 0%, hsl(0, 0%, 7%) 100%);
  overflow: hidden;
  isolation: isolate;
}

.content {
  position: relative;
  width: 100%;
  height: 100%;
  z-index: 1;
}

.safe-zone {
  width: 100%;
  height: 100%;
  padding: 5% 6%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.facts-area {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  padding-bottom: 2%;
}

.fact-text {
  font-size: calc(var(--fluid-fact) * var(--font-scale, 1));
  font-weight: var(--font-semibold);
  line-height: var(--leading-snug);
  margin: 0;
  /*
   * Stable quote column (not content shrink-wrap).
   * ~68% of the layout container — slightly narrower than the ~88% status
   * strip so hierarchy stays clear, but wide enough for TV / wall viewing.
   * 34em soft-caps measure on ultrawide; 100% never overflows the safe zone.
   * text-align:center keeps short lines optically centered in the column.
   */
  width: min(68cqi, 34em);
  max-width: 100%;
  box-sizing: border-box;
  color: var(--rpi-fact, #f5f5f5);
  /* Subtitle-style stack: crisp edge + soft halo (TV-readable, no CSS filter) */
  text-shadow:
    0 1px 0 rgba(0, 0, 0, 0.95),
    0 2px 2px rgba(0, 0, 0, 0.85),
    0 3px 12px rgba(0, 0, 0, 0.65);
  /* Sequential fade only — single layer, never two facts overlapping */
  transition: opacity 0.32s ease-in-out;
  will-change: opacity;
  backface-visibility: hidden;
}

.loading-hint,
.error-hint {
  font-size: calc(var(--fluid-caption) * var(--font-scale, 1));
  color: var(--rpi-fact-muted, rgba(245, 245, 245, 0.72));
  margin: 0;
}

.error-hint a {
  color: var(--rpi-fact, #f5f5f5);
}

.fact-dots {
  display: flex;
  justify-content: center;
  gap: clamp(10px, 1cqi, 22px);
  margin-top: clamp(1.25rem, 2.5cqi, 3rem);
}

.dot {
  width: clamp(8px, 0.9cqi, 18px);
  height: clamp(8px, 0.9cqi, 18px);
  border-radius: 50%;
  background: var(--rpi-dot, rgba(245, 245, 245, 0.35));
  transition: background-color 0.32s ease-in-out;
}

.dot.active {
  background: var(--rpi-dot-active, #f5f5f5);
}

.no-playback {
  color: var(--rpi-fact-muted, rgba(245, 245, 245, 0.8));
}

.no-playback-text {
  font-size: calc(var(--fluid-hero) * var(--font-scale, 1) * 0.55);
  font-weight: var(--font-semibold);
  margin: 0;
  color: var(--rpi-fact, #f5f5f5);
  text-shadow:
    0 1px 0 rgba(0, 0, 0, 0.95),
    0 2px 2px rgba(0, 0, 0, 0.85),
    0 3px 12px rgba(0, 0, 0, 0.65);
}

.zone-hint {
  font-size: calc(var(--fluid-caption) * var(--font-scale, 1));
  margin: 0.6em 0 0 0;
  color: var(--rpi-meta, rgba(245, 245, 245, 0.7));
}

.now-playing-row {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: clamp(0.85rem, 2cqi, 1.75rem);
  flex-shrink: 0;
  max-width: 100%;
}

.cover-wrap {
  flex: 0 0 auto;
  width: clamp(72px, 12cqi, 160px);
  height: clamp(72px, 12cqi, 160px);
  border-radius: clamp(2px, 0.22cqi, 5px);
  overflow: hidden;
  background: var(--rpi-cover-ring, rgba(255, 255, 255, 0.08));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  outline: 1px solid var(--rpi-cover-ring, rgba(255, 255, 255, 0.08));
}

.cover-art {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(145deg, #2a2a38 0%, #14141c 100%);
}

.now-playing {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.55rem;
}

.np-line {
  display: flex;
  align-items: baseline;
  gap: 0.4em;
  font-size: calc(var(--fluid-subtitle) * var(--font-scale, 1));
  white-space: nowrap;
  overflow: hidden;
}

/* Lighter subtitle stack for smaller NP strip type (same idea as fact text, less glow) */
.np-title,
.np-artist,
.np-sep,
.zone-name,
.source-label,
.quality-label,
.meta-dot,
.time-info,
.loading-hint,
.error-hint,
.zone-hint {
  text-shadow:
    0 1px 0 rgba(0, 0, 0, 0.9),
    0 1px 4px rgba(0, 0, 0, 0.55);
}

.np-title {
  font-weight: var(--font-semibold);
  color: var(--rpi-title, #f5f5f5);
  overflow: hidden;
  text-overflow: ellipsis;
}

.np-sep {
  color: var(--rpi-sep, rgba(245, 245, 245, 0.45));
  flex-shrink: 0;
}

.np-artist {
  color: var(--rpi-artist, rgba(245, 245, 245, 0.82));
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-line {
  height: clamp(5px, 0.45cqi, 9px);
  background: var(--rpi-progress-track, rgba(245, 245, 245, 0.16));
  border-radius: 999px;
  overflow: hidden;
  /* Isolate fill transforms so only this strip repaints */
  contain: layout style;
  box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.25);
}

.progress-fill {
  height: 100%;
  width: 100%;
  /* Soft “elegant” sheen over album-tinted accent — still Pi-friendly (scaleX only) */
  background-color: var(--rpi-progress-fill, #f2f2f2);
  background-image: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.12) 0%,
    rgba(255, 255, 255, 0.04) 40%,
    rgba(255, 255, 255, 0) 58%,
    rgba(0, 0, 0, 0.1) 100%
  );
  transform-origin: left center;
  /* scaleX is GPU-friendly; linear transition bridges 100ms seek ticks */
  transform: scaleX(var(--rpi-progress, 0));
  transition: transform 0.12s linear;
  will-change: transform;
  /* Avoid subpixel flicker on some Chromium builds */
  backface-visibility: hidden;
  border-radius: inherit;
  box-shadow: 0 0 8px color-mix(in srgb, var(--rpi-progress-fill, #f2f2f2) 18%, transparent);
}

.np-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  font-size: calc(var(--fluid-caption) * var(--font-scale, 1));
  color: var(--rpi-meta, rgba(245, 245, 245, 0.7));
}

.meta-left {
  display: flex;
  align-items: baseline;
  gap: 0.35em;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  white-space: nowrap;
  color: var(--rpi-meta, rgba(245, 245, 245, 0.7));
}

.zone-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 0 1 auto;
  max-width: 42%;
  color: var(--rpi-meta, rgba(245, 245, 245, 0.7));
}

.meta-dot {
  flex-shrink: 0;
  opacity: 0.55;
  color: var(--rpi-sep, rgba(245, 245, 245, 0.45));
}

.source-label,
.quality-label {
  flex-shrink: 0;
  color: var(--rpi-meta, rgba(245, 245, 245, 0.7));
  letter-spacing: 0.01em;
}

.quality-label {
  font-variant-numeric: tabular-nums;
  /* Slightly brighter so 192kHz / 24-bit is glanceable */
  color: var(--rpi-artist, rgba(245, 245, 245, 0.82));
}

.time-info {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--rpi-meta, rgba(245, 245, 245, 0.7));
}

@container layout (max-width: 700px) {
  .now-playing-row {
    gap: 0.75rem;
  }

  .cover-wrap {
    width: clamp(64px, 18cqi, 110px);
    height: clamp(64px, 18cqi, 110px);
  }

  /* Narrow screens: use most of the safe column; still fixed-width frame */
  .fact-text {
    width: min(90%, 28em);
    max-width: 100%;
  }
}
</style>
