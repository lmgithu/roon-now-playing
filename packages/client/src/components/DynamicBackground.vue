<script setup lang="ts">
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

// Track artwork changes for crossfade transitions
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

      // Clear transition state after animation duration (500ms)
      setTimeout(() => {
        isTransitioning.value = false;
        previousArtwork.value = null;
      }, 500);
    }
  },
  { immediate: true }
);

// Background types that require artwork image
const needsArtwork = computed(() => {
  return props.type === 'blur-grain';
});

// Background types that require noise overlay
const needsNoise = computed(() => {
  return props.type === 'blur-grain';
});

// Background style for gradient types
const backgroundStyle = computed(() => {
  const { center, edge } = props.vibrantGradient;

  switch (props.type) {
    case 'gradient-radial-corner': {
      return {
        background: `radial-gradient(ellipse at 0% 0%, ${center} 0%, ${edge} 100%)`,
      };
    }

    default:
      return {};
  }
});

// Image filter for artwork-based backgrounds
const imageFilter = computed(() => {
  switch (props.type) {
    case 'blur-grain':
      return 'blur(60px)';
    default:
      return 'none';
  }
});
</script>

<template>
  <div class="dynamic-background">
    <!-- Gradient layer (for gradient-based backgrounds) -->
    <div
      v-if="!needsArtwork"
      class="gradient-layer"
      :style="backgroundStyle"
    />

    <!-- Artwork background layers (for artwork-based backgrounds) -->
    <template v-if="needsArtwork">
      <!-- Previous artwork (fading out) -->
      <img
        v-if="previousArtwork && isTransitioning"
        :src="previousArtwork"
        class="artwork-bg fade-out"
        :style="{ filter: imageFilter }"
        alt=""
      />
      <!-- Current artwork (fading in) -->
      <img
        v-if="currentArtwork"
        :src="currentArtwork"
        class="artwork-bg"
        :class="{ 'fade-in': isTransitioning }"
        :style="{ filter: imageFilter }"
        alt=""
      />
    </template>

    <!-- Noise overlay -->
    <div
      v-if="needsNoise"
      class="noise-overlay"
      :style="{ backgroundImage: `url(${noiseUrl})` }"
    />

    <!-- Content slot -->
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
}

.gradient-layer {
  position: absolute;
  inset: 0;
  transition: background 0.5s ease;
}

.artwork-bg {
  position: absolute;
  inset: -10%;
  width: 120%;
  height: 120%;
  object-fit: cover;
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

.duotone-overlay {
  position: absolute;
  inset: 0;
  mix-blend-mode: color;
  opacity: 0.85;
}

.noise-overlay {
  position: absolute;
  inset: 0;
  background-repeat: repeat;
  background-size: 200px 200px;
  opacity: 0.08;
  pointer-events: none;
}

.content {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
}
</style>
