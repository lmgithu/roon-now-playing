import { computed, type Ref, type ComputedRef } from 'vue';
import type { BackgroundType } from '@roon-screen-cover/shared';
import type { ExtractedColors } from './colorUtils';
import type { VibrantGradient } from './useColorExtraction';

export interface BackgroundStyleResult {
  style: ComputedRef<Record<string, string>>;
  needsColorExtraction: ComputedRef<boolean>;
}

/** Types that need DynamicBackground (artwork image / special layers) */
export const DYNAMIC_BACKGROUND_TYPES: readonly BackgroundType[] = [
  'gradient-radial-corner',
  'blur-grain',
] as const;

/**
 * Composable for generating background styles based on background type
 */
export function useBackgroundStyle(
  backgroundType: Ref<BackgroundType>,
  colors?: Ref<ExtractedColors>,
  vibrantGradient?: Ref<VibrantGradient>
): BackgroundStyleResult {
  const needsColorExtraction = computed(() => {
    return (
      backgroundType.value !== 'black'
    );
  });

  const lightProgressBar = {
    '--progress-bar-bg': 'rgba(255, 255, 255, 0.2)',
    '--progress-bar-fill': 'rgba(255, 255, 255, 0.9)',
  };
  const darkProgressBar = {
    '--progress-bar-bg': 'rgba(26, 26, 26, 0.15)',
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

      case 'dominant':
        if (vibrantGradient?.value?.ready) {
          return {
            background: vibrantGradient.value.center,
            '--text-color': vibrantGradient.value.text,
            '--text-secondary': vibrantGradient.value.textSecondary,
            '--text-tertiary': vibrantGradient.value.textTertiary,
            ...progressBarForText(vibrantGradient.value.text),
          };
        }
        return {
          background: '#000000',
          '--text-color': '#ffffff',
          '--text-secondary': 'rgba(255, 255, 255, 0.8)',
          '--text-tertiary': 'rgba(255, 255, 255, 0.6)',
          ...lightProgressBar,
        };

      case 'gradient-simple':
        // Field is applied by layouts via useAlbumTheme (RPi single-hue radial).
        // Only text/progress fallbacks here if theme not layered yet.
        return {
          background: 'transparent',
          '--text-color': '#f5f5f5',
          '--text-secondary': 'rgba(245, 245, 245, 0.82)',
          '--text-tertiary': 'rgba(245, 245, 245, 0.7)',
          ...lightProgressBar,
        };

      case 'gradient-radial':
        if (vibrantGradient?.value?.ready) {
          return {
            background: `radial-gradient(ellipse 120% 100% at 50% 50%, ${vibrantGradient.value.center} 0%, ${vibrantGradient.value.edge} 100%)`,
            '--text-color': vibrantGradient.value.text,
            '--text-secondary': vibrantGradient.value.textSecondary,
            '--text-tertiary': vibrantGradient.value.textTertiary,
            ...progressBarForText(vibrantGradient.value.text),
          };
        }
        return {
          background: 'radial-gradient(ellipse 120% 100% at 50% 50%, #1a1a1a 0%, #000000 100%)',
          '--text-color': '#ffffff',
          '--text-secondary': 'rgba(255, 255, 255, 0.8)',
          '--text-tertiary': 'rgba(255, 255, 255, 0.6)',
          ...lightProgressBar,
        };

      case 'gradient-linear':
        if (vibrantGradient?.value?.ready) {
          return {
            background: `linear-gradient(135deg, ${vibrantGradient.value.center} 0%, ${vibrantGradient.value.edge} 100%)`,
            '--text-color': vibrantGradient.value.text,
            '--text-secondary': vibrantGradient.value.textSecondary,
            '--text-tertiary': vibrantGradient.value.textTertiary,
            ...progressBarForText(vibrantGradient.value.text),
          };
        }
        return {
          background: 'linear-gradient(135deg, #1a1a1a 0%, #000000 100%)',
          '--text-color': '#ffffff',
          '--text-secondary': 'rgba(255, 255, 255, 0.8)',
          '--text-tertiary': 'rgba(255, 255, 255, 0.6)',
          ...lightProgressBar,
        };

      case 'gradient-radial-corner':
      case 'blur-grain':
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
