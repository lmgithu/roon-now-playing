<script setup lang="ts">
/**
 * Full-bleed background layers.
 *
 * blur-grain — Apple Music dynamic background (frigopedro/Apple-Music-Background):
 *   1. Grid of dominant album colors (large blocks)
 *   2. Single heavy glass blur over the grid
 *   3. Light veil only (so colors stay visible; text still readable)
 *
 * Radial / black fields come from the parent via useBackgroundStyle.
 */
import { computed, ref, watch } from 'vue';
import type { BackgroundType } from '@roon-screen-cover/shared';
import type { ExtractedPalette, VibrantGradient } from '../composables/useColorExtraction';
import { hslToString, rgbToHsl, type HSL } from '../composables/colorUtils';
import noiseUrl from '../assets/noise.svg';

const props = defineProps<{
  type: BackgroundType;
  artworkUrl: string | null;
  palette: ExtractedPalette;
  vibrantGradient: VibrantGradient;
}>();

/** Grid size — matches the Apple Music Background demo (6×6) */
const GRID = 6;
const CELL_COUNT = GRID * GRID;

const isMesh = computed(() => props.type === 'blur-grain');

/** Dominant colors sampled from the cover (rgb→boosted HSL), preferred source */
const sampledColors = ref<string[]>([]);
let sampleGen = 0;

/**
 * Push lightness into a vivid mid band and lift saturation so the glass
 * blur still shows rich color (raw cover samples are often too dark/muddy).
 */
function boostForMesh(h: number, s: number, l: number): string {
  // Skip near-black / near-white noise
  if (l < 6 || l > 96) {
    return hslToString(h, Math.max(s, 35), 42);
  }
  const sOut = Math.min(92, Math.max(48, s * 1.35 + 12));
  // Target ~42–58% L so blur stays colorful, not black or washed
  let lOut = l;
  if (lOut < 28) lOut = 28 + (lOut / 28) * 14; // lift darks into mid
  else if (lOut > 72) lOut = 58 + (100 - lOut) * 0.15; // pull lights down
  else lOut = 38 + (lOut - 28) * (20 / 44); // compress mid range toward ~48
  lOut = Math.min(60, Math.max(36, lOut));
  return hslToString(h, sOut, lOut);
}

function hslFromRgb(r: number, g: number, b: number): HSL {
  return rgbToHsl(r, g, b);
}

/**
 * Sample artwork like use-image-color: downscale, keep colorful pixels,
 * bucket by hue, pick top N by weight. Returns boosted CSS colors.
 */
function sampleArtworkColors(url: string): void {
  const gen = ++sampleGen;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.onload = () => {
    if (gen !== sampleGen) return;
    try {
      const size = 48;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        sampledColors.value = [];
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);

      // 12 hue buckets
      type Bin = { w: number; h: number; s: number; l: number; n: number };
      const bins: Bin[] = Array.from({ length: 12 }, () => ({
        w: 0,
        h: 0,
        s: 0,
        l: 0,
        n: 0,
      }));

      for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 3] ?? 0) < 128) continue;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const { h, s, l } = hslFromRgb(r, g, b);
        // Keep greys lightly so monochrome covers still paint something
        if (l < 4 || l > 97) continue;
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        // Prefer chromatic pixels but allow low-sat for B&W
        const satW = s < 8 ? 0.15 : (s / 100) ** 1.2;
        const midW = 1 - Math.abs(l - 50) / 55;
        const weight = satW * (0.35 + 0.65 * Math.max(0, midW)) * (chroma < 12 ? 0.25 : 1);
        if (weight <= 0) continue;
        const bi = Math.floor(h / 30) % 12;
        const bin = bins[bi]!;
        bin.w += weight;
        bin.h += h * weight;
        bin.s += s * weight;
        bin.l += l * weight;
        bin.n += 1;
      }

      const ranked = bins
        .filter((b) => b.w > 0 && b.n >= 2)
        .sort((a, b) => b.w - a.w)
        .slice(0, 6)
        .map((b) =>
          boostForMesh(b.h / b.w, b.s / b.w, b.l / b.w)
        );

      sampledColors.value = ranked;
    } catch {
      if (gen === sampleGen) sampledColors.value = [];
    }
  };
  img.onerror = () => {
    if (gen === sampleGen) sampledColors.value = [];
  };
  img.src = url;
}

watch(
  () => props.artworkUrl,
  (url) => {
    if (!isMesh.value) {
      sampledColors.value = [];
      return;
    }
    if (!url) {
      sampleGen++;
      sampledColors.value = [];
      return;
    }
    sampleArtworkColors(url);
  },
  { immediate: true }
);

