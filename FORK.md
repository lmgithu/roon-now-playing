# LMGT fork notes

This is a fork of [arthursoares/roon-now-playing](https://github.com/arthursoares/roon-now-playing) with reliability and performance fixes for AI “interesting facts” generation (especially OpenRouter / DeepSeek and non-English prompts).

## What changed (v1.9.1)

| Problem | Fix |
|--------|-----|
| Facts missing / black screen when model returns almost-JSON | Tolerant parser (truncated arrays, smart quotes, missing commas, fences, reasoning fields) |
| OpenRouter length rejects / truncated Hungarian facts | Default `max_tokens` **1024 → 4096**, configurable in Admin → Facts → Advanced |
| Cache expired every 72h → slow re-generation | Default cache TTL **30 days** (`FACTS_CACHE_TTL_HOURS`, `0` = never) |
| Multi-zone hammered the LLM | In-flight request coalescing per track |
| Local provider blocked without API key on live endpoint | Local works without a key |
| Hung OpenRouter requests | 60s fetch timeout |

## Docker image

Image (after GitHub Actions has built it):

```text
ghcr.io/lmgithu/roon-now-playing:1.9.1
ghcr.io/lmgithu/roon-now-playing:latest
```

### First-time: enable Actions on this fork

GitHub disables workflows on new forks until you opt in:

1. Open https://github.com/lmgithu/roon-now-playing/actions  
2. Click **I understand my workflows, go ahead and enable them**  
3. Push any commit to `main` (or re-run) so **Docker Build and Publish** runs  
4. Confirm the package appears at https://github.com/lmgithu/roon-now-playing/pkgs/container/roon-now-playing  

If packages stay private, set package visibility to **Public** (or log Umbrel into GHCR).

## Umbrel packaging

See [lmgithu/lmgt-app-store](https://github.com/lmgithu/lmgt-app-store) → `lmgt-roon-now-playing`.

- **No `app_proxy`** — open `http://<umbrel-ip>:3000` (admin at `/admin/`)  
- Image pin: `ghcr.io/lmgithu/roon-now-playing:1.9.1`  
- Optional env: `FACTS_CACHE_TTL_HOURS=720` (already set in compose)

## Admin tips for your setup

1. Provider: **OpenRouter**, model e.g. `deepseek/deepseek-v4-flash`  
2. Advanced → **Max Tokens**: try `4096`–`8192` for Hungarian prompts  
3. Keep a long-lived cache if you pre-generate: set `FACTS_CACHE_TTL_HOURS=0`  
4. Place pre-built `facts-cache.json` in the app config volume (`…/config/facts-cache.json`)

## Security

Do not commit OpenRouter/OpenAI keys. Prefer env vars or the Admin UI. If a key was ever hardcoded in a helper script, **rotate it**.

## Docker platforms

CI builds **linux/amd64 only** (Umbrel Home / Intel N100 class). No arm64/QEMU.
