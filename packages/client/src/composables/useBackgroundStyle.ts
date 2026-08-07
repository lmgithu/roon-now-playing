import { computed, type Ref, type ComputedRef } from 'vue';
import type { BackgroundType } from '@roon-screen-cover/shared';
import type { ExtractedColors } from './colorUtils';
import type { VibrantGradient } from './useColorExtraction';

export interface BackgroundStyleResult {
  style: ComputedRef<Record<string, string>>;
  needsColorExtraction: ComputedRef<boolean>;
}

/** Types that need DynamicBackground (Apple Music color mesh + glass) */
export const DYNAMIC_BACKGROUND_TYPES: readonly BackgroundType[] = ['blur-grain'] as const;

/**
 * High-contrast chrome for monochromatic color washes (radial gradient).
 * Soft album accents share the field hue and disappear into the wash.
 */
export const RADIAL_HIGH_CONTRAST_CHROME: Record<string, string> = {
  '--rpi-progress-fill': 'rgba(255, 255, 255, 0.95)',
  '--rpi-progress-track': 'rgba(255, 255, 255, 0.36)',
  '--rpi-dot': 'rgba(255, 255, 255, 0.4)',
  '--rpi-dot-active': '#ffffff',
  '--progress-bar-fill': 'rgba(255, 255, 255, 0.95)',
  '--progress-bar-bg': 'rgba(255, 255, 255, 0.36)',
};

/** @deprecated alias */
export const GRADIENT_HIGH_CONTRAST_CHROME = RADIAL_HIGH_CONTRAST_CHROME;

/**
 * Forced light text for Grainy Blur / Apple mesh — always highly readable
 * over the darkened color field.
 */
export const BLUR_LIGHT_TEXT: Record<string, string> = {
  '--text-color': '#ffffff',
  '--text-primary': '#ffffff',
  '--text-secondary': 'rgba(255, 255, 255, 0.92)',
  '--text-tertiary': 'rgba(255, 255, 255, 0.8)',
  '--rpi-fact': '#ffffff',
  '--rpi-fact-muted': 'rgba(255, 255, 255, 0.82)',
  '--rpi-title': '#ffffff',
  '--rpi-artist': 'rgba(255, 255, 255, 0.92)',
  '--rpi-meta': 'rgba(255, 255, 255, 0.8)',
  '--rpi-sep': 'rgba(255, 255, 255, 0.5)',
};

/**
 * Composable for generating background styles based on background type
 */
export function useBackgroundStyle(
  backgroundType: Ref<BackgroundType>,
  colors?: Ref<ExtractedColors>,
  vibrantGradient?: Ref<VibrantGradient>
): BackgroundStyleResult {
  const needsColorExtraction = computed(() => backgroundType.value !== 'black');

  const lightProgressBar = {
    '--progress-bar-bg': 'rgba(255, 255, 255, 0.38)',
    '--progress-bar-fill': 'rgba(255, 255, 255, 0.9)',
  };

  const style = computed(() => {
    switch (backgroundType.value) {
      case 'black':
        return {
          background: '#000000',
          '--text-color': '#ffffff',
          '--text-secondary': 'rgba(255, 255, 255, 0.8)',
          '--text-tertiary': 'rgba(255, 255, 255, 0.6)',
          ...lightProgressBar,
        };

      case 'gradient-radial':
        // Center radial (restored from pre-corner versions) + light chrome
        if (vibrantGradient?.value?.ready) {
          return {
            background: `radial-gradient(ellipse 120% 100% at 50% 50%, ${vibrantGradient.value.center} 0%, ${vibrantGradient.value.edge} 100%)`,
            '--text-color': '#f5f5f5',
            '--text-secondary': 'rgba(245, 245, 245, 0.85)',
            '--text-tertiary': 'rgba(245, 245, 245, 0.7)',
            ...lightProgressBar,
            ...RADIAL_HIGH_CONTRAST_CHROME,
          };
        }
        return {
          background: 'radial-gradient(ellipse 120% 100% at 50% 50%, #1a1a1a 0%, #000000 100%)',
          '--text-color': '#ffffff',
          '--text-secondary': 'rgba(255, 255, 255, 0.8)',
          '--text-tertiary': 'rgba(255, 255, 255, 0.6)',
          ...lightProgressBar,
          ...RADIAL_HIGH_CONTRAST_CHROME,
        };

      case 'blur-grain':
        // Field = DynamicBackground mesh; always force bright light text
        return {
          background: 'transparent',
          ...BLUR_LIGHT_TEXT,
          ...lightProgressBar,
          ...RADIAL_HIGH_CONTRAST_CHROME,
        };

      default:
        return {
          background: '#000000',
          '--text-color': '#ffffff',
          '--text-secondary': 'rgba(255, 255, 255, 0.8)',
          '--text-tertiary': 'rgba(255, 255, 255, 0.6)',
          ...lightProgressBar,
        };
    }
  });

  return {
    style,
    needsColorExtraction,
  };
}
