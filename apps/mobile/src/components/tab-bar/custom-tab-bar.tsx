import { useEffect } from "react";
import { Platform, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
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
 * gives Liquid Glass for free, but it cannot do the one thing this design is
 * built on: an ELEVATED centre action (Record, lifted into a circle above the
 * bar because it is the app's primary verb). That is custom-drawn by
 * definition, so the trade is glass-for-identity, made on purpose.
 *
 * The four flanking tabs are ICON-ONLY. An earlier version expanded the
 * selected tab into a labelled pill while the others collapsed; it looked good
 * static and stuttered in motion, because animating width is a layout pass. The
 * selected state is now a highlight that fades under the icon — opacity and
 * scale only — so the bar is smooth by construction. See TabItem.
 *
 * What the switch costs, and how it is paid:
 *
 *   - Safe area. A custom bar is not a UITabBar, so UIKit no longer reports it
 *     in `insets.bottom`. Every scroll surface's clearance is recomputed around
 *     TAB_BAR_HEIGHT in lib/layout.ts — see the note there. Getting this wrong
 *     hides content behind the bar, so the constants live in ONE place.
 *
 *   - Accessibility. Icon-only tabs show no text, so every item carries an
 *     explicit accessibilityLabel and the `selected` state; VoiceOver reads the
 *     name the eye no longer sees.
 *
 *   - Reduce Motion. The highlight resolves instantly instead of animating, so
 *     it reads as an honest state change rather than a glitch.
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
      {/*
        Fades content out under the bar, and hides the gap beneath it.
        A floating bar leaves a transparent band between itself and the screen
        bottom, and the list scrolls its content the FULL height (its frame runs
        edge to edge behind the bar), so a card's edge was showing through that
        band — reported as a stray "layer" under the nav. This scrim runs from
        transparent at the top to the canvas colour at the bottom, so content
        dissolves as it passes behind the bar instead of poking out below it. It
        is the same idea as iOS's own scroll-edge effect, and it sits behind the
        pill (rendered first) so the bar itself is untouched.
      */}
      <LinearGradient
        colors={["transparent", background ?? "#06070A"]}
        locations={[0, 0.72]}
        pointerEvents="none"
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
      />
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
 * A flanking tab: an icon over a highlight that fades in when it is selected.
 *
 * It used to EXPAND — collapsed to an icon, grew to an icon+label pill on
 * select, driven by a LinearTransition layout spring. That looked good in a
 * mockup and stuttered on a device: animating `flexGrow` and mounting a label
 * makes all four items recompute layout on the shadow thread every tap, and no
 * amount of spring tuning smooths a layout pass. The label is gone and the only
 * thing that animates now is a highlight's opacity and scale — both transforms,
 * both on the UI thread — so the bar is smooth by construction rather than by
 * luck. VoiceOver still gets every tab's name; a tab icon is learned in a
 * session, so the words cost little and bought the jank.
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
  const active = useSharedValue(focused ? 1 : 0);

  // The active state is a single shared value that drives the highlight's
  // opacity and scale — nothing else. It is a TIMING, not a layout change: the
  // old bar animated `flexGrow` through LinearTransition and mounted a label,
  // so four items recomputed layout on the shadow thread on every tap, which is
  // what made it stutter. This never leaves the UI thread.
  useEffect(() => {
    active.value = reduceMotion
      ? focused
        ? 1
        : 0
      : withTiming(focused ? 1 : 0, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [focused, reduceMotion, active]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: active.value,
    // Grows in from 82% so the highlight arrives with a little life rather than
    // just fading — but scale is a transform, so it costs no layout.
    transform: [{ scale: 0.82 + active.value * 0.18 }],
  }));

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.06 }],
  }));

  return (
    // Equal fixed width, no flexGrow toggle. All four flanking tabs share the
    // row evenly and never resize — the smoothness comes from nothing moving.
    <Pressable
      style={{ flex: 1 }}
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
      // Icon-only, so the label is the accessible name VoiceOver reads. The
      // words were removed from the bar deliberately: the expanding label was
      // the thing that could not animate smoothly, and an icon a user taps many
      // times a day is learned in a session.
      accessibilityLabel={meta.label}
      hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
    >
      <Animated.View
        style={[{ height: 44, alignItems: "center", justifyContent: "center" }, pressStyle]}
      >
        {/* The highlight, absolute so it never affects layout — it fades and
            grows under the icon instead of a pill resizing the row. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: 48,
              height: 40,
              borderRadius: 20,
              backgroundColor: pillColor,
            },
            pillStyle,
          ]}
        />
        <Image
          source={`sf:${meta.icon}`}
          tintColor={focused ? activeColor : inactiveColor}
          style={{ width: 24, height: 24 }}
          contentFit="contain"
        />
      </Animated.View>
    </Pressable>
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
              // A confident seat, not an alarm. Two review passes read a red
              // halo as "hot"; the lift and the fill already carry the
              // prominence, so the shadow is now neutral black at low opacity —
              // it grounds the circle against the bar without ringing it in red.
              shadowColor: "#000000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.45,
              shadowRadius: 8,
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
