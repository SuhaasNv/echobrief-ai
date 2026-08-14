import { useState, type ReactNode, type RefObject } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  type BlurEvent,
  type FocusEvent,
  type TextInputProps,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { haptics } from "@/lib/haptics";
import { TIMING } from "@/lib/motion";
import { useColorToken } from "@/lib/tokens";

/**
 * A grouped field list, the way an iOS form is actually built.
 *
 * The fields used to be separate floating pills with gaps between them. Three
 * pills stacked with 12pt of canvas showing through read as three unrelated
 * controls; one card with hairline dividers reads as one form, and it is the
 * same surface recipe as every other card in the app — border, continuous
 * corner curve, and a 1px top highlight so the edge behaves like a bevel lit
 * from above.
 *
 * The highlight is rendered LAST. Card renders it first, which is fine there
 * because its children are padded, but a field row paints a background right
 * over the top edge.
 */
export function AuthFieldGroup({ children }: { children: ReactNode }) {
  return (
    <View
      className="overflow-hidden rounded-card border border-edge bg-surface"
      style={{ borderCurve: "continuous" }}
    >
      {children}
      <View className="absolute inset-x-0 top-0 h-px bg-highlight" pointerEvents="none" />
    </View>
  );
}

export interface AuthFieldProps extends Omit<TextInputProps, "style" | "className"> {
  /** Announced by VoiceOver. A placeholder cannot do this job: it disappears the moment there is a value. */
  label: string;
  /** For field chaining — the previous field's onSubmitEditing focuses this. */
  inputRef?: RefObject<TextInput | null>;
  /** Hairline below the row. Omit on the last row of a group. */
  divider?: boolean;
  /** Renders the reveal toggle and owns secureTextEntry. */
  secure?: boolean;
}

/**
 * One row of a grouped field list.
 *
 * min-h rather than a fixed height, because RN Text auto-scales with Dynamic
 * Type and a fixed 52pt box clips its own label from AX1 upward.
 *
 * Focus is carried by a background step rather than a ring. On this palette
 * surface -> elevated is a small move, but it is the same move the rest of the
 * app uses for raised state, and a coloured ring around a text field is a web
 * idiom. Its opacity is animated rather than swapped so the row does not blink
 * as focus moves between fields; in is slower than out so a chained Next reads
 * as the highlight travelling rather than two rows flashing.
 */
export function AuthField({
  label,
  inputRef,
  divider = false,
  secure = false,
  onFocus,
  onBlur,
  ...rest
}: AuthFieldProps) {
  const [reveal, setReveal] = useState(false);
  // placeholderTextColor is a prop, not a style, so it is one of the few
  // colours on this screen that cannot come from the field's className.
  const placeholder = useColorToken("--label-tertiary");
  const focus = useSharedValue(0);

  const focusStyle = useAnimatedStyle(() => ({ opacity: focus.value }));

  const handleFocus = (event: FocusEvent) => {
    focus.value = withTiming(1, TIMING.crossfade);
    onFocus?.(event);
  };

  const handleBlur = (event: BlurEvent) => {
    focus.value = withTiming(0, TIMING.instant);
    onBlur?.(event);
  };

  return (
    <>
      <View className="flex-row items-center">
        {/* First child, so it paints behind the text. */}
        <Animated.View
          className="absolute inset-0 bg-elevated"
          style={focusStyle}
          pointerEvents="none"
        />

        <TextInput
          keyboardAppearance="dark"
          ref={inputRef}
          className="min-h-[52px] flex-1 px-4 py-3.5 text-[17px] text-label"
          placeholderTextColor={placeholder}
          accessibilityLabel={label}
          onFocus={handleFocus}
          onBlur={handleBlur}
          secureTextEntry={secure ? !reveal : undefined}
          {...rest}
        />

        {secure ? (
          <Pressable
            onPress={() => {
              haptics.tap();
              setReveal((v) => !v);
            }}
            hitSlop={12}
            className="px-4 py-2 active:opacity-40"
            accessibilityRole="button"
            accessibilityLabel={reveal ? "Hide password" : "Show password"}
          >
            <Text className="text-[15px] font-medium text-tint-label" maxFontSizeMultiplier={1.4}>
              {reveal ? "Hide" : "Show"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Inset from the left the way a UITableView separator is, so the label
          column stays a straight vertical edge down the group. */}
      {divider ? <View className="ml-4 h-px bg-separator" /> : null}
    </>
  );
}
