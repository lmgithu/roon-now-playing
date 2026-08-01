#!/usr/bin/env bash
# plex-to-now-playing.sh — Poll Plex for music playback and push to Roon Now Playing
# External Sources API.
#
# Requirements: bash, curl, jq
#
# Run once:   ./plex-to-now-playing.sh
# Background: use the companion systemd unit (see scripts/plex-to-now-playing.service)
#
# Get a Plex token:
#   https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/

set -euo pipefail

# =============================================================================
# CONFIG — edit these for your LAN (env vars still override if set)
# =============================================================================
PLEX_URL="${PLEX_URL:-http://192.168.1.50:32400}"
PLEX_TOKEN="${PLEX_TOKEN:-PASTE_YOUR_PLEX_TOKEN_HERE}"
DISPLAY_URL="${DISPLAY_URL:-http://192.168.1.60:3000}"   # Roon Now Playing base URL

ZONE_ID="${ZONE_ID:-plex}"
ZONE_NAME="${ZONE_NAME:-Plex}"
POLL_INTERVAL="${POLL_INTERVAL:-2}"
API_KEY="${API_KEY:-}"            # only if external API key auth is enabled
PLEX_PLAYER="${PLEX_PLAYER:-}"    # optional: only sessions whose player title matches
PLEX_USER="${PLEX_USER:-}"        # optional: only this Plex username
# =============================================================================

if [[ "$PLEX_TOKEN" == "PASTE_YOUR_PLEX_TOKEN_HERE" || -z "$PLEX_TOKEN" ]]; then
  echo "error: set PLEX_TOKEN in the CONFIG block at the top of this script" >&2
  exit 1
fi

PLEX_URL="${PLEX_URL%/}"
DISPLAY_URL="${DISPLAY_URL%/}"
API_ENDPOINT="${DISPLAY_URL}/api/sources/${ZONE_ID}/now-playing"

# Last payload fingerprint — skip identical POSTs (except seek ticks while playing)
last_fingerprint=""
was_playing=0

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" >&2
}

die() {
  log "error: $*"
  exit 1
}

command -v curl >/dev/null || die "curl is required"
command -v jq >/dev/null || die "jq is required"

# Build optional curl header args for the display API
api_headers() {
  local -a h=(-H "Content-Type: application/json")
  if [[ -n "$API_KEY" ]]; then
    h+=(-H "X-API-Key: ${API_KEY}")
  fi
  printf '%s\0' "${h[@]}"
}

push_now_playing() {
  local json="$1"
  local -a headers=()
  local arg

  while IFS= read -r -d '' arg; do
    headers+=("$arg")
  done < <(api_headers)

  local http
  http=$(curl -sS -o /tmp/plex-np-response.json -w "%{http_code}" \
    -X POST "$API_ENDPOINT" \
    "${headers[@]}" \
    -d "$json") || {
    log "push failed (curl error)"
    return 1
  }

  if [[ "$http" != "200" && "$http" != "201" ]]; then
    log "push HTTP $http: $(cat /tmp/plex-np-response.json 2>/dev/null || true)"
    return 1
  fi
}

push_stopped() {
  local json
  json=$(jq -n \
    --arg zone_name "$ZONE_NAME" \
    '{zone_name: $zone_name, state: "stopped"}')
  push_now_playing "$json" || true
  last_fingerprint="stopped"
  was_playing=0
  log "stopped → ${ZONE_ID}"
}

# Fetch active sessions as JSON
fetch_sessions() {
  curl -sS --max-time 5 \
    -H "Accept: application/json" \
    "${PLEX_URL}/status/sessions?X-Plex-Token=${PLEX_TOKEN}"
}

