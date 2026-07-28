<script setup lang="ts">
/**
 * RPi Facts Carousel — Facts-carousel look, tuned for Raspberry Pi 3 / weak GPUs.
 *
 * Avoids: full-screen CSS blur, dual-image crossfades, mix-blend, heavy text-shadows.
 * Uses: solid (optionally tinted) background, sharp cover art beside the now-playing strip.
 */
import { computed, ref, watch } from 'vue';
import type { Track, PlaybackState, BackgroundType } from '@roon-screen-cover/shared';
import { useFacts } from '../composables/useFacts';

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

/** Soft solid tint from a tiny canvas sample (no CSS blur). Falls back to black. */
const bgTint = ref('rgb(8, 8, 12)');

function sampleTint(url: string | null): void {
  if (!url) {
    bgTint.value = 'rgb(8, 8, 12)';
    return;
  }

  const img = new Image();
  // Same-origin artwork from this app; allow canvas read when CORS allows.
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';

  img.onload = () => {
    try {
      const size = 16;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        // Skip near-transparent pixels
        if ((data[i + 3] ?? 0) < 32) continue;
        r += data[i] ?? 0;
        g += data[i + 1] ?? 0;
        b += data[i + 2] ?? 0;
        n++;
      }
      if (n === 0) return;
      // Darken heavily so white fact text stays legible without a blur layer
      const factor = 0.22;
      r = Math.round((r / n) * factor);
      g = Math.round((g / n) * factor);
      b = Math.round((b / n) * factor);
      bgTint.value = `rgb(${r}, ${g}, ${b})`;
    } catch {
      bgTint.value = 'rgb(8, 8, 12)';
    }
  };

  img.onerror = () => {
    bgTint.value = 'rgb(8, 8, 12)';
  };

  img.src = url;
}

watch(
  () => props.artworkUrl,
  (url) => {
    sampleTint(url);
  },
  { immediate: true }
);

/** Throttle progress bar visual updates (~4 Hz) to reduce Pi repaints */
const displayProgress = ref(0);
let lastProgressPaint = 0;

watch(
  () => props.progress,
  (p) => {
    const now = performance.now();
    if (now - lastProgressPaint >= 250 || p < displayProgress.value || p >= 99.5) {
      displayProgress.value = p;
      lastProgressPaint = now;
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="rpi-facts-carousel-layout" :style="{ backgroundColor: bgTint }">
    <!-- Content (no full-bleed filtered layers) -->
    <div class="content">
      <div class="safe-zone">
        <!-- Fact (hero) -->
        <div class="facts-area">
          <div v-if="!track" class="no-playback">
            <p class="no-playback-text">No playback</p>
            <p class="zone-hint">{{ zoneName }}</p>
          </div>

          <template v-else>
            <p v-if="isLoading" class="loading-hint">Loading facts…</p>
            <p v-else-if="currentFact" class="fact-text">{{ currentFact }}</p>
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

        <!-- Bottom: cover + now-playing strip -->
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
              <div class="progress-fill" :style="{ width: `${displayProgress}%` }" />
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
  /* Solid color only — no CSS filters / blurred images */
  background-color: #08080c;
  overflow: hidden;
  /* Hint: isolate so text doesn't force parent filter compositing */
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
  color: #fff;
  /* Soft shadow without multi-layer blur cost */
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.75);
}

.loading-hint,
.error-hint {
  font-size: calc(var(--fluid-caption) * var(--font-scale, 1));
  color: rgba(255, 255, 255, 0.75);
  margin: 0;
}

.error-hint a {
  color: #fff;
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
  background: rgba(255, 255, 255, 0.35);
}

.dot.active {
  background: #fff;
}

.no-playback {
  color: rgba(255, 255, 255, 0.8);
}

.no-playback-text {
  font-size: calc(var(--fluid-hero) * var(--font-scale, 1) * 0.55);
  font-weight: var(--font-semibold);
  margin: 0;
}

.zone-hint {
  font-size: calc(var(--fluid-caption) * var(--font-scale, 1));
  margin: 0.6em 0 0 0;
  opacity: 0.75;
}

/* Bottom strip: cover left + meta/progress right */
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
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
}

.cover-art {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  /* No filters — sharp art for Pi */
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
  color: rgba(255, 255, 255, 0.92);
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
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
}

.np-sep {
  opacity: 0.45;
  flex-shrink: 0;
}

.np-artist {
  color: rgba(255, 255, 255, 0.78);
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-line {
  height: clamp(4px, 0.4cqi, 8px);
  background: rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: rgba(255, 255, 255, 0.92);
  /* No transition — avoids continuous compositor work on Pi */
  width: 0%;
}

.np-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  font-size: calc(var(--fluid-caption) * var(--font-scale, 1));
  color: rgba(255, 255, 255, 0.72);
}

.zone-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 55%;
}

.time-info {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

/* Narrow / portrait: keep cover visible, slightly larger strip */
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
