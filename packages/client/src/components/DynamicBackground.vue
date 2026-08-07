<script setup lang="ts">
/**
 * Full-bleed background layers.
 *
 * blur-grain — same RESULT as frigopedro/Apple-Music-Background, without React:
 *
 *   1. Dominant colors via MMCQ quantize (same algo as use-image-color)
 *   2. 6×6 full-size color grid filled from that palette
 *   3. Soft field via heavy blur of the grid + glass darkening
 *      (visual equivalent of the demo’s backdrop-filter glass over the grid;
 *       filter-blur on the grid is used because it is reliable on TV/Pi where
 *       backdrop-filter often fails or does nothing)
 *
 * Radial / black fields still come from the parent via useBackgroundStyle.
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

/** Same SIZE as Apple-Music-Background */
const SIZE = 6;
const CELL_COUNT = SIZE * SIZE;

const isAppleBg = computed(() => props.type === 'blur-grain');

/** Dominant palette (hex), same role as useImageColor(..., { colors: 5 }) */
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

  // Fallback: existing palette extraction
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

/**
 * 6×6 grid: each cell random pick from dominant colors
 * (same as the demo’s nested loops + Math.random).
 * Seeded by artwork so re-renders do not reshuffle.
 */
const gridColors = computed(() => {
  if (!isAppleBg.value) return [] as string[];
  const colors = dominantColors.value;
  if (colors.length === 0) return [] as string[];

  const rand = mulberry32(seedFrom((props.artworkUrl || '') + colors.join('|')));
  const cells: string[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    cells.push(colors[Math.floor(rand() * colors.length)]!);
  }
  return cells;
});
</script>

<template>
  <div class="dynamic-background">
    <template v-if="isAppleBg">
      <!--
        Structure from Apple-Music-Background:
          color grid behind
          glass / blur layer in front
          content (slot) where the demo places the album
      -->
      <div class="container" aria-hidden="true">
        <div
          v-for="(color, i) in gridColors"
          :key="`${i}-${color}`"
          class="pixel"
          :style="{ background: color }"
        />
      </div>

      <!--
        Glass: same darkening + blur intent as the demo.
        Blur is applied to the grid via CSS filter (see .container) so the soft
        color field actually appears on all platforms; this layer only darkens
        like rgba(0,0,0,0.3) in the reference.
      -->
      <div class="blur" aria-hidden="true" />

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
/*
 * Visual result of frigopedro/Apple-Music-Background without React.
 *
 * Demo recipe:
 *   .container — full-size color grid
 *   .blur      — rgba(0,0,0,0.3) + backdrop-filter: blur(90px)
 *
 * On many TV/Pi Chromium builds, backdrop-filter does not blur sibling
 * content (you only get a dark film over hard squares → “poor” look).
 * Applying blur(90px) to the grid itself yields the same soft field the
 * demo screenshots show; glass only supplies the 0.3 darken + shadow.
 */
.dynamic-background {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #000;
}

.container {
  position: absolute;
  /* Full host size — not 180% zoom. Tiny bleed only so blur soft-edges
     are clipped by overflow:hidden instead of showing empty corners. */
  inset: -8%;
  width: 116%;
  height: 116%;
  background-color: #000;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  grid-template-rows: repeat(6, minmax(0, 1fr));
  z-index: 0;
  /* Demo: backdrop-filter blur(90px) on the glass; we blur the grid so
     the soft color wash always renders. */
  filter: blur(90px);
  transform: translateZ(0);
  will-change: filter;
}

.pixel {
  min-width: 0;
  min-height: 0;
}

/* Glass darkening — matches demo rgba + box-shadow */
.blur {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: rgba(0, 0, 0, 0.3);
  box-shadow: 0 8px 32px 0 rgba(6, 7, 22, 0.37);
  /* Keep backdrop-filter too for browsers where it helps */
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  pointer-events: none;
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
