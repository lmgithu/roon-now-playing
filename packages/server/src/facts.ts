import { Router } from 'express';
import type { FactsConfig, FactsRequest, FactsResponse, FactsTestResponse } from '@roon-screen-cover/shared';
import { FactsConfigStore } from './factsConfig.js';
import { FactsCache } from './factsCache.js';
import { createLLMProvider } from './llm.js';
import { logger } from './logger.js';

export function createFactsRouter(): Router {
  const router = Router();
  const configStore = new FactsConfigStore();
  const cache = new FactsCache();

  // Coalesce concurrent LLM requests for the same track (multi-display / multi-zone)
  const inflight = new Map<string, Promise<string[]>>();

  function trackKey(artist: string, album: string, title: string): string {
    return `${artist.toLowerCase()}::${album.toLowerCase()}::${title.toLowerCase()}`;
  }

  async function generateAndCache(artist: string, album: string, title: string): Promise<string[]> {
    const key = trackKey(artist, album, title);
    const existing = inflight.get(key);
    if (existing) {
      logger.info(`[Facts] Joining in-flight request for ${artist} — ${title}`);
      return existing;
    }

    const promise = (async () => {
      const config = configStore.get();
      const provider = createLLMProvider(config);
      const facts = await provider.generateFacts(artist, album, title);
      if (facts.length > 0) {
        cache.set(artist, album, title, facts);
      }
      return facts;
    })();

    inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(key);
    }
  }

  // Get facts for a track
  router.post('/facts', async (req, res) => {
    const { artist, album, title } = req.body as FactsRequest;

    if (!artist || !album || !title) {
      res.status(400).json({ error: 'artist, album, and title are required' });
      return;
    }

    // Serve pre-filled / previously generated cache without requiring an API key
    const cached = cache.get(artist, album, title);
    if (cached && cached.length > 0) {
      const timestamp = cache.getTimestamp(artist, album, title);
      const response: FactsResponse = {
        facts: cached,
        cached: true,
        generatedAt: timestamp || Date.now(),
      };
      res.json(response);
      return;
    }

    const config = configStore.get();

    // Local LLM does not require an API key; cloud providers do
    if (!configStore.isConfigured()) {
      res.status(503).json({
        error: {
          type: 'no-key',
          message:
            config.provider === 'local'
              ? 'Local LLM model not configured'
              : 'No API key configured (and no cached facts for this track)',
        },
      });
      return;
    }

    // Generate new facts (coalesced) and append to the same cache file
    try {
      const start = Date.now();
      const facts = await generateAndCache(artist, album, title);
      logger.info(`[Facts] Generated ${facts.length} facts for ${artist} — ${title} in ${Date.now() - start}ms`);

      if (facts.length === 0) {
        res.status(502).json({
          error: { type: 'empty', message: 'No facts generated' },
          facts: [],
          cached: false,
          generatedAt: Date.now(),
        });
        return;
      }

      const response: FactsResponse = {
        facts,
        cached: false,
        generatedAt: Date.now(),
      };
      res.json(response);
    } catch (error) {
      logger.error(`Failed to generate facts: ${error}`);
      res.status(500).json({
        error: { type: 'api-error', message: error instanceof Error ? error.message : 'Failed to generate facts' },
      });
    }
  });

  // Get facts configuration
  router.get('/facts/config', (_req, res) => {
    const config = configStore.get();
    res.json({
      ...config,
      apiKey: config.apiKey ? '••••••••' + config.apiKey.slice(-4) : '',
      hasApiKey: !!config.apiKey,
      isConfigured: configStore.isConfigured(),
    });
  });

  // Update facts configuration
  router.post('/facts/config', (req, res) => {
    const updates = req.body as Partial<FactsConfig>;

    if (updates.apiKey && updates.apiKey.includes('••••')) {
      delete updates.apiKey;
    }

    configStore.update(updates);
    logger.info('Facts config updated');
    res.json({ success: true });
  });

  // --- Cache import / export ---

  router.get('/facts/cache', (_req, res) => {
    res.json({
      entryCount: cache.size(),
    });
  });

  router.get('/facts/cache/export', (_req, res) => {
    const data = cache.exportAll();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="facts-cache-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify(data, null, 2));
  });

  router.post('/facts/cache/import', (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        entries?: unknown;
        mode?: 'merge' | 'replace';
        resetTimestamps?: boolean;
        overwrite?: boolean;
        [key: string]: unknown;
      };

      // Prefer { entries, mode, resetTimestamps }; also accept a raw cache map as the body
      const payload =
        body.entries !== undefined ? body.entries : stripImportMeta(body);

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        res.status(400).json({
          error:
            'Request must include cache entries (facts-cache.json object, or { entries: {...}, mode, resetTimestamps })',
        });
        return;
      }

      const mode = body.mode === 'replace' ? 'replace' : 'merge';
      const resetTimestamps = body.resetTimestamps !== false; // default true
      const overwrite = body.overwrite !== false;

      const result = cache.importEntries(payload, { mode, resetTimestamps, overwrite });
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error(`Facts cache import failed: ${error}`);
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Import failed',
      });
    }
  });

  // Test facts generation
  router.post('/facts/test', async (req, res) => {
    const { artist, album, title } = req.body as FactsRequest;

    if (!artist || !album || !title) {
      res.status(400).json({ error: 'artist, album, and title are required' });
      return;
    }

    const config = configStore.get();

    if (!configStore.isConfigured()) {
      res.status(400).json({
        error: config.provider === 'local' ? 'Local LLM model not configured' : 'No API key configured',
      });
      return;
    }

    const startTime = Date.now();

    try {
      const provider = createLLMProvider(config);
      const facts = await provider.generateFacts(artist, album, title);
      const durationMs = Date.now() - startTime;

      const response: FactsTestResponse = { facts, durationMs };

      if (facts.length === 0) {
        logger.warn(`Facts test returned 0 facts - model may not be returning valid JSON array. Check server logs for details.`);
        res.json({
          ...response,
          warning:
            'Model returned content but no facts could be parsed. The model may not be following the JSON array format. Check server logs for raw response.',
        });
        return;
      }

      res.json(response);
    } catch (error) {
      logger.error(`Facts test failed: ${error}`);
      res.status(500).json({ error: `API error: ${error}` });
    }
  });

  return router;
}

function hasCacheShape(obj: object): boolean {
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  // meta keys only → not a cache map
  const meta = new Set(['entries', 'mode', 'resetTimestamps', 'overwrite']);
  const sample = keys.filter((k) => !meta.has(k)).slice(0, 5);
  if (sample.length === 0) return false;
  return sample.some((k) => k.includes('::'));
}

function stripImportMeta(body: Record<string, unknown>): unknown {
  if (hasCacheShape(body)) {
    const copy = { ...body };
    delete copy.mode;
    delete copy.resetTimestamps;
    delete copy.overwrite;
    delete copy.entries;
    return copy;
  }
  return body.entries;
}
