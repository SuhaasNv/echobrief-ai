import { useEffect, useMemo } from "react";
import {
  Easing,
  cancelAnimation,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
  type WithTimingConfig,
} from "react-native-reanimated";

import { SPRING, TIMING } from "@/lib/motion";

/**
 * The orb's clockwork.
 *
 * Every value the orb draws from lives here, and every one of them is a
 * Reanimated shared value: the record screen re-renders about ten times a
 * second as the level and the duration tick, and not one of those renders is
 * allowed to produce a frame. React's only job is to assign a target; the
 * interpolation between targets happens entirely on the UI thread.
 *
 * Nothing in here knows what the orb looks like. It publishes scalars; the
 * layers decide what to do with them.
 */

export type OrbPhase = "armed" | "recording" | "paused";

/**
 * Level release. Attack is TIMING.meter (50ms) so the orb never lags the voice.
 * Release is slower on purpose: a meter that falls as fast as it rises strobes
 * on consonants, because speech is mostly gaps.
 *
 * 220ms, down from 420ms. Syllables arrive 125–250ms apart, so a 420ms release
 * never reached the floor between two of them — the orb sat pinned near its
 * peak for the whole of a sentence and only sagged during real pauses, which
 * is precisely the "floating, not reacting" read. At 220ms it still integrates
 * across a consonant but recovers enough between syllables for the rhythm of
 * speech to show.
 */
const RELEASE: WithTimingConfig = { duration: 220, easing: Easing.out(Easing.quad) };

/**
 * Pause. Long and monotonic — the light has to be seen coasting to a stop, not
 * caught already stopped. A spring is wrong here: overshoot would read as the
 * orb flinching.
 */
const SETTLE_IN: WithTimingConfig = { duration: 950, easing: Easing.out(Easing.cubic) };
/** Resume is not the reverse of pause. Coming back to life should be quick. */
const SETTLE_OUT: WithTimingConfig = { duration: 380, easing: Easing.out(Easing.quad) };

/** Ambient breath. Slow enough to read as respiration rather than as a pulse. */
const BREATH_MS = 5600;
/** Capture indicator blink. Independent of level, so it is visible in silence. */
const PULSE_MS = 1150;

/**
 * Seconds per orbit and per rotation for each of the four colour masses.
 *
 * Chosen to be mutually non-commensurate. With these, the composite's true
 * period is on the order of days, so there is no arrangement a user can watch
 * long enough to recognise as a repeat — the interior keeps changing colour
 * without anything ever obviously looping.
 */
const ORBIT_SECONDS = [13, 17, 23, 29] as const;
const SPIN_SECONDS = [31, 19.5, 41, 24.5] as const;

/** Recording runs the same clockwork faster. Armed is deliberately languid. */
const RECORDING_TEMPO = 0.68;

/**
 * Static pose for reduced motion, in turns.
 *
 * Not zeros. Zeroed clocks would stack every mass concentrically and collapse
 * the orb into the flat disc this component was rebuilt to escape. These offsets
 * hold the masses apart and their ellipses at different angles, so the still
 * frame is a composed image rather than an animation caught at t=0.
 */
const STILL_ORBIT = [0, 0.28, 0.55, 0.81] as const;
const STILL_SPIN = [0.05, 0.31, 0.62, 0.88] as const;

/**
 * Input shaping.
 *
 * `level` arrives already normalised against a -50 dBFS floor, which puts room
 * tone near 0.1 and ordinary speech between roughly 0.5 and 0.8 — a band too
 * narrow, and too far from either end, to drive a visible response directly.
 * Gating the bottom and pulling the top down to 0.85 spends the whole 0..1
 * range on the part of the signal that is actually speech.
 */
const GATE = 0.12;
const CEILING = 0.85;

type Easer = NonNullable<WithTimingConfig["easing"]>;

