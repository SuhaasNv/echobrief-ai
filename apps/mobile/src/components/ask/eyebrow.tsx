import { Text, View } from "react-native";

/**
 * Uppercase micro-label.
 *
 * 11pt / 600 / 0.8 tracking, tertiary. The most portable piece of the web app's
 * identity, and the thing that keeps this screen reading as an instrument panel
 * rather than a chat app: every band of content is announced before it starts.
 *
 * Capped at 1.4x Dynamic Type — past that it stops fitting on one line beside a
 * trailing count and wraps into a two-line label, which looks broken.
 */
export function Eyebrow({
  children,
  tone = "tertiary",
}: {
  children: string;
  /**
   * Violet is reserved for model output; only the answer band uses it.
   *
   * Danger is reserved for the moment BEFORE something irreversible — the
   * confirm card that proposes deleting a recording, and a failed action. It is
   * deliberately not used on the receipt afterwards: once the thing is done the
   * card's job is to report and offer a way back, not to keep alarming.
   */
  tone?: "tertiary" | "violet" | "danger";
}) {
  return (
    <Text
      className={`text-[11px] font-semibold uppercase ${
        tone === "violet"
          ? "text-violet"
          : tone === "danger"
            ? "text-danger"
            : "text-label-tertiary"
      }`}
      style={{ letterSpacing: 0.8 }}
      maxFontSizeMultiplier={1.4}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}

/**
 * Eyebrow with a trailing count on the same baseline.
 *
 * The count sits right-aligned rather than appended with a middle dot, so the
 * label column stays a straight vertical edge down the screen.
 */
export function EyebrowRow({
  label,
  trailing,
  tone,
}: {
  label: string;
  trailing?: string | null;
  tone?: "tertiary" | "violet";
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Eyebrow tone={tone}>{label}</Eyebrow>
      {trailing ? (
        <Text
          className="text-[12px] text-label-tertiary"
          style={{ fontVariant: ["tabular-nums"] }}
          maxFontSizeMultiplier={1.4}
          numberOfLines={1}
        >
          {trailing}
        </Text>
      ) : null}
    </View>
  );
}