watch(
  () => props.type,
  (t) => {
    if (t === 'blur-grain' && props.artworkUrl) {
      sampleArtworkColors(props.artworkUrl);
    }
  }
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
 * Build color pool: sampled cover colors first, then boosted palette /
 * vibrant gradient, then synthetic siblings so the grid never looks flat.
 */
function buildColorPool(): string[] {
  const pool: string[] = [];
  const add = (c: string | undefined | null) => {
    if (c && !pool.includes(c)) pool.push(c);
  };

  for (const c of sampledColors.value) add(c);

  for (const hsl of props.palette.palette) {
    add(boostForMesh(hsl.h, hsl.s, hsl.l));
  }

  if (props.vibrantGradient.ready) {
    // Parse isn't needed — re-boost from dominant
    const d = props.palette.dominant;
    add(boostForMesh(d.h, d.s, d.l));
    add(boostForMesh(d.h, Math.min(95, d.s + 20), Math.max(36, d.l - 8)));
    add(boostForMesh((d.h + 28) % 360, Math.min(90, d.s + 10), 48));
    add(boostForMesh((d.h + 180) % 360, Math.min(70, d.s * 0.7 + 20), 42));
  }

  if (pool.length === 0) {
    // Default vivid fallbacks (never pure black)
    pool.push(
      'hsl(280, 55%, 48%)',
      'hsl(200, 60%, 42%)',
      'hsl(340, 50%, 46%)',
      'hsl(30, 55%, 48%)'
    );
  }

  // Expand thin palettes with lightness / hue variants of existing colors
  if (pool.length < 4) {
    const base = [...pool];
    for (const c of base) {
      const m = c.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
      if (!m) continue;
      const h = Number(m[1]);
      const s = Number(m[2]);
      const l = Number(m[3]);
      add(hslToString(h, s, Math.min(60, l + 10)));
      add(hslToString(h, s, Math.max(36, l - 10)));
      add(hslToString((h + 40) % 360, Math.min(90, s + 5), l));
    }
  }

  return pool;
}

/**
 * Deterministic 6×6 mesh — same album ⇒ same pattern (no flicker on re-render).
 * Reference demo used Math.random every render; we keep it stable.
 */
const meshColors = computed(() => {
  if (!isMesh.value) return [] as string[];

  const pool = buildColorPool();
  const seedKey = [props.artworkUrl || '', ...pool, ...sampledColors.value].join('|');
  const rand = mulberry32(seedFrom(seedKey));

  // Bias: first ~40% of cells use top colors more often (bigger “blobs” feel)
  const cells: string[] = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    const r = rand();
    // Weighted pick — earlier pool entries slightly more likely
    let idx = Math.floor(r * r * pool.length); // square bias toward 0
    if (idx >= pool.length) idx = pool.length - 1;
    // Occasional pure random for variety
    if (rand() > 0.65) idx = Math.floor(rand() * pool.length);
    cells.push(pool[idx]!);
  }
  return cells;
});

/** Soft base under mesh so gaps never flash pure black */
const meshBaseStyle = computed(() => {
  const pool = buildColorPool();
  const a = pool[0] || 'hsl(220, 40%, 30%)';
  const b = pool[1] || pool[0] || 'hsl(260, 40%, 22%)';
  return {
    background: `radial-gradient(ellipse 120% 100% at 50% 40%, ${a} 0%, ${b} 70%, #0a0612 100%)`,
  };
});
</script>

<template>
  <div class="dynamic-background">
    <template v-if="isMesh">
      <!-- Soft base wash (always visible while mesh loads) -->
      <div class="mesh-base" :style="meshBaseStyle" aria-hidden="true" />

      <!--
        Color grid — same idea as Apple-Music-Background:
        random cells of dominant colors. Blur is applied ON the grid
        (filter), which is more reliable than backdrop-filter alone on TVs/Pi.
      -->
      <div class="color-grid" aria-hidden="true">
        <div
          v-for="(color, i) in meshColors"
          :key="i"
          class="pixel"
          :style="{ backgroundColor: color }"
        />
      </div>

      <!--
        Glass layer (reference: rgba(0,0,0,0.3) + backdrop blur ~90px).
        Kept light so color still reads through.
      -->
      <div class="glass" aria-hidden="true" />

      <!-- Edge vignette only — do NOT paint the whole field black -->
      <div class="vignette" aria-hidden="true" />

      <div
        class="noise-overlay"
        :style="{ backgroundImage: `url(${noiseUrl})` }"
        aria-hidden="true"
      />
    </template>

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
  background: #0a0612;
  isolation: isolate;
}

.mesh-base {
  position: absolute;
  inset: 0;
  z-index: 0;
  transition: background 0.6s ease;
}

/*
 * Oversized color grid so blur bleed doesn't reveal hard edges.
 * Large blur turns the 6×6 blocks into soft Apple Music blobs.
 */
.color-grid {
  position: absolute;
  /* bleed + scale so blur never shows empty corners */
  top: -40%;
  left: -40%;
  width: 180%;
  height: 180%;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  grid-template-rows: repeat(6, 1fr);
  gap: 0;
  /* Strong blur + saturation = vivid soft field */
  filter: blur(64px) saturate(1.35) brightness(1.05);
  transform: scale(1.12);
  transform-origin: center;
  z-index: 1;
  pointer-events: none;
  will-change: filter, transform;
}

.pixel {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

/*
 * Glass — mirrors the reference glassmorphism div.
 * Lighter fill than before so the mesh remains the star.
 */
.glass {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(40px) saturate(1.2);
  -webkit-backdrop-filter: blur(40px) saturate(1.2);
  box-shadow: inset 0 0 120px rgba(0, 0, 0, 0.15);
}

/*
 * Soft edge/bottom vignette for white text — center stays colorful.
 */
.vignette {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background:
    radial-gradient(
      ellipse 100% 90% at 50% 42%,
      rgba(0, 0, 0, 0.08) 0%,
      rgba(0, 0, 0, 0.22) 55%,
      rgba(0, 0, 0, 0.45) 100%
    ),
    linear-gradient(
      180deg,
      rgba(0, 0, 0, 0.18) 0%,
      transparent 35%,
      transparent 55%,
      rgba(0, 0, 0, 0.4) 100%
    );
}

.noise-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  background-repeat: repeat;
  background-size: 180px 180px;
  opacity: 0.05;
  pointer-events: none;
  mix-blend-mode: overlay;
}

.content {
  position: relative;
  z-index: 4;
  width: 100%;
  height: 100%;
}
</style>
