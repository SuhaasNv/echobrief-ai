import { Platform, Pressable, View } from "react-native";
import { Image } from "expo-image";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { haptics } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import {
  TAB_BAR_HEIGHT,
  TAB_BAR_SIDE_INSET,
  TAB_BAR_BOTTOM_GAP,
  TAB_BAR_ORB_LIFT,
} from "@/lib/layout";
import { useColorTokens } from "@/lib/tokens";

/**
 * The app's own bottom navigation, drawn rather than handed to UITabBar.
 *
 * This deliberately replaces `expo-router/unstable-native-tabs`. The native bar
 * gives Liquid Glass for free, but it cannot do the two things this design is
 * built on: an ELEVATED centre action (Record, lifted into a circle above the
 * bar because it is the app's primary verb), and a SELECTED-PILL that expands to
 * show its label while the others collapse to icons. Both are custom-drawn by
 * definition, so the trade is glass-for-identity, made on purpose.
 *
 * What the switch costs, and how it is paid:
 *
 *   - Safe area. A custom bar is not a UITabBar, so UIKit no longer reports it
 *     in `insets.bottom`. Every scroll surface's clearance is recomputed around
 *     TAB_BAR_HEIGHT in lib/layout.ts — see the note there. Getting this wrong
 *     hides content behind the bar, so the constants live in ONE place.
 *
 *   - Accessibility. The collapse-to-icon pattern means an inactive tab shows no
 *     text, so every item carries an explicit accessibilityLabel and the
 *     `selected` state, and the pill's motion is the only thing gated on Reduce
 *     Motion — the labels and hit targets never depend on it.
 *
 *   - Reduce Motion. The width morph is a spring; under Reduce Motion the layout
 *     still changes (selected shows its label) but without the animated
 *     transition, so it reads as an instant, honest state change rather than a
 *     glitch.
 */

/**
 * The slice of React Navigation's tab-bar props this component actually reads.
 *
 * Typed locally rather than imported from @react-navigation/bottom-tabs: that
 * package is not a top-level dependency — expo-router bundles its own copy under
 * a deep build path — so importing the type directly is a resolution that breaks
 * on the next expo-router bump. These four fields are the stable contract every
 * version of the tabBar prop has honoured.
 */
interface TabRoute {
  key: string;
  name: string;
}
export interface TabBarProps {
  state: { index: number; routes: TabRoute[] };
  navigation: {
    // `defaultPrevented` is optional to match React Navigation's own return
    // type, where it only exists on a `canPreventDefault` event. The press
    // handler reads it defensively (`event.defaultPrevented === true`), so an
    // undefined is treated as "not prevented", which is correct.
    emit: (event: {
      type: "tabPress" | "tabLongPress";
      target: string;
      canPreventDefault?: boolean;
    }) => { defaultPrevented?: boolean };
    navigate: (name: string) => void;
  };
}

interface TabMeta {
  /** SF Symbol, outline weight to match the rest of the app's glyphs. */
  icon: string;
  label: string;
  /** The elevated centre action. Exactly one tab sets this. */
  center?: boolean;
}

/** Route name → presentation. Order here does not matter; the navigator's does. */
const TABS: Record<string, TabMeta> = {
  meetings: { icon: "list.bullet", label: "Meetings" },
  ask: { icon: "questionmark.bubble", label: "Ask" },
  record: { icon: "mic.fill", label: "Record", center: true },
  actions: { icon: "checkmark.circle", label: "Actions" },
  account: { icon: "person.crop.circle", label: "Account" },
};

const TOKENS = [
  "--elevated",
  "--edge",
  "--label",
  "--label-tertiary",
  "--background",
  "--danger",
  "--fill",
] as const;

export function CustomTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const [elevated, edge, label, labelTertiary, background, danger, fill] = useColorTokens(TOKENS);

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        // Clears the home indicator, then floats the bar above it.
        paddingBottom: (insets.bottom || 8) + TAB_BAR_BOTTOM_GAP,
        paddingHorizontal: TAB_BAR_SIDE_INSET,
        alignItems: "center",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          height: TAB_BAR_HEIGHT,
          width: "100%",
          borderRadius: TAB_BAR_HEIGHT / 2,
          backgroundColor: elevated,
          borderWidth: 1,
          borderColor: edge,
          paddingHorizontal: 8,
          // A soft lift off the content, not a hard drop shadow. The bar floats;
          // it should read as hovering, not stamped on.
          ...Platform.select({
            ios: {
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.35,
              shadowRadius: 18,
            },
            default: { elevation: 12 },
          }),
        }}
      >
        {state.routes.map((route, index) => {
          const meta = TABS[route.name];
          if (!meta) return null;

          const focused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (focused || event.defaultPrevented === true) return;
            haptics.select();
            navigation.navigate(route.name);
          };

          const onLongPress = () => navigation.emit({ type: "tabLongPress", target: route.key });

          if (meta.center) {
            return (
              <CenterButton
                key={route.key}
                meta={meta}
                focused={focused}
                onPress={onPress}
                onLongPress={onLongPress}
                danger={danger}
                background={background}
                labelTertiary={labelTertiary}
              />
            );
          }

          return (
            <TabItem
              key={route.key}
              meta={meta}
              focused={focused}
              onPress={onPress}
              onLongPress={onLongPress}
              activeColor={label}
              inactiveColor={labelTertiary}
              pillColor={fill}
            />
          );
        })}
      </View>
    </View>
  );
}

