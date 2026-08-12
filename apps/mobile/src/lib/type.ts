/**
 * Typography.
 *
 * Two faces, with a strict division of labour:
 *
 *   Space Grotesk — DISPLAY only. Large titles, hero numbers, the record timer.
 *     Carries the brand identity (it is the display face on the web app) and is
 *     used at sizes where its character reads.
 *
 *   System (SF Pro) — EVERYTHING else. Body, labels, metadata, transcript.
 *     Never overridden, because only the system face gets Dynamic Type's
 *     per-style scaling curves, optical sizing across the size range, and
 *     correct non-Latin fallback. A custom font on body text loses all three.
 *
 * The rule: if it scales with Dynamic Type and someone has to read paragraphs
 * of it, it stays system.
 */

export const DISPLAY = {
  regular: "SpaceGrotesk_400Regular",
  medium: "SpaceGrotesk_500Medium",
  semibold: "SpaceGrotesk_600SemiBold",
  bold: "SpaceGrotesk_700Bold",
} as const;

/**
 * Hero numerals — meeting score, record timer, stat tiles.
 *
 * tabular-nums is not optional here: without it, a running timer's digits have
 * different widths and the whole number jitters as it counts.
 */
export const displayNumber = {
  fontFamily: DISPLAY.bold,
  fontVariant: ["tabular-nums" as const],
};
