/**
 * Scenario: empty stats
 * Scenario: record hits and generations within 24h window
 * Scenario: prune events older than 24h
 * Scenario: percentages sum sensibly
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { FactsServeStats } from './factsServeStats.js';

describe('FactsServeStats', () => {
  let dir: string;
  let stats: FactsServeStats;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-serve-'));
    stats = new FactsServeStats(path.join(dir, 'stats.json'));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty', () => {
    const s = stats.snapshot();
    expect(s.cacheHits).toBe(0);
    expect(s.generations).toBe(0);
    expect(s.total).toBe(0);
    expect(s.cacheHitPercent).toBe(0);
    expect(s.generationPercent).toBe(0);
  });

  it('counts hits and generations with percentages', () => {
    stats.recordCacheHit();
    stats.recordCacheHit();
    stats.recordCacheHit();
    stats.recordGeneration();
    const s = stats.snapshot();
    expect(s.cacheHits).toBe(3);
    expect(s.generations).toBe(1);
    expect(s.total).toBe(4);
    expect(s.cacheHitPercent).toBe(75);
    expect(s.generationPercent).toBe(25);
  });

  it('prunes events older than 24 hours', () => {
    stats.recordCacheHit();
    stats.recordGeneration();
    vi.setSystemTime(new Date('2026-08-02T13:00:00Z')); // +25h
    stats.recordCacheHit();
    const s = stats.snapshot();
    expect(s.cacheHits).toBe(1);
    expect(s.generations).toBe(0);
    expect(s.total).toBe(1);
    expect(s.cacheHitPercent).toBe(100);
  });

  it('persists across reload', () => {
    stats.recordCacheHit();
    stats.recordGeneration();
    // Force immediate save by snapshot path after debounce — write via second instance after flush
    vi.advanceTimersByTime(600);
    const again = new FactsServeStats(path.join(dir, 'stats.json'));
    const s = again.snapshot();
    expect(s.cacheHits).toBe(1);
    expect(s.generations).toBe(1);
  });
});
