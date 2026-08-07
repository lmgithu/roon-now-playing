<script setup lang="ts">
/**
 * RPi Facts Carousel — Facts-carousel hierarchy, Pi 3–safe / 10-foot TV rendering.
 *
 * Field: Black or Colors (premium colored-black from album — mental-model).
 * Progress fill / active dots: accent (Colors) or white (Black).
 * Typography is TV-first: dock chrome scales with viewport; fact size is length-aware.
 */
import { computed, ref, watch, onUnmounted, type CSSProperties } from 'vue';
import type { Track, PlaybackState, BackgroundType } from '@roon-screen-cover/shared';
import { useFacts } from '../composables/useFacts';
import { useAlbumTheme } from '../composables/useAlbumTheme';
import { useColorExtraction } from '../composables/useColorExtraction';
import { useBackgroundStyle } from '../composables/useBackgroundStyle';

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

const { cssVars: albumChrome } = useAlbumTheme({
  artworkUrl: () => props.artworkUrl,
  track: trackRef,
  progress: () => props.progress,
});

const backgroundRef = computed(() => props.background);
const artworkUrlRef = computed(() => props.artworkUrl);
const { colors, palette } = useColorExtraction(artworkUrlRef);
const { style: backgroundStyle } = useBackgroundStyle(backgroundRef, colors, palette);

/** backgroundStyle last so Colors accent wins for progress / active dots */
const layoutStyle = computed((): CSSProperties => ({
  ...albumChrome.value,
  ...backgroundStyle.value,
}));

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

/**
 * Length bands for fact type scale (Hungarian AI facts often 300–500 chars).
 * Short quotes stay large; longer ones step down only mildly so they still
 * fill the stage — thresholds are high so we don't shrink “normal long” text.
 */
const factDensity = computed(() => {
  const n = (displayFact.value ?? '').trim().length;
  if (n >= 520) return 'xlong';
  if (n >= 340) return 'long';
  if (n >= 180) return 'mid';
  return 'short';
});

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
              :class="`fact-${factDensity}`"
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
            <div class="progress-line" :class="{ 'is-paused': !isPlaying }">
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
/*
 * TV / 10-foot first:
 * - container-type: size → cqi (width) + cqb (height) for balanced type
 * - fact size length-banded so long AI quotes fit; short ones stay grand
 * - dock (cover + strip) scales up on large viewports so chrome matches the room
 */
.rpi-facts-carousel-layout {
  container-type: size;
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
  /* Slightly tighter vertical padding — less “void” under the fact on TVs */
  padding: clamp(2.5%, 3.5cqb, 4.5%) clamp(4%, 5cqi, 6%);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: clamp(0.75rem, 2.2cqb, 1.75rem);
}

.facts-area {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  /* Air between quote and dots — scales with viewport height, not stuck to the text */
  gap: clamp(1.1rem, 3cqb, 2.5rem);
  overflow: hidden;
}

