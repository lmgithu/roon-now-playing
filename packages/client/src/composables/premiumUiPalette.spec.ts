import { describe, it, expect } from 'vitest';
import { buildPremiumUiPalette, neutralPremiumPalette } from './premiumUiPalette';

describe('premiumUiPalette', () => {
  it('returns graphite neutral when no color', () => {
    const p = buildPremiumUiPalette(null);
    expect(p.bg).toBe(neutralPremiumPalette().bg);
    expect(p.ready).toBe(false);
  });

  it('builds colored-black bg and capped accent for saturated red', () => {
    // Pure red dominant
    const p = buildPremiumUiPalette(
      { h: 0, s: 90, l: 40 },
      { h: 0, s: 95, l: 50 }
    );
    expect(p.ready).toBe(true);
    // Background should be dark hsl
    expect(p.bg).toMatch(/^hsl\(/);
    // Accent sat capped — parse S from hsl(h, S%, L%)
    const m = p.accent.match(/hsl\(\d+,\s*(\d+)%/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeLessThanOrEqual(55);
  });

  it('uses near-neutral surfaces for low-chroma art', () => {
    const p = buildPremiumUiPalette({ h: 30, s: 5, l: 50 });
    expect(p.ready).toBe(true);
    expect(p.bg).toMatch(/#16|#161617|hsl/);
  });
});
