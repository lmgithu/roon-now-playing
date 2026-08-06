#!/usr/bin/env bash
# tidal-to-now-playing.sh — Push Tidal now-playing to Roon Now Playing
#
# TIDAL has no public "currently playing" API (unlike Plex/Spotify).
# Last.fm scrobbling is too slow for a live display. Use one of these instead:
#
#   MODE=hifi   (recommended for speed)
#     Poll Tidal Hi-Fi's local REST API (~1s). You play Tidal in Tidal Hi-Fi
#     on a machine the Pi can reach (same PC, or another host on your LAN).
#     App: https://github.com/Mastermindzh/tidal-hifi
#     Enable the API in Tidal Hi-Fi settings (default http://127.0.0.1:47836).
#
#   MODE=push
#     Do not poll. Expose a tiny helper you (or Tasker / Shortcuts) call the
#     moment a track starts — see tidal-push-now-playing.sh.
#
#   MODE=lastfm
#     Slow fallback via Last.fm nowplaying (kept only as a last resort).
#
# Requirements: bash, curl, jq
#
# Also consider: play Tidal *through Roon* — then this script is unnecessary;
# Roon Now Playing already sees the Roon zone natively.

set -euo pipefail

# =============================================================================
# CONFIG
# =============================================================================
MODE="${MODE:-hifi}"   # hifi | lastfm  (use tidal-push-now-playing.sh for push)

# --- Roon Now Playing display ---
DISPLAY_URL="${DISPLAY_URL:-http://192.168.1.60:3000}"
ZONE_ID="${ZONE_ID:-tidal}"
ZONE_NAME="${ZONE_NAME:-Tidal}"
POLL_INTERVAL="${POLL_INTERVAL:-1}"
API_KEY="${API_KEY:-}"

# --- MODE=hifi (Tidal Hi-Fi local API) ---
# If Tidal Hi-Fi runs on another machine, use that host's IP (open firewall if needed).
HIFI_URL="${HIFI_URL:-http://127.0.0.1:47836}"

# --- MODE=lastfm (slow; not recommended for live TV) ---
LASTFM_USER="${LASTFM_USER:-}"
LASTFM_API_KEY="${LASTFM_API_KEY:-}"
# =============================================================================

DISPLAY_URL="${DISPLAY_URL%/}"
HIFI_URL="${HIFI_URL%/}"
API_ENDPOINT="${DISPLAY_URL}/api/sources/${ZONE_ID}/now-playing"

last_fingerprint=""
was_playing=0
last_push_ts=0
FORCE_PUSH_EVERY=15

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }
die() { log "error: $*"; exit 1; }

command -v curl >/dev/null || die "curl is required"
command -v jq >/dev/null || die "jq is required"

case "$MODE" in
  hifi|lastfm) ;;
  push)
    die "MODE=push is handled by tidal-push-now-playing.sh (one-shot). For a listener use MODE=hifi"
    ;;
  *) die "unknown MODE=$MODE (use hifi or lastfm)" ;;
esac

if [[ "$MODE" == "lastfm" ]]; then
  [[ -n "$LASTFM_USER" && -n "$LASTFM_API_KEY" ]] || die "lastfm mode needs LASTFM_USER and LASTFM_API_KEY"
fi

api_headers() {
  local -a h=(-H "Content-Type: application/json")
  [[ -n "$API_KEY" ]] && h+=(-H "X-API-Key: ${API_KEY}")
  printf '%s\0' "${h[@]}"
}

push_now_playing() {
  local json="$1"
  local -a headers=() arg
  while IFS= read -r -d '' arg; do headers+=("$arg"); done < <(api_headers)

  local http
  http=$(curl -sS -o /tmp/tidal-np-response.json -w "%{http_code}" \
    -X POST "$API_ENDPOINT" \
    "${headers[@]}" \
    -d "$json") || { log "push failed (curl)"; return 1; }

  if [[ "$http" != "200" && "$http" != "201" ]]; then
    log "push HTTP $http: $(cat /tmp/tidal-np-response.json 2>/dev/null || true)"
    return 1
  fi
}

push_stopped() {
  local json
  json=$(jq -n --arg zone_name "$ZONE_NAME" '{zone_name: $zone_name, state: "stopped"}')
  push_now_playing "$json" || true
  last_fingerprint="stopped"
  was_playing=0
  log "stopped → ${ZONE_ID}"
}

fingerprint_meta() {
  jq -c '{state, title, artist, album, duration_seconds, artwork_url}' <<<"$1"
}

# ---------- Tidal Hi-Fi ----------
# Docs surface: GET $HIFI_URL/current  (also /current/image for artwork blob)
fetch_hifi_current() {
  curl -sS --max-time 3 "${HIFI_URL}/current"
}

