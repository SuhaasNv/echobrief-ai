import { memo, useMemo } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion } from "react-native-reanimated";

import { ORB_COLOR } from "./orb/palette";
import { useOrbEngine, type OrbPhase } from "./orb/engine";
import { Aperture, Bloom, Capture, Core, Mass, centered } from "./orb/layers";

/**
 * The record orb — the one thing on this screen that has to look alive.
 *
 * It is a light source, not a diagram. There is no stroke, no outline and no
 * shape with a hard edge anywhere in it: every silhouette is produced by
 * falloff. The form is an aperture of light with three anchored colour masses
 * drifting inside it, all of it sitting in a halo that bleeds past the orb's
 * nominal radius into the canvas.
 *
 * WHAT IT HAS TO DO AT REST is the constraint that shaped the current version.
 * The state a user sees for nearly all of the time they spend on this screen is
 * `armed` — no signal, nothing to react to. An earlier version put four soft
 * blue-ish masses concentric with each other, wandering by 5% of the diameter,
 * under a hot centred core and two blue halo shells. Every one of those choices
 * is individually defensible and together they average out: three overlapping
 * gradients of similar hue with a common centre ARE one gradient. It resolved
 * into a composition only under a loud signal, so the state it actually shipped
 * in was a blue radial gradient with a bright dot in it — no violet, no green,
 * no structure, and nothing to say the instrument was armed rather than merely
 * switched on.
 *
 * Three changes fix it, and none of them is "add more colour":
 *
 *   The interior is now a constellation, not a stack. Each mass has a permanent
 *   anchor 12-16% of the diameter from centre and wanders inside its own region.
 *   Blue sits low and right, violet high and left, green small and high and
 *   right. They are distinguishable in silence because they are in different
 *   places, which is a property no blend mode can take away.
 *
 *   The widest layer was inverted into an aperture. It used to be a 0.92 blue
 *   disc washing out everything drawn on top of it; it is now an annulus that
 *   clears the centre and rings the masses. A ring is structure, and structure
 *   is what says "open and pointed at you" instead of "on".
 *
 *   The halo and core were pulled back. They were the loudest things in the
 *   armed frame and both of them are undifferentiated light. They now sit under
 *   the composition rather than over it, and both come back up on input.
 *
 * The construction is deliberate, and each choice rules out a failure:
 *
 *   No Skia. Every mass is a react-native-svg radial gradient whose outer stop
 *   is fully transparent, which is how you get a soft-edged mass without a
 *   shader or a blur.
 *
 *   No blur filter. The halo is stacked, progressively larger and fainter
 *   gradients. `feGaussianBlur` support in react-native-svg is uneven and it
 *   fails by rendering nothing — a halo that silently disappears on some
 *   devices is worse than one built the long way.
 *
 *   Non-commensurate periods (13/17/23/29s drift, 31/19.5/41/24.5s rotation).
 *   Any two layers with a common period eventually re-align, and the moment the
 *   eye catches the loop the orb becomes a graphic again.
 *
 *   Transform and opacity only. No layer's `width`, `height`, `r` or
 *   `borderRadius` is ever touched — those force layout or re-tessellation
 *   every frame. This is the same rule that took the live waveform from 60% CPU
 *   to 6%.
 *
 *   Eight animated layers, and that is the ceiling. Past that the answer is to
 *   make these better, not to add a ninth.
 *
 * There are no haptics here and there must never be: iOS suppresses the Taptic
 * Engine while the microphone is live, so the call would succeed and produce
 * nothing at all.
 */

export type { OrbPhase };

/**
 * The drawing surface, as a multiple of the orb's nominal size.
 *
 * Larger than 1 on purpose. A halo that stops at the layout box has an edge,
 * and an edge is the thing this component exists to avoid — the outermost bloom
 * has to be free to fade out in open canvas. The overflow is only ever a few
 * percent of opacity, so it bleeds into the surrounding layout as light rather
 * than colliding with it.
 */
const STAGE = 1.34;

