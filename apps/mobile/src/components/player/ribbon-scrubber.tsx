import { useMemo } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import type { Speaker, TranscriptSegment } from "@/lib/api/meeting-detail";
import type { PlaybackController } from "@/lib/audio/playback";
import { buildBands, Ribbon } from "@/components/ribbon";
import { haptics } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";

/**
 * The Ribbon, made scrubbable.
 *
 * This is the feature, not a decoration on it. Every other recorder scrubs
 * along an amplitude waveform, which tells you only that sound exists at a
 * point. Dragging along speaker-coloured bands tells you WHO you are scrubbing
 * to, so "take me back to where Priya was talking" is a thing you can do with
 * your thumb instead of by reading timestamps.
 *
 * Two things this deliberately does not do:
 *
 *   It does not pass `progress` to the Ribbon. That prop redraws an SVG rect,
 *   which costs a React render per tick, and the transcript sitting under this
 *   is up to 800 rows. The playhead here is an overlay driven by a transform on
 *   a shared value, so a 60fps playhead never enters the JS thread at all.
 *
 *   It does not fatten the strip to be tappable. The graphic is 3-6pt in the
 *   player bar because that is the size at which it reads as a fingerprint; the
 *   44pt target is padding around it.
 */

/** --label, dark ramp. Matches PLAYHEAD_HEX in components/ribbon. */
const PLAYHEAD = "#F4F5F7";
/** Apple's minimum. The strip is far shorter than this, so the rest is padding. */
const MIN_TARGET = 44;
const PLAYHEAD_WIDTH = 2;

export interface RibbonScrubberProps {
  playback: PlaybackController;
  segments: TranscriptSegment[];
  speakers: Speaker[];
  /** Drawn height of the strip itself, not of the touch target. */
  height?: number;
  radius?: number;
}

export function RibbonScrubber({
  playback,
  segments,
  speakers,
  height = 4,
  radius,
}: RibbonScrubberProps) {
  const { progress, scrubbing, available } = playback;
  const width = useSharedValue(0);
  /** Band the playhead was last inside. Latches the haptic to crossings only. */
  const band = useSharedValue(-1);

  // Left edges of the drawn bands, in ribbon space. Bands merge on speaker
  // identity, so crossing an edge is crossing into a different voice - which is
  // the only moment worth a tick. Numbers rather than the band objects, so the
  // worklet closure carries an array of floats and not a colour table.
  const edges = useMemo(
    () => buildBands(segments, speakers).map((b) => b.start),
    [segments, speakers],
  );

  const padding = Math.max((MIN_TARGET - height) / 2, 0);

  const gesture = useMemo(() => {
    const tick = () => haptics.tap();

    /**
     * Jump to the touch, then track it 1:1.
     *
     * Music and Podcasts both do this rather than requiring you to grab the
     * playhead: at 4pt tall the playhead is not a grabbable object, and asking
     * someone to hit it would be inventing a custom gesture where a standard
     * one exists.
     */
    const apply = (x: number) => {
      "worklet";
      if (width.value <= 0) return;
      const next = Math.min(Math.max(x / width.value, 0), 1);
      progress.value = next;

      // Linear scan over 40-120 edges per frame. Measured against a binary
      // search it is not worth the branchier code at this size.
      let index = -1;
      for (let i = 0; i < edges.length; i += 1) {
        const edge = edges[i];
        if (edge !== undefined && edge <= next) index = i;
        else break;
      }
      if (index !== band.value) {
        band.value = index;
        // Crossings only. Without the latch, holding a finger still near an
        // edge fires every frame and the strip buzzes under the thumb.
        runOnJS(tick)();
      }
    };

    const commit = (fraction: number) => playback.commitScrub(fraction);

    const pan = Gesture.Pan()
      // Horizontal intent, explicitly: this sits inside a vertical ScrollView,
      // and without an activation offset the pan claims the touch on the first
      // pixel and the meeting can no longer be scrolled from anywhere near it.
      .activeOffsetX([-6, 6])
      .failOffsetY([-14, 14])
      .onStart((event) => {
        scrubbing.value = true;
        band.value = -1;
        apply(event.x);
      })
      .onUpdate((event) => apply(event.x))
      .onEnd(() => {
        runOnJS(commit)(progress.value);
      })
      .onFinalize(() => {
        // Also covers cancellation, where onEnd never runs and the playhead
        // would otherwise stay pinned under a finger that has already left.
        scrubbing.value = false;
      });

    // Default maxDuration deliberately left alone: a press that rests on the
    // strip for half a second before lifting is still someone pointing at a
    // moment, and failing it would leave the touch doing nothing at all.
    const tap = Gesture.Tap().onEnd((event) => {
      apply(event.x);
      runOnJS(commit)(progress.value);
    });

    return Gesture.Exclusive(pan, tap);
  }, [band, edges, playback, progress, scrubbing, width]);

  /**
   * Thickens under the finger without animating a width.
   *
   * Kept in its own derived value rather than inlined in the style: the style
   * below re-evaluates on every position push, and a withSpring re-issued at
   * that rate is a spring that is perpetually being restarted. This one only
   * re-runs when the scrub latch flips.
   *
   * Direct manipulation, so it opts out of Reduce Motion for the same reason
   * the swipe rows do: resolved instantly it reads as a glitch rather than as a
   * respected preference.
   */
  const thickness = useDerivedValue(() =>
    withSpring(scrubbing.value ? 2.2 : 1, {
      ...SPRING.chrome,
      reduceMotion: ReduceMotion.Never,
    }),
  );

  const headStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * width.value - PLAYHEAD_WIDTH / 2 },
      { scaleX: thickness.value },
    ],
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    width.value = event.nativeEvent.layout.width;
  };

  const strip = <Ribbon segments={segments} speakers={speakers} height={height} radius={radius} />;

  // A transcript-only meeting gets the graphic and nothing else. A scrubber
  // that cannot scrub is worse than no scrubber.
  if (!available) return strip;

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={{ paddingVertical: padding }}
        onLayout={onLayout}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Playback position"
        accessibilityHint="Swipe up or down to move through the recording"
        // Deliberately no accessibilityValue. It would only be regenerated when
        // this component re-renders, which is on transport changes and not per
        // second, so it would read out a time that was true a minute ago. The
        // live readout is the elapsed and total text in the player bar, which
        // VoiceOver reaches immediately after this control.
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "increment") playback.skip(15);
          else if (event.nativeEvent.actionName === "decrement") playback.skip(-15);
        }}
      >
        {strip}

        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              left: 0,
              top: padding,
              width: PLAYHEAD_WIDTH,
              height,
              borderRadius: PLAYHEAD_WIDTH / 2,
              backgroundColor: PLAYHEAD,
            },
            headStyle,
          ]}
        />
      </View>
    </GestureDetector>
  );
}