# Pick the first music track session (optionally filtered by player/user)
# Prints a single JSON object or empty if none.
pick_music_session() {
  local sessions="$1"

  jq -c \
    --arg player "$PLEX_PLAYER" \
    --arg user "$PLEX_USER" '
    .MediaContainer.Metadata // []
    | map(select(.type == "track"))
    | if $player != "" then
        map(select((.Player.title // "") | test($player; "i")))
      else . end
    | if $user != "" then
        map(select((.User.title // "") | test($user; "i")))
      else . end
    | .[0] // empty
  ' <<<"$sessions"
}

# Map Plex Player.state → external API state
map_state() {
  case "${1:-}" in
    playing|buffering) echo "playing" ;;
    paused)            echo "paused" ;;
    *)                 echo "stopped" ;;
  esac
}

# Build artwork URL Plex can serve; prefer parent (album) thumb
artwork_url_for() {
  local session="$1"
  local thumb
  thumb=$(jq -r '.parentThumb // .thumb // .grandparentThumb // empty' <<<"$session")
  if [[ -z "$thumb" || "$thumb" == "null" ]]; then
    echo ""
    return
  fi
  # Absolute paths from Plex start with /; some are already full URLs
  if [[ "$thumb" == http* ]]; then
    if [[ "$thumb" == *"X-Plex-Token="* ]]; then
      printf '%s\n' "$thumb"
    else
      printf '%s%cX-Plex-Token=%s\n' "$thumb" \
        "$([[ "$thumb" == *\?* ]] && echo '&' || echo '?')" \
        "$PLEX_TOKEN"
    fi
    return
  fi
  # Transcode to a modest size the display can fetch
  local encoded
  encoded=$(jq -rn --arg t "$thumb" '$t|@uri')
  printf '%s/photo/:/transcode?width=800&height=800&minSize=1&upscale=1&url=%s&X-Plex-Token=%s\n' \
    "$PLEX_URL" "$encoded" "$PLEX_TOKEN"
}

session_to_payload() {
  local session="$1"
  local state duration_ms seek_ms duration_s seek_s artwork

  state=$(map_state "$(jq -r '.Player.state // empty' <<<"$session")")
  duration_ms=$(jq -r '.duration // 0' <<<"$session")
  seek_ms=$(jq -r '.viewOffset // 0' <<<"$session")
  duration_s=$(( duration_ms / 1000 ))
  seek_s=$(( seek_ms / 1000 ))
  artwork=$(artwork_url_for "$session")

  jq -n \
    --arg zone_name "$ZONE_NAME" \
    --arg state "$state" \
    --arg title "$(jq -r '.title // empty' <<<"$session")" \
    --arg artist "$(jq -r '.grandparentTitle // .originalTitle // empty' <<<"$session")" \
    --arg album "$(jq -r '.parentTitle // empty' <<<"$session")" \
    --argjson duration_seconds "$duration_s" \
    --argjson seek_position "$seek_s" \
    --arg artwork_url "$artwork" '
    {
      zone_name: $zone_name,
      state: $state,
      title: $title,
      artist: $artist,
      album: $album,
      duration_seconds: $duration_seconds,
      seek_position: $seek_position
    }
    + (if $artwork_url != "" then {artwork_url: $artwork_url} else {} end)
  '
}

# Fingerprint without seek so we don't spam on every second of progress alone —
# but we still push periodically while playing so the zone doesn't disconnect (60s TTL).
fingerprint_meta() {
  jq -c '{state, title, artist, album, duration_seconds, artwork_url}' <<<"$1"
}

cleanup() {
  if [[ "$was_playing" -eq 1 ]]; then
    log "shutting down — sending stopped"
    push_stopped
  fi
}
trap cleanup EXIT INT TERM

log "Plex  → ${PLEX_URL}"
log "Display → ${API_ENDPOINT}"
log "poll every ${POLL_INTERVAL}s (music tracks only)"
[[ -n "$PLEX_PLAYER" ]] && log "filter player ~ /${PLEX_PLAYER}/i"
[[ -n "$PLEX_USER" ]] && log "filter user ~ /${PLEX_USER}/i"

last_push_ts=0
FORCE_PUSH_EVERY=15  # keep zone alive while playing

while true; do
  sessions=""
  if ! sessions=$(fetch_sessions 2>/dev/null); then
    log "warn: could not reach Plex"
    sleep "$POLL_INTERVAL"
    continue
  fi

  # Empty MediaContainer (no sessions) is valid JSON with no Metadata
  session=$(pick_music_session "$sessions" || true)

  if [[ -z "$session" || "$session" == "null" ]]; then
    if [[ "$was_playing" -eq 1 ]]; then
      push_stopped
    fi
    sleep "$POLL_INTERVAL"
    continue
  fi

  payload=$(session_to_payload "$session")
  state=$(jq -r '.state' <<<"$payload")
  meta_fp=$(fingerprint_meta "$payload")
  now=$(date +%s)
  force=0
  if [[ "$state" == "playing" && $((now - last_push_ts)) -ge $FORCE_PUSH_EVERY ]]; then
    force=1
  fi

  if [[ "$meta_fp" != "$last_fingerprint" || "$force" -eq 1 ]]; then
    title=$(jq -r '.title // "?"' <<<"$payload")
    artist=$(jq -r '.artist // "?"' <<<"$payload")
    seek=$(jq -r '.seek_position // 0' <<<"$payload")
    if push_now_playing "$payload"; then
      last_fingerprint="$meta_fp"
      last_push_ts=$now
      was_playing=1
      log "${state}: ${artist} — ${title} @ ${seek}s"
    fi
  fi

  sleep "$POLL_INTERVAL"
done
