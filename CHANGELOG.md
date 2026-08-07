# Changelog

All notable changes to this project will be documented in this file.

## [2.0.41] - 2026-08-07

### Changed

- **Backgrounds:** only **Black**, **Grainy Blur**, and **Radial Gradient** (flat list, no categories). Default is Grainy Blur.
- **Grainy Blur:** blur radius +20% (64px → 77px) so cover is less recognizable.
- **Ambient + Radial Gradient:** uses the same vibrant radial field as other layouts (no Ambient-only offset).

## [2.0.40] - 2026-08-07

### Fixed

- **Pale covers only:** if average cover luminance ≥ 0.58, slightly dim the blur (`brightness(0.72)`) and use a stronger scrim. All other art keeps the exact 2.0.39 filters and scrim (no color pipeline changes).

## [2.0.39] - 2026-08-06

### Fixed

- **CI:** restore exact Docker workflow from last green publish (v2.0.34). No matrix, no concurrency pile-up. App still blur ambient (2.0.35).

## [2.0.38] - 2026-08-06

### Fixed

- **CI:** restore simple single-job multi-arch Docker publish (proven for 2.0.34); global concurrency group so only one publish runs. App unchanged from blur-ambient 2.0.35.

## [2.0.37] - 2026-08-06

### Fixed

- **CI Docker publish:** multi-arch via separate amd64/arm64 jobs + manifest merge (fixes hosted-runner “not acquired” timeouts). Same app as 2.0.35/2.0.36 (blur ambient).

## [2.0.36] - 2026-08-06

### Changed

- Same as 2.0.35 (blur ambient + safe chrome). Re-release after GHCR publish failures (hosted runners not acquired) and `latest` tag fix for version tags.

### Fixed

- **CI:** Docker workflow tags `latest` on version tags; concurrency + buildx v6; cancel stuck publishes.

## [2.0.35] - 2026-08-06

### Changed

- **Apple/Plexamp ambient:** Simple Gradient (default) is now a **blurred album-art field** + dark scrim, not a synthetic solid HSL wash. The room always matches the cover.
- **Safe chrome:** Progress/dots use pre-blurred mid-tone sampling only; near-black/near-white ignored; low-chroma art gets neutral grey chrome (no gold/red invention). Soft accents only when chroma is real.

## [2.0.34] - 2026-08-06

### Fixed

- **Album ambient colors (critical):** stop crushing vivid art into brown mud. Extraction now finds the vivid hue peak (e.g. red fire on Katatonia) and builds an Apple/Plexamp-style dark field with **high saturation + low lightness**. True B&W covers stay pure greys (no warm beige). Removed Color Thief dependency.

## [2.0.33] - 2026-08-06

### Changed

- **Album color extraction overhaul:** multi-strategy palette (canvas median-cut + chromatic-peak + residual warm/cool cast + Color Thief merge). Removed seeded random accent fallbacks; dark/B&W rock covers keep image-derived cast or honest neutrals. Sparse logos on black art now drive status-bar / progress / field tint. Blue ban removed; sample size and hue buckets increased for better dominant extraction across layouts.

## [2.0.32] - 2026-08-04

### Changed

- **Progress / status track:** inactive bar background is more opaque and slightly lighter so it stands out from album-colored page washes (RPi, Ambient, and shared ProgressBar).

## [2.0.31] - 2026-08-04

### Fixed

- **Facts JSON shatter:** unescaped mid-fact quotes (e.g. album title *Ecstasy in the Shadow of Ecstasy*) no longer split one fact across the next; rejoin + odd-quote scanner heuristics close/repair fragments.
- **Facts reasoning leak:** chain-of-thought / prompt restatements (common on Various Artists / compilation metadata failures) are filtered out instead of shown as facts; default prompt tells the model to admit missing artist context instead of dumping planning notes.
- **Progress track:** removed dark inset `box-shadow` and black-leading sheen on progress bars so the inactive track stays homogeneous on warm/colored backgrounds (RPi status bar and shared ProgressBar).

## [2.0.30] - 2026-08-03

### Fixed

- **Defaults:** new/unset displays use RPi Facts Carousel + Simple Gradient (websocket and client metadata no longer fall back to black).

## [2.0.29] - 2026-08-02

### Added

- **Display keyboard controls:** ArrowDown/Up cycles backgrounds; ArrowLeft/Right cycles zones; click still cycles layouts.

