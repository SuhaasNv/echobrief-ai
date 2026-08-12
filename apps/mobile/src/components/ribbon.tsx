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

export interface RibbonBand {
  /** 0..1 start position along the meeting. */
  start: number;
  /** 0..1 end position. */
  end: number;
  color: string;
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

  const total = segments[segments.length - 1]?.end_sec ?? 0;
  if (total <= 0) return [];

  const colorFor = (speakerId: string | null): string => {
    if (!speakerId) return UNKNOWN_HEX;
    const i = speakers.findIndex((s) => s.id === speakerId);
    return i >= 0 ? (SPEAKER_HEX[i % SPEAKER_HEX.length] ?? UNKNOWN_HEX) : UNKNOWN_HEX;
  };

  const merged: RibbonBand[] = [];
  for (const seg of segments) {
    const color = colorFor(seg.speaker);
    const start = seg.start_sec / total;
    const end = seg.end_sec / total;
    const last = merged[merged.length - 1];

    // Same speaker continuing, or a gap small enough not to matter.
    if (last && last.color === color) {
      last.end = end;
    } else {
      merged.push({ start, end, color });
    }
  }

  // Absorb slivers into whichever neighbour is longer, so the strip stays
  // continuous rather than developing hairline gaps.
  const bands: RibbonBand[] = [];
  for (const band of merged) {
    const width = band.end - band.start;
    const prev = bands[bands.length - 1];
    if (width < minWidth && prev) {
      prev.end = band.end;
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
        accessibilityLabel={a11yLabel}
      />
    );
  }

  return (
    <View
      className="w-full overflow-hidden"
      style={{ height, borderRadius: r }}
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
            fill="#F4F5F7"
          />
        ) : null}
      </Svg>
    </View>
  );
}