/**
 * Layer diameters, as fractions of the nominal size.
 *
 * The masses are much smaller than they were (0.8/0.72/0.52 -> 0.62/0.5/0.34).
 * Three masses that each span three quarters of the orb cannot be told apart no
 * matter where you put them, because their falloffs overlap everywhere; at these
 * sizes an anchor of 14% of the diameter genuinely separates them.
 */
const SIZE = {
  bloomFar: STAGE,
  bloomNear: 1.02,
  aperture: 0.98,
  massBlue: 0.62,
  massViolet: 0.5,
  massGreen: 0.34,
  core: 0.3,
  capture: 0.34,
} as const;

/**
 * Resting positions, as fractions of the nominal size.
 *
 * A triangle rather than a line, and deliberately not an equilateral one: three
 * masses evenly spaced around a centre read as a loading spinner. Blue is
 * nearest the middle because it is the body of the thing; violet is thrown
 * furthest because it is the hue that has to survive being outnumbered; green
 * is high and tight, small enough that it reads as an accent on the composition
 * rather than as a third equal party in it.
 */
const ANCHOR = {
  blue: { x: 0.088, y: 0.072 },
  violet: { x: -0.142, y: -0.112 },
  green: { x: 0.116, y: -0.138 },
} as const;

export interface RecordOrbProps {
  /** Normalized input level 0..1, arriving as React state at ~10Hz. */
  level: number;
  phase: OrbPhase;
  /** Overall diameter in points. Callers should scale this to the viewport. */
  size?: number;
  /**
   * Whether the screen holding this orb is the one on screen.
   *
   * Not optional in practice. The tab navigator keeps every tab's screen
   * mounted, so an orb whose clocks are not gated on this keeps running two
   * repeat loops and eight animated styles on the UI thread for the entire time
   * the user is reading a transcript on another tab.
   */
  focused?: boolean;
}

