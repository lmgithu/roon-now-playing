import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

const DATA_DIR = process.env.DATA_DIR || './config';
const DEFAULT_CACHE_PATH = path.join(DATA_DIR, 'facts-cache.json');

// Default 30 days — music facts rarely change; short TTL caused needless re-generation lag.
// Override with FACTS_CACHE_TTL_HOURS (set to 0 for never-expire).
function resolveTtlMs(): number {
  const raw = process.env.FACTS_CACHE_TTL_HOURS;
  if (raw === undefined || raw === '') {
    return 30 * 24 * 60 * 60 * 1000;
  }
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) {
    return 30 * 24 * 60 * 60 * 1000;
  }
  if (hours === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return hours * 60 * 60 * 1000;
}

const TTL_MS = resolveTtlMs();

export interface CacheEntry {
  facts: string[];
  timestamp: number;
}

export interface FactsCacheImportOptions {
  /** merge = keep existing keys unless overwritten; replace = clear first */
  mode: 'merge' | 'replace';
  /**
   * When true (default), set every imported entry's timestamp to now so TTL
   * does not immediately expire pre-generated / older cache files.
   */
  resetTimestamps: boolean;
  /**
   * When merging, overwrite keys that already exist (default true).
   * If false, existing entries are kept and import skips those keys.
   */
  overwrite?: boolean;
}

export interface FactsCacheImportResult {
  imported: number;
  skipped: number;
  invalid: number;
  total: number;
  mode: 'merge' | 'replace';
  resetTimestamps: boolean;
}

export class FactsCache {
  private cache: Map<string, CacheEntry> = new Map();
  private cachePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(cachePath: string = DEFAULT_CACHE_PATH) {
    this.cachePath = cachePath;
    this.load();
  }

  private makeKey(artist: string, album: string, title: string): string {
    return `${artist.toLowerCase()}::${album.toLowerCase()}::${title.toLowerCase()}`;
  }

  private load(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        const data = fs.readFileSync(this.cachePath, 'utf-8');
        const parsed = JSON.parse(data) as Record<string, CacheEntry>;
        this.cache = new Map(Object.entries(parsed));
        logger.info(`Loaded ${this.cache.size} cached facts from ${this.cachePath}`);
      }
    } catch (error) {
      logger.error(`Failed to load facts cache: ${error}`);
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this.cache);
      fs.writeFileSync(this.cachePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error(`Failed to save facts cache: ${error}`);
    }
  }

  /** Debounce disk writes when many tracks are cached in a burst. */
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 250);
  }

  get(artist: string, album: string, title: string): string[] | null {
    const key = this.makeKey(artist, album, title);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check TTL (skipped when FACTS_CACHE_TTL_HOURS=0)
    if (Number.isFinite(TTL_MS) && Date.now() - entry.timestamp > TTL_MS) {
      this.cache.delete(key);
      this.scheduleSave();
      return null;
    }

    return entry.facts;
  }

  set(artist: string, album: string, title: string, facts: string[]): void {
    const key = this.makeKey(artist, album, title);
    this.cache.set(key, {
      facts,
      timestamp: Date.now(),
    });
    this.scheduleSave();
  }

  getTimestamp(artist: string, album: string, title: string): number | null {
    const key = this.makeKey(artist, album, title);
    const entry = this.cache.get(key);
    return entry?.timestamp ?? null;
  }

  size(): number {
    return this.cache.size;
  }

  /** Full cache object for export (same shape as facts-cache.json on disk). */
  exportAll(): Record<string, CacheEntry> {
    return Object.fromEntries(this.cache);
  }

  /**
   * Import a pre-generated facts-cache.json payload.
   * Expected shape: { "artist::album::title": { facts: string[], timestamp?: number } }
   */
  importEntries(
    data: unknown,
    options: FactsCacheImportOptions
  ): FactsCacheImportResult {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Cache file must be a JSON object keyed by artist::album::title');
    }

    const entries = data as Record<string, unknown>;
    const keys = Object.keys(entries);
    if (keys.length === 0) {
      throw new Error('Cache file contains no entries');
    }

    const now = Date.now();
    const overwrite = options.overwrite !== false;
    let imported = 0;
    let skipped = 0;
    let invalid = 0;

    if (options.mode === 'replace') {
      this.cache.clear();
    }

    for (const [key, raw] of Object.entries(entries)) {
      if (!key || typeof key !== 'string' || !key.includes('::')) {
        invalid++;
        continue;
      }

      const normalized = this.normalizeImportEntry(raw, options.resetTimestamps, now);
      if (!normalized) {
        invalid++;
        continue;
      }

      if (options.mode === 'merge' && !overwrite && this.cache.has(key)) {
        skipped++;
        continue;
      }

      // Always store under the provided key (keys are already lowercased by generators)
      this.cache.set(key.toLowerCase(), normalized);
      imported++;
    }

    this.flush();
    logger.info(
      `[FactsCache] Import ${options.mode}: +${imported} imported, ${skipped} skipped, ${invalid} invalid → ${this.cache.size} total`
    );

    return {
      imported,
      skipped,
      invalid,
      total: this.cache.size,
      mode: options.mode,
      resetTimestamps: options.resetTimestamps,
    };
  }

  private normalizeImportEntry(
    raw: unknown,
    resetTimestamps: boolean,
    now: number
  ): CacheEntry | null {
    if (!raw || typeof raw !== 'object') return null;

    const obj = raw as { facts?: unknown; timestamp?: unknown };

    // Allow bare string[] as a value (some tools may have written that)
    let facts: string[];
    if (Array.isArray(raw) && raw.every((f) => typeof f === 'string')) {
      facts = (raw as string[]).map((f) => f.trim()).filter(Boolean);
    } else if (Array.isArray(obj.facts) && obj.facts.every((f) => typeof f === 'string')) {
      facts = (obj.facts as string[]).map((f) => f.trim()).filter(Boolean);
    } else {
      return null;
    }

    if (facts.length === 0) return null;

    let timestamp = now;
    if (!resetTimestamps && typeof obj.timestamp === 'number' && Number.isFinite(obj.timestamp)) {
      timestamp = obj.timestamp;
    }

    return { facts, timestamp };
  }

  /** Flush pending debounced writes (useful in tests / after bulk import). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save();
  }
}