## [2.0.28] - 2026-08-02

### Fixed

- **Ambient:** progress bar, times, zone, and equalizer always use light chrome to match title/artist/album (no black flip on pale covers).

## [2.0.27] - 2026-08-02

### Changed

- **Backgrounds trimmed:** Basic: Black, Dominant Color. Gradients: Simple Gradient (RPi album radial, default), Radial, Linear, Corner. Artwork (renamed from Textured): Grainy Blur only. Removed White and all other artwork/textured options.
- **All layouts** (RPi Facts Carousel, Ambient, Cover, Fullscreen) respect the selected display background; Simple Gradient uses the former RPi-only album field.

## [2.0.26] - 2026-08-02

### Fixed

- **Admin access gate:** Safari/iOS still treated the field as a password despite `autocomplete=off`. Gate no longer uses `<form>` or `type="password"`; masked `type="text"` (`-webkit-text-security: disc`) so Keychain autofill and “Save Password” stay off. (Re-release after cancelling stuck 2.0.25 Docker builds.)

## [2.0.25] - 2026-08-02

### Fixed

- Same admin-gate fix as 2.0.26 (Docker publish for 2.0.25 was cancelled mid-build).

## [2.0.24] - 2026-08-02

### Changed

- **Layouts:** removed Detailed. Order: RPi Facts Carousel (default), Ambient, Cover, Fullscreen.
- **Admin login:** suppress browser password autofill / save prompts (iOS Keychain, Safari Save Password).
- **Ambient:** progress bar fill matches surrounding text (white/black) — no album-hue tint; sheen and smooth progress kept.

## [2.0.23] - 2026-08-02

### Changed

- **RPi Facts Carousel:** more air between fact text and indicator dots (viewport-scaled gap).

## [2.0.22] - 2026-08-02

### Changed

- **RPi Facts Carousel:** long facts use larger type again (milder length bands; higher thresholds). Typical AI quotes stay mid/long instead of shrinking to xlong.

## [2.0.21] - 2026-08-02

### Changed

- **RPi Facts Carousel (TV / 10-foot):** rebalanced for large OLED panels (e.g. LG C1).
  - Length-aware fact type (short / mid / long / xlong) so long AI quotes fit fully; short ones stay grand.
  - Fact size uses width + height (`cqi`/`cqb`) with lower ceilings so text doesn’t dominate the wall.
  - Wider quote column for long Hungarian facts; dock cover + title/meta scale up on large viewports.
  - Tighter vertical rhythm (less empty void under facts); progress bar readable from the sofa.

## [2.0.20] - 2026-08-02

### Changed

- **RPi Facts Carousel:** fact indicator dots ~2px smaller.

## [2.0.19] - 2026-08-02

### Changed

- **RPi Facts Carousel:** thinner progress bar (~2–3px less height) for a finer status strip.

## [2.0.18] - 2026-08-02

### Changed

- **RPi Facts Carousel:** cover thumbnail shadow matches Cover layout (dark soft drop, scaled for the small art); removed outline/ring edge.

## [2.0.17] - 2026-08-02

### Changed

- **RPi Facts Carousel:** remove text drop shadows so fact and status-strip type match the other layouts (no halo).

## [2.0.16] - 2026-08-02

### Changed

- **Layouts kept:** detailed, fullscreen, ambient, cover, rpi-facts-carousel (default). Removed minimal, basic, facts-columns, facts-overlay, facts-carousel.

## [2.0.15] - 2026-08-02

### Added

- **Restored multi-layout set** (later trimmed; see Unreleased). Shared album theme and progress polish across layouts.
- **Shared album theme** (`useAlbumTheme`): Color Thief single-hue chrome (title/artist/meta/facts, progress track/fill, dots) applied across layouts.
- **Progress bar polish** on shared `ProgressBar` and layout strips: `scaleX` fill, soft sheen, paused breath pulse (same as RPi Facts Carousel).

### Changed

- Admin / screen config layout pickers list available layouts with readable display names.

## [2.0.14] - 2026-08-01

### Added

- **Facts Cache stats (last 24h):** Admin → AI Facts shows cache serves vs AI generations (counts + %), plus total requests and current entry count. Rolling window persisted in `facts-serve-stats.json`.

