import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import type { MeetingSummary } from "@/lib/api/meetings";
import { haptics } from "@/lib/haptics";
import { SPRING, TIMING } from "@/lib/motion";
import { StatusBadge } from "@/components/status-badge";
import { ROW_MIN_HEIGHT, Section, SettingIcon, type IconTone } from "@/components/settings/rows";

/**
 * The meeting overflow menu, drawn rather than handed to UIAlertController.
 *
 * ActionSheetIOS was genuinely native and genuinely unfinished: a system sheet
 * takes a list of strings, so there is nowhere to put an icon, nowhere to group
 * "share this" apart from "destroy this", and the meeting itself is reduced to
 * a title in 13px grey. Next to the settings tree — grouped cards, tinted SF
 * Symbol chips, Space Grotesk headings — it read as a screen nobody had got to
 * yet.
 *
 * What is rebuilt here is only the PRESENTATION. Which rows exist, what they
 * do, what they confirm, and how they fail all still live in meeting-menu.tsx;
 * this file receives them already decided.
 *
 * Three structural notes, in the order they will bite someone:
 *
 *   It is a react-native Modal. The trigger renders inside the native
 *   navigation bar, and anything drawn as its sibling is clipped by the bar —
 *   the same constraint that forced the share confirmation out into an external
 *   store (see share-toast.ts). A Modal is a separate native presentation, so
 *   position in the React tree stops mattering.
 *
 *   That separate presentation is also why gesture-handler and safe-area-context
 *   are re-rooted below: neither the GestureHandlerRootView nor the
 *   SafeAreaProvider in app/_layout.tsx reaches into a Modal's view hierarchy.
 *
 *   The card, its hairline separators, and the icon chips are the settings
 *   primitives, imported rather than restyled. Two grouped-list implementations
 *   in one app is how the second one ends up 1pt off the first.
 */

/** Travel past which a release closes the sheet. Roughly a thumb's length. */
const CLOSE_AT = 88;
/** Points per second that closes regardless of how far the sheet travelled. */
const FLICK_VELOCITY = 700;
/**
 * Dim behind the sheet.
 *
 * Black at 55% rather than a token: no palette entry means "the screen you are
 * not currently using", and every value in global.css is a surface or a label
 * that would have to be inverted for a light theme. app.json pins
 * userInterfaceStyle to "dark", so this is stated the same way the SVG strokes
 * in swipe-to-delete are.
 */
const BACKDROP_COLOR = "#000000";
const BACKDROP_OPACITY = 0.55;
/** --radius-sheet from global.css. Inline because only the TOP corners round. */
const SHEET_RADIUS = 20;

/**
 * One row.
 *
 * `run` is the handler the menu already built; nothing here inspects it. `key`
 * is separate from `label` because the label is not stable — the same row reads
 * "Create share link" or "Share link" depending on whether a token exists — and
 * a list keyed on a changing string remounts the row it is trying to keep.
 */
export interface MenuRow {
  key: string;
  label: string;
  /** Second line, for a consequence the label cannot state in two words. */
  detail?: string;
  /** SF Symbol name, resolved through expo-image's `sf:` source. */
  symbol: string;
  /** Ignored when `destructive` is set — that always paints the row red. */
  tone?: IconTone;
  destructive?: boolean;
  /** Read after the label by VoiceOver. Required: every row here has a cost. */
  hint: string;
  run: () => void;
}

/** A card. Groups with no rows are dropped by the caller, never rendered empty. */
export interface MenuGroup {
  key: string;
  rows: MenuRow[];
}

/**
 * A menu row, which is settings' `Row` minus the chevron.
 *
 * Not `Row` itself: that renders a disclosure chevron for anything with an
 * onPress, and a chevron on a row that fires an action and dismisses is a
 * promise of a screen that never arrives. The Dynamic Type ceiling is also
 * tighter here (1.6 against 1.8) because this sheet has a hard height budget —
 * it is bottom-anchored, so anything it cannot fit is pushed off the TOP.
 */
