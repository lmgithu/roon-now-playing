<script setup lang="ts">
/**
 * Full-bleed background layers.
 *
 * blur-grain — exact approach from frigopedro/Apple-Music-Background:
 *   1. Full-size grid of dominant album colors (no zoom / scale / filter on grid)
 *   2. Full-size glass layer: rgba(0,0,0,0.3) + backdrop-filter blur(90px)
 *   3. Content (slot) sits in the glass layer — same place the demo puts the album
 *
 * No extra vignette, noise, mesh-base, cover zoom, or filter-blur on the grid.
 * Radial / black fields are still applied by the parent via useBackgroundStyle.
 */
import { computed, ref, watch } from 'vue';
import type { BackgroundType } from '@roon-screen-cover/shared';
import type { ExtractedPalette, VibrantGradient } from '../composables/useColorExtraction';

const props = defineProps<{
  type: BackgroundType;
  artworkUrl: string | null;
  palette: ExtractedPalette;
  vibrantGradient: VibrantGradient;
}>();

/** Same as Apple-Music-Background: SIZE = 6 */
const SIZE = 6;
const CELL_COUNT = SIZE * SIZE;

const isAppleBg = computed(() => props.type === 'blur-grain');

/**
 * Dominant colors as CSS color strings (like use-image-color → colors[]).
 * Sampled from the cover; raw values, no boost / invent.
 */
const dominantColors = ref<string[]>([]);
let sampleGen = 0;

function rgbCss(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * Downscale cover and pick ~5 dominant colors by RGB bucket population
 * (same role as use-image-color with { colors: 5 } in the demo).
 */
function extractDominantColors(url: string): void {
  const gen = ++sampleGen;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.onload = () => {
    if (gen !== sampleGen) return;
    try {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        dominantColors.value = [];
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);

      // 4-bit per channel buckets (similar spirit to quantize space)
      const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 3] ?? 0) < 128) continue;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const cur = buckets.get(key);
        if (cur) {
          cur.r += r;
          cur.g += g;
          cur.b += b;
          cur.n += 1;
        } else {
          buckets.set(key, { r, g, b, n: 1 });
        }
      }

      const top = [...buckets.values()]
        .sort((a, b) => b.n - a.n)
        .slice(0, 5)
        .map((c) => rgbCss(c.r / c.n, c.g / c.n, c.b / c.n));

      dominantColors.value = top.length > 0 ? top : ['#222222', '#444444', '#111111'];
    } catch {
      if (gen === sampleGen) dominantColors.value = [];
    }
  };
  img.onerror = () => {
    if (gen === sampleGen) dominantColors.value = [];
  };
  img.src = url;
}

watch(
  () => [props.type, props.artworkUrl] as const,
  ([type, url]) => {
    if (type !== 'blur-grain') {
      sampleGen++;
      dominantColors.value = [];
      return;
    }
    if (!url) {
      sampleGen++;
      // Fallback until art exists (demo waits for colors before render)
      dominantColors.value = props.palette.paletteCSS.length
        ? [...props.palette.paletteCSS]
        : ['#1a1a1a', '#333333', '#0d0d0d'];
      return;
    }
    extractDominantColors(url);
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
 * 6×6 grid, each cell a random pick from dominant colors.
 * Demo used Math.random every render; we seed by artwork so Vue re-renders
 * do not reshuffle (same visual idea, stable for our app).
 */
const gridColors = computed(() => {
  if (!isAppleBg.value) return [] as string[];
  const colors = dominantColors.value;
  if (colors.length === 0) return [] as string[];

  const rand = mulberry32(seedFrom(props.artworkUrl || colors.join(',')));
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
        Apple-Music-Background structure:
          .blur  (glass, z-index high) — content lives here
          .container (color grid, behind)
      -->
      <div class="blur">
        <div class="content">
          <slot />
        </div>
      </div>
      <div class="container" aria-hidden="true">
        <div
          v-for="(color, i) in gridColors"
          :key="i"
          class="pixel"
          :style="{ background: color }"
        />
      </div>
    </template>

    <!-- Non-mesh backgrounds: just host the layout slot -->
    <div v-else class="content content--plain">
      <slot />
    </div>
  </div>
</template>

<style scoped>
/*
 * Styles aligned with frigopedro/Apple-Music-Background
 * src/Components/Background/styles.css — full size, no zoom/scale.
 */
.dynamic-background {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #000;
}

/* Color grid — 100% of host (not 180%, no transform scale) */
.container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background-color: black;
  display: grid;
  /* Demo CSS used 5 auto columns with a 6×6 fill; use 6 equal columns */
  grid-template-columns: repeat(6, 1fr);
  grid-template-rows: repeat(6, 1fr);
  z-index: 0;
}

.pixel {
  min-width: 0;
  min-height: 0;
  position: relative;
  z-index: 0;
}

/* Glass — exact recipe from the demo */
.blur {
  position: absolute;
  inset: 0;
  z-index: 10;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.3);
  box-shadow: 0 8px 32px 0 rgba(6, 7, 22, 0.37);
  backdrop-filter: blur(90px);
  -webkit-backdrop-filter: blur(90.5px);
  display: flex;
  align-items: stretch;
  justify-content: stretch;
}

.content {
  position: relative;
  z-index: 11;
  width: 100%;
  height: 100%;
}

.content--plain {
  position: relative;
  width: 100%;
  height: 100%;
}
</style>
