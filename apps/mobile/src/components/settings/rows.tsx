import {
  Fragment,
  isValidElement,
  useEffect,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInUp,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Image } from "expo-image";
import Svg, { Path } from "react-native-svg";

import { haptics } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";

/**
 * Inset-grouped list primitives.
 *
 * iOS settings surfaces are grouped cards with hairline separators inset from
 * the leading edge, not free-floating rows. Building them here keeps every
 * settings screen structurally identical rather than each inventing its own
 * spacing — and keeps the three metrics that make a grouped list feel native in
 * one place: 52pt minimum row height, 16pt content margin, and a separator
 * inset to that same 16pt so it starts where the row's content starts.
 *
 * Every navigational row carries a leading SF Symbol in a rounded square. That
 * is how iOS Settings itself keeps a long list scannable: the icon does the
 * recognition work so the label can stay short. The icon is never the only
 * carrier of meaning — the text label is always present.
 *
 * The chip is GREY by default, which is the one place this deviates from iOS
 * Settings on purpose. Apple's rainbow of saturated chips works because their
 * list is forty rows of unrelated system domains and the colour is the only
 * index into it. This list is eleven rows on one subject, and painting it the
 * same way produced a wall of blue squares that read as a stock settings
 * template rather than as this product. Colour survives here only where it
 * means something: violet where a model produced the thing, red where the row
 * destroys something. There is deliberately no green, no amber, and no blue
 * tone to reach for — the union below is the whole vocabulary.
 */

/** Minimum row height. Below this a grouped list stops reading as iOS. */
const ROW_MIN_HEIGHT = 52;

/** Dark-ramp values from global.css, for SVG and native controls. */
const HEX = {
  label: "#F4F5F7",
  secondary: "#9CA1A9",
  // Tracks --label-tertiary, which was raised from #6E727A: that value measured
  // 4.03:1 on the canvas and carried every chevron and every field placeholder
  // in the settings tree. #787C85 is 4.82:1 on --background, 4.65:1 on
  // --surface. It still cannot clear AA on --fill, so nothing on a filled
  // control may use it — those use `secondary`.
  tertiary: "#787C85",
  tint: "#4C99F8",
  danger: "#FF5F62",
  track: "#2E3138",
  background: "#06070A",
} as const;

/**
 * The complete chip vocabulary. Three entries, not six.
 *
 * `neutral` is the default and covers every ordinary row. `violet` is the app's
 * one semantic colour: a model produced this. `danger` is set by the row's
 * `destructive` flag, never by hand.
 */
export type IconTone = "violet" | "danger" | "neutral";

const TONE_BG: Record<IconTone, string> = {
  // Recessed rather than filled — the chip is a container for the glyph, not a
  // colour swatch. --label-secondary on --surface-3 measures 5.85:1.
  neutral: "bg-surface-3",
  violet: "bg-violet",
  danger: "bg-danger",
};

const TONE_GLYPH: Record<IconTone, string> = {
  neutral: HEX.secondary,
  // Both accent chips are light values, so the glyph is the CANVAS colour, not
  // near-white: #F4F5F7 measures 2.81:1 on violet and 2.73:1 on red, while
  // #06070A measures 6.57:1 and 6.78:1 on the same two.
  violet: HEX.background,
  danger: HEX.background,
};

/**
 * Leading icon chip.
 *
 * SF Symbols come through expo-image's `sf:` source rather than a vector-icon
 * font: they are the real system symbols, so they inherit the platform's
 * weights and stay correct as iOS revises them.
 */
export function SettingIcon({ symbol, tone = "neutral" }: { symbol: string; tone?: IconTone }) {
  return (
    <View
      className={`h-7 w-7 items-center justify-center rounded-[7px] ${TONE_BG[tone]}`}
      style={{ borderCurve: "continuous" }}
    >
      <Image
        source={`sf:${symbol}`}
        tintColor={TONE_GLYPH[tone]}
        style={{ width: 15, height: 15 }}
        contentFit="contain"
        // Decorative: the row's label already says what this is.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </View>
  );
}

