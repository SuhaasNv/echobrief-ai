import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import type { MeetingDetail } from "@/lib/api/meeting-detail";
import { SPEAKER_CLASSES } from "@/lib/api/meeting-detail";
import type { PlaybackController } from "@/lib/audio/playback";
import type { FollowScroll } from "@/components/player/follow-scroll";
import { formatClock } from "@/lib/format";
import { haptics } from "@/lib/haptics";

import { EmptyPane, Notice } from "./primitives";
import { SegmentRow, type SegmentRowProps } from "./segment-row";

/**
 * The transcript.
 *
 * This is the app's only long-form reading surface, so it is typeset rather
 * than laid out: one hard left margin for the body, timestamps in a gutter that
 * never competes with the text, and vertical space that groups a speaker's
 * consecutive lines into a turn instead of spacing every line identically.
 *
 * With audio it is also the seek surface. Reading a transcript is how you find
 * the moment you care about; tapping the line you found is how you hear it. The
 * highlight walks down as the recording plays, and the pane scrolls to keep it
 * visible until the reader takes the scroll back, at which point it stops for
 * good and offers a way to return instead.
 */

/** A turn starts; give it air. */
const TURN_GAP = 20;
/** The same speaker continuing; a paragraph break, not a new block. */
const LINE_GAP = 8;

interface Row extends Omit<SegmentRowProps, "active" | "onSeek" | "onMeasure" | "onNameSpeaker"> {
  key: string;
  /** Where this line starts in the recording. Drives seek and highlight. */
  startSec: number;
}

interface Box {
  y: number;
  height: number;
}

function buildRows(transcript: NonNullable<MeetingDetail["transcript"]>): Row[] {
  const { segments, speakers } = transcript;

  // Resolve identity once. Doing this per row would be O(segments × speakers)
  // and would hand every row a fresh value on each poll.
  //
  // Indexed by BOTH id and label, for the reason components/ribbon spells out at
  // length: `speakers[].id` is the bare diarization tag ("A"), while a segment's
  // `speaker` carries the resolved display label ("Speaker A", or "Priya" once
  // someone has named the voice). Keying on the id alone missed on every segment
  // of every meeting, so `resolved` was always undefined — the label still drew,
  // because it falls back to `segment.speaker`, but the COLOUR fell through to
  // text-label-secondary and every speaker in every transcript rendered grey.
  //
  // Both keys rather than normalising one into the other, because the label is
  // now user-editable and only a map that answers to both survives a rename.
  const identity = new Map<string, { id: string; label: string; className: string }>();
  speakers.forEach((speaker, i) => {
    const entry = {
      id: speaker.id,
      label: speaker.label,
      className: SPEAKER_CLASSES[i % SPEAKER_CLASSES.length] ?? "text-label-secondary",
    };
    identity.set(speaker.id, entry);
    if (speaker.label) identity.set(speaker.label, entry);
  });

  // h:mm:ss only when the meeting actually runs past an hour; otherwise the
  // extra column width is dead space taken from the reading measure.
  const longest = segments.reduce((max, s) => Math.max(max, s.start_sec), 0);
  const gutter = longest >= 3600 ? 58 : 44;

  const rows: Row[] = [];
  let previousSpeaker: string | null | undefined;

  segments.forEach((segment, i) => {
    const text = segment.text?.trim();
    if (!text) return;

    const startsTurn = i === 0 || segment.speaker !== previousSpeaker;
    previousSpeaker = segment.speaker;

    const resolved = segment.speaker ? identity.get(segment.speaker) : undefined;

    rows.push({
      key: `${i}-${segment.start_sec}`,
      index: rows.length,
      startSec: segment.start_sec,
      // Repeating the name and the clock on every consecutive line from one
      // speaker is noise; the turn is the unit a reader tracks.
      time: startsTurn ? formatClock(segment.start_sec) : null,
      label: startsTurn ? (resolved?.label ?? segment.speaker ?? "Speaker") : null,
      labelClass: resolved?.className ?? "text-label-secondary",
      // Only on a turn's first line, because that is the only line that draws a
      // name to tap. An unattributed segment carries no id and stays inert.
      speakerId: startsTurn ? (resolved?.id ?? null) : null,
      text,
      gutter,
      spacing: rows.length === 0 ? 0 : startsTurn ? TURN_GAP : LINE_GAP,
    });
  });

  return rows;
}

/**
 * Last row that has started at `seconds`, or -1 before the first word.
 *
 * Binary search rather than a scan: this runs on every position push, ten times
 * a second, against up to 800 rows.
 *
 * Silence between two lines keeps the earlier one highlighted rather than
 * clearing it. A highlight that blinks off in every gap draws far more
 * attention than one that simply waits.
 */
