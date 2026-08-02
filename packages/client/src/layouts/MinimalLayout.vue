<script setup lang="ts">
import { computed } from 'vue';
import type { Track, PlaybackState, BackgroundType } from '@roon-screen-cover/shared';
import DynamicBackground from '../components/DynamicBackground.vue';
import { useColorExtraction } from '../composables/useColorExtraction';
import { useAlbumTheme } from '../composables/useAlbumTheme';

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

const { cssVars: albumChrome } = useAlbumTheme({
  artworkUrl: () => props.artworkUrl,
  track: () => props.track,
  progress: () => props.progress,
  includeBackground: false,
});


const artworkUrlRef = computed(() => props.artworkUrl);
const { palette, vibrantGradient } = useColorExtraction(artworkUrlRef);

// Background types handled by DynamicBackground component
const dynamicBackgroundTypes: BackgroundType[] = [
  'gradient-linear-multi',
  'gradient-radial-corner',
  'gradient-mesh',
  'blur-subtle',
  'blur-heavy',
  'duotone',
  'posterized',
  'gradient-noise',
  'blur-grain',
];

const usesDynamicBackground = computed(() =>
  dynamicBackgroundTypes.includes(props.background)
);
</script>

<template>
  <!-- Dynamic background types use DynamicBackground component -->
  <DynamicBackground
    v-if="usesDynamicBackground"
    :type="background"
    :artwork-url="artworkUrl"
    :palette="palette"
    :vibrant-gradient="vibrantGradient"
    class="minimal-layout" :style="albumChrome"
  >
    <div class="overlay">
      <div v-if="track" class="track-info">
        <h1 class="title">{{ track.title }}</h1>
        <p class="artist">{{ track.artist }}</p>
      </div>
      <div v-else class="no-playback">
        <p>No playback</p>
      </div>

      <div class="progress-line" :class="{ 'is-paused': !isPlaying }">
          <div class="progress-fill" />
        </div>
    </div>
  </DynamicBackground>

  <!-- Original layout uses artwork as background with gradient overlay -->
  <div v-else class="minimal-layout" :style="albumChrome">
    <div class="artwork-background">
      <img
        v-if="artworkUrl"
        :src="artworkUrl"
        :alt="track?.album || 'Album artwork'"
        class="artwork"
      />
      <div v-else class="artwork-placeholder">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
        </svg>
      </div>
    </div>

    <div class="overlay">
      <div v-if="track" class="track-info">
        <h1 class="title">{{ track.title }}</h1>
        <p class="artist">{{ track.artist }}</p>
      </div>
      <div v-else class="no-playback">
        <p>No playback</p>
      </div>

      <div class="progress-line" :class="{ 'is-paused': !isPlaying }">
          <div class="progress-fill" />
        </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * ============================================
 * TYPOGRAPHY
 * Uses token-based container queries for responsive scaling.
 * See: packages/client/src/styles/tokens.css
 * ============================================
 */
.minimal-layout {
  container-type: inline-size;
  container-name: layout;

  /* Base styles */
  width: 100%;
  height: 100%;
  position: relative;
  background: #000;
  color: #fff;
}

.artwork-background {
  position: absolute;
  inset: 0;
}

.artwork {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.artwork-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
  color: #333;
}

.artwork-placeholder svg {
  width: 30%;
  height: 30%;
  max-width: 200px;
  max-height: 200px;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.8) 0%,
    rgba(0, 0, 0, 0.4) 30%,
    transparent 60%
  );
  padding: 2rem;
}

.track-info {
  margin-bottom: 1rem;
}

.title {
  font-size: calc(var(--text-xl) * var(--font-scale, 1));
  font-weight: var(--font-semibold);
  line-height: var(--leading-tight);
  margin-bottom: 0.25rem;
  color: var(--rpi-title, #f5f5f5);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artist {
  font-size: calc(var(--text-lg) * var(--font-scale, 1));
  font-weight: var(--font-normal);
  line-height: var(--leading-snug);
  color: var(--rpi-artist, rgba(245, 245, 245, 0.82));
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.no-playback {
  margin-bottom: 1rem;
}

.no-playback p {
  font-size: calc(var(--text-xl) * var(--font-scale, 1));
  font-weight: var(--font-normal);
  line-height: var(--leading-snug);
  color: rgba(255, 255, 255, 0.6);
}

.progress-line {
  height: 3px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: rgba(255, 255, 255, 0.9);
  transition: width 0.1s linear;
}

/* Container Query Typography Scaling */
@container layout (min-width: 500px) {
  .title {
    font-size: calc(var(--text-2xl) * var(--font-scale, 1));
  }

  .artist {
    font-size: calc(var(--text-xl) * var(--font-scale, 1));
  }

  .no-playback p {
    font-size: calc(var(--text-2xl) * var(--font-scale, 1));
  }
}

@container layout (min-width: 700px) {
  .title {
    font-size: calc(var(--text-3xl) * var(--font-scale, 1));
  }

  .artist {
    font-size: calc(var(--text-2xl) * var(--font-scale, 1));
  }

  .no-playback p {
    font-size: calc(var(--text-3xl) * var(--font-scale, 1));
  }
}

@container layout (min-width: 1000px) {
  .title {
    font-size: calc(var(--text-4xl) * var(--font-scale, 1));
  }

  .artist {
    font-size: calc(var(--text-3xl) * var(--font-scale, 1));
  }

  .no-playback p {
    font-size: calc(var(--text-4xl) * var(--font-scale, 1));
  }
}

/* Album-themed progress (scaleX + sheen + paused breath) */
.progress-line {
  background: var(--rpi-progress-track, rgba(245, 245, 245, 0.16)) !important;
  border-radius: 999px;
  overflow: hidden;
  contain: layout style;
  box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.25);
}
.progress-fill {
  width: 100% !important;
  background-color: var(--rpi-progress-fill, #f2f2f2) !important;
  background-image: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.1) 0%,
    rgba(255, 255, 255, 0) 45%,
    rgba(255, 255, 255, 0.03) 75%,
    rgba(255, 255, 255, 0.05) 100%
  );
  transform-origin: left center;
  transform: scaleX(var(--rpi-progress, 0));
  transition: transform 0.12s linear !important;
  will-change: transform;
  backface-visibility: hidden;
  border-radius: inherit;
  box-shadow: 0 0 6px color-mix(in srgb, var(--rpi-progress-fill, #f2f2f2) 12%, transparent);
}
.progress-line.is-paused .progress-fill {
  animation: album-progress-breath 3.6s ease-in-out infinite;
}
@keyframes album-progress-breath {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.62; }
}
@media (prefers-reduced-motion: reduce) {
  .progress-line.is-paused .progress-fill {
    animation: none;
    opacity: 0.85;
  }
}

</style>