export function Chevron({ color = HEX.tertiary }: { color?: string }) {
  return (
    <Svg width={8} height={13} viewBox="0 0 8 13">
      <Path
        d="M1.2 1.2 L6.4 6.5 L1.2 11.8"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function ExternalGlyph({ color = HEX.tertiary }: { color?: string }) {
  return (
    <Svg width={13} height={13} viewBox="0 0 13 13">
      <Path
        d="M4 1.4 H11.6 V9"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M11.4 1.6 L1.4 11.6"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

export function CheckGlyph({ color = HEX.tint }: { color?: string }) {
  return (
    <Svg width={15} height={12} viewBox="0 0 15 12">
      <Path
        d="M1.4 6.2 L5.4 10.2 L13.4 1.6"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** Separator, inset to the row's 16pt content margin. */
export function RowDivider() {
  return <View className="ml-4 h-px bg-separator" />;
}

/**
 * Auto-separated group.
 *
 * Dividers are inserted between children rather than written by hand at every
 * call site: fifteen screens hand-placing separators is fifteen chances to miss
 * one, and a group with an inconsistent separator reads as a rendering fault.
 */
function withDividers(children: ReactNode): ReactNode {
  const items = Array.isArray(children) ? children : [children];
  const visible = items.flat().filter(Boolean);

  return visible.map((child, index) => {
    // The child's own key has to survive onto the wrapper. Keying by position
    // instead would make React match the wrapper at index 2 across a removal
    // and remount everything below it — which cancels exit animations and
    // resets any row that holds state.
    const key = isValidElement(child) && child.key !== null ? child.key : `row-${index}`;

    return (
      <Fragment key={key}>
        {index > 0 ? <RowDivider /> : null}
        {child}
      </Fragment>
    );
  });
}

function SectionShell({ children }: { children: ReactNode }) {
  return (
    <View
      className="mx-4 overflow-hidden rounded-card border border-edge bg-surface"
      style={{ borderCurve: "continuous" }}
    >
      {/* Light from above — turns the border into a bevel. */}
      <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />
      {children}
    </View>
  );
}

export function Section({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-2">
      {title ? (
        <Text
          className="px-5 text-[13px] font-medium text-label-secondary"
          maxFontSizeMultiplier={1.6}
        >
          {title}
        </Text>
      ) : null}

      <SectionShell>{withDividers(children)}</SectionShell>

      {footer ? (
        <Text
          className="px-5 text-[13px] leading-[18px] text-label-tertiary"
          maxFontSizeMultiplier={1.8}
        >
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A group that opens and closes.
 *
 * For pickers with more rows than belong on screen at rest — languages, time
 * zones. The body mounts and unmounts; the spring layout transition on the card
 * does the open and close, and the disclosure chevron rotates. No height
 * animation is written by hand.
 */
export function CollapsibleSection({
  title,
  footer,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  footer?: string;
  /** Current value, shown while collapsed. */
  summary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(defaultOpen);
  const spin = useSharedValue(defaultOpen ? 1 : 0);

  useEffect(() => {
    spin.value = reduceMotion ? (open ? 1 : 0) : withSpring(open ? 1 : 0, SPRING.chrome);
  }, [open, reduceMotion, spin]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 90}deg` }],
  }));

  return (
    <View className="gap-2">
      <Animated.View
        layout={
          reduceMotion
            ? undefined
            : LinearTransition.springify()
                .damping(SPRING.smooth.damping)
                .stiffness(SPRING.smooth.stiffness)
        }
      >
        <SectionShell>
          <Pressable
            onPress={() => {
              haptics.select();
              setOpen((value) => !value);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityHint={open ? "Collapses this group" : "Expands this group"}
            className="flex-row items-center gap-3 px-4 py-3 active:bg-elevated"
            style={{ minHeight: ROW_MIN_HEIGHT }}
          >
            <Text className="flex-1 text-[17px] text-label" maxFontSizeMultiplier={1.8}>
              {title}
            </Text>
            {summary ? (
              <Text
                className="max-w-[45%] text-[17px] text-label-secondary"
                numberOfLines={1}
                maxFontSizeMultiplier={1.6}
              >
                {summary}
              </Text>
            ) : null}
            <Animated.View style={chevronStyle}>
              <Chevron />
            </Animated.View>
          </Pressable>

          {open ? (
            <Animated.View
              entering={reduceMotion ? undefined : FadeIn.duration(160)}
              exiting={reduceMotion ? undefined : FadeOut.duration(120)}
            >
              {withDividers(children)}
            </Animated.View>
          ) : null}
        </SectionShell>
      </Animated.View>

      {footer ? (
        <Text
          className="px-5 text-[13px] leading-[18px] text-label-tertiary"
          maxFontSizeMultiplier={1.8}
        >
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/** Value text, cross-faded when it changes so a picked value confirms itself. */
function RowValue({ value }: { value: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <Animated.Text
      key={value}
      entering={reduceMotion ? undefined : FadeIn.duration(150)}
      className="max-w-[52%] text-[17px] text-label-secondary"
      numberOfLines={1}
      maxFontSizeMultiplier={1.6}
    >
      {value}
    </Animated.Text>
  );
}

export interface RowProps {
  label: string;
  /** Secondary line under the label. Keeps the label itself short. */
  detail?: string;
  value?: string;
  icon?: string;
  iconTone?: IconTone;
  onPress?: () => void;
  destructive?: boolean;
  hint?: string;
  /** Shows the diagonal arrow used for anything leaving the app. */
  external?: boolean;
  disabled?: boolean;
  /** Renders a leading checkmark slot instead of a chevron — for pickers. */
  selected?: boolean;
  /** Replaces the trailing accessory entirely. */
  accessory?: ReactNode;
}

export function Row({
  label,
  detail,
  value,
  icon,
  iconTone = "neutral",
  onPress,
  destructive,
  hint,
  external,
  disabled,
  selected,
  accessory,
}: RowProps) {
  const isPicker = selected !== undefined;

  const content = (
    <View
      className="flex-row items-center gap-3 px-4 py-3"
      style={{ minHeight: ROW_MIN_HEIGHT }}
    >
      {icon ? <SettingIcon symbol={icon} tone={destructive ? "danger" : iconTone} /> : null}

      <View className={`flex-1 ${detail ? "gap-0.5" : ""} ${disabled ? "opacity-40" : ""}`}>
        <Text
          className={`text-[17px] ${destructive ? "text-danger" : "text-label"}`}
          maxFontSizeMultiplier={1.8}
        >
          {label}
        </Text>
        {detail ? (
          <Text
            className="text-[13px] leading-[18px] text-label-tertiary"
            maxFontSizeMultiplier={1.8}
          >
            {detail}
          </Text>
        ) : null}
      </View>

      {value ? <RowValue value={value} /> : null}

      {accessory ??
        (isPicker ? (
          // Fixed-width slot so labels stay aligned whether or not they are the
          // selected one. The checkmark is a SHAPE, not a colour cue.
          <View className="w-[15px] items-center">{selected ? <CheckGlyph /> : null}</View>
        ) : onPress ? (
          external ? (
            <ExternalGlyph />
          ) : (
            <Chevron />
          )
        ) : null)}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={isPicker ? "radio" : "button"}
      accessibilityState={{ disabled: Boolean(disabled), selected }}
      accessibilityHint={hint}
      className="active:bg-elevated"
    >
      {content}
    </Pressable>
  );
}

/**
 * Switch row.
 *
 * A real UISwitch, not a drawn one: it inherits the platform's own animation,
 * its Reduce Motion behaviour, and the On/Off labels people turn on under
 * Accessibility > Display.
 */
export function ToggleRow({
  label,
  detail,
  icon,
  iconTone = "neutral",
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  detail?: string;
  icon?: string;
  iconTone?: IconTone;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View
      className="flex-row items-center gap-3 px-4 py-3"
      style={{ minHeight: ROW_MIN_HEIGHT }}
    >
      {icon ? <SettingIcon symbol={icon} tone={iconTone} /> : null}

      <View className={`flex-1 ${detail ? "gap-0.5" : ""} ${disabled ? "opacity-40" : ""}`}>
        <Text className="text-[17px] text-label" maxFontSizeMultiplier={1.8}>
          {label}
        </Text>
        {detail ? (
          <Text
            className="text-[13px] leading-[18px] text-label-tertiary"
            maxFontSizeMultiplier={1.8}
          >
            {detail}
          </Text>
        ) : null}
      </View>

      <Switch
        value={value}
        onValueChange={(next) => {
          haptics.select();
          onValueChange(next);
        }}
        disabled={disabled}
        trackColor={{ false: HEX.track, true: HEX.tint }}
        ios_backgroundColor={HEX.track}
        accessibilityLabel={label}
      />
    </View>
  );
}

/** Text field styled as a grouped row, with an optional leading label. */
export function TextFieldRow({
  label,
  ref,
  ...input
}: { label?: string; ref?: Ref<TextInput> } & TextInputProps) {
  return (
    <View
      className="flex-row items-center gap-3 px-4 py-2"
      style={{ minHeight: ROW_MIN_HEIGHT }}
    >
      {label ? (
        <Text className="w-[104px] text-[17px] text-label" maxFontSizeMultiplier={1.4}>
          {label}
        </Text>
      ) : null}
      <TextInput
        keyboardAppearance="dark"
        ref={ref}
        className="flex-1 py-2 text-[17px] text-label"
        placeholderTextColor={HEX.tertiary}
        {...input}
      />
    </View>
  );
}

/** Read-only value row — for things the app knows but the user cannot change. */
export function ValueRow({
  label,
  value,
  icon,
  iconTone,
  mono,
}: {
  label: string;
  value: string;
  icon?: string;
  iconTone?: IconTone;
  /** Tabular figures, for versions, dates, and amounts. */
  mono?: boolean;
}) {
  return (
    <View
      className="flex-row items-center gap-3 px-4 py-3"
      style={{ minHeight: ROW_MIN_HEIGHT }}
    >
      {icon ? <SettingIcon symbol={icon} tone={iconTone} /> : null}
      {/* The label sizes to its own text and the VALUE takes the remainder.
          It was the other way round — `flex-1` on the label plus `max-w-[52%]`
          on the value — so a short label like "Address" claimed the whole row
          and then truncated a perfectly short email at 52%, with ~180pt sitting
          empty beside it. `shrink` still lets a long label give way rather than
          pushing the value off the row. */}
      <Text className="shrink text-[17px] text-label" numberOfLines={1} maxFontSizeMultiplier={1.8}>
        {label}
      </Text>
      <Text
        className="flex-1 text-right text-[17px] text-label-secondary"
        style={mono ? { fontVariant: ["tabular-nums"] } : undefined}
        numberOfLines={1}
        maxFontSizeMultiplier={1.6}
      >
        {value}
      </Text>
    </View>
  );
}

/*
 * There was a SampleBadge here — an uppercase "SAMPLE DATA" marker for groups
 * that rendered a local fixture. It is gone along with the fixture. A marker
 * admitting that a row is invented is not a design state; it is an unshipped
 * screen presented as shipped. Rows now either show a real value or are not
 * rendered.
 */

/** Entrance for a row appended to a live list. Transform and opacity only. */
export function AppearingRow({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInUp.duration(220)}
      exiting={reduceMotion ? undefined : FadeOut.duration(140)}
      layout={
        reduceMotion
          ? undefined
          : LinearTransition.springify()
              .damping(SPRING.smooth.damping)
              .stiffness(SPRING.smooth.stiffness)
      }
    >
      {children}
    </Animated.View>
  );
}

export { HEX as SETTINGS_HEX, ROW_MIN_HEIGHT };