/**
 * Restart a 0..1 ping-pong from wherever it was left, without clipping it.
 *
 * `withRepeat(withTiming(1, …), -1, true)` is the obvious way to write a
 * ping-pong and it is only correct from a known endpoint. Reanimated reverses
 * between the value the animation STARTED at and its target, so resuming a
 * breath that was frozen at 0.62 would oscillate 0.62..1 forever — a third of
 * the depth, permanently, and no error anywhere to notice. The leading leg walks
 * the value up to 1 taking only the time that remains of that leg, and the loop
 * proper then runs 1..0 from an endpoint where the reversal is right.
 */
function pingPong(from: number, period: number, easing: Easer) {
  const remaining = Math.max(0.02, 1 - from);
  return withSequence(
    withTiming(1, { duration: period * remaining, easing }),
    withRepeat(withTiming(0, { duration: period, easing }), -1, true),
  );
}

function shapeLevel(raw: number): number {
  // Called from a worklet now, so it has to be one.
  "worklet";
  const clamped = Math.max(0, Math.min(1, raw));
  const gated = (clamped - GATE) / (CEILING - GATE);
  const normalized = Math.max(0, Math.min(1, gated));
  // Mild expansion of the lower half. Monotonic, so a quieter room can never
  // produce a brighter orb.
  return Math.pow(normalized, 0.85);
}

/** One colour mass's pair of independent clocks. */
export interface OrbClock {
  /** 0..1 wrapping. Drives the drift path. */
  orbit: SharedValue<number>;
  /** 0..1 wrapping. Drives the ellipse's rotation. */
  spin: SharedValue<number>;
}

export interface OrbEngine {
  /** Shaped, envelope-smoothed input level, 0..1. */
  energy: SharedValue<number>;
  /** Centred ambient breath, roughly -0.5..0.5, scaled by phase. */
  breath: SharedValue<number>;
  /** 0..1, reaching 1 when fully paused. */
  settle: SharedValue<number>;
  /** 0..1, 1 while capturing. Gates the red presence. */
  live: SharedValue<number>;
  /** 0..1, 1 while capturing. Lifts overall brightness out of the armed state. */
  awake: SharedValue<number>;
  /** 0..1 ping-pong. The capture indicator's own heartbeat. */
  pulse: SharedValue<number>;
  clocks: readonly [OrbClock, OrbClock, OrbClock, OrbClock];
}

/**
 * @param focused Whether the screen holding the orb is the one on screen.
 *
 * Not a nicety. The tab navigator keeps every tab's screen mounted for the life
 * of the app, so the record screen is still rendered — and its shared values are
 * still animating — while the user is reading a transcript, asking a question or
 * sitting in Account. Ten shared values under repeat animations keep every
 * `useAnimatedStyle` that reads them re-evaluating on every single frame, which
 * is eight SVG-wrapping layers' worth of worklet on the UI thread, forever,
 * driving nothing anybody can see.
 *
 * Blur freezes every clock where it stands rather than resetting it, and focus
 * restarts each one from that value. Nothing jumps, because a clock's loop
 * period is exactly one turn and every layer reads its clock through a sin, a
 * cos or a rotation — one whole turn later is the same picture, so there is no
 * position in the cycle that is a worse place to resume from than any other.
 */
