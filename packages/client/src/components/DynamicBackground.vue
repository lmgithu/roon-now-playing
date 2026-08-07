<script setup lang="ts">
/**
 * Full-bleed background layers.
 *
 * blur-grain (Apple Music style): grid of dominant album colors under a heavy
 * glass blur + dark scrim so light text stays highly readable.
 * Radial / black fields are applied by the parent via useBackgroundStyle.
 *
 * Approach adapted from frigopedro/Apple-Music-Background:
 * color mesh → heavy blur (glass) → dark veil for contrast.
 */
import { computed } from 'vue';
import type { BackgroundType } from '@roon-screen-cover/shared';
import type { ExtractedPalette, VibrantGradient } from '../composables/useColorExtraction';
import noiseUrl from '../assets/noise.svg';

const props = defineProps<{
  type: BackgroundType;
  artworkUrl: string | null;
  palette: ExtractedPalette;
  vibrantGradient: VibrantGradient;
}>();

/** Mesh resolution — 6×6 matches the reference implementation */
const GRID = 6;
const CELL_COUNT = GRID * GRID;

const isMesh = computed(() => props.type === 'blur-grain');
const needsNoise = computed(() => props.type === 'blur-grain');
const needsScrim = computed(() => props.type === 'blur-grain');

/**
 * FNV-1a style seed from a string (palette + artwork) so the mesh is stable
 * for a given album and does not reshuffle on every Vue re-render.
 */
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

/** Build a rich set of mesh colors from extracted palette + vibrant ends. */
function buildColorPool(
  paletteCSS: string[],
  vibrant: VibrantGradient
): string[] {
  const pool: string[] = [];

  for (const c of paletteCSS) {
    if (c && !pool.includes(c)) pool.push(c);
  }

  if (vibrant.ready) {
    if (vibrant.center && !pool.includes(vibrant.center)) pool.push(vibrant.center);
    if (vibrant.edge && !pool.includes(vibrant.edge)) pool.push(vibrant.edge);
  }

  // Dark / mid fallbacks so monochrome art still gets depth
  if (pool.length === 0) {
    pool.push('hsl(220, 35%, 28%)', 'hsl(220, 40%, 14%)', 'hsl(200, 30%, 22%)', '#0a0a0c');
  } else if (pool.length === 1) {
    // Single color: synthesize darker / lighter siblings via color-mix fallbacks
    pool.push('#0a0a0c', '#1a1a22', pool[0]!);
  }

  // Ensure enough variety by repeating with black mixed in via duplicates of darker ends
  while (pool.length < 4) {
    pool.push(pool[pool.length % Math.max(pool.length, 1)] || '#111');
  }

  return pool;
}

/**
 * Deterministic 6×6 color mesh for the current album.
 * Recomputed only when palette / artwork identity changes.
 */
const meshColors = computed(() => {
  if (!isMesh.value) return [] as string[];

  const pool = buildColorPool(props.palette.paletteCSS, props.vibrantGradient);
  const seedKey = [
    props.artworkUrl || '',
    ...pool,
    props.palette.dominant.h,
    props.palette.dominant.s,
    props.palette.dominant.l,
  ].join('|');
  const rand = mulberry32(seedFrom(seedKey));

  const cells: string[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    cells.push(pool[Math.floor(rand() * pool.length)]!);
  }
  return cells;
});
</script>

<template>
  <div class="dynamic-background">
    <!-- Apple Music–style color mesh (dominant colors in a grid) -->
    <div
      v-if="isMesh"
      class="color-mesh"
      aria-hidden="true"
    >
      <div
        v-for="(color, i) in meshColors"
        :key="i"
        class="mesh-pixel"
        :style="{ background: color }"
      />
    </div>

    <!-- Glass blur over the mesh (heavy backdrop + soft fill) -->
    <div
      v-if="isMesh"
      class="glass-blur"
      aria-hidden="true"
    />

    <!-- Fallback solid when no palette yet -->
    <div
      v-if="isMesh && meshColors.length === 0"
      class="fallback-black"
    />

    <!--
      Strong dark veil so light fact/title text is always very visible
      over colorful washes (Apple Music also darkens under UI).
    -->
    <div
      v-if="needsScrim"
      class="ambient-scrim"
      aria-hidden="true"
    />

    <!-- Subtle film grain -->
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

.fallback-black {
  position: absolute;
  inset: 0;
  background: #050505;
}

/*
 * Color grid oversized + CSS filter blur — more reliable on TV/Pi than
 * backdrop-filter alone, and matches the soft Apple Music field look.
 */
.color-mesh {
  position: absolute;
  /* Bleed past edges so blur doesn't show hard frame */
  inset: -35%;
  width: 170%;
  height: 170%;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  grid-template-rows: repeat(6, 1fr);
  filter: blur(72px) saturate(1.15);
  transform: scale(1.05);
  will-change: filter;
  z-index: 0;
}

.mesh-pixel {
  min-width: 0;
  min-height: 0;
}

/*
 * Glass layer: backdrop blur + translucent dark fill (reference: blur 90px).
 * Stacked on filter-blurred mesh for extra soft diffusion.
 */
.glass-blur {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(48px) saturate(1.1);
  -webkit-backdrop-filter: blur(48px) saturate(1.1);
  pointer-events: none;
}

/*
 * Dark scrim — bias field dark so pure white / near-white text pops.
 * Stronger center-to-edge veil than older blur-photo path.
 */
.ambient-scrim {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  background:
    radial-gradient(
      ellipse 95% 85% at 50% 40%,
      rgba(0, 0, 0, 0.38) 0%,
      rgba(0, 0, 0, 0.58) 50%,
      rgba(0, 0, 0, 0.78) 100%
    ),
    linear-gradient(
      180deg,
      rgba(0, 0, 0, 0.42) 0%,
      rgba(0, 0, 0, 0.28) 40%,
      rgba(0, 0, 0, 0.62) 100%
    );
}

.noise-overlay {
  position: absolute;
  inset: 0;
  background-repeat: repeat;
  background-size: 200px 200px;
  opacity: 0.06;
  pointer-events: none;
  z-index: 2;
}

.content {
  position: relative;
  z-index: 3;
  width: 100%;
  height: 100%;
}
</style>
