import { computed, type Ref, type ComputedRef } from 'vue';
import type { BackgroundType } from '@roon-screen-cover/shared';
import type { ExtractedColors } from './colorUtils';
import type { VibrantGradient } from './useColorExtraction';

export interface BackgroundStyleResult {
  style: ComputedRef<Record<string, string>>;
  needsColorExtraction: ComputedRef<boolean>;
}

/** Types that need DynamicBackground (blurred art + layers) */
export const DYNAMIC_BACKGROUND_TYPES: readonly BackgroundType[] = ['blur-grain'] as const;

/**
 * High-contrast chrome for monochromatic color washes (corner gradient).
 * Soft album accents share the field hue and disappear into the wash.
 */
export const GRADIENT_HIGH_CONTRAST_CHROME: Record<string, string> = {
  '--rpi-progress-fill': 'rgba(255, 255, 255, 0.95)',
  '--rpi-progress-track': 'rgba(255, 255, 255, 0.36)',
  '--rpi-dot': 'rgba(255, 255, 255, 0.4)',
  '--rpi-dot-active': '#ffffff',
  '--progress-bar-fill': 'rgba(255, 255, 255, 0.95)',
  '--progress-bar-bg': 'rgba(255, 255, 255, 0.36)',
};

/** @deprecated alias — same as GRADIENT_HIGH_CONTRAST_CHROME */
export const RADIAL_HIGH_CONTRAST_CHROME = GRADIENT_HIGH_CONTRAST_CHROME;

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
  const darkProgressBar = {
    '--progress-bar-bg': 'rgba(26, 26, 26, 0.22)',
    '--progress-bar-fill': 'rgba(26, 26, 26, 0.7)',
  };

  function progressBarForText(textColor: string) {
    return textColor === '#1a1a1a' ? darkProgressBar : lightProgressBar;
  }

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

      case 'gradient-radial-corner':
        // Corner radial from top-left; light chrome for contrast on color wash
        if (vibrantGradient?.value?.ready) {
          return {
            background: `radial-gradient(ellipse 140% 120% at 0% 0%, ${vibrantGradient.value.center} 0%, ${vibrantGradient.value.edge} 72%, #000000 100%)`,
            '--text-color': '#f5f5f5',
            '--text-secondary': 'rgba(245, 245, 245, 0.85)',
            '--text-tertiary': 'rgba(245, 245, 245, 0.7)',
            ...lightProgressBar,
            ...GRADIENT_HIGH_CONTRAST_CHROME,
          };
        }
        return {
          background: 'radial-gradient(ellipse 140% 120% at 0% 0%, #2a2a35 0%, #0a0a0c 72%, #000000 100%)',
          '--text-color': '#ffffff',
          '--text-secondary': 'rgba(255, 255, 255, 0.8)',
          '--text-tertiary': 'rgba(255, 255, 255, 0.6)',
          ...lightProgressBar,
          ...GRADIENT_HIGH_CONTRAST_CHROME,
        };

      case 'blur-grain':
        // Field = DynamicBackground blur; chrome from useAlbumTheme / light defaults
        if (vibrantGradient?.value?.ready) {
          return {
            background: 'transparent',
            '--text-color': vibrantGradient.value.text,
            '--text-secondary': vibrantGradient.value.textSecondary,
            '--text-tertiary': vibrantGradient.value.textTertiary,
            ...progressBarForText(vibrantGradient.value.text),
          };
        }
        return {
          background: 'transparent',
          '--text-color': '#ffffff',
          '--text-secondary': 'rgba(255, 255, 255, 0.8)',
          '--text-tertiary': 'rgba(255, 255, 255, 0.6)',
          ...lightProgressBar,
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
