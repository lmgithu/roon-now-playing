import { ref, computed, watch, onUnmounted, type Ref, type ComputedRef } from 'vue';
import type { Track, PlaybackState, FactsResponse, FactsError } from '@roon-screen-cover/shared';

const DEBOUNCE_DELAY = 300;
const DEFAULT_ROTATION_INTERVAL = 25; // seconds, can be overridden by server config

interface CachedFacts {
  facts: string[];
  generatedAt: number;
}

function getCacheKey(artist: string, album: string, title: string): string {
  return `facts::${artist.toLowerCase()}::${album.toLowerCase()}::${title.toLowerCase()}`;
}

function getFromSessionStorage(key: string): CachedFacts | null {
  try {
    const cached = sessionStorage.getItem(key);
    if (cached) {
      const data = JSON.parse(cached) as CachedFacts;
      if (Array.isArray(data.facts) && data.facts.length > 0) {
        return data;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function saveToSessionStorage(key: string, data: CachedFacts): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

export interface UseFactsReturn {
  facts: Ref<string[]>;
  currentFactIndex: Ref<number>;
  currentFact: ComputedRef<string | null>;
  isLoading: Ref<boolean>;
  error: Ref<FactsError | null>;
  cached: Ref<boolean>;
}

export function useFacts(
  track: Ref<Track | null>,
  playbackState: Ref<PlaybackState>
): UseFactsReturn {
  const facts = ref<string[]>([]);
  const currentFactIndex = ref(0);
  const isLoading = ref(false);
  const error = ref<FactsError | null>(null);
  const cached = ref(false);
  const rotationIntervalSec = ref(DEFAULT_ROTATION_INTERVAL);

  let debounceTimer: number | null = null;
  let rotationTimer: number | null = null;
  let abortController: AbortController | null = null;
  let requestSeq = 0;

  function applyRotationInterval(seconds: unknown): void {
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
      const next = Math.round(seconds);
      if (next !== rotationIntervalSec.value) {
        rotationIntervalSec.value = next;
      }
    }
  }

  /**
   * Public settings only — must not use /api/facts/config (admin-protected).
   * Otherwise displays fall back to DEFAULT_ROTATION_INTERVAL (25s) forever.
   */
  function loadDisplaySettings(): void {
    fetch('/api/facts/display-settings')
      .then((response) => (response.ok ? response.json() : null))
      .then((settings) => {
        if (settings) applyRotationInterval(settings.rotationInterval);
      })
      .catch(() => {
        // Keep default / last known interval
      });
  }

  loadDisplaySettings();
  // Refresh periodically so admin changes apply without a full page reload
  const settingsPollTimer = window.setInterval(loadDisplaySettings, 60_000);

  const currentFact = computed(() => {
    if (facts.value.length === 0) {
      return null;
    }
    return facts.value[currentFactIndex.value] ?? null;
  });

  function clearDebounceTimer(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function clearRotationTimer(): void {
    if (rotationTimer !== null) {
      clearTimeout(rotationTimer);
      rotationTimer = null;
    }
  }

  function scheduleNextRotation(): void {
    clearRotationTimer();

    if (facts.value.length <= 1) {
      return;
    }

    if (playbackState.value !== 'playing') {
      return;
    }

    const currentFactText = facts.value[currentFactIndex.value];
    if (!currentFactText) {
      return;
    }

    // Use the configured rotation interval (in seconds, convert to ms)
    const displayTime = rotationIntervalSec.value * 1000;

    rotationTimer = window.setTimeout(() => {
      currentFactIndex.value = (currentFactIndex.value + 1) % facts.value.length;
      scheduleNextRotation();
    }, displayTime);
  }

  // When interval arrives/changes after a timer was already scheduled with the default,
  // restart so the new value takes effect on the *current* fact hold.
  watch(rotationIntervalSec, () => {
    if (facts.value.length > 1 && playbackState.value === 'playing') {
      scheduleNextRotation();
    }
  });

  async function fetchFacts(trackData: Track): Promise<void> {
    const cacheKey = getCacheKey(trackData.artist, trackData.album, trackData.title);

    // Check sessionStorage cache first
    const cachedData = getFromSessionStorage(cacheKey);
    if (cachedData) {
      facts.value = cachedData.facts;
      cached.value = true;
      error.value = null;
      scheduleNextRotation();
      return;
    }

    // Abort any previous in-flight request (track changed)
    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();
    const seq = ++requestSeq;
    const signal = abortController.signal;

    isLoading.value = true;
    error.value = null;

    try {
      const response = await fetch('/api/facts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artist: trackData.artist,
          album: trackData.album,
          title: trackData.title,
        }),
        signal,
      });

      // Stale response from a superseded request
      if (seq !== requestSeq) {
        return;
      }

      const data = await response.json();

      if (seq !== requestSeq) {
        return;
      }

      if (!response.ok) {
        error.value = (data.error as FactsError) ?? {
          type: 'api-error',
          message: `HTTP ${response.status}`,
        };
        facts.value = Array.isArray(data.facts) ? data.facts : [];
        return;
      }

      // Guard against malformed success payloads (missing facts array)
      const factsResponse = data as FactsResponse & { error?: FactsError };
      const list = Array.isArray(factsResponse.facts) ? factsResponse.facts : [];

      if (list.length === 0) {
        error.value = factsResponse.error ?? {
          type: 'empty',
          message: 'No facts generated',
        };
        facts.value = [];
        return;
      }

      facts.value = list;
      cached.value = !!factsResponse.cached;
      error.value = null;

      saveToSessionStorage(cacheKey, {
        facts: list,
        generatedAt: factsResponse.generatedAt ?? Date.now(),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      if (seq !== requestSeq) {
        return;
      }
      error.value = {
        type: 'api-error',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
      facts.value = [];
    } finally {
      if (seq === requestSeq) {
        isLoading.value = false;
        // Schedule rotation AFTER loading is complete, so first fact gets full display time
        if (facts.value.length > 1 && playbackState.value === 'playing') {
          scheduleNextRotation();
        }
      }
    }
  }

  // Watch for track changes with debouncing
  watch(
    track,
    (newTrack, oldTrack) => {
      // Check if track actually changed (not just object reference)
      const trackActuallyChanged =
        newTrack?.title !== oldTrack?.title ||
        newTrack?.artist !== oldTrack?.artist ||
        newTrack?.album !== oldTrack?.album;

      // If track data is the same (just a ref update from zone events), ignore
      if (!trackActuallyChanged && newTrack && oldTrack) {
        return;
      }

      // Clear existing timers only when track actually changes
      clearDebounceTimer();
      clearRotationTimer();

      // Reset state when track changes
      if (trackActuallyChanged) {
        facts.value = [];
        currentFactIndex.value = 0;
        cached.value = false;
        error.value = null;
        if (abortController) {
          abortController.abort();
          abortController = null;
        }
      }

      if (!newTrack) {
        return;
      }

      // Debounce the fetch
      debounceTimer = window.setTimeout(() => {
        fetchFacts(newTrack);
      }, DEBOUNCE_DELAY);
    },
    { immediate: true }
  );

  // Watch playback state for rotation control
  watch(
    playbackState,
    (state) => {
      if (state === 'playing') {
        scheduleNextRotation();
      } else {
        clearRotationTimer();
      }
    }
  );

  onUnmounted(() => {
    clearDebounceTimer();
    clearRotationTimer();
    window.clearInterval(settingsPollTimer);
    if (abortController) {
      abortController.abort();
    }
  });

  return {
    facts,
    currentFactIndex,
    currentFact,
    isLoading,
    error,
    cached,
  };
}
