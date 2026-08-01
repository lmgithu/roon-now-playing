/**
 * Scenario: format sample rates for display
 * Scenario: detect Tidal vs FLAC and build quality labels
 */
import { describe, it, expect } from 'vitest';
import { formatSampleRateLabel, extractRoonSourceAndQuality } from './roon.js';

describe('formatSampleRateLabel', () => {
  it('formats common rates', () => {
    expect(formatSampleRateLabel(44100)).toBe('44.1kHz');
    expect(formatSampleRateLabel(48000)).toBe('48kHz');
    expect(formatSampleRateLabel(96000)).toBe('96kHz');
    expect(formatSampleRateLabel(192000)).toBe('192kHz');
  });

  it('accepts kHz-scale values', () => {
    expect(formatSampleRateLabel(44.1)).toBe('44.1kHz');
    expect(formatSampleRateLabel(96)).toBe('96kHz');
  });
});

describe('extractRoonSourceAndQuality', () => {
  it('labels Tidal sources', () => {
    const r = extractRoonSourceAndQuality({
      three_line: { line1: 'a', line2: 'b', line3: 'c' },
      source: 'TIDAL',
      sample_rate: 96000,
      bits_per_sample: 24,
    });
    expect(r.source_label).toBe('Tidal');
    expect(r.quality_label).toBe('96kHz / 24-bit');
  });

  it('labels local library as FLAC', () => {
    const r = extractRoonSourceAndQuality({
      three_line: { line1: 'a', line2: 'b', line3: 'c' },
      sample_rate: 192000,
      bit_depth: 24,
      // path is undocumented on Roon payloads
      ...({ path: '/music/album/track.flac' } as object),
    } as Parameters<typeof extractRoonSourceAndQuality>[0]);
    expect(r.source_label).toBe('FLAC');
    expect(r.quality_label).toBe('192kHz / 24-bit');
  });

  it('returns nulls when unknown', () => {
    const r = extractRoonSourceAndQuality({
      three_line: { line1: 'a', line2: 'b', line3: 'c' },
    });
    expect(r.source_label).toBeNull();
    expect(r.quality_label).toBeNull();
  });
});