function MenuRowButton({ row, onPick }: { row: MenuRow; onPick: (row: MenuRow) => void }) {
  return (
    <Pressable
      onPress={() => onPick(row)}
      accessibilityRole="button"
      accessibilityLabel={row.label}
      // iOS has a destructive trait for menu items; React Native exposes no way
      // to set it, so the warning has to travel in the hint. The red label and
      // red chip carry it visually, and neither is the sole channel.
      accessibilityHint={row.hint}
      className="active:bg-elevated"
    >
      <View className="flex-row items-center gap-3 px-4 py-3" style={{ minHeight: ROW_MIN_HEIGHT }}>
        <SettingIcon
          symbol={row.symbol}
          tone={row.destructive ? "danger" : (row.tone ?? "neutral")}
        />

        <View className={`flex-1 ${row.detail ? "gap-0.5" : ""}`}>
          <Text
            className={`text-[17px] ${row.destructive ? "text-danger" : "text-label"}`}
            maxFontSizeMultiplier={1.6}
          >
            {row.label}
          </Text>
          {row.detail ? (
            <Text
              className="text-[13px] leading-[18px] text-label-tertiary"
              maxFontSizeMultiplier={1.6}
            >
              {row.detail}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * "Link live".
 *
 * Shaped exactly like StatusBadge beside it, on purpose: the header carries two
 * pieces of state and they should read as one vocabulary. It is what makes
 * "Share link" and "Stop sharing" unambiguous — without it those two rows
 * describe a link the user has no evidence exists.
 */
function LinkBadge() {
  return (
    <View className="shrink-0 flex-row items-center gap-1.5 rounded-full bg-tint/15 px-2 py-1">
      <View className="h-1.5 w-1.5 rounded-full bg-tint" />
      <Text className="text-[12px] font-semibold text-tint" maxFontSizeMultiplier={1.4}>
        Link live
      </Text>
    </View>
  );
}

interface SheetContentProps {
  /** Display title, already run through displayTitle. */
  title: string;
  /** "Yesterday · 42 min". Null when the meeting has neither. */
  meta: string | null;
  /**
   * Omitted by sheets that are not about the meeting as a whole — naming a voice
   * happens on a meeting that has already finished processing, and a badge
   * reading "Complete" beside "Speaker B" answers a question nobody asked.
   */
  status?: MeetingSummary["status"];
  /** True when a public share token exists right now. */
  linkLive?: boolean;
  groups: MenuGroup[];
  /**
   * Fired once the exit animation has finished. The argument is the action the
   * user picked, which the Modal runs only after it has actually gone away —
   * see the note on MeetingMenuSheet.
   */
  onClosed: (run: (() => void) | null) => void;
}

function SheetContent({ title, meta, status, linkLive, groups, onClosed }: SheetContentProps) {
  // Inside the nested SafeAreaProvider, so this is the WINDOW's bottom inset —
  // the home indicator, and nothing else.
  //
  // Reading the screen's own inset here would be the tab-bar double-count all
  // over again (see lib/layout.ts and player/metrics.ts): on a screen inside
  // native tabs UIKit reports 83, which is the 49pt bar plus the 34pt
  // indicator. This sheet is presented OVER the tab bar and hides it, so 83
  // would park the Cancel button a full bar-height above the bottom of the
  // screen and leave a dead band under it — exactly the sliver those two files
  // were written to explain.
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();

  /** Distance below the resting position, in points. 0 is open. */
  const offset = useSharedValue(windowHeight);
  /** Measured sheet height, which is the closed position. */
  const height = useSharedValue(windowHeight);
  /** Where the sheet was when the finger landed, so a re-grab continues. */
  const dragFrom = useSharedValue(0);
  const backdrop = useSharedValue(0);

  const entered = useRef(false);
  const closing = useRef(false);
  const picked = useRef<(() => void) | null>(null);

  const finish = useCallback(() => onClosed(picked.current), [onClosed]);

  /**
   * Start the exit.
   *
   * `closing` latches because every dismissal path can fire twice — a second
   * tap while the sheet is already sliding away, a backdrop press that lands in
   * the same frame as a flick — and the second one would overwrite the action
   * the first one had already committed to.
   *
   * @param run     The picked action, or null for a plain dismissal.
   * @param velocity Release velocity, carried into the spring so a flick and a
   *                 slow drag do not settle identically.
   * @param direct  True when the user is physically pushing the sheet away.
   */
  const dismiss = useCallback(
    (run: (() => void) | null, velocity = 0, direct = false) => {
      if (closing.current) return;
      closing.current = true;
      picked.current = run;

      // Reduce Motion removes the exit, but NOT one the user is performing with
      // their thumb: a sheet that vanishes mid-drag reads as a crash rather than
      // as a respected preference. Same distinction, and the same reasoning, as
      // the row settle in swipe-to-delete.
      if (reduceMotion && !direct) {
        finish();
        return;
      }

      // Faster out than in — TIMING.instant against TIMING.backdrop, SPRING
      // .sheetOut against .sheet. A slow exit reads as lag, and by then the user
      // has already decided.
      backdrop.value = withTiming(0, { ...TIMING.instant, reduceMotion: ReduceMotion.Never });
      offset.value = withSpring(
        height.value,
        { ...SPRING.sheetOut, velocity, reduceMotion: ReduceMotion.Never },
        (done) => {
          // Only on a clean finish. An interrupted spring means something else
          // now owns the sheet, and unmounting under it would cut that short.
          if (done) runOnJS(finish)();
        },
      );
    },
    [backdrop, finish, height, offset, reduceMotion],
  );

  const cancel = useCallback(() => {
    // Light: nothing happened. The consequential haptics belong to the rows.
    haptics.tap();
    dismiss(null);
  }, [dismiss]);

  const closeByGesture = useCallback(
    (velocity: number) => {
      haptics.tap();
      dismiss(null, velocity, true);
    },
    [dismiss],
  );

  const pick = useCallback(
    (row: MenuRow) => {
      // A tick as the row commits. The sheet leaving is the visible half of the
      // feedback — lib/haptics is explicit that a haptic is never the only one.
      haptics.select();
      dismiss(row.run);
    },
    [dismiss],
  );

  /**
   * Entrance, kicked from layout rather than from an effect.
   *
   * The sheet's height is not known until it has been measured, and the height
   * IS the distance it has to travel. Parking it at the window height for the
   * first frame keeps it off-screen; the real value replaces that before the
   * spring starts, so it enters from its own edge and not from the bottom of
   * the display.
   */
  const onSheetLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const measured = event.nativeEvent.layout.height;
      height.value = measured;

      if (entered.current) return;
      entered.current = true;

      if (reduceMotion) {
        offset.value = 0;
        backdrop.value = 1;
        return;
      }

      offset.value = measured;
      offset.value = withSpring(0, SPRING.sheet);
      backdrop.value = withTiming(1, TIMING.backdrop);
    },
    [backdrop, height, offset, reduceMotion],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Downward intent, past a threshold. Without it the pan claims the touch
        // on the first pixel and no row inside the sheet can ever be tapped.
        .activeOffsetY(14)
        .onBegin(() => {
          dragFrom.value = offset.value;
        })
        .onUpdate((event) => {
          // Clamped at the resting position rather than rubber-banded upward.
          // There is nothing above the sheet to reveal, so stretch would be
          // decoration promising content that does not exist.
          offset.value = Math.max(0, dragFrom.value + event.translationY);
        })
        .onEnd((event) => {
          // Velocity beats position: a flick should close from anywhere, and a
          // slow drag that stopped short should not.
          if (event.velocityY > FLICK_VELOCITY || offset.value > CLOSE_AT) {
            runOnJS(closeByGesture)(event.velocityY);
            return;
          }

          offset.value = withSpring(0, {
            ...SPRING.sheet,
            velocity: event.velocityY,
            reduceMotion: ReduceMotion.Never,
          });
        }),
    [closeByGesture, dragFrom, offset],
  );

  // The delete row navigates the screen away, which takes the header — and this
  // — with it. Cancelling leaves nothing running against a shared value whose
  // component is gone.
  useEffect(
    () => () => {
      cancelAnimation(offset);
      cancelAnimation(backdrop);
    },
    [offset, backdrop],
  );

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => {
    // Multiplied by how far the sheet has been pushed down, so a half-completed
    // swipe shows a half-lifted dim instead of a backdrop that only reacts once
    // the finger lifts.
    const hidden = height.value > 0 ? Math.min(offset.value / height.value, 1) : 1;
    return { opacity: backdrop.value * (1 - hidden) * BACKDROP_OPACITY };
  });

  return (
    <View className="flex-1">
      <Animated.View
        className="absolute inset-0"
        style={[{ backgroundColor: BACKDROP_COLOR }, backdropStyle]}
        pointerEvents="none"
      />

      {/* Touch-only. It is deliberately hidden from VoiceOver: the sheet below
          sets accessibilityViewIsModal, which would hide this sibling anyway,
          and a full-screen unlabelled button is worse than none. Cancel is the
          labelled dismiss for assistive technology. */}
      <Pressable
        className="absolute inset-0"
        onPress={cancel}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      <GestureDetector gesture={pan}>
        <Animated.View
          onLayout={onSheetLayout}
          // Bottom-anchored and absolutely positioned rather than laid out in a
          // flex column. At the largest Dynamic Type sizes a fully populated
          // sheet can outgrow the shortest supported iPhone, and this is the
          // only arrangement where the overflow goes off the TOP: losing the
          // title is recoverable, losing Cancel is not.
          className="absolute inset-x-0 bottom-0 border-t border-edge bg-sheet"
          style={[
            {
              borderTopLeftRadius: SHEET_RADIUS,
              borderTopRightRadius: SHEET_RADIUS,
              borderCurve: "continuous",
              paddingBottom: Math.max(insets.bottom, 16),
            },
            sheetStyle,
          ]}
          accessibilityViewIsModal
        >
          {/* Light from above, as on every card in the app. */}
          <View className="absolute inset-x-0 top-0 h-px bg-highlight" pointerEvents="none" />

          <View
            className="items-center py-2.5"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View className="h-1 w-9 rounded-full bg-label-quaternary" />
          </View>

          <View className="gap-1.5 px-5 pb-4">
            <Text
              className="font-display-semibold text-[19px] leading-[24px] text-label"
              numberOfLines={2}
              accessibilityRole="header"
              maxFontSizeMultiplier={1.4}
            >
              {title}
            </Text>

            {/* The identity line. Every row below acts on THIS meeting, and the
                two that cannot be undone say so in their own confirmation — but
                a menu that names nothing is a menu you learn to tap through. */}
            <View className="flex-row flex-wrap items-center gap-2">
              {meta ? (
                <Text
                  className="text-[13px] text-label-secondary"
                  style={{ fontVariant: ["tabular-nums"] }}
                  maxFontSizeMultiplier={1.4}
                >
                  {meta}
                </Text>
              ) : null}
              {status ? <StatusBadge status={status} /> : null}
              {linkLive ? <LinkBadge /> : null}
            </View>
          </View>

          <View className="gap-4">
            {groups.map((group) => (
              <Section key={group.key}>
                {group.rows.map((row) => (
                  <MenuRowButton key={row.key} row={row} onPick={pick} />
                ))}
              </Section>
            ))}
          </View>

          <View className="px-4 pt-4">
            <Pressable
              onPress={cancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              accessibilityHint="Closes this menu without changing anything"
              className="items-center justify-center rounded-card border border-edge bg-surface active:bg-elevated"
              style={{ minHeight: ROW_MIN_HEIGHT, borderCurve: "continuous" }}
            >
              <Text className="text-[17px] font-semibold text-label" maxFontSizeMultiplier={1.6}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * Presented by mounting it; it tells the caller when it has gone.
 *
 * The picked action runs from the Modal's `onDismiss` and not from the row's
 * own press handler, which is the one non-obvious thing in this file. Every row
 * here ends in either a UIAlertController (delete, revoke, rename) or a
 * UIActivityViewController (share), and iOS will not present either from a view
 * controller that is itself still presenting — firing them on press throws
 * "attempt to present ... which is already presenting". `onDismiss` fires after
 * the Modal's own dismissal has completed, which is the first moment the alert
 * can be put up safely.
 */
export interface MeetingMenuSheetProps {
  title: string;
  meta: string | null;
  /** Omit on a sheet that is not about the meeting's own state. */
  status?: MeetingSummary["status"];
  linkLive?: boolean;
  groups: MenuGroup[];
  /** Fired after the sheet has gone and the picked action has run. */
  onDismissed: () => void;
}

export function MeetingMenuSheet({
  title,
  meta,
  status,
  linkLive,
  groups,
  onDismissed,
}: MeetingMenuSheetProps) {
  const [visible, setVisible] = useState(true);
  const picked = useRef<(() => void) | null>(null);
  const settled = useRef(false);

  const handleClosed = useCallback((run: (() => void) | null) => {
    picked.current = run;
    setVisible(false);
  }, []);

  const handleDismissed = useCallback(() => {
    if (settled.current) return;
    settled.current = true;

    const run = picked.current;
    picked.current = null;
    run?.();
    onDismissed();
  }, [onDismissed]);

  /**
   * Backstop for `onDismiss`.
   *
   * That event is the only thing that finishes a presentation: it runs the
   * picked action AND tells the caller to unmount this. If it were ever missed
   * — it is an iOS-only native event, and this component is the app's only
   * Modal — the sheet would sit mounted and invisible, and the header button
   * would look dead because `open` is already true. 250ms is well past the
   * native dismissal and short enough that a delete confirmation still feels
   * like it followed the tap.
   */
  useEffect(() => {
    if (visible) return;

    const timer = setTimeout(handleDismissed, 250);
    return () => clearTimeout(timer);
  }, [visible, handleDismissed]);

  return (
    <Modal
      visible={visible}
      transparent
      // The sheet animates itself. iOS's own slide would run underneath ours and
      // the two would disagree about where the surface is.
      animationType="none"
      onDismiss={handleDismissed}
      onRequestClose={() => setVisible(false)}
    >
      {/* A Modal is a new native root, and neither of these providers in
          app/_layout.tsx reaches into it. Without the first, no gesture inside
          the sheet ever activates; without the second, useSafeAreaInsets falls
          back to the OUTER context, which on a screen inside native tabs
          reports the tab bar this sheet is covering. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <SheetContent
            title={title}
            meta={meta}
            status={status}
            linkLive={linkLive}
            groups={groups}
            onClosed={handleClosed}
          />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}
