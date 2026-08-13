import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Rect } from "react-native-svg";

import type { Speaker, TranscriptSegment } from "@/lib/api/meeting-detail";

/**
 * The Ribbon — a conversation fingerprint.
 *
 * A horizontal strip spanning the meeting's duration, divided into bands
 * coloured by who was speaking.
 *
 * This is the app's signature, and it is deliberately NOT a waveform. Every
 * competitor draws amplitude, which only says "there is audio here". Bands of
 * speaker-coloured time say "we understood the conversation" — the one graphic
 * a diarization product can draw and a recorder cannot.
 *
 * It is also genuinely informative at 3pt: a meeting where one band dominates
 * is visibly a monologue; rapid alternation is visibly a discussion. You can
 * read the shape of a meeting before reading a word of it.
 *
 * Colour is never the sole carrier of meaning — callers pair this with a
 * speaker legend, and it carries an accessibilityLabel naming the split.
 */

/** Matches SPEAKER_CLASSES in lib/api/meeting-detail, as resolved hex. */
const SPEAKER_HEX = ["#4C99F8", "#A27DFA", "#2FC183", "#E6AC3D", "#7A869F"] as const;
const UNKNOWN_HEX = "#2E3138";
/** --label, dark ramp. The app is locked to dark (app.json userInterfaceStyle). */
const PLAYHEAD_HEX = "#F4F5F7";

export interface RibbonBand {
  /** 0..1 start position along the meeting. */
  start: number;
  /** 0..1 end position. */
  end: number;
  color: string;
}

export interface RibbonSpan {
  /** Wall-clock second drawn at x = 0. */
  origin: number;
  /** Seconds covered by the full width. */
  span: number;
}

/**
 * The stretch of the recording the strip actually draws.
 *
 * Normalised against the span covered by speech, not against zero. Speech
 * rarely starts at 0.0s, and anchoring to zero left a dead gap at the left edge
 * that looked like a bug rather than silence.
 *
 * Exported because the scrubber has to map a touch back through exactly this
 * transform. Two copies of it would drift, and the symptom would be a playhead
 * that sits a few seconds off the words being spoken — which reads as broken
 * diarization rather than as a mapping bug.
 */
export function ribbonSpan(segments: TranscriptSegment[]): RibbonSpan | null {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return null;

  const span = last.end_sec - first.start_sec;
  if (span <= 0) return null;

  return { origin: first.start_sec, span };
}

/**
 * Collapse segments into drawable bands.
 *
 * Two passes that matter for performance: runs by the same speaker merge, and
 * anything shorter than `minWidth` of the total is absorbed into its neighbour.
 * A 45-minute meeting can carry 800+ segments; this brings it to roughly
 * 40-120 rects, which is the difference between a smooth list and a janky one.
 */
