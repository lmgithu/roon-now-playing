<script setup lang="ts">
/**
 * Full-bleed background layers.
 *
 * gradient-simple / blur-grain: Apple/Plexamp path — blurred album art + dark scrim.
 * Other types: solid gradients / duotone handled by parent styles or gradient layer.
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
  },
  { immediate: true }
);

/** Blurred cover as ambient field (Plexamp / Apple Music) */
const needsArtworkBlur = computed(
  () => props.type === 'blur-grain' || props.type === 'gradient-simple'
);

const needsNoise = computed(() => props.type === 'blur-grain');

const needsScrim = computed(() => needsArtworkBlur.value);

const needsGradientLayer = computed(
  () => !needsArtworkBlur.value && props.type === 'gradient-radial-corner'
);

const backgroundStyle = computed(() => {
  const { center, edge } = props.vibrantGradient;
  if (props.type === 'gradient-radial-corner') {
    return {
      background: `radial-gradient(ellipse at 0% 0%, ${center} 0%, ${edge} 100%)`,
    };
  }
  return {};
});

/** Heavy blur + slight saturate so color reads at couch distance */
const imageFilter = computed(() => {
  if (props.type === 'blur-grain') {
    return 'blur(64px) saturate(1.08)';
  }
  if (props.type === 'gradient-simple') {
    // Slightly stronger blur = fewer “edge artifacts”; mild saturate like Apple wash
    return 'blur(72px) saturate(1.12)';
  }
  return 'none';
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

    <!-- Blurred artwork ambient (gradient-simple + blur-grain) -->
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

    <!-- Dark scrim for text readability over blur -->
    <div v-if="needsScrim" class="ambient-scrim" aria-hidden="true" />

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

/* Oversize + cover so blur doesn’t show hard edges */
.artwork-bg {
  position: absolute;
  inset: -18%;
  width: 136%;
  height: 136%;
  object-fit: cover;
  object-position: center;
  transform: translateZ(0);
  will-change: opacity;
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

/* Apple/Plexamp-style darkening so facts stay readable */
.ambient-scrim {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 90% 80% at 50% 42%, rgba(0, 0, 0, 0.25) 0%, rgba(0, 0, 0, 0.55) 55%, rgba(0, 0, 0, 0.78) 100%),
    linear-gradient(180deg, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.15) 40%, rgba(0, 0, 0, 0.55) 100%);
  z-index: 1;
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
