#!/bin/bash
# Capture one screenshot per screen from a simulator build made with
# EXPO_PUBLIC_SHOT_MODE=1.
#
# The app walks itself (see src/lib/shot-driver.tsx) because neither remote
# control path works on this runtime: iOS 26 gates custom scheme URLs behind a
# confirmation dialog, and idb's HID injection no-ops.
#
# THIS HARNESS FOLLOWS THE APP. It used to be a clock — sleep a fixed dwell,
# shoot, and name the file from a hardcoded list — and it drifted constantly:
# boot time varies by ten seconds between runs, `simctl io screenshot` itself
# stalls the simulator for a moment, and the two compound. One run came back
# with 12 of 13 screenshots showing the wrong screen.
#
# So the app is now the clock. The driver writes every route it reaches, with a
# millisecond stamp, to shot-routes.txt inside its own container — an ordinary
# directory on this host. This script polls that file, waits for the route to
# stop changing, then shoots and NAMES THE FILE FROM THE ROUTE ITSELF.
#
# The filename can therefore no longer disagree with the image: it is derived
# from the app's own report rather than from a list of what we hoped would
# happen. A route that never opens produces a missing file, which is an obvious
# gap, instead of shifting every subsequent name by one.
#
# Usage: ./capture-shots.sh <output-dir> [max-seconds]
set -uo pipefail

OUT="${1:?usage: capture-shots.sh <output-dir> [max-seconds]}"
MAX_SECONDS="${2:-180}"
BUNDLE="com.suhaasnv.echobrief"

# How long a route must hold still before it is worth photographing. Covers the
# push transition plus the entrance animations the screens run on mount.
SETTLE=2.5

mkdir -p "$OUT"
rm -f "$OUT"/*.png "$OUT"/manifest.txt "$OUT"/shot-routes.txt 2>/dev/null

xcrun simctl terminate booted "$BUNDLE" >/dev/null 2>&1
sleep 1

# Everything the app reported BEFORE this instant is a previous run's trail and
# must never be believed. The driver rewrites the file whole on its first
# navigation, but until then the old contents are still on disk — and the first
# version of this script read them, shot the Metro bundling splash, and named it
# from a route the app would not reach for another 18 seconds. The filename was
# derived from the app's own report, just not the report that was current when
# the shutter fired, which is the only thing that makes the guarantee worth
# anything.
LAUNCH_MS=$(python3 -c 'import time; print(int(time.time()*1000))')

xcrun simctl launch booted "$BUNDLE" >/dev/null 2>&1 || { echo "launch failed"; exit 1; }

# The container path is only stable once the app has written the file at least
# once, so it is resolved inside the loop rather than up front.
find_trail() {
  find ~/Library/Developer/CoreSimulator/Devices/*/data/Containers/Data/Application \
    -name shot-routes.txt -newermt "-5 minutes" 2>/dev/null | head -1
}

# Route -> filename stem. Collapses the meeting id so a detail capture has a
# stable name, and keeps a counter so revisiting a route (the walk pushes into a
# meeting and pops back to the list) does not overwrite the first visit.
stem_for() {
  local route="$1"
  case "$route" in
    /meetings/*) echo "meeting-detail" ;;
    /) echo "root" ;;
    *) echo "${route#/}" | tr '/' '-' ;;
  esac
}

echo "following the app's route trail (max ${MAX_SECONDS}s)…"
START=$(date +%s)
LAST_ROUTE=""
STABLE_SINCE=0
declare -a SEEN=()

while [ $(( $(date +%s) - START )) -lt "$MAX_SECONDS" ]; do
  TRAIL=$(find_trail)
  if [ -z "$TRAIL" ]; then sleep 1; continue; fi

  # Only entries this run wrote. An empty result means the app has not navigated
  # yet — which is a reason to WAIT, never a reason to shoot.
  ROUTE=$(awk -v since="$LAUNCH_MS" '$1 >= since { $1=""; sub(/^ /,""); print }' "$TRAIL" | tail -1)
  [ -z "$ROUTE" ] && { sleep 0.5; continue; }

  NOW=$(python3 -c 'import time; print(time.time())')

  if [ "$ROUTE" != "$LAST_ROUTE" ]; then
    LAST_ROUTE="$ROUTE"
    STABLE_SINCE="$NOW"
    sleep 0.4
    continue
  fi

  HELD=$(python3 -c "print($NOW - $STABLE_SINCE)")
  if (( $(python3 -c "print(1 if $HELD >= $SETTLE else 0)") )); then
    STEM=$(stem_for "$ROUTE")
    # Already captured this route while it was continuously on screen? Skip,
    # otherwise a route the walk sits on would be shot every loop.
    ALREADY=0
    for s in "${SEEN[@]:-}"; do [ "$s" = "$ROUTE" ] && ALREADY=1; done
    if [ "$ALREADY" -eq 0 ]; then
      IDX=$(printf "%02d" "${#SEEN[@]}")
      if xcrun simctl io booted screenshot --type=png "$OUT/${IDX}-${STEM}.png" >/dev/null 2>&1; then
        echo "${IDX}-${STEM} $(python3 -c 'import time; print(int(time.time()*1000))') ${ROUTE}" >> "$OUT/manifest.txt"
        echo "  ${IDX}-${STEM}  <- ${ROUTE}"
        SEEN+=("$ROUTE")
      fi
    fi
    sleep 1
    continue
  fi

  sleep 0.4
done

TRAIL=$(find_trail)
[ -n "$TRAIL" ] && cp "$TRAIL" "$OUT/shot-routes.txt"

COUNT=$(ls -1 "$OUT"/*.png 2>/dev/null | wc -l | tr -d ' ')
echo "Wrote ${COUNT} screenshots to $OUT"
echo "Names come from the app's own route trail, so a filename cannot disagree"
echo "with its image. Routes the walk never reached are simply absent."
