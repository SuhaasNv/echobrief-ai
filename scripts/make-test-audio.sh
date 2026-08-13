#!/usr/bin/env bash
#
# Generate a multi-voice meeting recording of an arbitrary length, for testing
# the REAL pipeline — upload, AssemblyAI, diarization, analysis.
#
# This is the counterpart to scripts/seed-dev-meeting.mjs and the difference
# matters: the seed writes a finished meeting straight into the database and
# proves nothing about transcription. This produces actual audio, so uploading
# it exercises every stage a user's recording does.
#
# Distinct accents per speaker on purpose. Diarization separates voices by
# acoustic character, and four US voices reading in turn is a much easier problem
# than four people in a room — it would pass here and still fail in the wild.
# en_GB / en_AU / en_IE / en_ZA / en_IN give the diarizer something to actually
# separate.
#
#   ./scripts/make-test-audio.sh 10          # 10-minute, 3 speakers
#   ./scripts/make-test-audio.sh 30 4        # 30-minute, 4 speakers
#   ./scripts/make-test-audio.sh 3 2 out.m4a
#
set -euo pipefail

MINUTES="${1:-10}"
SPEAKERS="${2:-3}"
OUT="${3:-test-meeting-${MINUTES}min.m4a}"

command -v ffmpeg >/dev/null || { echo "ffmpeg required: brew install ffmpeg"; exit 1; }

VOICES=(Daniel Karen Moira Tessa Rishi)
if (( SPEAKERS < 1 || SPEAKERS > 5 )); then echo "speakers must be 1-5"; exit 1; fi

LINES=(
  "Right, let's start with the migration timeline. Where are we?"
  "We're two weeks out. The backfill is the risk, not the cutover itself."
  "How long does the backfill actually take, end to end?"
  "Six hours on the staging copy. Production is roughly four times the rows, so call it a day with the checks."
  "Then I'd rather run it over a weekend than try to squeeze it into a maintenance window."
  "Agreed. Let's book the weekend of the twelfth and tell everyone now."
  "I'll write the rollback before then. If it fails halfway through we need a way out."
  "Does the rollback need the old schema kept around afterwards?"
  "Yes, dual write for one release. Then we drop it in the following one."
  "That pushes the cleanup work into next quarter, which I'm not thrilled about."
  "It does, and I still think it's the right trade to make here."
  "Fine. Who owns the communication to the support team?"
  "I'll take it. They'll want a one pager on what users might actually see."
  "Ideally nothing at all, if this goes the way we expect."
  "Nothing is not something support can put into a macro. Give them real words."
  "Fair enough. I'll draft it and send it round on Thursday for review."
  "Last thing. Do we need a load test before any of this happens?"
  "On the read path, yes. The write path is unchanged so I'd skip it there."
  "Then let's close on that and pick this up again on Monday morning."
  "One more thing, who is covering if the backfill runs long into Sunday?"
)

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

TARGET=$(( MINUTES * 60 ))
echo "Generating ~${MINUTES} min, ${SPEAKERS} voices -> $OUT"

elapsed=0
i=0
part=0
# Speaker RUNS rather than strict round-robin: real meetings hold a voice for
# several turns, and a perfectly alternating recording is both unrealistic audio
# and an unrealistically easy diarization problem.
while (( elapsed < TARGET )); do
  run=$(( (RANDOM % 3) + 1 ))
  vi=$(( (i / 2) % SPEAKERS ))
  voice="${VOICES[$vi]}"
  for (( k = 0; k < run && elapsed < TARGET; k++, i++ )); do
    line="${LINES[$(( i % ${#LINES[@]} ))]}"
    f=$(printf "%s/%04d.aiff" "$WORK" "$part")
    say -v "$voice" -o "$f" "$line" 2>/dev/null || {
      echo "voice $voice unavailable — install it in System Settings > Accessibility > Spoken Content"; exit 1; }
    dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" | cut -d. -f1)
    elapsed=$(( elapsed + dur ))
    part=$(( part + 1 ))
  done
done

# AAC in an MPEG-4 container (`audio/m4a`), which is an accepted upload type.
#
# Scope, and it matters: this file tests the UPLOAD path — Record > upload a
# file — not live segmented recording. Segments take a different route and are
# checked for ADTS framing at register time (meetings.ts, the `audio/aac`
# branch), because only ADTS concatenates losslessly; an MPEG-4 segment is
# rejected there by design. So this script can prove that a 30-minute recording
# transcribes, analyses and renders. It cannot prove that 30 minutes of live
# segmented capture joins correctly. That still needs a real recording.
ls "$WORK"/*.aiff | sed "s/^/file '/;s/$/'/" > "$WORK/list.txt"
ffmpeg -v error -f concat -safe 0 -i "$WORK/list.txt" -c:a aac -b:a 64k -ar 44100 -ac 1 -y "$OUT"

secs=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" | cut -d. -f1)
size=$(du -h "$OUT" | cut -f1)
echo "wrote $OUT  —  $(( secs / 60 ))m $(( secs % 60 ))s, $size, ${part} turns, ${SPEAKERS} voices"
