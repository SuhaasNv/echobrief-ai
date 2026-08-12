import { Easing, type WithSpringConfig, type WithTimingConfig } from "react-native-reanimated";

/**
 * Motion tokens.
 *
 * The web app's language does not port. Two things are deliberately dropped:
 *
 *   Scroll reveals. The web fades content in on whileInView. Native lists never
 *   do this — UITableView cells simply appear — and a staggered scroll reveal is
 *   the loudest "this is a web view" signal there is.
 *
 *   The [0.22, 1, 0.36, 1] curve. A fixed cubic-bezier cannot absorb gesture
 *   velocity, so a sheet grabbed mid-flight stops dead and restarts. iOS motion
 *   is spring-driven and velocity-continuous.
 *
 * Timing curves survive only for non-interactive, monotonic things: opacity,
 * backdrops, and progress.
 */

/**
 * Build a Reanimated spring from SwiftUI's mental model.
 *
 * SwiftUI thinks in (duration, bounce); Reanimated solves
 * m·x'' + c·x' + k·x = 0. The conversion:
 *
 *   ζ = 1 − bounce
 *   k = (2π / duration)² · mass
 *   c = 2 · ζ · √(k · mass)
 *
 * Verified against Apple's own worked example: Spring(duration: 0.5,
 * bounce: 0.3) documents mass 1.0, stiffness 157.9, damping 17.6 — which is
 * exactly what spring(0.5, 0.7) returns below.
 *
 * @param duration Undamped period in seconds (SwiftUI `duration` / `response`).
 * @param zeta     Damping ratio (SwiftUI `dampingFraction`; bounce = 1 − zeta).
 */
export function spring(duration: number, zeta: number, mass = 1): WithSpringConfig {
  "worklet";
  const w0 = (2 * Math.PI) / duration;
  const stiffness = w0 * w0 * mass;

  return {
    mass,
    stiffness,
    damping: 2 * zeta * Math.sqrt(stiffness * mass),
    // Replaced restDisplacementThreshold / restSpeedThreshold in Reanimated 4.
    energyThreshold: 6e-9,
  };
}

/**
 * Reanimated's own withSpring defaults are mass 4 / stiffness 900 / damping 120,
 * which is nothing like iOS. Always pass one of these instead.
 *
 * Rule encoded here: size and damping are inversely related. Small chips may
 * bounce; full-width surfaces must not. Anything carrying text you have to read
 * mid-flight is critically damped.
 */
export const SPRING = {
  /** Finger-tracking. Must resolve faster than the user perceives latency. */
  pressIn: spring(0.15, 0.9),
  pressOut: spring(0.25, 0.8),
  /** Default for anything mid-sized that isn't a sheet. SwiftUI .snappy. */
  snappy: spring(0.5, 0.85),
  /** Zero overshoot. SwiftUI .smooth. */
  smooth: spring(0.45, 1.0),
  /** Full-width surfaces. A bouncing sheet reads as a toy. */
  sheet: spring(0.45, 1.0),
  sheetOut: spring(0.35, 1.0),
  /** Small, transient, wants attention. The one place bounce is correct. */
  bouncy: spring(0.5, 0.7),
  /** Sub-frame chrome: tab icon, chip selection. High frequency, so no bounce. */
  chrome: spring(0.35, 1.0),
} as const;

/**
 * Timing, for things with no mass.
 *
 * `progress` is timing and not a spring on purpose: a spring overshoots past
 * its target, so an upload bar would report more progress than actually
 * happened and then visibly walk backwards.
 */
export const TIMING = {
  backdrop: { duration: 250, easing: Easing.out(Easing.quad) } satisfies WithTimingConfig,
  crossfade: { duration: 180, easing: Easing.inOut(Easing.quad) } satisfies WithTimingConfig,
  progress: { duration: 300, easing: Easing.out(Easing.cubic) } satisfies WithTimingConfig,
  instant: { duration: 100, easing: Easing.out(Easing.quad) } satisfies WithTimingConfig,
  /** Audio meters must not lag the signal they represent. */
  meter: { duration: 80, easing: Easing.linear } satisfies WithTimingConfig,
} as const;

/** Press feedback scale. Cards and buttons only — never full-width list rows. */
export const PRESS_SCALE = 0.97;
