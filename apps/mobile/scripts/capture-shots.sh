#!/bin/bash
# Capture one screenshot per screen from a simulator build made with
# EXPO_PUBLIC_SHOT_MODE=1.
#
# The app walks itself (see src/lib/shot-driver.tsx) because neither remote
# control path works on this runtime: iOS 26 gates custom scheme URLs behind a
# confirmation dialog, and idb's HID injection no-ops. So the harness is a
# clock, not a driver.
#
# Timing must match SHOT_DWELL_MS. Deadlines are absolute rather than a
# sleep-per-iteration, because screenshot capture costs ~0.5s and that drift
# accumulates into a wrong screen by the end of a 12-route walk.
#
# Usage: ./capture-shots.sh <output-dir>
set -uo pipefail

OUT="${1:?usage: capture-shots.sh <output-dir>}"
BUNDLE="com.suhaasnv.echobrief"
DWELL=8          # seconds; must equal SHOT_DWELL_MS / 1000
# Fire mid-window, not at its start. The driver pushes route k at roughly
# mount + (k+1)*DWELL, so capturing at the boundary races the push and lands on
# the PREVIOUS screen — which is exactly how the first run produced a set of
# correctly-numbered, wrongly-named screenshots.
SETTLE=4
# Splash + font load + Keychain hydrate before the driver's first push. Raised
# from 4: the app now also registers the notification background task and mounts
# five error boundaries at boot, and the extra ~10s put every capture two dwells
# ahead of the walk, so each screenshot carried the name of a screen two steps
# later than the one in the image.
LAUNCH=9

# One entry per SHOT_ROUTES element, same order. Reordering that array renames
# everything after the change, so the two files move together.
NAMES=(
  00-meetings-list
  01-meeting-detail
  02-back-to-list
  03-record
  04-ask
  05-actions
  06-account
  07-account-profile
  08-account-plan
  09-account-password
  10-account-workspaces
  11-account-legal
  12-account-delete
)

mkdir -p "$OUT"
rm -f "$OUT"/*.png "$OUT"/manifest.txt 2>/dev/null

xcrun simctl terminate booted "$BUNDLE" >/dev/null 2>&1
sleep 1
xcrun simctl launch booted "$BUNDLE" >/dev/null 2>&1 || { echo "launch failed"; exit 1; }

START=$(date +%s)
for i in "${!NAMES[@]}"; do
  # Screen i is on display during [LAUNCH + i*DWELL, LAUNCH + (i+1)*DWELL).
  DEADLINE=$(( START + LAUNCH + i * DWELL + SETTLE ))
  NOW=$(date +%s)
  WAIT=$(( DEADLINE - NOW ))
  if [ "$WAIT" -gt 0 ]; then sleep "$WAIT"; fi

  if xcrun simctl io booted screenshot --type=png "$OUT/${NAMES[$i]}.png" >/dev/null 2>&1; then
    # Millisecond stamp, matched later against the app's own [shot-route] lines.
    # The filename is a GUESS derived from the route list; this is the evidence.
    echo "${NAMES[$i]} $(python3 -c 'import time; print(int(time.time()*1000))')" >> "$OUT/manifest.txt"
    echo "  ${NAMES[$i]}"
  else
    echo "  FAILED ${NAMES[$i]}"
  fi
done

echo "Wrote $(ls -1 "$OUT"/*.png 2>/dev/null | wc -l | tr -d ' ') screenshots to $OUT"
