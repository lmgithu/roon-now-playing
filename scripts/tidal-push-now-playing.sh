#!/usr/bin/env bash
# tidal-push-now-playing.sh — One-shot push (fast path from phone/Tasker/etc.)
#
# Use when you can fire a command at track-change time instead of polling Tidal.
# Examples:
#   Android Tasker / MacroDroid on media notification change
#   iOS Shortcuts (limited)
#   Any local tool that knows title/artist
#
# Usage:
#   ./tidal-push-now-playing.sh playing "Song" "Artist" "Album" [duration_sec] [artwork_url]
#   ./tidal-push-now-playing.sh paused  "Song" "Artist" "Album"
#   ./tidal-push-now-playing.sh stopped
#
# Env / config same as the listener script.

set -euo pipefail

DISPLAY_URL="${DISPLAY_URL:-http://192.168.1.60:3000}"
ZONE_ID="${ZONE_ID:-tidal}"
ZONE_NAME="${ZONE_NAME:-Tidal}"
API_KEY="${API_KEY:-}"

DISPLAY_URL="${DISPLAY_URL%/}"
API_ENDPOINT="${DISPLAY_URL}/api/sources/${ZONE_ID}/now-playing"

STATE="${1:-}"
TITLE="${2:-}"
ARTIST="${3:-}"
ALBUM="${4:-}"
DURATION="${5:-}"
ARTWORK="${6:-}"

if [[ -z "$STATE" ]]; then
  echo "usage: $0 playing|paused|stopped [title] [artist] [album] [duration_sec] [artwork_url]" >&2
  exit 1
fi

case "$STATE" in
  playing|paused|stopped) ;;
  *) echo "state must be playing|paused|stopped" >&2; exit 1 ;;
esac

HEADERS=(-H "Content-Type: application/json")
[[ -n "$API_KEY" ]] && HEADERS+=(-H "X-API-Key: ${API_KEY}")

if [[ "$STATE" == "stopped" ]]; then
  BODY=$(jq -n --arg zone_name "$ZONE_NAME" '{zone_name: $zone_name, state: "stopped"}')
else
  BODY=$(jq -n \
    --arg zone_name "$ZONE_NAME" \
    --arg state "$STATE" \
    --arg title "$TITLE" \
    --arg artist "$ARTIST" \
    --arg album "$ALBUM" \
    --arg artwork_url "$ARTWORK" \
    --arg duration "$DURATION" '
    {
      zone_name: $zone_name,
      state: $state,
      title: $title,
      artist: $artist,
      album: $album
    }
    + (if ($duration|length) > 0 and ($duration|tonumber) > 0
        then {duration_seconds: ($duration|tonumber)} else {} end)
    + (if ($artwork_url|length) > 0 then {artwork_url: $artwork_url} else {} end)
  ')
fi

http=$(curl -sS -o /tmp/tidal-push-resp.json -w "%{http_code}" \
  -X POST "$API_ENDPOINT" \
  "${HEADERS[@]}" \
  -d "$BODY")

if [[ "$http" != "200" && "$http" != "201" ]]; then
  echo "push failed HTTP $http: $(cat /tmp/tidal-push-resp.json 2>/dev/null)" >&2
  exit 1
fi
echo "ok → ${ZONE_ID} ($STATE)"
