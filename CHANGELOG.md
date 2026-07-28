# Changelog

All notable changes to this project will be documented in this file.

## [1.9.4] - 2026-07-28

### Added

- **RPi Facts Carousel** layout (`rpi-facts-carousel`): Pi 3 / weak-GPU friendly facts view — solid tinted background (no CSS blur), sharp cover art beside the progress strip, throttled progress updates, fact text + time remaining. Select it in Admin for Chromium kiosk displays.

## [1.9.3] - 2026-07-28

### Added

- **Facts cache import/export in Admin → AI Facts**: upload a pre-generated `facts-cache.json`, merge or replace, and optionally **reset timestamps** so TTL does not re-generate imported tracks immediately. Export downloads the live cache. AI generation still appends missing tracks to the same file. Cached facts are served without requiring an API key.

## [1.9.2] - 2026-07-28

### Fixed

- **Facts split on song titles**: Near-JSON responses with unescaped quotes around track names (e.g. `"The track "Come Together" was…"`) no longer explode into extra fragments (5 facts → 9). Replaced naive “every quoted substring” extraction with a top-level array scanner that only ends an element at `",` / `"]` / next-element `"`. Caps output to configured `factsCount`.

## [1.9.1] - 2026-07-28

### Fixed

- **Facts parsing reliability**: Much more tolerant JSON parsing for LLM responses — handles truncated arrays, smart quotes, missing commas, markdown fences, multi-array line formats, thinking-model `reasoning` fields (DeepSeek / OpenRouter), and non-JSON bracketed lines. Addresses intermittent empty-facts / black-screen issues (upstream #14).
- **Token limit for non-English facts**: Default max completion tokens raised from hardcoded `1024` to `4096`, and exposed as configurable **Max Tokens** in Admin → Facts → Advanced Settings (upstream #16).
- **Local LLM without API key**: `POST /api/facts` no longer requires an API key when provider is `local` (test endpoint already allowed this).
- **Empty-facts client handling**: Server returns `502` with a clear error for empty generations; client no longer assigns `undefined` to the facts list.

### Changed

- **Facts cache TTL**: Default extended from 72 hours to **30 days** (override with `FACTS_CACHE_TTL_HOURS`; `0` = never expire). Reduces slow re-generation of the same tracks.
- **Concurrent request coalescing**: Multiple displays/zones requesting facts for the same track share one in-flight LLM call.
- **LLM request timeout**: 60s timeout on OpenRouter / local fetch calls so hung requests cannot block the UI forever.
- **Faster track debounce**: Client facts fetch debounce reduced from 500ms to 300ms.
- Debounced disk writes for the facts cache to avoid blocking when caching many tracks.

## [1.9.0] - 2026-06-17

### Added

- **Server-authoritative per-screen config**: Each display's settings (layout, font, background, zone, font/artwork scale, enabled layouts) are stored per device on the server and pushed to the display on connect, so configuration persists across reloads and stays consistent across reconnects. Includes a remote "reset" that clears a screen and reloads it.
- **Resolution-aware fluid typography**: The type scale now scales continuously with the display (`clamp` + container-query units) instead of capping around 1400px, so text stays correctly proportioned from tablets up to 1080p and 4K. Composes with artwork scaling and adaptive contrast.
- **GPT-5 family** support for AI facts (`gpt-5`, `gpt-5-mini`, `gpt-5-nano`); the OpenAI provider now uses `max_completion_tokens` (required by GPT-5 / o-series models).
- **Visual approval matrix**: `pnpm test:e2e:matrix` renders every layout × background at the approved review resolutions (iPad-landscape, TV-1080p, TV-4K); `pnpm run review:gallery` (interactive flag-for-review gallery) and `pnpm run review:pack` (contact sheets). A "Visual Approval Matrix" GitHub Actions workflow uploads them as artifacts on every PR.

### Changed

- **Refreshed LLM models**: Anthropic IDs updated to the current generation (`claude-haiku-4-5` default, `claude-sonnet-4-6`, `claude-opus-4-8`); refreshed OpenAI and OpenRouter options. The retired `claude-sonnet-4-20250514` default was removed.
- **Facts Carousel** redesigned: the rotating fact is now large type directly on the blurred background (no small card) with a compact now-playing chip, sized for legibility on TVs.
- **Basic layout** album artwork now scales with the viewport on large displays (previously capped at ~500px), while still honoring the per-screen artwork-scale override.

### Fixed

- Reconnecting displays no longer lose their saved settings (stored config was overwritten before it could be re-applied), and admin connections no longer overwrite a display's stored settings.
- Server runtime state in `DATA_DIR` (including `roonstate.json` pairing tokens) is no longer tracked in git; `*.example.json` templates are provided instead.
- Removed a dead poll on the per-screen config page that spammed `404`s for offline screens.

## [1.8.0] - 2026-04-07

### Added

- **Artwork Scale Control**: New global slider (50–100%) in admin Display Settings to control album cover size across layouts. Applies to Detailed, Ambient, Basic, Cover, and Facts Columns layouts. Layouts using artwork as a full-screen background (Fullscreen, Minimal, Facts Overlay, Facts Carousel) are not affected.

- **Per-Screen Overrides in Admin Panel**: Font Scale and Artwork Scale override sliders directly on each screen card in the main admin view. Check the box to override the global setting for that screen.

- **Layout Cycling Control**: Per-screen configuration to select which layouts participate in tap-to-cycle. Available on the per-screen config page (`/admin/screen/:name`).

- **Per-Screen Artwork Scale Override**: Override the global artwork scale on individual screens from the per-screen config page.

### Fixed

- **iPad Portrait Layout**: Ambient and Facts Columns layouts no longer show side-by-side mode on iPads in portrait. Added `min-aspect-ratio: 1/1` guard to all `min-width` media queries so landscape-only layouts are never triggered on tall viewports.

- **Artwork Centering**: Album artwork now resizes from the center (not top-left or top-center) when the artwork scale is adjusted.

- **Artwork Scale in Landscape**: The artwork scale slider now works in both portrait and landscape orientations. Previously, landscape media queries overrode the scale with fixed values.

- **Basic Layout Portrait Space**: Removed fixed `max-width: 400px` constraint that prevented artwork from using available space on iPad portrait. Layout now uses `--artwork-scale` for responsive sizing.

### Changed

- Runtime config files (`packages/server/config/`) are now gitignored to avoid tracking environment-specific state.

## [1.7.3] - 2026-03-28

### Fixed

- **DetailedLayout tablet portrait**: Use stacked layout for tablets in portrait mode
- **Adaptive text contrast**: Use WCAG contrast ratios for text readability on colored backgrounds
- **Admin panel**: Fix duplicate screens appearing in client list

## [1.7.1] - 2026-02-10

### Fixed

- **Roon pairing now persists across Docker container restarts**. Previously, `node-roon-api` wrote its auth tokens to `config.json` in the working directory (`/app/config.json`), which fell outside the mounted `/app/config/` volume. Added custom `set_persisted_state`/`get_persisted_state` callbacks to redirect Roon state into `./config/roonstate.json`, inside the Docker volume.

- **Client friendly names now persist in Docker**. Changed `clientNames.ts` default `DATA_DIR` from `'.'` to `'./config'` so `client-names.json` lands inside the mounted volume alongside other config files.

- **Roon extension display version** updated from `1.5.1` to `1.7.1` (was stale).

## [1.7.0] - 2026-02-09

### Added

- **Self-Service Welcome Screen**: New displays show a clean welcome screen with their auto-generated friendly name and a QR code linking to their config page. Replaces the Roon-specific "Waiting for Roon Core..." message.

- **Auto-Generated Friendly Names**: Screens automatically receive a memorable name on first connect (e.g., `gentle-fox-17`, `calm-falcon-3`). Names are persisted across reconnects. Admins can rename anytime.

- **Per-Screen Config Page** (`/admin/screen/:name`): A focused, mobile-friendly page for configuring a single display. Scan the QR code from your phone to land directly on the right screen's settings — zone, layout, font, and background.

- **Roon Optional Mode** (contributed by @leolobato): Set `ROON_ENABLED=false` to run without Roon entirely. The app runs in external-sources-only mode — no Roon discovery, no "Waiting for Roon" screen. Includes:
  - `RoonClient` is nullable throughout the server
  - `roon_enabled` flag sent to clients via WebSocket
  - Admin panel shows "Connected (External only)" status
  - Docker Compose files updated with commented `ROON_ENABLED` option

- **Screen Lookup API**: New `GET /api/admin/screens/:friendlyName` endpoint to resolve a screen by its friendly name.

- **Name Validation**: Friendly name uniqueness check and 50-character length limit on rename.

### Changed

- Welcome screen now works for all users (Roon, API-only, or no sources yet)
- Admin panel connection label is Roon-aware ("Connected", "Waiting for Roon", or "Connected (External only)")
- Updated README with new onboarding flow, Roon-optional docs, and updated project structure

## [1.6.0] - 2026-02-02

### Added

- **Configurable Typography**: All layouts now have CSS custom properties for font sizes and line heights at the top of their style sections. This makes it easy to adjust typography without hunting through CSS rules.
  - Variables include: `--font-title`, `--font-artist`, `--font-fact`, `--line-height-title`, etc.
  - Each layout has a clearly marked "TYPOGRAPHY CONFIGURATION" block

- **E2E Visual Testing**: Added Playwright-based end-to-end testing for layout validation
  - Screenshot capture tests for all 9 layouts across multiple viewports
  - Layout constraint tests to verify facts column alignment
  - Smoke tests to catch rendering errors
  - Configured viewports: TV 1080p, TV 4K, iPad, Android tablet, various monitors

### Changed

- **Improved Font Scaling**: Increased `clamp()` max values for better readability on 4K displays
- **Tighter Line Heights**: Reduced line spacing for more compact text on smaller viewports (1080p, iPad)
- **Facts Column Alignment**: Fixed vertical alignment issues where facts column extended below artwork

### Layouts Updated

- FactsColumnsLayout
- AmbientLayout
- MinimalLayout
- DetailedLayout
- FactsOverlayLayout
- FactsCarouselLayout

## [1.5.1] - Previous Release

See git history for earlier changes.
