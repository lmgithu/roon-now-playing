import { describe, it, expect } from 'vitest';
import { samplePixels, quantizePixels } from './extractDominantColors';

describe('extractDominantColors', () => {
  it('samplePixels strides by windowSize', () => {
    // 3 pixels: RGB A each
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
    ]);
    // windowSize 1 → every pixel
    expect(samplePixels(data, 1)).toEqual([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ]);
    // windowSize 2 → 1st and 3rd
    expect(samplePixels(data, 2)).toEqual([
      [255, 0, 0],
      [0, 0, 255],
    ]);
  });

  it('quantizePixels returns dominant clusters', () => {
    const pixels: [number, number, number][] = [];
    for (let i = 0; i < 40; i++) pixels.push([220, 20, 20]);
    for (let i = 0; i < 40; i++) pixels.push([20, 20, 220]);
    for (let i = 0; i < 10; i++) pixels.push([20, 220, 20]);

    const palette = quantizePixels(pixels, 3);
    expect(palette.length).toBeGreaterThanOrEqual(2);
    // Should include something red-ish and blue-ish
    const hasRed = palette.some(([r, g, b]) => r > g && r > b);
    const hasBlue = palette.some(([r, g, b]) => b > r && b > g);
    expect(hasRed).toBe(true);
    expect(hasBlue).toBe(true);
  });
});
