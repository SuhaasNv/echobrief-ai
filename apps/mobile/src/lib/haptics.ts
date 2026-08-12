import * as Haptics from "expo-haptics";

/**
 * Haptics, wrapped so a failure can never reject a caller's promise chain.
 *
 * Two rules encoded here rather than left to memory:
 *
 * 1. NEVER fire haptics on the recording screen. iOS suppresses the Taptic
 *    Engine while the microphone is active, so the call succeeds and produces
 *    nothing — you would ship a control that feels dead in the app's single
 *    most important moment. Use a visual state change plus
 *    AccessibilityInfo.announceForAccessibility there instead.
 *
 * 2. Haptics are never the only feedback. iOS silently suppresses them in Low
 *    Power Mode, when the user disables them, and while the camera or dictation
 *    is active — and there is no API to detect any of that.
 */

function safe(run: () => Promise<void>): void {
  run().catch(() => {
    // Suppressed by the system, or no Taptic Engine (iPad, simulator).
  });
}

export const haptics = {
  /** Discrete confirmation: item checked, link copied. */
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Consequential: destructive confirm presented, sheet committed. */
  medium: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Value changed within a set: segmented control, picker, row selection. */
  select: () => safe(() => Haptics.selectionAsync()),
  /** Terminal outcomes only — not intermediate steps. */
  success: () =>
    safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () =>
    safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