function rowAt(starts: number[], seconds: number): number {
  let low = 0;
  let high = starts.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = starts[mid];
    if (start === undefined) break;
    if (start <= seconds) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

/**
 * Pasted and imported transcripts arrive as raw text with no diarization. That
 * is a partial result, not an empty one, so it is rendered as prose rather than
 * thrown away behind "no transcript available".
 */
function RawText({ raw }: { raw: string }) {
  const paragraphs = useMemo(
    () =>
      raw
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean),
    [raw],
  );

  return (
    <View className="gap-4 px-4 pb-8">
      <Notice
        title="No speaker labels"
        detail="This transcript came in as plain text, so it carries no speaker labels or timings."
      />
      {paragraphs.map((paragraph, i) => (
        <Text key={i} className="text-[16px] leading-[25px] text-label" selectable>
          {paragraph}
        </Text>
      ))}
    </View>
  );
}

export interface TranscriptViewProps {
  meeting: MeetingDetail;
  /** Absent for a transcript-only meeting; the pane then reads as before. */
  playback?: PlaybackController;
  /** The screen's scroll surface. Auto-scroll is a no-op without it. */
  follow?: FollowScroll;
  /**
   * Open the naming sheet for a voice. Must be stable across renders — every
   * turn's name is a button, and a fresh identity would re-render all of them on
   * each five second poll.
   */
  onNameSpeaker?: (speakerId: string) => void;
}

export function TranscriptView({ meeting, playback, follow, onNameSpeaker }: TranscriptViewProps) {
  const transcript = meeting.transcript;
  const reduceMotion = useReducedMotion();

  const rows = useMemo(() => (transcript ? buildRows(transcript) : []), [transcript]);
  const starts = useMemo(() => rows.map((row) => row.startSec), [rows]);

  const [activeIndex, setActiveIndex] = useState(-1);

  // Read by the stable callbacks below. Depending on `rows` directly would give
  // every row a new onSeek identity on each five second poll, which is exactly
  // the memoisation the row comparator exists to protect.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const activeRef = useRef(-1);
  const geometry = useRef(new Map<number, Box>()).current;

  const seekable = Boolean(playback?.available) && rows.length > 0;

  // Row offsets belong to one build of the list. A meeting that finishes
  // processing while open replaces every row, and stale boxes would scroll to
  // where a line used to be.
  //
  // Done during render rather than in an effect on purpose: onLayout fires
  // after the native layout pass, which can land before a passive effect, so an
  // effect here would sometimes wipe the measurements it was meant to precede.
  const builtRef = useRef(rows);
  if (builtRef.current !== rows) {
    builtRef.current = rows;
    geometry.clear();
  }

  const onMeasure = useCallback(
    (index: number, y: number, height: number) => {
      geometry.set(index, { y, height });
    },
    [geometry],
  );

  const onSeek = useCallback(
    (index: number) => {
      const row = rowsRef.current[index];
      if (!row || !playback) return;
      haptics.tap();
      // Plays immediately. Seeking without starting playback would make the tap
      // look like it did nothing.
      playback.seek(row.startSec, { play: true });
    },
    [playback],
  );

  // Follow the playhead. The listener runs at the status update rate but only
  // calls setState when the row actually changes, so a 45 minute meeting costs
  // one render per spoken line rather than ten per second.
  useEffect(() => {
    if (!playback || !seekable) return;
    return playback.subscribePosition((seconds) => {
      const next = rowAt(starts, seconds);
      if (next === activeRef.current) return;
      activeRef.current = next;
      setActiveIndex(next);
    });
  }, [playback, seekable, starts]);

  useEffect(() => {
    if (!follow || activeIndex < 0) return;
    const box = geometry.get(activeIndex);
    if (!box) return;
    // Under Reduce Motion the view still follows, it just arrives instead of
    // travelling. Dropping the follow entirely would remove information, which
    // is not what the preference asks for.
    follow.reveal(box.y, box.height, !reduceMotion);
  }, [activeIndex, follow, geometry, reduceMotion]);

  // The return-to-current affordance is published from here because this is the
  // only place that knows where "current" is on screen, and it is withdrawn on
  // unmount so the Summary tab never offers a jump into a pane that is gone.
  useEffect(() => {
    if (!follow || !seekable) return;
    follow.registerJump(() => {
      const box = activeRef.current >= 0 ? geometry.get(activeRef.current) : undefined;
      if (!box) return;
      follow.force(box.y, box.height, !reduceMotion);
    });
    return () => follow.registerJump(null);
  }, [follow, geometry, reduceMotion, seekable]);

  if (rows.length === 0) {
    const raw = transcript?.raw_text?.trim();
    if (raw) return <RawText raw={raw} />;

    return (
      <EmptyPane
        title="No transcript"
        detail={
          meeting.summary
            ? "No transcript was stored for this meeting. The Summary tab still has what the model produced."
            : "No transcript was stored for this meeting."
        }
      />
    );
  }

  return (
    <View ref={follow?.setContainer} className="px-4 pb-8">
      {rows.map(({ key, startSec: _startSec, ...row }) => (
        <SegmentRow
          key={key}
          {...row}
          active={row.index === activeIndex}
          onSeek={seekable ? onSeek : undefined}
          onMeasure={follow ? onMeasure : undefined}
          onNameSpeaker={onNameSpeaker}
        />
      ))}
    </View>
  );
}