## [2.0.13] - 2026-08-01

### Fixed

- **Fact rotation interval:** display clients now load timing from public `GET /api/facts/display-settings` instead of admin-only `/api/facts/config` (which returned 401 when admin password was set, so every screen silently used the 25s default). Interval updates also re-arm the active timer.

## [2.0.12] - 2026-08-01

### Added

- **Paused progress breath:** subtle opacity pulse on the progress fill while paused (slow ease-in-out; respects `prefers-reduced-motion`).

## [2.0.11] - 2026-08-01

### Changed

- **Progress bar:** even subtler leading-edge sheen (tip brightness matches former ~75% stop).

## [2.0.10] - 2026-08-01

### Changed

- **Progress bar:** reverse sheen direction — subtler dark at the start, soft light at the leading edge (playhead).

## [2.0.9] - 2026-08-01

### Changed

- **Progress bar:** softer gradient sheen (less bright lead edge) and lighter glow.

## [2.0.8] - 2026-08-01

### Added

- **Source + quality** on the now-playing meta row: e.g. `Mojo 2 · Tidal · 96kHz / 24-bit` or `… · FLAC · 192kHz / 24-bit` (from Roon when available; optional on External Sources API).
- Soft **gradient sheen** on the progress bar fill (album-tinted accent, still Pi-friendly `scaleX`).

## [2.0.7] - 2026-08-01

### Changed

- **Roon extension:** `display_version` **1.9.0 → 2.0.0**; publisher/website aligned with this fork; user-facing **Roon Screen Cover** labels renamed to **Roon Now Playing** (page title, server fallback page, docs). Internal npm package names (`@roon-screen-cover/*`) and localStorage keys unchanged for compatibility.

## [2.0.6] - 2026-08-01

### Fixed

- **Admin login:** Sign in button now uses the same amber primary styling as the rest of the admin panel (login gate sits outside `.admin-shell`, so accent CSS variables were missing).

## [2.0.5] - 2026-08-01

### Changed

- **RPi Facts Carousel:** lighter, more chromatic album background wash (higher L + S on the radial gradient) so the room color resonates with cover art instead of reading as near-black.

## [2.0.4] - 2026-08-01

### Added

- **Admin password protection** (optional): set a password under Display → Admin password. When enabled, `/admin` requires login; now-playing display and external source push (Plex) stay open. Password is stored hashed (`scrypt`); sessions use a Bearer token (7-day).

## [2.0.3] - 2026-08-01

### Changed

- **RPi Facts Carousel:** stronger album tint on fact quote and strip text (title/artist/meta) so type reflects cover temperature more clearly; progress bar and active dots unchanged as the bolder accent.

## [2.0.2] - 2026-08-01

### Changed

- **RPi Facts Carousel color system:** single album hue staged by role (dark wash background, soft tinted facts, near-white strip ladder, muted progress accent). Avoids dual fighting tints (e.g. cream quote + purple dock), stays non-neon with sat/lightness caps, less dull than Muted-on-all-text.

## [2.0.1] - 2026-07-30

### Changed

- **RPi Facts Carousel:** stable fact quote column (`width: min(68cqi, 34em)`) instead of content shrink-wrap, so short and long facts share the same optical frame (~68% of screen on TV). Status strip still full safe-zone width (~88%).
- Added optional **`scripts/plex-to-now-playing.sh`** (+ systemd unit) to push Plex music sessions into the External Sources API.

## [2.0.0] - 2026-07-30

### Changed

- **Major fork release** for Umbrel / always-on displays.
- **Single layout:** `rpi-facts-carousel` only (other layouts removed).
- **Color Thief** album theming: Muted for progress/dots/strip text, LightMuted for fact quotes; soft fallbacks only when extraction fails.
- **Pi-friendly UI:** no full-screen CSS blur, smooth progress (`scaleX`), sequential fact fades, subtitle-style text shadows.
- **Facts cache** import/export in Admin, longer cache TTL, robust fact JSON parsing, configurable max tokens.
- Multi-arch Docker images (`linux/amd64` + `linux/arm64`).

Future patches: **2.0.2**, **2.0.3**, …

## [1.9.23] - 2026-07-30

### Notes

- Keep multi-arch Docker builds (`linux/amd64` + `linux/arm64`) as upstream CI.

## [1.9.22] - 2026-07-30

### Changed

