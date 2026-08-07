import { computed, type Ref, type ComputedRef } from 'vue';
import type { BackgroundType } from '@roon-screen-cover/shared';
import type { ExtractedColors, ExtractedPalette, HSL } from './colorUtils';
import { buildPremiumUiPalette, neutralPremiumPalette } from './premiumUiPalette';

export interface BackgroundStyleResult {
  style: ComputedRef<Record<string, string>>;
  needsColorExtraction: ComputedRef<boolean>;
}

/** No backgrounds use DynamicBackground (Black / Colors are pure CSS). */
export const DYNAMIC_BACKGROUND_TYPES: readonly BackgroundType[] = [] as const;

/** @deprecated */
export const RADIAL_HIGH_CONTRAST_CHROME: Record<string, string> = {};
export const GRADIENT_HIGH_CONTRAST_CHROME = RADIAL_HIGH_CONTRAST_CHROME;
export const BLUR_LIGHT_TEXT: Record<string, string> = {
  '--text-color': '#f1f1f3',
  '--text-primary': '#f1f1f3',
  '--text-secondary': 'rgba(255, 255, 255, 0.5)',
  '--text-tertiary': 'rgba(255, 255, 255, 0.38)',
};

function pickVibrant(palette: HSL[], dominant: HSL): HSL {
  const candidates = palette.filter((c) => c.s >= 14 && c.l > 18 && c.l < 85);
  if (candidates.length === 0) return dominant;
  return [...candidates].sort((a, b) => b.s - a.s)[0]!;
}

/**
 * Black | Colors — Colors uses premium “colored black” + accent progress.
 * Third argument is the extracted album palette (ExtractedPalette).
 */
export function useBackgroundStyle(
  backgroundType: Ref<BackgroundType>,
  colors?: Ref<ExtractedColors>,
  palette?: Ref<ExtractedPalette>
): BackgroundStyleResult {
  const needsColorExtraction = computed(() => backgroundType.value === 'colors');

  const premium = computed(() => {
    if (backgroundType.value !== 'colors') return neutralPremiumPalette();
    const pal = palette?.value;
    if (pal && pal.dominant) {
      const dominant = pal.dominant;
      const vibrant = pickVibrant(pal.palette ?? [], dominant);
      return buildPremiumUiPalette(dominant, vibrant);
    }
    void colors; // kept for call-site compatibility
    return neutralPremiumPalette();
  });

  const lightText = {
    '--text-color': '#f1f1f3',
    '--text-primary': '#f1f1f3',
    '--text-secondary': 'rgba(255, 255, 255, 0.5)',
    '--text-tertiary': 'rgba(255, 255, 255, 0.38)',
  };

  const style = computed(() => {
    switch (backgroundType.value) {
      case 'black':
        return {
          background: '#000000',
          backgroundColor: '#000000',
          backgroundImage: 'none',
          ...lightText,
          // Progress: white fill on black
          '--progress-bar-bg': 'rgba(255, 255, 255, 0.12)',
          '--progress-bar-fill': 'rgba(255, 255, 255, 0.92)',
          '--rpi-progress-track': 'rgba(255, 255, 255, 0.12)',
          '--rpi-progress-fill': 'rgba(255, 255, 255, 0.92)',
          '--rpi-dot': 'rgba(255, 255, 255, 0.32)',
          '--rpi-dot-active': 'rgba(255, 255, 255, 0.95)',
          '--ui-bg': '#000000',
          '--ui-status': '#141414',
          '--ui-card': '#1c1c1c',
          '--ui-accent': 'rgba(255, 255, 255, 0.92)',
        };

      case 'colors': {
        const p = premium.value;
        return {
          backgroundColor: p.bg,
          backgroundImage: p.backgroundImage,
          background: p.backgroundImage,
          ...lightText,
          // Progress track muted; fill = album accent (demo-player)
          '--progress-bar-bg': 'rgba(255, 255, 255, 0.12)',
          '--progress-bar-fill': p.accent,
          '--rpi-progress-track': 'rgba(255, 255, 255, 0.12)',
          '--rpi-progress-fill': p.accent,
          '--rpi-dot': 'rgba(255, 255, 255, 0.28)',
          '--rpi-dot-active': p.accent,
          '--ui-bg': p.bg,
          '--ui-status': p.status,
          '--ui-card': p.card,
          '--ui-accent': p.accent,
          // Fact chrome stays light; accent only on active progress/dots
          '--rpi-fact': '#f1f1f3',
          '--rpi-fact-muted': 'rgba(255, 255, 255, 0.5)',
          '--rpi-title': '#f1f1f3',
          '--rpi-artist': 'rgba(255, 255, 255, 0.5)',
          '--rpi-meta': 'rgba(255, 255, 255, 0.38)',
          '--rpi-sep': 'rgba(255, 255, 255, 0.28)',
        };
      }

      default:
        return {
          background: '#000000',
          ...lightText,
          '--progress-bar-bg': 'rgba(255, 255, 255, 0.12)',
          '--progress-bar-fill': 'rgba(255, 255, 255, 0.92)',
        };
    }
  });

  return {
    style,
    needsColorExtraction,
  };
}
