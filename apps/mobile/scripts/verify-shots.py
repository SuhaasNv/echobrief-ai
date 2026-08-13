#!/usr/bin/env python3
"""Name every screenshot from the route the app actually reported.

capture-shots.sh names files from SHOT_ROUTES by index, which assumes every
navigation landed. It does not always: a tab switch that bounces leaves the
screenshot showing one screen under another screen's filename, and a reviewer
then grades the wrong screen and reports a confident score for it. That has
happened three times.

The app writes a timestamped route trail (see shot-driver.tsx) and the harness
writes a timestamped capture manifest. A screenshot taken at T shows whichever
route was last logged before T -- that is evidence, not inference, so it wins
over the filename every time.

Usage: verify-shots.py <shots-dir> <shot-routes.txt> [--rename]

Exit status is the number of mismatches, so a capture run can gate on it.
Without --rename nothing is written; the report alone says which files lie.
"""

import shutil
import sys
from pathlib import Path

# Filename stem (minus the NN- prefix) -> the route prefix that stem claims.
# A prefix rather than equality because the meeting detail route carries an id.
EXPECTED = {
    "meetings-list": "/meetings",
    "meeting-detail": "/meetings/",
    "back-to-list": "/meetings",
    "record": "/record",
    "ask": "/ask",
    "actions": "/actions",
    "account": "/account",
    "account-profile": "/account/profile",
    "account-plan": "/account/plan",
    "account-password": "/account/password",
    "account-workspaces": "/account/workspaces",
    "account-legal": "/account/legal",
    "account-delete": "/account/delete",
}


def route_matches(stem: str, actual: str) -> bool:
    """True when `actual` is the route `stem` claims to show."""
    expected = EXPECTED.get(stem)
    if expected is None:
        return False
    # "/account" is a prefix of "/account/plan", so the tab root demands an
    # exact match. Everything else is a prefix test, for the detail route's id.
    if expected == "/account" or expected == "/meetings":
        return actual == expected
    return actual.startswith(expected)


def slug(route: str) -> str:
    """A filename-safe stem for a route the walk did not expect to be on."""
    if route.startswith("/meetings/"):
        return "meeting-detail"
    return route.strip("/").replace("/", "-") or "root"


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    rename = "--rename" in sys.argv
    if len(args) != 2:
        print(__doc__, file=sys.stderr)
        return 2

    shots, trail_path = Path(args[0]), Path(args[1])
    manifest = shots / "manifest.txt"
    if not manifest.exists():
        print(f"no manifest at {manifest}", file=sys.stderr)
        return 2
    if not trail_path.exists():
        print(f"no route trail at {trail_path}", file=sys.stderr)
        return 2

    trail = []
    for line in trail_path.read_text().splitlines():
        parts = line.split(maxsplit=1)
        if len(parts) == 2 and parts[0].isdigit():
            trail.append((int(parts[0]), parts[1]))
    trail.sort()
    if not trail:
        print("route trail is empty -- was the build made with SHOT_MODE=1?", file=sys.stderr)
        return 2

    mismatches = []
    print(f"{'file':26} {'claims':22} {'actually showed':26} ")
    print("-" * 80)

    for line in manifest.read_text().splitlines():
        parts = line.split()
        if len(parts) != 2 or not parts[1].isdigit():
            continue
        name, stamp = parts[0], int(parts[1])

        before = [r for t, r in trail if t <= stamp]
        if not before:
            # Captured before the app logged anything. Cannot be attributed, so
            # it must not be graded.
            mismatches.append((name, "?", "no route logged yet"))
            print(f"{name:26} {name.split('-', 1)[1]:22} {'(nothing logged yet)':26} UNKNOWN")
            continue
        actual = before[-1]
        stem = name.split("-", 1)[1]
        ok = route_matches(stem, actual)
        print(f"{name:26} {stem:22} {actual:26} {'ok' if ok else 'MISMATCH'}")
        if not ok:
            mismatches.append((name, stem, actual))
            if rename:
                src = shots / f"{name}.png"
                if src.exists():
                    index = name.split("-", 1)[0]
                    dst = shots / f"{index}-WRONG-shows-{slug(actual)}.png"
                    shutil.move(str(src), str(dst))
                    print(f"    renamed -> {dst.name}")

    print()
    if mismatches:
        print(f"{len(mismatches)} of the captures do not show the screen they are named for.")
        print("Do NOT grade this set until they are recaptured.")
    else:
        print("All captures verified against the app's own route trail.")
    return len(mismatches)


if __name__ == "__main__":
    sys.exit(main())
