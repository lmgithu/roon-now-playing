/**
 * Premium “colored black” UI palette (mental-model.html + demo-player.html).
 *
 * Rules:
 *   Background  — DarkMuted-like: same hue, sat 15–30%, L 8–14%  (“colored black”)
 *   Status      — same hue/sat, L = bg.L + 4
 *   Card        — same hue/sat, L = bg.L + 6
 *   Accent      — Vibrant: sat ≤ 55%, L ≈ 55%  (progress fill / active chrome only)
 *
 * Large surfaces never use full saturation. Album art stays the colorful star.
 */
import { hslToString, type HSL } from './colorUtils';

export interface PremiumUiPalette {
  /** Near-black with album hue tint */
  bg: string;
  /** Status / slightly lifted surface (+4% L) */
  status: string;
  /** Card surface (+6% L) */
  card: string;
  /** Vibrant accent for progress fill / active indicators */
  accent: string;
  /** Soft vertical field gradient (CSS) */
  backgroundImage: string;
  ready: boolean;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function hsl(h: number, s: number, l: number): string {
  return hslToString(
    ((h % 360) + 360) % 360,
    clamp(s, 0, 100),
    clamp(l, 0, 100)
  );
}

/** Neutral graphite when art has no usable chroma */
export function neutralPremiumPalette(): PremiumUiPalette {
  const bg = '#161617';
  return {
    bg,
    status: '#212122',
    card: '#2b2b2c',
    accent: '#a8a8b0',
    backgroundImage: verticalFieldGradient(bg),
    ready: false,
  };
}

/**
 * Subtle top→bottom field like demo-player .screen:
 *   lighter top mix → solid bg → slightly darker bottom
 */
export function verticalFieldGradient(bg: string): string {
  // color-mix works in modern Chromium (TV/Pi Chromium, desktop)
  return `linear-gradient(
    to bottom,
    color-mix(in srgb, ${bg} 93%, white 7%) 0%,
    ${bg} 38%,
    color-mix(in srgb, ${bg} 88%, black 12%) 100%
  )`;
}

/**
 * Build refined UI colors from extracted album hues.
 *
 * @param darkMuted  Dark / muted sample (dominant or dark-weighted) — drives surfaces
 * @param vibrant    More saturated mid-tone for accent (optional; falls back to darkMuted)
 */
export function buildPremiumUiPalette(
  darkMuted: HSL | null | undefined,
  vibrant?: HSL | null
): PremiumUiPalette {
  if (!darkMuted) {
    return neutralPremiumPalette();
  }

  const h = ((darkMuted.h % 360) + 360) % 360;
  const sourceS = darkMuted.s;

  // Near-monochrome art → graphite (demo “horse” case)
  if (sourceS < 10) {
    return {
      ...neutralPremiumPalette(),
      ready: true,
      // Soft warm/cool neutral accent from source lightness
      accent: hsl(h, 8, 62),
    };
  }

  // Background: colored black — sat 15–30%, L 8–14
  // chroma × 0.45 from source, then clamped into the allowed band
  const bgS = clamp(sourceS * 0.45, 15, 30);
  const bgL = clamp(darkMuted.l < 20 ? 11 : Math.min(14, Math.max(8, darkMuted.l * 0.35)), 8, 14);

  const statusL = clamp(bgL + 4, 12, 20);
  const cardL = clamp(bgL + 6, 14, 24);

  const bg = hsl(h, bgS, bgL);
  const status = hsl(h, bgS, statusL);
  const card = hsl(h, bgS, cardL);

  // Accent: prefer vibrant mid color; cap sat 55%, L ≈ 55
  const v = vibrant && vibrant.s >= 12 ? vibrant : darkMuted;
  const accentH = ((v.h % 360) + 360) % 360;
  const accentS = clamp(Math.min(v.s, 55), 28, 55);
  const accentL = clamp(v.l > 20 && v.l < 80 ? v.l : 55, 48, 60);
  const accent = hsl(accentH, accentS, accentL);

  return {
    bg,
    status,
    card,
    accent,
    backgroundImage: verticalFieldGradient(bg),
    ready: true,
  };
}