/**
 * A flanking tab: icon alone, or an icon+label pill when selected.
 *
 * The expand/collapse is a LAYOUT spring, the same primitive the segmented
 * control uses, so selecting a tab redistributes width across the row with one
 * coherent motion rather than four independent resizes. `SPRING.chrome` is the
 * app's designated "tab icon / chip selection" curve — critically damped,
 * because a bar the thumb hits many times a session must not bounce.
 */
function TabItem({
  meta,
  focused,
  onPress,
  onLongPress,
  activeColor,
  inactiveColor,
  pillColor,
}: {
  meta: TabMeta;
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  activeColor?: string;
  inactiveColor?: string;
  pillColor?: string;
}) {
  const reduceMotion = useReducedMotion();
  const pressed = useSharedValue(0);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.06 }],
  }));

  const layout = reduceMotion ? undefined : LinearTransition.springify().damping(22).stiffness(240);

  return (
    <Animated.View layout={layout} style={[{ flexGrow: focused ? 0 : 1, flexShrink: 1 }]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={() => {
          pressed.value = withSpring(1, SPRING.pressIn);
        }}
        onPressOut={() => {
          pressed.value = withSpring(0, SPRING.pressOut);
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={meta.label}
        // The whole bar is only ~56pt tall, so the row height carries most of
        // the 44pt target; hitSlop tops it up at the narrow icon-only width.
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      >
        <Animated.View
          style={[
            {
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              height: 44,
              paddingHorizontal: focused ? 14 : 10,
              borderRadius: 22,
              backgroundColor: focused ? pillColor : "transparent",
            },
            pressStyle,
          ]}
        >
          <Image
            source={`sf:${meta.icon}`}
            tintColor={focused ? activeColor : inactiveColor}
            style={{ width: 22, height: 22 }}
            contentFit="contain"
          />
          {focused ? (
            // Mounts only when selected; the layout spring above animates the
            // width the label demands. Fades so it does not pop in after the
            // pill has already grown.
            <Animated.Text
              entering={reduceMotion ? undefined : FadeIn.duration(160)}
              exiting={reduceMotion ? undefined : FadeOut.duration(100)}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              style={{
                marginLeft: 7,
                color: activeColor,
                fontSize: 15,
                fontWeight: "600",
              }}
            >
              {meta.label}
            </Animated.Text>
          ) : null}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Record — the elevated centre action.
 *
 * Lifted above the bar and drawn as a filled circle because it is the one thing
 * the app exists to do; every other tab is a place, this is a verb. Red rather
 * than the app's blue tint, so it matches the record dot and the danger colour
 * used for "live" everywhere else — the same identity the record screen and the
 * Live Activity already share.
 *
 * It does NOT expand into a pill. The word "Record" sits under it, always, so
 * the one tab with no room for an inline label never loses its name.
 */
function CenterButton({
  meta,
  focused,
  onPress,
  onLongPress,
  danger,
  background,
  labelTertiary,
}: {
  meta: TabMeta;
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  danger?: string;
  background?: string;
  labelTertiary?: string;
}) {
  const pressed = useSharedValue(0);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.08 }],
  }));

  return (
    <View style={{ width: 76, alignItems: "center" }}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={() => {
          pressed.value = withSpring(1, SPRING.pressIn);
        }}
        onPressOut={() => {
          pressed.value = withSpring(0, SPRING.pressOut);
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel="Record"
        accessibilityHint="Start a new recording"
      >
        <Animated.View
          style={[
            {
              // Lifted so it breaks the top edge of the bar — the elevation is
              // the whole point, and it is what marks this as the primary action
              // rather than a fifth peer. The lift is a shared constant because
              // every scroll surface has to reserve clearance for it.
              marginTop: -TAB_BAR_ORB_LIFT,
              width: 58,
              height: 58,
              borderRadius: 29,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: danger,
              // A ring in the bar's own colour, so the lifted circle reads as
              // sitting through the bar rather than pasted on top of it.
              borderWidth: 4,
              borderColor: background,
              // A confident seat, not an alarm. A design review read the old
              // 0.55/12 halo as "hot" — the lift and the red fill already carry
              // all the prominence the primary verb needs, so the glow only has
              // to ground the circle, not announce it.
              shadowColor: danger,
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: focused ? 0.3 : 0.2,
              shadowRadius: 7,
            },
            style,
          ]}
        >
          <Image
            source={`sf:${meta.icon}`}
            tintColor="#FFFFFF"
            style={{ width: 25, height: 25 }}
            contentFit="contain"
          />
        </Animated.View>
        {/* The one always-on label in the bar, so the tab with no room for an
            inline pill never loses its name. Its colour was `undefined` when
            unfocused, which fell back to near-black on the dark bar — legible
            only on the Record screen itself, where it turned red. Now it matches
            the inactive icons (tertiary grey) off-screen and turns red when
            active, exactly like every other tab's icon. */}
        <Animated.Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{
            marginTop: 2,
            fontSize: 11,
            fontWeight: focused ? "700" : "600",
            color: focused ? danger : labelTertiary,
            textAlign: "center",
          }}
        >
          {meta.label}
        </Animated.Text>
      </Pressable>
    </View>
  );
}