# Map various field names Tidal Hi-Fi has used across versions
hifi_to_payload() {
  local raw="$1"
  jq -n --arg zone_name "$ZONE_NAME" --argjson raw "$raw" '
    ($raw) as $c
    | (
        ($c.status // $c.playback // $c.state // "")
        | ascii_downcase
      ) as $st
    | (
        if ($st | test("play")) then "playing"
        elif ($st | test("pause")) then "paused"
        elif ($st | test("not|stop|idle|none") or $st == "") then
          # some builds omit status while still sending title
          if (($c.title // "") | length) > 0 then "playing" else "stopped" end
        else "playing"
        end
      ) as $state
    | (
        $c.title // $c.name // ""
      ) as $title
    | (
        $c.artists // $c.artist // $c.artistName // ""
        | if type == "array" then join(", ") else . end
      ) as $artist
    | (
        $c.album // $c.albumName // ""
      ) as $album
    | (
        # duration / position: seconds or ms
        def sec:
          if . == null or . == "" then 0
          else (.|tonumber) as $n | if $n > 10000 then ($n/1000|floor) else ($n|floor) end
          end;
        ($c.duration // $c.durationSeconds // 0 | sec)
      ) as $dur
    | (
        ($c.current // $c.currentSeconds // $c.position // $c.progress // 0
          | if . == null or . == "" then 0
            else (.|tonumber) as $n | if $n > 10000 then ($n/1000|floor) else ($n|floor) end
            end)
      ) as $seek
    | (
        $c.image // $c.imageUrl // $c.cover // $c.art // ""
      ) as $art
    | if $state == "stopped" or ($title|length) == 0 then
        {zone_name: $zone_name, state: "stopped"}
      else
        {
          zone_name: $zone_name,
          state: $state,
          title: $title,
          artist: $artist,
          album: $album
        }
        + (if $dur > 0 then {duration_seconds: $dur} else {} end)
        + (if $state == "playing" or $state == "paused" then {seek_position: $seek} else {} end)
        + (if ($art|tostring|length) > 0 and ($art|tostring|startswith("http"))
            then {artwork_url: ($art|tostring)} else {} end)
      end
  '
}

# ---------- Last.fm (slow fallback) ----------
fetch_lastfm() {
  curl -sS --max-time 8 -G "https://ws.audioscrobbler.com/2.0/" \
    --data-urlencode "method=user.getrecenttracks" \
    --data-urlencode "user=${LASTFM_USER}" \
    --data-urlencode "api_key=${LASTFM_API_KEY}" \
    --data-urlencode "format=json" \
    --data-urlencode "limit=1" \
    --data-urlencode "extended=1"
}

lastfm_to_payload() {
  local recent="$1"
  local track
  track=$(jq -c '
    .recenttracks.track
    | if type == "array" then .[0] else . end
    | select(. != null)
    | select(."@attr".nowplaying == "true")
  ' <<<"$recent" 2>/dev/null || true)

  if [[ -z "$track" || "$track" == "null" ]]; then
    jq -n --arg zone_name "$ZONE_NAME" '{zone_name: $zone_name, state: "stopped"}'
    return
  fi

  jq -n --arg zone_name "$ZONE_NAME" --argjson t "$track" '
    {
      zone_name: $zone_name,
      state: "playing",
      title: ($t.name // ""),
      artist: (
        if ($t.artist|type) == "object" then ($t.artist.name // $t.artist."#text" // "")
        else ($t.artist // "") end
      ),
      album: (
        if ($t.album|type) == "object" then ($t.album."#text" // $t.album.name // "")
        else ($t.album // "") end
      )
    }
    + (
      (($t.image // []) | reverse | map(."#text" // empty) | map(select(length>0)) | .[0] // "") as $art
      | if $art != "" then {artwork_url: $art} else {} end
    )
  '
}

cleanup() {
  if [[ "$was_playing" -eq 1 ]]; then
    log "shutting down — sending stopped"
    push_stopped
  fi
}
trap cleanup EXIT INT TERM

log "mode=${MODE}"
log "Display → ${API_ENDPOINT}"
if [[ "$MODE" == "hifi" ]]; then
  log "Tidal Hi-Fi → ${HIFI_URL}/current  (poll ${POLL_INTERVAL}s)"
  log "tip: play music in Tidal Hi-Fi, not the stock Tidal app"
else
  log "Last.fm → ${LASTFM_USER} (slow scrobble path)"
fi

while true; do
  payload=""
  if [[ "$MODE" == "hifi" ]]; then
    raw=""
    if ! raw=$(fetch_hifi_current 2>/dev/null); then
      log "warn: cannot reach Tidal Hi-Fi at ${HIFI_URL}"
      sleep "$POLL_INTERVAL"
      continue
    fi
    # empty / non-json when idle on some versions
    if ! jq -e . >/dev/null 2>&1 <<<"$raw"; then
      if [[ "$was_playing" -eq 1 ]]; then push_stopped; fi
      sleep "$POLL_INTERVAL"
      continue
    fi
    payload=$(hifi_to_payload "$raw")
  else
    recent=""
    if ! recent=$(fetch_lastfm 2>/dev/null); then
      log "warn: Last.fm unreachable"
      sleep "$POLL_INTERVAL"
      continue
    fi
    payload=$(lastfm_to_payload "$recent")
  fi

  state=$(jq -r '.state // "stopped"' <<<"$payload")

  if [[ "$state" == "stopped" ]]; then
    if [[ "$was_playing" -eq 1 ]]; then push_stopped; fi
    sleep "$POLL_INTERVAL"
    continue
  fi

  meta_fp=$(fingerprint_meta "$payload")
  now=$(date +%s)
  force=0
  [[ $((now - last_push_ts)) -ge $FORCE_PUSH_EVERY ]] && force=1

  if [[ "$meta_fp" != "$last_fingerprint" || "$force" -eq 1 ]]; then
    title=$(jq -r '.title // "?"' <<<"$payload")
    artist=$(jq -r '.artist // "?"' <<<"$payload")
    seek=$(jq -r '.seek_position // empty' <<<"$payload")
    if push_now_playing "$payload"; then
      last_fingerprint="$meta_fp"
      last_push_ts=$now
      was_playing=1
      if [[ -n "$seek" ]]; then
        log "${state}: ${artist} — ${title} @ ${seek}s"
      else
        log "${state}: ${artist} — ${title}"
      fi
    fi
  fi

  sleep "$POLL_INTERVAL"
done
