<script setup lang="ts">
/**
 * RPi Facts Carousel — Facts-carousel information hierarchy, Pi 3–safe rendering.
 *
 * - No full-screen CSS blur / dual-image crossfades
 * - Dark radial gradient from album dominant + secondary hues (hue-bucket extract)
 * - Now-playing strip (title, zone, progress, time) tinted from the same palette
 * - WCAG-oriented contrast: dark bg + light text; accent for progress/dots
 */
import { computed, ref, watch, onUnmounted, type CSSProperties } from 'vue';
import type { Track, PlaybackState, BackgroundType } from '@roon-screen-cover/shared';
import { useFacts } from '../composables/useFacts';
import {
  SAMPLE_SIZE,
  extractDominantColor,
  extractColorPalette,
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
 * Soft fallback accents — only used when artwork sampling fails / no art.
 * Low saturation, mid-lightness: readable on dark OLED without a loud blue default.
 * Seeded by artwork URL (or random) so tracks vary without flashing every repaint.
 */
const FALLBACK_ACCENTS: ReadonlyArray<{ h: number; s: number; l: number }> = [
  { h: 28, s: 11, l: 58 }, // warm stone
  { h: 42, s: 10, l: 57 }, // soft sand
  { h: 95, s: 9, l: 56 }, // muted olive
  { h: 155, s: 10, l: 55 }, // sage
  { h: 200, s: 11, l: 58 }, // soft slate (not vivid blue)
  { h: 260, s: 9, l: 58 }, // dusty violet
  { h: 340, s: 10, l: 57 }, // rose ash
  { h: 0, s: 6, l: 60 }, // warm neutral gray
  { h: 220, s: 7, l: 59 }, // cool neutral gray
];

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

/** Build a dark, quiet fallback theme. Does not affect successful album-art extraction. */
function makeFallbackTheme(seed: string = ''): RpiTheme {
  const idx = seed
    ? hashSeed(seed) % FALLBACK_ACCENTS.length
    : Math.floor(Math.random() * FALLBACK_ACCENTS.length);
  const edgeIdx = seed
    ? hashSeed(seed + ':edge') % FALLBACK_ACCENTS.length
    : (idx + 3) % FALLBACK_ACCENTS.length;

  const a = FALLBACK_ACCENTS[idx]!;
  const e = FALLBACK_ACCENTS[edgeIdx]!;

  // Very dark field with a whisper of hue (OLED-friendly, not flashy)
  const bgCenter = hslToString(a.h, clamp(a.s + 4, 6, 16), 11);
  const bgMid = hslToString(e.h, clamp(e.s, 5, 14), 7);
  const bgEdge = hslToString(e.h, clamp(e.s - 2, 4, 12), 4);

  // Soft accent: muted, not dominant (~#9a9a9a family with slight hue)
  const accent = hslToString(a.h, a.s, a.l);
  const accentSoft = hslToString(a.h, a.s, a.l, 0.32);
  const track = hslToString(a.h, clamp(a.s, 4, 12), 22, 0.4);

  return {
    background: `radial-gradient(ellipse at 28% 85%, ${bgCenter} 0%, ${bgMid} 52%, ${bgEdge} 100%)`,
    factText: '#f2f2f2',
    factMuted: 'rgba(242, 242, 242, 0.7)',
    title: '#f2f2f2',
    artist: 'rgba(242, 242, 242, 0.8)',
    meta: 'rgba(242, 242, 242, 0.68)',
    sep: 'rgba(242, 242, 242, 0.42)',
    progressTrack: track,
    progressFill: accent,
    dot: accentSoft,
    dotActive: accent,
    coverRing: hslToString(a.h, clamp(a.s, 5, 14), 18, 0.45),
  };
}

const theme = ref<RpiTheme>(makeFallbackTheme());

const LIGHT_TEXT: RGB = { r: 245, g: 245, b: 245 };
const DARK_TEXT: RGB = { r: 26, g: 26, b: 26 };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
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

/**
 * Pick the most chromatic palette swatch for accents.
 * Dark covers often yield a low-sat "dominant"; reds/etc. live in secondary buckets.
 */
function pickAccentSource(dominant: HSL, palette: HSL[]): HSL {
  const candidates = [dominant, ...palette].filter((c) => c.s >= 12);
  if (candidates.length === 0) {
    return dominant;
  }
  // Prefer real chroma; slight bonus for mid lightness (not pure black/white pixels)
  let best = candidates[0]!;
  let bestScore = -1;
  for (const c of candidates) {
    const midL = 1 - Math.abs(c.l - 45) / 50;
    const score = c.s * (0.65 + 0.35 * clamp(midL, 0, 1));
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Build a dark, album-linked theme. Background stays OLED-safe (low L);
 * accents (progress, active dots) use a brighter tint of the art hue.
 *
 * Important: low-sat / B&W art must NOT force a cool blue accent. The old
 * `max(s, 40)` boost on extractDominantColor's neutral h=220 produced #6d87ba
 * even when sampling "succeeded".
 */
function buildRpiTheme(dominant: HSL, palette: HSL[]): RpiTheme {
  const accentSrc = pickAccentSource(dominant, palette);
  const isNeutral = accentSrc.s < 14;

  const secondary =
    palette.find((c) => {
      const dh = Math.min(Math.abs(c.h - dominant.h), 360 - Math.abs(c.h - dominant.h));
      return dh >= 25 && c.s >= 12;
    }) ?? (isNeutral ? dominant : accentSrc);

  // Dark backgrounds — keep neutral art nearly gray (no fake blue field)
  const bgS = isNeutral
    ? clamp(accentSrc.s * 0.4, 4, 12)
    : clamp(dominant.s * 0.55, 14, 48);
  const bgL = clamp(11 + (dominant.l > 50 ? 2 : 0), 8, 14);
  const edgeS = isNeutral
    ? clamp(bgS * 0.8, 3, 10)
    : clamp(secondary.s * 0.5, 12, 42);
  const edgeL = clamp(bgL - 5, 4, 9);
  const midS = clamp((bgS + edgeS) / 2, isNeutral ? 3 : 12, isNeutral ? 12 : 45);
  const midL = clamp((bgL + edgeL) / 2 + 1, 6, 12);

  const bgH = isNeutral ? 0 : dominant.h; // pure gray-ish when neutral
  const edgeH = isNeutral ? 0 : secondary.h;

  const bgCenter = hslToString(bgH, bgS, bgL);
  const bgMid = hslToString(edgeH, midS, midL);
  const bgEdge = hslToString(edgeH, edgeS, edgeL);

  const midRgb = hslToRgb(edgeH, midS, midL);
  const texts = pickReadableText(midRgb);

  // --- Accent (progress / dots) ---
  let accentH = isNeutral ? 0 : accentSrc.h;
  let accentS: number;
  let accentL: number;

  if (isNeutral) {
    // Quiet silver-gray — never boost into blue
    accentS = 0;
    accentL = 62;
  } else {
    // Use real art chroma; mild lift only (no floor of 40)
    accentS = clamp(accentSrc.s * 0.85, 18, 68);
    accentL = 56;
  }

  let accentRgb = hslToRgb(accentH, accentS, accentL);
  if (getContrastRatio(midRgb, accentRgb) < 3) {
    accentL = isNeutral ? 72 : 66;
    accentRgb = hslToRgb(accentH, accentS, accentL);
  }
  if (getContrastRatio(midRgb, accentRgb) < 3) {
    accentS = isNeutral ? 0 : clamp(accentS, 10, 40);
    accentL = 78;
    accentRgb = hslToRgb(accentH, accentS, accentL);
  }

  const accent = hslToString(accentH, accentS, accentL);
  const accentSoft = hslToString(accentH, accentS, accentL, 0.38);
  const track = isNeutral
    ? hslToString(0, 0, 24, 0.45)
    : hslToString(accentH, clamp(bgS, 8, 28), clamp(bgL + 16, 16, 28), 0.45);

  return {
    background: `radial-gradient(ellipse at 26% 88%, ${bgCenter} 0%, ${bgMid} 48%, ${bgEdge} 100%)`,
    factText: texts.text,
    factMuted: texts.tertiary,
    title: texts.text,
    artist: texts.secondary,
    meta: texts.tertiary,
    sep: texts.tertiary,
    progressTrack: track,
    progressFill: accent,
    dot: accentSoft,
    dotActive: accent,
    coverRing: isNeutral
      ? 'rgba(255, 255, 255, 0.1)'
      : hslToString(accentH, bgS, clamp(bgL + 10, 14, 24), 0.55),
  };
}

let sampleGeneration = 0;

function sampleFromArtwork(url: string | null): void {
  const gen = ++sampleGeneration;

  if (!url) {
    // Seed with track id if present so the soft fallback varies per song
    const seed = props.track
      ? `${props.track.artist}::${props.track.album}::${props.track.title}`
      : `rnd:${Date.now()}`;
    theme.value = makeFallbackTheme(seed);
    return;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';

  img.onload = () => {
    if (gen !== sampleGeneration) return;
    try {
      const canvas = document.createElement('canvas');
      // SAMPLE_SIZE (50) is still cheap; better hue buckets than 16px average
      const size = Math.min(SAMPLE_SIZE, 48);
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        theme.value = makeFallbackTheme(url);
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      const imageData = ctx.getImageData(0, 0, size, size);
      const dominant = extractDominantColor(imageData);
      const palette = extractColorPalette(imageData, 5);
      // Successful extraction path — unchanged algorithm
      theme.value = buildRpiTheme(dominant, palette);
    } catch {
      if (gen === sampleGeneration) theme.value = makeFallbackTheme(url);
    }
  };

  img.onerror = () => {
    if (gen === sampleGeneration) theme.value = makeFallbackTheme(url);
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
              <span class="zone-name">{{ zoneName }}</span>
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
  background: radial-gradient(ellipse at 28% 85%, hsl(0, 0%, 11%) 0%, hsl(0, 0%, 4%) 100%);
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
  max-width: 20em;
  color: var(--rpi-fact, #f5f5f5);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.65);
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
  border-radius: clamp(6px, 0.6cqi, 12px);
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
  height: clamp(4px, 0.4cqi, 8px);
  background: var(--rpi-progress-track, rgba(245, 245, 245, 0.16));
  border-radius: 999px;
  overflow: hidden;
  /* Isolate fill transforms so only this strip repaints */
  contain: layout style;
}

.progress-fill {
  height: 100%;
  width: 100%;
  background: var(--rpi-progress-fill, hsl(0, 0%, 62%));
  transform-origin: left center;
  /* scaleX is GPU-friendly; linear transition bridges 100ms seek ticks */
  transform: scaleX(var(--rpi-progress, 0));
  transition: transform 0.12s linear;
  will-change: transform;
  /* Avoid subpixel flicker on some Chromium builds */
  backface-visibility: hidden;
}

.np-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  font-size: calc(var(--fluid-caption) * var(--font-scale, 1));
  color: var(--rpi-meta, rgba(245, 245, 245, 0.7));
}

.zone-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 55%;
  color: var(--rpi-meta, rgba(245, 245, 245, 0.7));
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

  .fact-text {
    max-width: 22em;
  }
}
</style>
