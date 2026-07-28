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

interface CacheEntry {
  facts: string[];
  timestamp: number;
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

  /** Flush pending debounced writes (useful in tests). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.save();
    }
  }
}