export function useOrbEngine(
  level: SharedValue<number>,
  phase: OrbPhase,
  reducedMotion: boolean,
  focused: boolean,
): OrbEngine {
  const energy = useSharedValue(0);
  const settle = useSharedValue(0);
  const live = useSharedValue(0);
  const awake = useSharedValue(0);
  const pulse = useSharedValue(0.5);

  // 0..1 ping-pong, and the amplitude it is scaled by. Kept apart so the
  // breath's depth can change with phase without interrupting its rhythm.
  const ambient = useSharedValue(0.5);
  const breathAmp = useSharedValue(1);

  const orbit0 = useSharedValue(0);
  const orbit1 = useSharedValue(0.28);
  const orbit2 = useSharedValue(0.55);
  const orbit3 = useSharedValue(0.81);
  const spin0 = useSharedValue(0.05);
  const spin1 = useSharedValue(0.31);
  const spin2 = useSharedValue(0.62);
  const spin3 = useSharedValue(0.88);

  const clocks = useMemo(
    () =>
      [
        { orbit: orbit0, spin: spin0 },
        { orbit: orbit1, spin: spin1 },
        { orbit: orbit2, spin: spin2 },
        { orbit: orbit3, spin: spin3 },
      ] as const,
    [orbit0, orbit1, orbit2, orbit3, spin0, spin1, spin2, spin3],
  );

  // One derived value instead of the same subtraction inside eight worklets.
  const breath = useDerivedValue(() => (ambient.value - 0.5) * breathAmp.value);

  /**
   * Follow the mic level, entirely on the UI thread.
   *
   * The level is a shared value written by the sampling loop 25 times a second,
   * so this reaction runs there too and React never sees a single one of them.
   * It was previously a useEffect on React state, which meant a render, a
   * commit and an effect between the microphone and the pixel — for a number
   * whose only destination was a worklet.
   *
   * Rising is tested against the previous sample rather than against
   * `energy.value`, because `energy.value` is mid-flight and reading it picks
   * the wrong envelope leg on roughly every other sample.
   */
  const previousLevel = useSharedValue(0);
  useAnimatedReaction(
    // Gated on focus, and this matters more than it looks: the recorder keeps
    // metering in the background, so an ungated follower would start a fresh
    // interpolation 25 times a second and keep every layer's worklet hot with
    // all the clocks frozen. Returning null parks the reaction entirely.
    () => (reducedMotion || !focused ? null : level.value),
    (raw) => {
      if (raw === null) return;
      const target = shapeLevel(raw);
      const rising = target > previousLevel.value;
      previousLevel.value = target;
      energy.value = withTiming(target, rising ? TIMING.meter : RELEASE);
    },
  );

  // Free-running loops: the breath and the capture heartbeat. Neither is tied
  // to phase, so neither is restarted by one — the breath's depth is changed by
  // scaling it, and the heartbeat is gated by `live` at the layer that uses it.
  // Restarting either on a state change would put a visible seam in it.
  useEffect(() => {
    if (reducedMotion) {
      ambient.value = 0.5;
      // Held at the top of the beat rather than mid-blink, so the reduced-motion
      // capture indicator is at full strength instead of arbitrarily dimmed.
      pulse.value = 1;
      return;
    }

    // Frozen mid-breath rather than parked at a neutral value. The orb has to
    // come back looking like it was never away, and resuming from wherever the
    // breath was is the only way to guarantee that — there is no correct value
    // to snap to, because the user did not see it stop.
    if (!focused) {
      cancelAnimation(ambient);
      cancelAnimation(pulse);
      return;
    }

    ambient.value = pingPong(ambient.value, BREATH_MS, Easing.inOut(Easing.sin));
    pulse.value = pingPong(pulse.value, PULSE_MS, Easing.inOut(Easing.quad));

    return () => {
      cancelAnimation(ambient);
      cancelAnimation(pulse);
    };
  }, [reducedMotion, focused, ambient, pulse]);

  useEffect(() => {
    const paused = phase === "paused";
    const recording = phase === "recording";

    if (reducedMotion) {
      settle.value = paused ? 1 : 0;
      live.value = recording ? 1 : 0;
      awake.value = recording ? 1 : 0;
      breathAmp.value = 0;
      energy.value = 0;
      orbit0.value = STILL_ORBIT[0];
      orbit1.value = STILL_ORBIT[1];
      orbit2.value = STILL_ORBIT[2];
      orbit3.value = STILL_ORBIT[3];
      spin0.value = STILL_SPIN[0];
      spin1.value = STILL_SPIN[1];
      spin2.value = STILL_SPIN[2];
      spin3.value = STILL_SPIN[3];
      return;
    }

    // Set unconditionally, before the focus gate. These are one-shot
    // interpolations that reach their target and stop, so running them while
    // blurred costs at most a second of worklet — and skipping them would leave
    // the orb showing the wrong phase on return, because the Dynamic Island can
    // pause and end a recording while this screen is not the one on screen.
    settle.value = withTiming(paused ? 1 : 0, paused ? SETTLE_IN : SETTLE_OUT);
    live.value = withTiming(recording ? 1 : 0, TIMING.crossfade);
    awake.value = withSpring(recording ? 1 : 0, SPRING.smooth);
    // Input takes over the breathing while capturing, so the ambient component
    // steps back rather than fighting it. Paused, it stops entirely.
    breathAmp.value = withTiming(paused ? 0 : recording ? 0.5 : 1, TIMING.backdrop);

    /** Stop every clock where it stands. No resets — the values are the state. */
    const freeze = () => {
      cancelAnimation(energy);
      cancelAnimation(orbit0);
      cancelAnimation(orbit1);
      cancelAnimation(orbit2);
      cancelAnimation(orbit3);
      cancelAnimation(spin0);
      cancelAnimation(spin1);
      cancelAnimation(spin2);
      cancelAnimation(spin3);
    };

    if (!focused) {
      freeze();
      // The one value that is reset rather than frozen. Everything else is
      // positional and resumes from where it was; energy is a reading of a
      // signal nobody is looking at, and leaving it frozen high would hold the
      // orb open on a level that stopped being true the moment we blurred.
      energy.value = 0;
      previousLevel.value = 0;
      return;
    }

    if (!recording) energy.value = withTiming(0, RELEASE);

    /**
     * A full turn is the loop's own period, so a linear repeat restarted from
     * wherever the value currently sits is seamless — every layer reads its
     * clock through sin/cos or a rotation, and one whole turn later is the same
     * picture. That is what lets the motion coast to a stop on pause, change
     * tempo between armed and recording, and pick straight back up on resume
     * without a jump at any of those transitions.
     */
    const run = (clock: SharedValue<number>, seconds: number) => {
      cancelAnimation(clock);
      clock.value = withRepeat(
        withTiming(clock.value + 1, { duration: seconds * 1000, easing: Easing.linear }),
        -1,
        false,
      );
    };
    /** Carry the last of the momentum and stop. Frozen light, not switched off. */
    const coast = (clock: SharedValue<number>) => {
      cancelAnimation(clock);
      clock.value = withTiming(clock.value + 0.035, SETTLE_IN);
    };

    if (paused) {
      coast(orbit0);
      coast(orbit1);
      coast(orbit2);
      coast(orbit3);
      coast(spin0);
      coast(spin1);
      coast(spin2);
      coast(spin3);
    } else {
      const tempo = recording ? RECORDING_TEMPO : 1;
      run(orbit0, ORBIT_SECONDS[0] * tempo);
      run(orbit1, ORBIT_SECONDS[1] * tempo);
      run(orbit2, ORBIT_SECONDS[2] * tempo);
      run(orbit3, ORBIT_SECONDS[3] * tempo);
      run(spin0, SPIN_SECONDS[0] * tempo);
      run(spin1, SPIN_SECONDS[1] * tempo);
      run(spin2, SPIN_SECONDS[2] * tempo);
      run(spin3, SPIN_SECONDS[3] * tempo);
    }

    // Teardown lives here rather than only in the ambient effect, so nothing is
    // left animating after unmount regardless of which phase we were in when
    // the screen went away.
    return freeze;
  }, [
    phase,
    reducedMotion,
    focused,
    previousLevel,
    settle,
    live,
    awake,
    breathAmp,
    energy,
    orbit0,
    orbit1,
    orbit2,
    orbit3,
    spin0,
    spin1,
    spin2,
    spin3,
  ]);

  return useMemo(
    () => ({ energy, breath, settle, live, awake, pulse, clocks }),
    [energy, breath, settle, live, awake, pulse, clocks],
  );
}
