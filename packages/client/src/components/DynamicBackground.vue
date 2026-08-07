<script setup lang="ts">
/**
 * Full-bleed background layers.
 *
 * blur-grain: heavily blurred album art + film grain + dark scrim.
 * Radial / black fields are applied by the parent via useBackgroundStyle.
 */
import { computed, ref, watch } from 'vue';
import type { BackgroundType } from '@roon-screen-cover/shared';
import type { ExtractedPalette, VibrantGradient } from '../composables/useColorExtraction';
import noiseUrl from '../assets/noise.svg';

const props = defineProps<{
  type: BackgroundType;
  artworkUrl: string | null;
  palette: ExtractedPalette;
  vibrantGradient: VibrantGradient;
}>();

const currentArtwork = ref<string | null>(null);
const previousArtwork = ref<string | null>(null);
const isTransitioning = ref(false);

/**
 * Only true for very pale covers (e.g. light monochrome art).
 * Threshold is high so normal / colorful / dark albums are untouched.
 */
const isPaleArt = ref(false);
let lumaGeneration = 0;

/** Average relative luminance 0–1 from a tiny canvas sample. */
function sampleIsPale(url: string | null): void {
  const gen = ++lumaGeneration;
  if (!url) {
    isPaleArt.value = false;
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.onload = () => {
    if (gen !== lumaGeneration) return;
    try {
      const size = 24;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        isPaleArt.value = false;
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 3] ?? 0) < 128) continue;
        const r = data[i]! / 255;
        const g = data[i + 1]! / 255;
        const b = data[i + 2]! / 255;
        sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        n++;
      }
      const luma = n > 0 ? sum / n : 0;
      // Only kick in for clearly bright covers (Great Escape–class white/grey)
      isPaleArt.value = luma >= 0.58;
    } catch {
      isPaleArt.value = false;
    }
  };
  img.onerror = () => {
    if (gen === lumaGeneration) isPaleArt.value = false;
  };
  img.src = url;
}

watch(
  () => props.artworkUrl,
  (newUrl, oldUrl) => {
    if (newUrl !== oldUrl) {
      previousArtwork.value = currentArtwork.value;
      currentArtwork.value = newUrl;
      isTransitioning.value = true;
      setTimeout(() => {
        isTransitioning.value = false;
        previousArtwork.value = null;
      }, 500);
    }
    sampleIsPale(newUrl);
  },
  { immediate: true }
);

/** Blurred cover as ambient field (Plexamp / Apple Music) */
const needsArtworkBlur = computed(() => props.type === 'blur-grain');

const needsNoise = computed(() => props.type === 'blur-grain');

const needsScrim = computed(() => needsArtworkBlur.value);

const needsGradientLayer = computed(() => false);

const backgroundStyle = computed(() => ({}));

/**
 * Grainy Blur: very heavy blur + scale/rotate so the cover is unrecognizable.
 * Pale art only: slight brightness reduce.
 */
const imageFilter = computed(() => {
  if (props.type !== 'blur-grain') return 'none';
  // Aggressive soft wash (was 77px) — abstract color field, not a soft photo
  let base = 'blur(110px) saturate(1.12)';
  if (isPaleArt.value) {
    return `${base} brightness(0.72)`;
  }
  return base;
});
</script>

<template>
  <div class="dynamic-background">
    <!-- Solid / corner gradient layer -->
    <div
      v-if="needsGradientLayer"
      class="gradient-layer"
      :style="backgroundStyle"
    />

    <!-- Fallback black when blur ambient but no art yet -->
    <div
      v-if="needsArtworkBlur && !currentArtwork"
      class="fallback-black"
    />

    <!-- Blurred artwork ambient (Grainy Blur) -->
    <template v-if="needsArtworkBlur && currentArtwork">
      <img
        v-if="previousArtwork && isTransitioning"
        :src="previousArtwork"
        class="artwork-bg fade-out"
        :style="{ filter: imageFilter }"
        alt=""
        decoding="async"
      />
      <img
        :src="currentArtwork"
        class="artwork-bg"
        :class="{ 'fade-in': isTransitioning }"
        :style="{ filter: imageFilter }"
        alt=""
        decoding="async"
      />
    </template>

    <!-- Dark scrim; --pale only when cover is very bright (extra veil, default unchanged) -->
    <div
      v-if="needsScrim"
      class="ambient-scrim"
      :class="{ 'ambient-scrim--pale': isPaleArt }"
      aria-hidden="true"
    />

    <!-- Grain (blur-grain only) -->
    <div
      v-if="needsNoise"
      class="noise-overlay"
      :style="{ backgroundImage: `url(${noiseUrl})` }"
    />

    <div class="content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.dynamic-background {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}

.gradient-layer {
  position: absolute;
  inset: 0;
  transition: background 0.5s ease;
}

.fallback-black {
  position: absolute;
  inset: 0;
  background: #050505;
}

/*
 * Deep zoom + slight rotation so edges/structure of the cover vanish.
 * Large inset compensates for rotate without showing empty corners.
 */
.artwork-bg {
  position: absolute;
  inset: -42%;
  width: 184%;
  height: 184%;
  object-fit: cover;
  object-position: center;
  transform: rotate(-11deg) scale(1.08) translateZ(0);
  will-change: opacity, transform;
}

.artwork-bg.fade-in {
  animation: fadeIn 0.5s ease forwards;
}

.artwork-bg.fade-out {
  animation: fadeOut 0.5s ease forwards;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes fadeOut {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

/* Apple/Plexamp-style darkening so facts stay readable — same as 2.0.39 */
.ambient-scrim {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 90% 80% at 50% 42%, rgba(0, 0, 0, 0.25) 0%, rgba(0, 0, 0, 0.55) 55%, rgba(0, 0, 0, 0.78) 100%),
    linear-gradient(180deg, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.15) 40%, rgba(0, 0, 0, 0.55) 100%);
  z-index: 1;
}

/* Extra veil only when art is pale (isPaleArt). Stacked on top of default scrim. */
.ambient-scrim--pale {
  background:
    radial-gradient(ellipse 95% 85% at 50% 40%, rgba(0, 0, 0, 0.42) 0%, rgba(0, 0, 0, 0.62) 50%, rgba(0, 0, 0, 0.82) 100%),
    linear-gradient(180deg, rgba(0, 0, 0, 0.45) 0%, rgba(0, 0, 0, 0.32) 40%, rgba(0, 0, 0, 0.6) 100%);
}

.noise-overlay {
  position: absolute;
  inset: 0;
  background-repeat: repeat;
  background-size: 200px 200px;
  opacity: 0.07;
  pointer-events: none;
  z-index: 1;
}

.content {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
}
</style>
