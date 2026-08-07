<script setup lang="ts">
/**
 * Full-bleed background layers.
 *
 * blur-grain — Apple Music–style ambient field without React:
 *   1. Dominant colors via MMCQ quantize (same algo as use-image-color)
 *   2. Large overlapping soft orbs (not a coarse 6×6 checker grid)
 *   3. Light glass darken for contrast under UI
 *
 * Why not a 6×6 grid alone? On 1080p/4K each cell is huge; blur(90px) cannot
 * fully melt them → visible “patches”. Overlapping orbs + heavy blur merge into
 * a continuous wash (what Apple Music looks like).
 */
import { computed, ref, watch } from 'vue';
import type { BackgroundType } from '@roon-screen-cover/shared';
import type { ExtractedPalette, VibrantGradient } from '../composables/useColorExtraction';
import { extractDominantColorsFromUrl } from '../composables/extractDominantColors';

const props = defineProps<{
  type: BackgroundType;
  artworkUrl: string | null;
  palette: ExtractedPalette;
  vibrantGradient: VibrantGradient;
}>();

const isAppleBg = computed(() => props.type === 'blur-grain');

const dominantColors = ref<string[]>([]);
let sampleGen = 0;

async function loadColors(url: string | null): Promise<void> {
  const gen = ++sampleGen;
  if (!url) {
    dominantColors.value =
      props.palette.paletteCSS.length > 0
        ? [...props.palette.paletteCSS]
        : ['#333333', '#1a1a1a', '#555555'];
    return;
  }

  const colors = await extractDominantColorsFromUrl(url, {
    colors: 5,
    windowSize: 50,
    format: 'hex',
  });
  if (gen !== sampleGen) return;

  if (colors.length > 0) {
    dominantColors.value = colors;
    return;
  }

  if (props.palette.paletteCSS.length > 0) {
    dominantColors.value = [...props.palette.paletteCSS];
  } else {
    dominantColors.value = ['#2a2a35', '#1a1a22', '#3a3a48'];
  }
}

watch(
  () => [props.type, props.artworkUrl] as const,
  ([type, url]) => {
    if (type !== 'blur-grain') {
      sampleGen++;
      dominantColors.value = [];
      return;
    }
    void loadColors(url);
  },
  { immediate: true }
);

function seedFrom(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SoftOrb {
  color: string;
  /** center X % */
  x: number;
  /** center Y % */
  y: number;
  /** diameter as % of the larger viewport side (very large → soft merge) */
  size: number;
}

/**
 * Build large, heavily overlapping orbs from the dominant palette.
 * Positions are deterministic per album so the field is stable.
 */
const orbs = computed((): SoftOrb[] => {
  if (!isAppleBg.value) return [];
  const colors = dominantColors.value;
  if (colors.length === 0) return [];

  const rand = mulberry32(seedFrom((props.artworkUrl || '') + colors.join('|')));
  const count = Math.max(6, colors.length * 2);
  const out: SoftOrb[] = [];

  for (let i = 0; i < count; i++) {
    const color = colors[i % colors.length]!;
    // Spread centers; keep them on-canvas so the wash fills the screen
    const x = 8 + rand() * 84;
    const y = 8 + rand() * 84;
    // Huge orbs (55–95% of host) so neighbors overlap heavily after blur
    const size = 55 + rand() * 40;
    out.push({ color, x, y, size });
  }

  return out;
});

/** Base fill from the first (usually most dominant) color */
const baseColor = computed(() => dominantColors.value[0] || '#0a0a0c');
</script>

<template>
  <div class="dynamic-background">
    <template v-if="isAppleBg">
      <div class="color-field" :style="{ backgroundColor: baseColor }" aria-hidden="true">
        <div
          v-for="(orb, i) in orbs"
          :key="i"
          class="orb"
          :style="{
            background: orb.color,
            left: `${orb.x}%`,
            top: `${orb.y}%`,
            width: `${orb.size}%`,
            height: `${orb.size}%`,
          }"
        />
      </div>

      <!-- Glass darken (demo uses rgba(0,0,0,0.3)) -->
      <div class="glass" aria-hidden="true" />

      <div class="content">
        <slot />
      </div>
    </template>

    <div v-else class="content content--plain">
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
  background-color: #000;
}

/*
 * Soft color field: large overlapping circles + one strong blur pass.
 * This melts into a continuous wash instead of a patchy grid.
 */
.color-field {
  position: absolute;
  /* modest bleed so blur edges are clipped, not a “cover zoom” */
  inset: -20%;
  width: 140%;
  height: 140%;
  z-index: 0;
  filter: blur(100px) saturate(1.15);
  transform: translateZ(0);
  will-change: filter;
}

.orb {
  position: absolute;
  border-radius: 50%;
  /* center the circle on (left, top) */
  transform: translate(-50%, -50%);
  opacity: 0.95;
  /* mix colors where orbs overlap */
  mix-blend-mode: plus-lighter;
}

/* Fallback blend for browsers without plus-lighter */
@supports not (mix-blend-mode: plus-lighter) {
  .orb {
    mix-blend-mode: screen;
    opacity: 0.85;
  }
}

.glass {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.3);
  box-shadow: 0 8px 32px 0 rgba(6, 7, 22, 0.37);
}

.content {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
}

.content--plain {
  position: relative;
  width: 100%;
  height: 100%;
}
</style>