- **RPi Facts Carousel**: Color Thief roles — **Muted** for progress bar, dots, and strip text; **LightMuted** for hero fact quotes. White only when those swatches are unavailable.

## [1.9.21] - 2026-07-30

### Fixed

- **RPi Facts Carousel**: white progress bar on every track. Color Thief **Muted** is intentionally low-chroma; we treated `s < 14` as "use pure white". Now Muted/DarkMuted hues are kept (softened for OLED) and white is not forced.

## [1.9.20] - 2026-07-30

### Changed

- **RPi Facts Carousel**: progress accents use Color Thief **Muted / DarkMuted only** for every album; soft seeded fallback only when those swatches are missing or extraction fails.

## [1.9.19] - 2026-07-30

### Changed

- **RPi Facts Carousel**: always trust Color Thief when art loads (including B&W via Muted/DarkMuted). Soft seeded palette only if there is no image or extraction fails.

## [1.9.18] - 2026-07-30

### Changed

- **RPi Facts Carousel**: album accent/background extraction now uses **Color Thief v3** (OKLCH quantization + semantic Muted/DarkVibrant/Vibrant swatches) instead of the custom hue-bucket sampler. Mute/neon caps and soft fallbacks unchanged.

## [1.9.17] - 2026-07-30

### Fixed

- **Build**: fix TypeScript `never` on layout display name after reducing LAYOUTS to a single entry.

## [1.9.16] - 2026-07-30

### Changed

- **Layouts**: this fork now ships only `rpi-facts-carousel` (other layouts removed). Default layout updated everywhere.

## [1.9.15] - 2026-07-30

### Changed

- **RPi Facts Carousel**: replace cool-blue fallback/neutral accents with fact-text white (`#f2f2f2`); keep other soft palette colors (stone, sage, rose, etc.).

## [1.9.14] - 2026-07-30

### Changed

- **RPi Facts Carousel**: subtler cover art corner radius (less rounded).

## [1.9.13] - 2026-07-30

### Changed

- **RPi Facts Carousel**: clamp album-derived progress/dot accents (max sat ~32%, max lightness ~50%) so vivid covers cannot produce neon bars (e.g. `#4aceb3`).

## [1.9.12] - 2026-07-30

### Changed

- **RPi Facts Carousel**: lighter subtitle-style shadow on title, artist, zone, time, and related strip text (full stack remains on hero facts).

## [1.9.11] - 2026-07-30

### Changed

- **RPi Facts Carousel**: subtitle-style fact text shadow stack (crisp edge + soft halo) for better OLED/TV legibility; still no CSS `filter`.

## [1.9.10] - 2026-07-28

### Changed

- **RPi Facts Carousel**: soft seeded fallback palette is used for **both** hard failures (no/failed art load) **and** neutral B&W samples — same per-track variety (stone/sage/slate gray/etc.). Chromatic album-art themes still use real extracted hues.

## [1.9.9] - 2026-07-28

### Fixed

- **RPi Facts Carousel**: dark / B&W covers no longer map to `#6d87ba` blue. Sampling was succeeding, but low-sat art was assigned hue 220 and then sat-boosted with `max(s, 40)`. Neutrals now stay gray; chromatic accents prefer the most saturated palette swatch (so dark reds can win). CSS default progress fill no longer blue.

## [1.9.8] - 2026-07-28

### Changed

- **RPi Facts Carousel**: softer, low-saturation fallback accents (warm stone / sage / slate gray, etc.) seeded per track when art sampling fails — no more loud default blue. Successful album-art color extraction unchanged.

## [1.9.7] - 2026-07-28

### Changed

- **RPi Facts Carousel**: sequential fact transitions — old fact fully fades out, then the new fact fades in (no dual-text overlap). Dots ease with the same timing.

## [1.9.6] - 2026-07-28

### Changed

- **RPi Facts Carousel**: smooth progress bar via `transform: scaleX` + short linear CSS transition (no more stepped pixel jumps from throttled width updates).

## [1.9.5] - 2026-07-28

### Changed

- **RPi Facts Carousel**: album-linked dark radial background (hue-bucket dominant + secondary palette) instead of flat RGB average; progress bar, dots, zone, and time use the same palette accents with WCAG-oriented contrast against the dark field. Still no CSS blur. Classic `facts-carousel` unchanged.

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