function RecordOrbComponent({ level, phase, size = 264, focused = true }: RecordOrbProps) {
  const reducedMotion = useReducedMotion();
  const { energy, breath, settle, live, awake, pulse, clocks } = useOrbEngine(
    level,
    phase,
    reducedMotion,
    focused,
  );

  const stage = size * STAGE;
  const stageStyle = useMemo(() => centered(size, stage), [size, stage]);

  /**
   * The global response.
   *
   * Overall scale lives on the container so it multiplies through everything —
   * halo, masses and core all grow together — while each layer's own gain adds
   * the differential on top. Doing it per-layer instead would make the orb
   * inflate without its light travelling any further, which is the difference
   * between "bigger" and "brighter".
   */
  const stageAnimation = useAnimatedStyle(() => ({
    transform: [
      {
        scale:
          (1 + breath.value * 0.035 + energy.value * 0.13) * (1 - settle.value * 0.05),
      },
    ],
  }));

  const label =
    phase === "recording"
      ? "Input level"
      : phase === "paused"
        ? "Recording paused"
        : "Ready to record";

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <Animated.View pointerEvents="none" style={[stageStyle, stageAnimation]}>
        {/* Halo. Two shells, back to front, neither individually legible. The
            far one is violet at heart and blue at the rim, so the bloom cools
            as it travels outward instead of reading as a flat wash.

            Both are roughly half as bright at rest as they were. They are the
            only two layers with no internal detail at all, so every point of
            opacity they carry while armed is a point of contrast taken away
            from the layers that do. `lift` is raised to compensate: the halo is
            still the loudest thing in the frame under a real signal, which is
            where a halo should be loud. */}
        <Bloom
          stage={stage}
          diameter={size * SIZE.bloomFar}
          inner={ORB_COLOR.violet}
          outer={ORB_COLOR.blue}
          peak={0.34}
          base={0.24}
          wake={0.16}
          lift={0.7}
          gain={0.26}
          drift={0.05}
          fade={0.45}
          energy={energy}
          breath={breath}
          settle={settle}
          awake={awake}
        />
        <Bloom
          stage={stage}
          diameter={size * SIZE.bloomNear}
          inner={ORB_COLOR.blue}
          outer={ORB_COLOR.blue}
          peak={0.4}
          base={0.22}
          wake={0.13}
          lift={0.6}
          gain={0.2}
          drift={0.07}
          fade={0.4}
          energy={energy}
          breath={breath}
          settle={settle}
          awake={awake}
        />

        {/* The aperture, behind the masses and in front of the halo. Widest
            structure in the orb and the only one present at full strength while
            armed — the ring IS the armed state. It dims to 40% once capturing,
            because by then the masses are moving to a real signal and the
            instrument no longer has to advertise that it is ready. */}
        <Aperture
          stage={stage}
          diameter={size * SIZE.aperture}
          squash={0.94}
          direction={1}
          rest={0.72}
          capturing={0.4}
          lift={0.18}
          gain={0.16}
          drift={0.045}
          dilate={0.022}
          survives={0.5}
          orbit={clocks[2].orbit}
          spin={clocks[2].spin}
          energy={energy}
          breath={breath}
          settle={settle}
          awake={awake}
        />

        {/* The three masses, largest first. Blue is the body and is drawn first
            so the other two read against it; violet is the only mass allowed to
            approach blue's weight, and green is a third of the diameter at half
            the opacity — visible as a cool teal accent in the upper right and
            never more than that.

            `armed` is high on all three (0.82-0.92) rather than the 0.55-0.85 it
            was. Dimming the masses in the state with nothing else in it was
            backwards: armed is the state that needs them most, and brightness
            here costs nothing because the halo and core stepped back to pay
            for it. */}
        <Mass
          stage={stage}
          diameter={size * SIZE.massBlue}
          color={ORB_COLOR.blue}
          peak={0.92}
          squash={0.8}
          anchorX={size * ANCHOR.blue.x}
          anchorY={size * ANCHOR.blue.y}
          reachX={size * 0.045}
          reachY={size * 0.038}
          offset={0}
          direction={1}
          base={0.86}
          armed={0.93}
          lift={0.22}
          gain={0.14}
          drift={0.11}
          survives={0.62}
          orbit={clocks[0].orbit}
          spin={clocks[0].spin}
          energy={energy}
          breath={breath}
          settle={settle}
          awake={awake}
        />
        <Mass
          stage={stage}
          diameter={size * SIZE.massViolet}
          color={ORB_COLOR.violet}
          peak={0.9}
          squash={0.74}
          anchorX={size * ANCHOR.violet.x}
          anchorY={size * ANCHOR.violet.y}
          reachX={size * 0.052}
          reachY={size * 0.058}
          offset={0.37}
          direction={-1}
          base={0.82}
          armed={0.93}
          lift={0.2}
          gain={0.17}
          drift={-0.13}
          survives={0.34}
          orbit={clocks[1].orbit}
          spin={clocks[1].spin}
          energy={energy}
          breath={breath}
          settle={settle}
          awake={awake}
        />
        <Mass
          stage={stage}
          diameter={size * SIZE.massGreen}
          color={ORB_COLOR.green}
          peak={0.8}
          squash={0.68}
          anchorX={size * ANCHOR.green.x}
          anchorY={size * ANCHOR.green.y}
          reachX={size * 0.058}
          reachY={size * 0.05}
          offset={0.15}
          direction={-1}
          base={0.56}
          armed={0.88}
          lift={0.18}
          gain={0.22}
          drift={-0.16}
          survives={0.2}
          orbit={clocks[3].orbit}
          spin={clocks[3].spin}
          energy={energy}
          breath={breath}
          settle={settle}
          awake={awake}
        />

        <Core
          stage={stage}
          diameter={size * SIZE.core}
          energy={energy}
          breath={breath}
          settle={settle}
          live={live}
          awake={awake}
        />

        {/* Last, so nothing composites over it. Present only while capturing. */}
        <Capture
          stage={stage}
          diameter={size * SIZE.capture}
          energy={energy}
          pulse={pulse}
          live={live}
        />
      </Animated.View>
    </View>
  );
}

/**
 * The screen re-renders about ten times a second as the duration ticks, and
 * `level` genuinely changes on most of those, so this component cannot avoid
 * re-rendering. What it can do — and what `memo` here plus `memo` on every
 * layer achieves — is make that re-render stop at the props comparison instead
 * of walking eight subtrees of SVG. The only thing a level change is allowed to
 * cost is one shared-value assignment.
 */
export const RecordOrb = memo(RecordOrbComponent);
