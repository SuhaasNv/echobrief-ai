import { Pressable, TextInput, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { haptics } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";

/**
 * Resolved dark-palette values from global.css. The app pins
 * userInterfaceStyle to "dark" in app.json, and SVG strokes cannot take a
 * className — same trade already made in components/ribbon.tsx.
 */
const ON_PRIMARY = "#06070A"; // --background, drawn on the near-white pill

/**
 * Both of these mirror a label token. If one moves in global.css it has to be
 * copied here by hand — a hex cannot follow a CSS variable, and these two sat at
 * the old #6E727A for a whole token revision because of it.
 *
 * ON_DISABLED is the send arrow while the button is genuinely disabled, drawn on
 * --fill. It was --label-tertiary, which measures 3.95:1 there, and the argument
 * for keeping it was that a 20pt graphic is judged at 3:1. That argument does
 * not survive what this glyph IS: the arrow is the only thing on the screen that
 * says what the button does, on the primary control of the screen, and the rule
 * global.css states for this token has no size exemption in it — anything on
 * --fill uses --label-secondary. It measures 6.4:1 there.
 *
 * Disabled still reads as disabled, because that state is carried by the pill
 * itself: --fill grey against the near-white --label pill of the live control,
 * which is a difference in the whole button rather than in the legibility of one
 * arrow.
 *
 * PLACEHOLDER is real 17px text on --surface, where --label-tertiary measures
 * 4.65:1 and clears AA. It is also the only visible label the field has, so it
 * does not get to be dim.
 */
const ON_DISABLED = "#9CA1A9"; // --label-secondary
const PLACEHOLDER = "#787C85"; // --label-tertiary

/** Gap between the keyboard's top edge and the composer when raised. */
const KEYBOARD_GAP = 10;

function ArrowUp({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 20 20" fill="none">
      <Path
        d="M10 15.6V4.9M4.9 10 10 4.6l5.1 5.4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

interface ComposerProps {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  /** Retrieval or generation is in flight — send becomes stop. */
  busy: boolean;
  /** Resting clearance for the floating tab bar, from useTabBarInset(). */
  bottomInset: number;
}

/**
 * Pinned composer.
 *
 * No KeyboardAvoidingView. On this screen it collapsed the content area between
 * a native large-title header and a floating tab bar, and pushed the answer off
 * the top of the screen — a real bug, not a theoretical one. The bar instead
 * rides the keyboard on translateY driven by useAnimatedKeyboard, which is a
 * transform on one view: nothing relayouts, and it tracks the system keyboard
 * curve exactly rather than approximating it with a timing function.
 *
 * The ScrollView above handles its own occlusion with
 * automaticallyAdjustKeyboardInsets.
 */
export function Composer({
  value,
  onChangeText,
  onSubmit,
  onStop,
  busy,
  bottomInset,
}: ComposerProps) {
  const keyboard = useAnimatedKeyboard();
  const canSend = value.trim().length > 0 && !busy;

  const lift = useAnimatedStyle(() => ({
    transform: [
      {
        // At rest the composer already sits `bottomInset` above the screen
        // edge, so it only owes the keyboard the difference.
        translateY: -Math.max(0, keyboard.height.value + KEYBOARD_GAP - bottomInset),
      },
    ],
  }));

  // The send affordance grows into place when the field becomes non-empty,
  // rather than switching colour instantly. Transform only.
  const ready = useDerivedValue(() =>
    withSpring(canSend || busy ? 1 : 0, SPRING.chrome),
  );
  const buttonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.9 + ready.value * 0.1 }],
  }));

  return (
    <Animated.View
      className="bg-background px-4 pt-3"
      style={[{ paddingBottom: bottomInset }, lift]}
    >
      {/* Inset to the same 16pt margin every other rule, card and list in the
          app starts at. A full-bleed border-t here was the one place the grid
          broke. Absolute so it costs no layout: the row below keeps its pt-3
          against the top edge rather than against a hairline. */}
      <View className="absolute inset-x-4 top-0 h-px bg-separator" pointerEvents="none" />

      <View className="flex-row items-end gap-2.5">
        <View
          className="min-h-[44px] flex-1 justify-center rounded-control border border-edge bg-surface"
          style={{ borderCurve: "continuous" }}
        >
          <TextInput
            keyboardAppearance="dark"
            className="max-h-[132px] px-4 py-2.5 text-[17px] leading-[22px] text-label"
            placeholder="Ask across your meetings"
            placeholderTextColor={PLACEHOLDER}
            value={value}
            onChangeText={onChangeText}
            multiline
            editable={!busy}
            // Return sends. A question is one or two lines; a newline key is
            // worth less here than not having to reach for the button.
            submitBehavior="blurAndSubmit"
            onSubmitEditing={onSubmit}
            accessibilityLabel="Your question"
            selectionColor="#4C99F8"
          />
        </View>

        <Animated.View style={buttonStyle}>
          <Pressable
            onPress={() => {
              if (busy) {
                haptics.medium();
                onStop();
                return;
              }
              onSubmit();
            }}
            disabled={!busy && !canSend}
            accessibilityRole="button"
            accessibilityLabel={busy ? "Stop" : "Send question"}
            className={`h-11 w-11 items-center justify-center rounded-full ${
              busy
                ? "border border-edge bg-fill active:opacity-70"
                : canSend
                  ? "bg-label active:opacity-80"
                  : "bg-fill"
            }`}
          >
            {busy ? (
              <Animated.View
                entering={FadeIn.duration(140)}
                exiting={FadeOut.duration(90)}
                className="h-3.5 w-3.5 rounded-[3px] bg-label"
              />
            ) : (
              <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(90)}>
                <ArrowUp color={canSend ? ON_PRIMARY : ON_DISABLED} />
              </Animated.View>
            )}
          </Pressable>
        </Animated.View>
      </View>
    </Animated.View>
  );
}
