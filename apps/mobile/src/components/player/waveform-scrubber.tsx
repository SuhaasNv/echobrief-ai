import { useMemo, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import type { PlaybackController } from "@/lib/audio/playback";
import { haptics } from "@/lib/haptics";
import { useColorToken } from "@/lib/tokens";

/**
 * A voice-memo waveform, made the scrubber.
 *
 * The bars are drawn bright; everything AHEAD of the playhead is knocked back by
 * a translucent veil translated to the play position — played reads bright, the
 * rest dim, and the boundary between them IS the playhead, so there is no
 * separate line to draw. That veil is the same transform-only trick the ribbon
 * scrubber uses: the transcript beneath this can be 800 rows, so the played
 * fraction moves on the UI thread and never triggers a React render per tick.
 *
 * The heights are decorative, not sampled from the audio — there is no amplitude
 * data on the wire — but they are DETERMINISTIC per meeting, so a given
 * recording always draws the same shape and the bar you scrubbed to is the bar
 * you come back to. A centred envelope gives it the tapering a real utterance
 * has instead of a flat block of noise.
 */

const BAR_COUNT = 44;
const BAR_WIDTH = 2.5;
/** Below this the played/unplayed split is invisible; it is a floor, not a value. */
const MIN_BAR = 0.16;
/** Apple's minimum touch target. The bars are ~28pt tall; the rest is padding. */
const MIN_TARGET = 44;
/**
 * The unplayed bars' opacity. The split is drawn by rendering the bars TWICE —
 * a dim layer under a bright layer clipped to the played region — never by
 * laying a translucent dark box over the strip. A veil has to paint SOMETHING
 * over the gaps between bars, and that something read as a grey slab behind
 * the waveform: the played/unplayed boundary must live in the bars themselves.
 */
const AHEAD_OPACITY = 0.32;

/**
 * FNV-1a over the meeting id, then a per-bar xorshift, folded through a centred
 * sine envelope. No Math.random: the same id must draw the same wave on every
 * mount, or the shape would flicker on each open.
 */
function seededHeights(seed: string, count: number): number[] {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }

  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    const r = (h % 1000) / 1000;
    const t = count > 1 ? i / (count - 1) : 0.5;
    const envelope = 0.45 + 0.55 * Math.sin(Math.PI * t);
    out.push(Math.max(MIN_BAR, Math.min(1, (0.3 + 0.7 * r) * envelope)));
  }
  return out;
}

export function WaveformScrubber({
  playback,
  seed,
  height = 28,
}: {
  playback: PlaybackController;
  /** Meeting id — keeps the wave stable across mounts. */
  seed: string;
  /** Drawn height of the tallest bar. The touch target pads out to 44pt. */
  height?: number;
}) {
  const { progress, scrubbing, available } = playback;
  const bar = useColorToken("--label");
  const width = useSharedValue(0);
  // The haptic latch. A shared value, NOT a captured `let`: a worklet cannot
  // reassign a variable it closed over — Reanimated freezes the closure, and
  // mutating it crashes the runtime. The ribbon scrubber latches the same way.
  const notch = useSharedValue(-1);
  const [containerWidth, setContainerWidth] = useState(0);

  const heights = useMemo(() => seededHeights(seed, BAR_COUNT), [seed]);
  const padding = Math.max((MIN_TARGET - height) / 2, 0);

  const gesture = useMemo(() => {
    const tick = () => haptics.tap();

    // Jump to the touch, then track 1:1 — the same "tap anywhere" seek Music and
    // Podcasts use, because a 2.5pt bar is not a grabbable playhead.
    const apply = (x: number) => {
      "worklet";
      if (width.value <= 0) return;
      const next = Math.min(Math.max(x / width.value, 0), 1);
      progress.value = next;
      // A tick every tenth of the bar, so a drag feels notched without buzzing.
      const t = Math.floor(next * 10);
      if (t !== notch.value) {
        notch.value = t;
        runOnJS(tick)();
      }
    };

    const commit = (fraction: number) => playback.commitScrub(fraction);

    const pan = Gesture.Pan()
      .activeOffsetX([-6, 6])
      .failOffsetY([-14, 14])
      .onStart((event) => {
        scrubbing.value = true;
        notch.value = -1;
        apply(event.x);
      })
      .onUpdate((event) => apply(event.x))
      .onEnd(() => runOnJS(commit)(progress.value))
      .onFinalize(() => {
        scrubbing.value = false;
      });

    const tap = Gesture.Tap().onEnd((event) => {
      apply(event.x);
      runOnJS(commit)(progress.value);
    });

    return Gesture.Exclusive(pan, tap);
  }, [playback, progress, scrubbing, width, notch]);

  /**
   * The moving clip for the bright layer.
   *
   * A window slid left of the strip by the unplayed fraction, whose child
   * counter-translates by the same amount: the intersection that stays visible
   * is exactly the played left portion. Two transforms, no width animation, no
   * layout pass — and crucially no overlay painting the gaps between bars.
   */
  const clipStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (progress.value - 1) * width.value }],
  }));
  const counterStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - progress.value) * width.value }],
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    const w = event.nativeEvent.layout.width;
    width.value = w;
    setContainerWidth(w);
  };

  const drawBars = (opacity: number) => (
    <View
      className="flex-row items-center justify-between"
      style={{ height, opacity }}
      pointerEvents="none"
    >
      {heights.map((h, i) => (
        <View
          key={i}
          style={{
            width: BAR_WIDTH,
            height: Math.max(BAR_WIDTH, h * height),
            borderRadius: BAR_WIDTH / 2,
            backgroundColor: bar,
          }}
        />
      ))}
    </View>
  );

  const content = (
    <View>
      {/* The whole wave, knocked back — what "not yet played" looks like. */}
      {drawBars(available ? AHEAD_OPACITY : 1)}

      {/* The played region: the same bars at full strength, revealed by the
          sliding clip window above the dim layer. */}
      {available && containerWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: "absolute", left: 0, top: 0, bottom: 0, right: 0, overflow: "hidden" },
            clipStyle,
          ]}
        >
          <Animated.View style={[{ width: containerWidth }, counterStyle]}>
            {drawBars(1)}
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );

  // A transcript-only meeting still gets the wave, just not the scrub gesture.
  if (!available) {
    return (
      <View style={{ paddingVertical: padding }} onLayout={onLayout}>
        {content}
      </View>
    );
  }

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={{ paddingVertical: padding }}
        onLayout={onLayout}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Playback position"
        accessibilityHint="Swipe up or down to move through the recording"
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "increment") playback.skip(15);
          else if (event.nativeEvent.actionName === "decrement") playback.skip(-15);
        }}
      >
        {content}
      </View>
    </GestureDetector>
  );
}
