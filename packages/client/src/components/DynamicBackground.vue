<script setup lang="ts">
/**
 * Legacy content wrapper. Backgrounds are applied by the parent via
 * useBackgroundStyle (Black / Colors). Kept so older imports still compile.
 */
import type { BackgroundType } from '@roon-screen-cover/shared';
import type { ExtractedPalette } from '../composables/useColorExtraction';
import type { VibrantGradient } from '../composables/useColorExtraction';

defineProps<{
  type?: BackgroundType;
  artworkUrl?: string | null;
  palette?: ExtractedPalette;
  vibrantGradient?: VibrantGradient;
}>();
</script>

<template>
  <div class="dynamic-background">
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
  background: transparent;
}

.content {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
}
</style>
