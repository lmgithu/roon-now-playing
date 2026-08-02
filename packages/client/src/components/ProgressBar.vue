<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    progress: number;
    currentTime: string;
    duration: string;
    showTime?: boolean;
    /** When false, progress fill uses a gentle breath pulse (RPi status-bar style) */
    isPlaying?: boolean;
  }>(),
  {
    showTime: false,
    isPlaying: true,
  }
);

const progressScale = computed(() => {
  const p = Number.isFinite(props.progress) ? props.progress : 0;
  return Math.min(100, Math.max(0, p)) / 100;
});
</script>

<template>
  <div class="progress-bar-container">
    <div v-if="showTime" class="time-display">
      <span class="current">{{ currentTime }}</span>
      <span class="duration">{{ duration }}</span>
    </div>
    <div class="progress-bar" :class="{ 'is-paused': !isPlaying }">
      <div
        class="progress-fill"
        :style="{ '--progress-scale': String(progressScale) }"
      />
    </div>
  </div>
</template>

<style scoped>
.progress-bar-container {
  width: 100%;
}

.time-display {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  font-size: var(--progress-time-size, 0.875rem);
  color: var(--text-tertiary, var(--rpi-meta, rgba(255, 255, 255, 0.7)));
  font-variant-numeric: tabular-nums;
}

.progress-bar {
  height: var(--progress-bar-height, 4px);
  background: var(--progress-bar-bg, var(--rpi-progress-track, rgba(255, 255, 255, 0.2)));
  border-radius: 999px;
  overflow: hidden;
  contain: layout style;
  box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.25);
}

.progress-fill {
  height: 100%;
  width: 100%;
  background-color: var(--progress-bar-fill, var(--rpi-progress-fill, rgba(255, 255, 255, 0.9)));
  /* Soft sheen: darker at origin → subtle lift at the leading edge */
  background-image: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.1) 0%,
    rgba(255, 255, 255, 0) 45%,
    rgba(255, 255, 255, 0.03) 75%,
    rgba(255, 255, 255, 0.05) 100%
  );
  transform-origin: left center;
  transform: scaleX(var(--progress-scale, 0));
  transition: transform 0.12s linear;
  will-change: transform;
  backface-visibility: hidden;
  border-radius: inherit;
  box-shadow: 0 0 6px color-mix(
    in srgb,
    var(--progress-bar-fill, var(--rpi-progress-fill, #f2f2f2)) 12%,
    transparent
  );
}

/* Paused “breath”: gentle opacity pulse so the strip still feels alive */
.progress-bar.is-paused .progress-fill {
  animation: progress-breath 3.6s ease-in-out infinite;
  will-change: transform, opacity;
}

@keyframes progress-breath {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.62;
  }
}

@media (prefers-reduced-motion: reduce) {
  .progress-bar.is-paused .progress-fill {
    animation: none;
    opacity: 0.85;
  }
}
</style>
