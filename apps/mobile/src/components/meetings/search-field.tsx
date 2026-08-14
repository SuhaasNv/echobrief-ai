import { Pressable, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { haptics } from "@/lib/haptics";
import { useColorTokens } from "@/lib/tokens";

/**
 * In-content search, not the native nav-bar search bar.
 *
 * `headerSearchBarOptions` does not install its UISearchController on this
 * react-native-screens / iOS pairing — the field was silently absent, which is
 * the "search is gone" the library was reporting. A field we render ourselves
 * behaves identically on every OS version and is ours to style into the rest of
 * the instrument panel.
 *
 * Pinned above the list rather than scrolling away with a large title: the whole
 * point of search over a long library is that it is reachable without first
 * scrolling back to the top, which is also what `hideWhenScrolling: false` was
 * reaching for on the native control.
 */

/**
 * The three colours a TextInput and two SVG strokes need that a className cannot
 * reach: the placeholder, the selection caret, and the glyph strokes are props,
 * not styles — the same trade the composer and ribbon make.
 */
const TOKENS = ["--label-secondary", "--label-tertiary", "--tint", "--background"] as const;

function MagnifierGlyph({ color }: { color?: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
      <Path
        d="M7.6 13a5.4 5.4 0 100-10.8 5.4 5.4 0 000 10.8zM11.5 11.5l4 4"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** iOS-style clear affordance: a filled disc with the cross knocked out of it. */
function ClearGlyph({ disc, cross }: { disc?: string; cross?: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18">
      <Path d="M9 1.5a7.5 7.5 0 110 15 7.5 7.5 0 010-15z" fill={disc} />
      <Path
        d="M6.4 6.4l5.2 5.2M11.6 6.4l-5.2 5.2"
        stroke={cross}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function MeetingSearchField({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (value: string) => void;
}) {
  const [secondary, tertiary, tint, background] = useColorTokens(TOKENS);
  const hasText = value.length > 0;

  return (
    <View className="px-4 pb-2 pt-1">
      <View
        className="min-h-[44px] flex-row items-center gap-2.5 rounded-control border border-edge bg-surface px-3.5"
        style={{ borderCurve: "continuous" }}
      >
        <MagnifierGlyph color={secondary} />

        <TextInput
          keyboardAppearance="dark"
          className="flex-1 py-2.5 text-[17px] leading-[22px] text-label"
          placeholder="Search meetings"
          placeholderTextColor={tertiary}
          value={value}
          onChangeText={onChangeText}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          // The field owns nothing but the query text; there is no submit step,
          // results resolve as you type, so return just dismisses the keyboard.
          submitBehavior="blurAndSubmit"
          accessibilityLabel="Search meetings"
          selectionColor={tint}
          // Our own clear button below, drawn to match the panel, rather than the
          // system grey circle which sits at the wrong contrast on this canvas.
          clearButtonMode="never"
        />

        {hasText ? (
          <Pressable
            onPress={() => {
              haptics.tap();
              onChangeText("");
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            {({ pressed }) => (
              <View style={{ opacity: pressed ? 0.5 : 1 }}>
                <ClearGlyph disc={tertiary} cross={background} />
              </View>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
