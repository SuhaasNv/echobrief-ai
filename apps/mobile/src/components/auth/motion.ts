import { useCallback } from "react";
import { FadeInDown, FadeOut, useReducedMotion } from "react-native-reanimated";

/**
 * Entrance motion for the auth screens.
 *
 * One rule, applied everywhere here: things arrive slower than they leave. An
 * entrance is orienting you, so it can afford to be seen; an exit is getting
 * out of the way of whatever you just asked for, so it must not be. The error
 * row is where this is most visible — it takes 240ms to appear and 120ms to go.
 *
 * The stagger is deliberately shallow. Four blocks at 70ms apart resolve in
 * under half a second total, which reads as one panel settling rather than a
 * sequence of items being dealt onto the screen. Anything longer and the CTA
 * arrives after the user has already reached for it.
 */

const ENTER_MS = 440;
const STEP_MS = 70;
/** Short enough that nothing appears to slide; it is a settle, not a reveal. */
const RISE = 14;

export const AUTH_ERROR_IN = FadeInDown.duration(240);
export const AUTH_ERROR_OUT = FadeOut.duration(120);

/**
 * Returns a builder for the nth block of the panel, or `undefined` under
 * Reduce Motion.
 *
 * `undefined` rather than a disabled builder on purpose: Reanimated's
 * ReduceMotion.System skips the animation but the builder still carries a
 * delay, so a staggered layout would hold its last block invisible for 200ms
 * and then pop it in. Removing the animation entirely is the only way to get a
 * genuinely static first frame.
 */
export function useAuthEntrance() {
  const reduceMotion = useReducedMotion();

  return useCallback(
    (step: number) =>
      reduceMotion
        ? undefined
        : FadeInDown.duration(ENTER_MS)
            .delay(step * STEP_MS)
            .withInitialValues({ transform: [{ translateY: RISE }] }),
    [reduceMotion],
  );
}