export function buildBands(
  segments: TranscriptSegment[],
  speakers: Speaker[],
  minWidth = 0.005,
): RibbonBand[] {
  if (segments.length === 0) return [];

  const bounds = ribbonSpan(segments);
  if (!bounds) return [];

  const origin = bounds.origin;
  const total = bounds.span;

  // One pass to build the lookup instead of a findIndex per segment: at 800+
  // segments the linear scan is the most expensive thing in this function.
  //
  // Indexed by BOTH id and label, because the two sides of this disagree.
  // `speakers[].id` is the bare diarization tag ("A"), while a segment's
  // `speaker` carries the display label ("Speaker A") — so a lookup by id alone
  // missed on every segment of every meeting, every band fell through to
  // UNKNOWN_HEX, and the ribbon rendered as one flat grey slab. It looked like
  // a component that had failed to load rather than a lookup that never hit,
  // which is why it survived: the playhead still drew, so nothing was obviously
  // broken.
  //
  // Both keys rather than normalising one into the other: the label is
  // user-editable (speaker names), so today's "Speaker A" can become "Priya"
  // while the id stays "A", and only a map that answers to both survives that.
  const colors = new Map<string, string>();
  speakers.forEach((speaker, i) => {
    const hex = SPEAKER_HEX[i % SPEAKER_HEX.length] ?? UNKNOWN_HEX;
    colors.set(speaker.id, hex);
    if (speaker.label) colors.set(speaker.label, hex);
  });
  const colorFor = (speakerId: string | null): string =>
    (speakerId ? colors.get(speakerId) : undefined) ?? UNKNOWN_HEX;

  const merged: RibbonBand[] = [];
  // Runs merge on speaker IDENTITY, not on colour. Past five speakers the
  // palette wraps, and merging by colour would silently glue speaker A to
  // speaker F and report a monologue that never happened.
  let runSpeaker: string | null | undefined;

  for (const seg of segments) {
    const start = (seg.start_sec - origin) / total;
    // Defensive against unordered or zero-length segments: a band that ends
    // before it starts draws as a negative-width rect, which some renderers
    // simply drop and others draw as a full-width smear.
    const end = Math.max(start, (seg.end_sec - origin) / total);
    const previous = merged[merged.length - 1];

    if (previous && seg.speaker === runSpeaker) {
      // Same speaker continuing. Short silences inside a turn stay filled.
      previous.end = Math.max(previous.end, end);
    } else {
      merged.push({ start, end, color: colorFor(seg.speaker) });
    }
    runSpeaker = seg.speaker;
  }

  // Absorb slivers into whichever neighbour is longer, so the strip stays
  // continuous rather than developing hairline gaps.
  const bands: RibbonBand[] = [];
  for (const band of merged) {
    const width = band.end - band.start;
    const prev = bands[bands.length - 1];
    if (width < minWidth && prev) {
      prev.end = Math.max(prev.end, band.end);
      continue;
    }
    bands.push({ ...band });
  }

  return bands;
}

interface RibbonProps {
  segments: TranscriptSegment[];
  speakers: Speaker[];
  height?: number;
  /** 0..1 playback position. Draws a playhead when provided. */
  progress?: number;
  radius?: number;
  /** Rendered instead of bands while a meeting is still processing. */
  placeholder?: boolean;
}

export function Ribbon({
  segments,
  speakers,
  height = 3,
  progress,
  radius,
  placeholder = false,
}: RibbonProps) {
  const bands = useMemo(
    () => (placeholder ? [] : buildBands(segments, speakers)),
    [segments, speakers, placeholder],
  );

  const r = radius ?? Math.min(height / 2, 3);

  const a11yLabel = useMemo(() => {
    if (placeholder || bands.length === 0) return "Conversation timeline, not yet available";
    const total = speakers.reduce((sum, s) => sum + s.talk_time_sec, 0);
    if (total <= 0) return "Conversation timeline";
    const parts = speakers
      .map((s) => `${s.label} ${Math.round((s.talk_time_sec / total) * 100)}%`)
      .join(", ");
    return `Conversation timeline. ${parts}`;
  }, [bands.length, speakers, placeholder]);

  if (placeholder || bands.length === 0) {
    return (
      <View
        className="w-full bg-fill"
        style={{ height, borderRadius: r }}
        accessible
        accessibilityRole="image"
        accessibilityLabel={a11yLabel}
      />
    );
  }

  return (
    <View
      // The track is filled rather than transparent, so the gaps between turns
      // read as silence in the conversation instead of holes in the graphic.
      className="w-full overflow-hidden bg-fill"
      style={{ height, borderRadius: r }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={a11yLabel}
    >
      {/* viewBox in 0..1000 so the SVG scales to whatever width the row gives
          it without needing an onLayout measure pass. */}
      <Svg width="100%" height={height} viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none">
        {bands.map((band, i) => (
          <Rect
            key={i}
            x={band.start * 1000}
            y={0}
            // Half a unit of overlap hides sub-pixel seams between bands.
            width={Math.max((band.end - band.start) * 1000 + 0.5, 1)}
            height={height}
            fill={band.color}
          />
        ))}

        {progress !== undefined ? (
          <Rect
            x={Math.max(0, Math.min(1, progress)) * 1000 - 1}
            y={0}
            width={2}
            height={height}
            fill={PLAYHEAD_HEX}
          />
        ) : null}
      </Svg>
    </View>
  );
}
