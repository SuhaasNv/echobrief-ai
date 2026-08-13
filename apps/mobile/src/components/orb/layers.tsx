import { memo, useMemo } from "react";
import type { ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import Svg, { Circle, Defs, Ellipse, RadialGradient, Stop } from "react-native-svg";

import { ORB_COLOR, nextGradientId } from "./palette";

/**
 * The orb's drawable layers.
 *
 * Everything here is the same object: a square `Svg` holding one shape filled
 * with a radial gradient whose outermost stop is at zero opacity, wrapped in an
 * `Animated.View` that does all the moving. Consequences worth stating plainly,
 * because each one is a rule this component is not allowed to break:
 *
 * 1. There is no stroke anywhere and no shape with a hard edge. The silhouette
 *    is produced by falloff, not by an outline, which is the whole difference
 *    between light and a diagram. Any layer whose final stop is not
 *    `stopOpacity={0}` will show a circular seam against the canvas.
 *
 * 2. The SVG never changes. Not one attribute is animated — no `r`, no `cx`, no
 *    gradient stop. Only the wrapper's `transform` and `opacity` move, both of
 *    which are layer properties the compositor handles without re-rasterising
 *    anything. Animating `r` would re-tessellate the shape every frame, which is
 *    the same mistake that had the old waveform at 60% CPU against 6% once it
 *    was rebuilt on transforms.
 *
 * 3. The bloom is stacked gradients, not a blur filter. `feGaussianBlur` support
 *    in react-native-svg is uneven and fails by silently rendering nothing,
 *    which would take the halo away without any error to notice.
 *
 * 4. Every layer is `memo`'d and takes only numbers, strings and shared values.
 *    The screen re-renders ~10x/sec; those renders reach the props comparison
 *    and stop there.
 */

const TAU = Math.PI * 2;

/**
 * Absolutely centre a `diameter`-wide layer inside a `stage`-wide box.
 *
 * Explicit insets rather than flex alignment: the stage is deliberately larger
 * than the orb's nominal size so the halo can bleed past it, and centring by
 * layout would have to fight that.
 */
export function centered(stage: number, diameter: number): ViewStyle {
  return {
    position: "absolute",
    width: diameter,
    height: diameter,
    left: (stage - diameter) / 2,
    top: (stage - diameter) / 2,
  };
}

/**
 * Where two masses overlap, the brighter of the two should win rather than the
 * nearer one. `screen` is what makes the crossings brighten and the accent hue
 * surface, instead of the top layer simply occluding what is under it.
 *
 * It degrades safely. If the platform ignores it, compositing falls back to
 * plain alpha over a near-black canvas, which is close to identical everywhere
 * except in the overlaps — so a no-op costs the colour mixing and nothing else.
 * That is the opposite of the blur-filter failure mode, where a no-op would
 * remove the effect entirely.
 */
const LUMINOUS: ViewStyle = { mixBlendMode: "screen" };

interface BloomProps {
  stage: number;
  diameter: number;
  /** Inner colour of the halo. */
  inner: string;
  /** Outer colour, which always fades to fully transparent. */
  outer: string;
  /** Peak opacity of the inner stop. */
  peak: number;
  /** Opacity at rest, while armed. */
  base: number;
  /** Added to opacity once capturing. */
  wake: number;
  /** Added to opacity at full input. */
  lift: number;
  /** Added to scale at full input. This is what makes the halo visibly extend. */
  gain: number;
  /** Ambient breath amplitude. */
  drift: number;
  /** Fraction of brightness lost to a full pause. */
  fade: number;
  energy: SharedValue<number>;
  breath: SharedValue<number>;
  settle: SharedValue<number>;
  awake: SharedValue<number>;
}

/**
 * A halo shell.
 *
 * Two of these stack behind the colour masses. They carry no detail and are
 * never individually legible — their whole job is to put light into the
 * background beyond the orb's nominal radius, so the form has no boundary you
 * could point at.
 */
export const Bloom = memo(function Bloom({
  stage,
  diameter,
  inner,
  outer,
  peak,
  base,
  wake,
  lift,
  gain,
  drift,
  fade,
  energy,
  breath,
  settle,
  awake,
}: BloomProps) {
  const geometry = useMemo(() => centered(stage, diameter), [stage, diameter]);
  const gradient = useMemo(() => nextGradientId("orbBloom"), []);

  const style = useAnimatedStyle(() => ({
    // Clamped rather than tuned to stay under 1. The halo's whole job is to be
    // as loud as the input allows, so `base + wake + lift` is deliberately
    // written past full brightness — this is where it is made legal.
    opacity:
      Math.min(1, base + wake * awake.value + lift * energy.value) *
      (1 - settle.value * fade),
    transform: [{ scale: 1 + breath.value * drift + energy.value * gain }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[geometry, style]}>
      <Svg width={diameter} height={diameter}>
        <Defs>
          <RadialGradient id={gradient} cx="50%" cy="50%" r="50%">
            {/* Four stops rather than two. A linear ramp reads as a cone with a
                visible apex; this holds density through the middle and then
                lets go, which is what a light source actually does. */}
            <Stop offset="0" stopColor={inner} stopOpacity={peak} />
            <Stop offset="0.34" stopColor={inner} stopOpacity={peak * 0.68} />
            <Stop offset="0.62" stopColor={outer} stopOpacity={peak * 0.32} />
            <Stop offset="0.84" stopColor={outer} stopOpacity={peak * 0.09} />
            <Stop offset="1" stopColor={outer} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={diameter / 2} cy={diameter / 2} r={diameter / 2} fill={`url(#${gradient})`} />
      </Svg>
    </Animated.View>
  );
});

interface ApertureProps {
  stage: number;
  diameter: number;
  /** Vertical squash. Below 1 makes an ellipse, so its rotation is legible. */
  squash: number;
  /** 1 or -1. Opposed to the mass it shares a clock family with. */
  direction: number;
  /** Opacity while armed. This layer's loudest state, by design. */
  rest: number;
  /** Fraction of `rest` still present while capturing. */
  capturing: number;
  /** Added to opacity at full input. */
  lift: number;
  /** Added to scale at full input. This is the iris opening. */
  gain: number;
  /** Ambient breath amplitude. */
  drift: number;
  /** Second dilation, driven off the orbit clock rather than the breath. */
  dilate: number;
  /** Fraction of brightness that survives a full pause. */
  survives: number;
  orbit: SharedValue<number>;
  spin: SharedValue<number>;
  energy: SharedValue<number>;
  breath: SharedValue<number>;
  settle: SharedValue<number>;
  awake: SharedValue<number>;
}

/**
 * The aperture — the widest thing inside the halo, and the reason the armed orb
 * reads as an instrument rather than as a lamp.
 *
 * This layer used to be a fourth colour mass: a 0.92-diameter blue disc sitting
 * under the other three. That was the single largest contributor to the "one
 * blue radial gradient" failure, because a wide, soft, centred blue wash under
 * three narrower centred blue-ish washes is indistinguishable from one wash. It
 * flattened everything drawn on top of it.
 *
 * Inverting it fixes both problems at once. The gradient is now annular — fully
 * transparent through the middle, densest at 0.78 of the radius — so it clears
 * the centre for the masses instead of washing them out, and what it leaves
 * behind is a ring of light around them. A ring is structure. It says the
 * instrument is open and pointed at you, which is what "armed" actually means,
 * and it says it in the state the user spends most of their time in.
 *
 * It is still not a stroke and still has no edge: the density ramps up across
 * 0.34 of the radius and back down across 0.22 of it, which at a 270pt orb is
 * roughly 45pt in and 30pt out. There is nowhere on it you could point to and
 * call a boundary.
 *
 * It is loudest while armed and steps back while capturing, which is the
 * opposite of every other layer here. Once audio is arriving, the masses and the
 * capture presence carry the state and the ring's job is done.
 */
export const Aperture = memo(function Aperture({
  stage,
  diameter,
  squash,
  direction,
  rest,
  capturing,
  lift,
  gain,
  drift,
  dilate,
  survives,
  orbit,
  spin,
  energy,
  breath,
  settle,
  awake,
}: ApertureProps) {
  const geometry = useMemo(() => centered(stage, diameter), [stage, diameter]);
  const gradient = useMemo(() => nextGradientId("orbAperture"), []);

  const style = useAnimatedStyle(() => {
    const e = energy.value;

    return {
      opacity:
        Math.min(1, rest * (capturing + (1 - capturing) * (1 - awake.value)) + lift * e) *
        (1 - settle.value * (1 - survives)),
      transform: [
        { rotate: `${(spin.value * direction * 360) % 360}deg` },
        {
          // Two dilations on non-commensurate clocks. The breath alone is a
          // 5.6s loop, and a ring is a regular enough shape that the eye finds
          // a 5.6s loop in it within about three cycles; the orbit term is
          // 23s and never lands in phase with it, so the iris keeps opening and
          // closing by a different amount every time.
          scale:
            1 +
            breath.value * drift +
            Math.sin(orbit.value * TAU) * dilate +
            e * gain,
        },
      ],
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[geometry, LUMINOUS, style]}>
      <Svg width={diameter} height={diameter}>
        <Defs>
          <RadialGradient id={gradient} cx="50%" cy="50%" r="50%">
            {/* Transparent well through the middle. This is the whole point:
                the masses live in here and nothing may be laid over them. */}
            <Stop offset="0" stopColor={ORB_COLOR.blue} stopOpacity={0} />
            <Stop offset="0.44" stopColor={ORB_COLOR.blue} stopOpacity={0} />
            <Stop offset="0.63" stopColor={ORB_COLOR.blue} stopOpacity={0.26} />
            <Stop offset="0.78" stopColor={ORB_COLOR.blue} stopOpacity={0.92} />
            <Stop offset="0.9" stopColor={ORB_COLOR.violet} stopOpacity={0.34} />
            <Stop offset="1" stopColor={ORB_COLOR.violet} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse
          cx={diameter / 2}
          cy={diameter / 2}
          rx={diameter / 2}
          ry={(diameter / 2) * squash}
          fill={`url(#${gradient})`}
        />
      </Svg>
    </Animated.View>
  );
});

interface MassProps {
  stage: number;
  diameter: number;
  color: string;
  /** Peak opacity of the gradient itself. Brightness is carried by the wrapper. */
  peak: number;
  /** Vertical squash. Below 1 makes an ellipse, so its rotation is legible. */
  squash: number;
  /**
   * Resting position relative to the orb's centre, in points.
   *
   * This is the fix for the orb reading as one blue blob. Every mass used to sit
   * concentric with every other mass, wandering by 5-6% of the diameter, which
   * at a 270pt orb is a 15pt excursion — far too small to separate three soft
   * gradients whose falloffs each span 100pt. They stacked, and stacked
   * gradients of similar hue average out to a single gradient.
   *
   * The anchor holds each mass in its own region of the interior permanently, so
   * the composition is legible in silence and not only at full input. The orbit
   * then wanders WITHIN that region rather than around the shared centre.
   */
  anchorX: number;
  anchorY: number;
  /** Orbit amplitude in points. */
  reachX: number;
  reachY: number;
  /** Phase offset in turns. Keeps the four masses from ever agreeing. */
  offset: number;
  /** 1 or -1. Opposed rotation is most of what stops this reading as a turntable. */
  direction: number;
  /** Opacity at rest, while capturing. */
  base: number;
  /** Fraction of `base` present while merely armed. */
  armed: number;
  /** Added to opacity at full input. */
  lift: number;
  /** Added to scale at full input. */
  gain: number;
  /** Ambient breath amplitude. Negative counter-moves against a neighbour. */
  drift: number;
  /** Fraction of brightness that survives a full pause. Low values desaturate. */
  survives: number;
  orbit: SharedValue<number>;
  spin: SharedValue<number>;
  energy: SharedValue<number>;
  breath: SharedValue<number>;
  settle: SharedValue<number>;
  awake: SharedValue<number>;
}

/**
 * How far a full-level signal throws the anchored masses apart.
 *
 * Lower than it looks. The anchor is already 12-16% of the diameter, so 0.42
 * moves a mass by another 5-7% of the orb at full input — the composite visibly
 * comes apart into its colours without any mass leaving the aperture.
 */
const SPREAD = 0.42;

/**
 * One luminous colour mass.
 *
 * Three of these, each anchored in its own part of the interior, are what the
 * orb is made of: blue low and right and largest, violet high and left, green
 * small and high and right. They sit inside the aperture ring rather than under
 * a fourth blue wash, and they no longer share a centre.
 *
 * That separation is deliberately positional and not compositional. `screen`
 * blending brightens the crossings and lifts the hue where two masses meet, and
 * it is worth having, but react-native's `mixBlendMode` is not guaranteed to
 * resolve on every device — and a composition that only exists when a blend mode
 * lands is a composition that is sometimes not there. Every mass here is legible
 * on the canvas by itself, at its resting position, in silence. Blending is the
 * bonus, never the mechanism.
 *
 * The drift path carries a second harmonic on each axis. A single sine per axis
 * is an ellipse, and an ellipse traversed at constant speed is recognisably a
 * mass on a wire; adding a faster term at a different phase makes the path
 * close on itself somewhere unexpected, which is what reads as organic.
 */
export const Mass = memo(function Mass({
  stage,
  diameter,
  color,
  peak,
  squash,
  anchorX,
  anchorY,
  reachX,
  reachY,
  offset,
  direction,
  base,
  armed,
  lift,
  gain,
  drift,
  survives,
  orbit,
  spin,
  energy,
  breath,
  settle,
  awake,
}: MassProps) {
  const geometry = useMemo(() => centered(stage, diameter), [stage, diameter]);
  const gradient = useMemo(() => nextGradientId("orbMass"), []);

  const style = useAnimatedStyle(() => {
    const e = energy.value;
    const angle = (orbit.value + offset) * TAU;

    // Loud input pushes the masses apart. The anchor is inside the multiplier,
    // not outside it: spreading only the wander would rock each mass in place,
    // whereas spreading the whole offset opens the constellation outward from
    // the centre, which is what reads as the orb coming apart into its colours.
    const spread = 1 + e * SPREAD;
    const wanderX =
      Math.cos(angle) * reachX + Math.cos(angle * 3 + offset * TAU) * reachX * 0.28;
    const wanderY =
      Math.sin(angle) * reachY + Math.sin(angle * 2 - offset * TAU) * reachY * 0.34;
    const x = (anchorX + wanderX) * spread;
    const y = (anchorY + wanderY) * spread;

    // Armed is dimmer than capturing, and a pause takes most of the violet and
    // green away while leaving the blues — the composite loses its hue without
    // any colour being animated, which is not something transforms can do.
    const brightness = base * (armed + (1 - armed) * awake.value) + lift * e;

    return {
      opacity: Math.min(1, brightness) * (1 - settle.value * (1 - survives)),
      transform: [
        { translateX: x },
        { translateY: y },
        { rotate: `${(spin.value * direction * 360) % 360}deg` },
        { scale: (1 + breath.value * drift + e * gain) * (1 - settle.value * 0.06) },
      ],
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[geometry, LUMINOUS, style]}>
      <Svg width={diameter} height={diameter}>
        <Defs>
          {/* objectBoundingBox units, so the gradient stretches with the
              ellipse and the falloff stays concentric to the shape instead of
              cutting across it. */}
          {/* Density is held further out than a mass gradient usually would,
              then dropped hard. A mass that starts falling off at 0.42 of its
              radius has no body — it is all penumbra, and three overlapping
              penumbrae average into exactly the featureless wash this orb was
              accused of being. Holding 72% of peak out to 0.36 and 28% out to
              0.66 gives each lobe a readable centre while the last 14% of the
              radius still takes it to zero, so there is no edge anywhere. */}
          <RadialGradient id={gradient} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={peak} />
            <Stop offset="0.36" stopColor={color} stopOpacity={peak * 0.72} />
            <Stop offset="0.66" stopColor={color} stopOpacity={peak * 0.28} />
            <Stop offset="0.86" stopColor={color} stopOpacity={peak * 0.07} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse
          cx={diameter / 2}
          cy={diameter / 2}
          rx={diameter / 2}
          ry={(diameter / 2) * squash}
          fill={`url(#${gradient})`}
        />
      </Svg>
    </Animated.View>
  );
});

interface CoreProps {
  stage: number;
  diameter: number;
  energy: SharedValue<number>;
  breath: SharedValue<number>;
  settle: SharedValue<number>;
  live: SharedValue<number>;
  awake: SharedValue<number>;
}

/**
 * The hot centre.
 *
 * Without this the composite is four coloured clouds and no source — light with
 * nowhere it came from. It is also the fastest-responding layer, which is what
 * makes speech legible before the slower masses have finished moving.
 *
 * It steps back while capturing so the red presence can own the centre instead
 * of being washed pink by white sitting under it.
 *
 * Smaller and dimmer at rest than it was. A hot blue-white centre at 0.4 of the
 * diameter and 0.26 opacity was measurably the brightest thing on the screen
 * while armed, and a bright point at the exact centre of a soft blue field is
 * the definition of a lens flare — it also sat directly on top of the masses and
 * bleached them. At 0.3 and 0.2 it still reads as the place the light comes
 * from, and it now leaves the masses somewhere to be seen.
 */
export const Core = memo(function Core({
  stage,
  diameter,
  energy,
  breath,
  settle,
  live,
  awake,
}: CoreProps) {
  const geometry = useMemo(() => centered(stage, diameter), [stage, diameter]);
  const gradient = useMemo(() => nextGradientId("orbCore"), []);

  const style = useAnimatedStyle(() => ({
    // Never reaches zero on pause: this is the layer that keeps a paused orb
    // reading as frozen light rather than as switched off.
    // Clamped, which it did not need to be at 0.26/0.1/0.55 and does at these
    // values. Every other layer that can be driven past 1 already clamps; this
    // one only escaped because its old numbers summed to 0.91.
    opacity:
      Math.min(1, 0.4 + 0.12 * awake.value + 0.5 * energy.value) *
      (1 - live.value * 0.4) *
      (1 - settle.value * 0.3),
    transform: [{ scale: 1 + breath.value * 0.06 + energy.value * 0.34 }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[geometry, LUMINOUS, style]}>
      <Svg width={diameter} height={diameter}>
        <Defs>
          <RadialGradient id={gradient} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={ORB_COLOR.core} stopOpacity={0.85} />
            <Stop offset="0.3" stopColor={ORB_COLOR.core} stopOpacity={0.45} />
            <Stop offset="0.62" stopColor={ORB_COLOR.blue} stopOpacity={0.14} />
            <Stop offset="1" stopColor={ORB_COLOR.blue} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={diameter / 2} cy={diameter / 2} r={diameter / 2} fill={`url(#${gradient})`} />
      </Svg>
    </Animated.View>
  );
});

interface CaptureProps {
  stage: number;
  diameter: number;
  energy: SharedValue<number>;
  pulse: SharedValue<number>;
  live: SharedValue<number>;
}

/**
 * The capture presence.
 *
 * Small, hot and central, with a tight falloff: red spread wide over a blue
 * field turns the whole orb magenta and stops meaning "recording". Concentrated,
 * it survives as red and reads instantly.
 *
 * It carries its own heartbeat, independent of level, because the one thing this
 * must never do is disappear during a silence — "am I still recording?" cannot
 * be a question the user has to answer by looking at anything else. Composited
 * normally rather than screened, for the same reason: screening it into the
 * blues underneath would lift it toward pink.
 */
export const Capture = memo(function Capture({
  stage,
  diameter,
  energy,
  pulse,
  live,
}: CaptureProps) {
  const geometry = useMemo(() => centered(stage, diameter), [stage, diameter]);
  const gradient = useMemo(() => nextGradientId("orbCapture"), []);

  const style = useAnimatedStyle(() => ({
    opacity: live.value * (0.62 + 0.38 * pulse.value) * (0.74 + 0.26 * energy.value),
    transform: [{ scale: 1 + energy.value * 0.42 + pulse.value * 0.06 }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[geometry, style]}>
      <Svg width={diameter} height={diameter}>
        <Defs>
          <RadialGradient id={gradient} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={ORB_COLOR.red} stopOpacity={1} />
            <Stop offset="0.22" stopColor={ORB_COLOR.red} stopOpacity={0.88} />
            <Stop offset="0.48" stopColor={ORB_COLOR.red} stopOpacity={0.3} />
            <Stop offset="0.74" stopColor={ORB_COLOR.red} stopOpacity={0.07} />
            <Stop offset="1" stopColor={ORB_COLOR.red} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={diameter / 2} cy={diameter / 2} r={diameter / 2} fill={`url(#${gradient})`} />
      </Svg>
    </Animated.View>
  );
});
