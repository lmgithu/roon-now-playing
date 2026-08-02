/**
 * Test Plan: usePreferences Composable
 *
 * Scenario: Load preferences from URL params
 *   Given URL contains zone and layout params
 *   When loadPreferences is called
 *   Then preferences should match URL params
 *
 * Scenario: Fall back to localStorage
 *   Given no URL params but localStorage has values
 *   When loadPreferences is called
 *   Then preferences should match localStorage values
 *
 * Scenario: Save zone preference
 *   Given a zone is selected
 *   When saveZonePreference is called
 *   Then localStorage should be updated
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePreferences } from './usePreferences';

describe('usePreferences', () => {
  beforeEach(() => {
    // jsdom sometimes omits a working localStorage; use an in-memory stub
    const store = new Map<string, string>();
    const mockStorage: Storage = {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    vi.stubGlobal('localStorage', mockStorage);
    // Reset URL
    window.history.replaceState({}, '', '/');
  });

  it('should initialize with default layout', () => {
    const { layout } = usePreferences();
    expect(layout.value).toBe('rpi-facts-carousel');
  });

  it('should load zone from URL param', () => {
    window.history.replaceState({}, '', '/?zone=Living%20Room');

    const { preferredZone, loadPreferences } = usePreferences();
    loadPreferences();

    expect(preferredZone.value).toBe('Living Room');
  });

  it('should load layout from URL param', () => {
    window.history.replaceState({}, '', '/?layout=ambient');

    const { layout, loadPreferences } = usePreferences();
    loadPreferences();

    expect(layout.value).toBe('ambient');
  });

  it('should fall back to localStorage when no URL params', () => {
    localStorage.setItem('roon-screen-cover:zone', 'Office');
    localStorage.setItem('roon-screen-cover:layout', 'fullscreen');

    const { preferredZone, layout, loadPreferences } = usePreferences();
    loadPreferences();

    expect(preferredZone.value).toBe('Office');
    expect(layout.value).toBe('fullscreen');
  });

  it('should save zone preference to localStorage', () => {
    const { saveZonePreference, preferredZone } = usePreferences();

    saveZonePreference('Kitchen');

    expect(preferredZone.value).toBe('Kitchen');
    expect(localStorage.getItem('roon-screen-cover:zone')).toBe('Kitchen');
  });

  it('should save layout preference to localStorage', () => {
    const { saveLayoutPreference, layout } = usePreferences();

    saveLayoutPreference('cover');

    expect(layout.value).toBe('cover');
    expect(localStorage.getItem('roon-screen-cover:layout')).toBe('cover');
  });

  it('should clear zone preference', () => {
    localStorage.setItem('roon-screen-cover:zone', 'Office');

    const { clearZonePreference, preferredZone, loadPreferences } = usePreferences();
    loadPreferences();

    expect(preferredZone.value).toBe('Office');

    clearZonePreference();

    expect(preferredZone.value).toBeNull();
    expect(localStorage.getItem('roon-screen-cover:zone')).toBeNull();
  });

  it('should ignore invalid layout in URL', () => {
    window.history.replaceState({}, '', '/?layout=invalid');

    const { layout, loadPreferences } = usePreferences();
    loadPreferences();

    expect(layout.value).toBe('rpi-facts-carousel'); // Default
  });

  it('should prioritize URL params over localStorage', () => {
    localStorage.setItem('roon-screen-cover:layout', 'fullscreen');
    window.history.replaceState({}, '', '/?layout=ambient');

    const { layout, loadPreferences } = usePreferences();
    loadPreferences();

    expect(layout.value).toBe('ambient');
  });

  // New background type tests
  it('should accept gradient-mesh background from URL', () => {
    window.history.replaceState({}, '', '/?background=gradient-mesh');

    const { background, loadPreferences } = usePreferences();
    loadPreferences();

    expect(background.value).toBe('gradient-mesh');
  });

  it('should accept blur-subtle background from URL', () => {
    window.history.replaceState({}, '', '/?background=blur-subtle');

    const { background, loadPreferences } = usePreferences();
    loadPreferences();

    expect(background.value).toBe('blur-subtle');
  });

  it('should accept duotone background from URL', () => {
    window.history.replaceState({}, '', '/?background=duotone');

    const { background, loadPreferences } = usePreferences();
    loadPreferences();

    expect(background.value).toBe('duotone');
  });

  it('should reject invalid background from URL', () => {
    window.history.replaceState({}, '', '/?background=invalid-type');

    const { background, loadPreferences } = usePreferences();
    loadPreferences();

    expect(background.value).toBe('black'); // Default
  });

  it('should save new background types to localStorage', () => {
    const { saveBackgroundPreference, background } = usePreferences();

    saveBackgroundPreference('gradient-noise');

    expect(background.value).toBe('gradient-noise');
    expect(localStorage.getItem('roon-screen-cover:background')).toBe('gradient-noise');
  });
});