.fact-text {
  /*
   * Base = mid-length facts. Density modifiers override.
   * min(cqi, cqb) keeps multi-line quotes inside the facts column on 16:9 TVs.
   * Maxes sit near the short-hero range so long text can still look substantial.
   */
  --rpi-fact-size: clamp(1.4rem, min(3.3cqi, 5.9cqb), 4.95rem);
  font-size: calc(var(--rpi-fact-size) * var(--font-scale, 1));
  font-weight: var(--font-semibold);
  line-height: 1.34;
  margin: 0;
  /*
   * Wider column on large screens so long Hungarian facts use fewer lines
   * (still soft-capped so short quotes don’t stretch edge-to-edge).
   */
  width: min(74cqi, 42em);
  max-width: 100%;
  max-height: 100%;
  box-sizing: border-box;
  color: var(--rpi-fact, #f5f5f5);
  overflow: hidden;
  overflow-wrap: break-word;
  /* Sequential fade only — single layer, never two facts overlapping */
  transition: opacity 0.32s ease-in-out;
  will-change: opacity;
  backface-visibility: hidden;
  flex: 0 1 auto;
  min-height: 0;
}

/* Short quotes: allow a bolder hero size without overrunning the dock */
.fact-text.fact-short {
  --rpi-fact-size: clamp(1.5rem, min(3.55cqi, 6.4cqb), 5.35rem);
  line-height: 1.3;
  width: min(70cqi, 36em);
}

.fact-text.fact-mid {
  /* Near short — only a mild step down */
  --rpi-fact-size: clamp(1.45rem, min(3.4cqi, 6.1cqb), 5.15rem);
}

.fact-text.fact-long {
  /* Still fills the stage; only ~½ step below mid (was too conservative) */
  --rpi-fact-size: clamp(1.35rem, min(3.2cqi, 5.7cqb), 4.85rem);
  line-height: 1.35;
  width: min(76cqi, 44em);
}

/* Truly long AI facts (520+ chars): mild step only — still up near mid max */
.fact-text.fact-xlong {
  --rpi-fact-size: clamp(1.3rem, min(3.05cqi, 5.35cqb), 4.55rem);
  line-height: 1.36;
  width: min(78cqi, 46em);
}

.loading-hint,
.error-hint {
  font-size: calc(clamp(0.85rem, 1.15cqi, 1.75rem) * var(--font-scale, 1));
  color: var(--rpi-fact-muted, rgba(245, 245, 245, 0.72));
  margin: 0;
}

.error-hint a {
  color: var(--rpi-fact, #f5f5f5);
}

.fact-dots {
  display: flex;
  justify-content: center;
  gap: clamp(10px, 1cqi, 20px);
  flex-shrink: 0;
  margin: 0;
  /* Small extra lift so dots read as a separate control, not a text underline */
  padding-top: clamp(0.15rem, 0.6cqb, 0.45rem);
}

.dot {
  width: clamp(7px, 0.65cqi, 14px);
  height: clamp(7px, 0.65cqi, 14px);
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
  font-size: calc(clamp(1.75rem, min(4cqi, 7cqb), 4.5rem) * var(--font-scale, 1));
  font-weight: var(--font-semibold);
  margin: 0;
  color: var(--rpi-fact, #f5f5f5);
}

.zone-hint {
  font-size: calc(clamp(0.85rem, 1.15cqi, 1.75rem) * var(--font-scale, 1));
  margin: 0.6em 0 0 0;
  color: var(--rpi-meta, rgba(245, 245, 245, 0.7));
}

/* —— Status strip: scales with room size so it stays couch-readable —— */
.now-playing-row {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: clamp(0.9rem, 1.8cqi, 2rem);
  flex: 0 0 auto;
  max-width: 100%;
  /* ~11–14% of viewport height budget for dock on large screens */
  min-height: clamp(5.5rem, 12cqb, 11rem);
}

.cover-wrap {
  flex: 0 0 auto;
  /* Was hard-capped at 160px — too small on C1/4K; grow with container */
  width: clamp(80px, 10.5cqi, 248px);
  height: clamp(80px, 10.5cqi, 248px);
  align-self: center;
  border-radius: clamp(2px, 0.22cqi, 6px);
  overflow: hidden;
  /* Cover-layout dark soft drop, scaled for thumbnail */
  box-shadow: 0 clamp(6px, 1cqi, 14px) clamp(16px, 2.6cqi, 36px) rgba(0, 0, 0, 0.45);
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
  gap: clamp(0.4rem, 0.9cqb, 0.75rem);
}

.np-line {
  display: flex;
  align-items: baseline;
  gap: 0.4em;
  /* Dedicated dock type — larger ceiling than generic --fluid-subtitle for TV */
  font-size: calc(clamp(1.05rem, 1.75cqi, 2.65rem) * var(--font-scale, 1));
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
  /* Visible from the sofa without looking chunky on laptops */
  height: clamp(4px, 0.38cqi, 8px);
  /* Homogeneous track — prominent enough to read on album-colored fields */
  background: var(--rpi-progress-track, rgba(245, 245, 245, 0.4));
  border-radius: 999px;
  overflow: hidden;
  contain: layout style;
  box-shadow: none;
}

.progress-fill {
  height: 100%;
  width: 100%;
  background-color: var(--rpi-progress-fill, #f2f2f2);
  background-image: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.04) 55%,
    rgba(255, 255, 255, 0.08) 100%
  );
  transform-origin: left center;
  transform: scaleX(var(--rpi-progress, 0));
  transition: transform 0.12s linear;
  will-change: transform;
  backface-visibility: hidden;
  border-radius: inherit;
  box-shadow: 0 0 6px color-mix(in srgb, var(--rpi-progress-fill, #f2f2f2) 12%, transparent);
}

.progress-line.is-paused .progress-fill {
  animation: rpi-progress-breath 3.6s ease-in-out infinite;
  will-change: transform, opacity;
}

@keyframes rpi-progress-breath {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.62;
  }
}

@media (prefers-reduced-motion: reduce) {
  .progress-line.is-paused .progress-fill {
    animation: none;
    opacity: 0.85;
  }
}

.np-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  font-size: calc(clamp(0.85rem, 1.15cqi, 1.85rem) * var(--font-scale, 1));
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
  color: var(--rpi-artist, rgba(245, 245, 245, 0.82));
}

.time-info {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--rpi-meta, rgba(245, 245, 245, 0.7));
}

/* Large living-room panels (C1-class): boost dock; keep fact steps gentle */
@container layout (min-width: 1600px) {
  .fact-text.fact-short {
    --rpi-fact-size: clamp(1.55rem, min(3.35cqi, 6cqb), 5.2rem);
  }

  .fact-text.fact-long {
    --rpi-fact-size: clamp(1.4rem, min(3.15cqi, 5.6cqb), 4.9rem);
  }

  .fact-text.fact-xlong {
    /* No hard shrink on TV — stay close to long/mid */
    --rpi-fact-size: clamp(1.35rem, min(3cqi, 5.25cqb), 4.65rem);
  }

  .cover-wrap {
    width: clamp(120px, 9.5cqi, 260px);
    height: clamp(120px, 9.5cqi, 260px);
  }

  .np-line {
    font-size: calc(clamp(1.2rem, 1.55cqi, 2.75rem) * var(--font-scale, 1));
  }

  .np-meta {
    font-size: calc(clamp(0.95rem, 1.05cqi, 1.9rem) * var(--font-scale, 1));
  }
}

/* 4K / ultrawide wall: keep hierarchy, never let facts become a textbook page */
@container layout (min-width: 2800px) {
  .fact-text {
    width: min(68cqi, 40em);
  }

  .fact-text.fact-long,
  .fact-text.fact-xlong {
    width: min(72cqi, 44em);
  }

  .cover-wrap {
    width: clamp(160px, 8cqi, 280px);
    height: clamp(160px, 8cqi, 280px);
  }
}

@container layout (max-width: 700px) {
  .now-playing-row {
    gap: 0.75rem;
    min-height: 0;
  }

  .cover-wrap {
    width: clamp(64px, 18cqi, 110px);
    height: clamp(64px, 18cqi, 110px);
  }

  .fact-text,
  .fact-text.fact-short,
  .fact-text.fact-mid,
  .fact-text.fact-long,
  .fact-text.fact-xlong {
    width: min(90%, 28em);
    max-width: 100%;
  }
}
</style>
