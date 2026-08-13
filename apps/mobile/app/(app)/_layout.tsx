import { Tabs } from "expo-router";

import { CustomTabBar, type TabBarProps } from "@/components/tab-bar/custom-tab-bar";
import { useRecordingRecovery } from "@/lib/audio/recovery";
import { useNotificationLifecycle } from "@/lib/notifications";

/**
 * The app's own bottom navigation, drawn in JS.
 *
 * This replaced `expo-router/unstable-native-tabs`. A real UITabBar gave Liquid
 * Glass for free, but the design calls for two things a UITabBar cannot draw:
 * an elevated centre Record action lifted into a circle above the bar, and a
 * selected tab that expands to reveal its label while the rest collapse to
 * icons. Both are custom by definition. See components/tab-bar/custom-tab-bar.
 *
 * The trade has a cost that is paid in lib/layout.ts: with no UITabBar, UIKit
 * stops reporting the bar in the bottom safe area, so every scroll surface's
 * clearance is recomputed there around the bar's known height. That is the one
 * place a change here can hide content, so the geometry lives as constants.
 */
export default function AppLayout() {
  // Notification plumbing for the whole signed-in app: routes a tap to its
  // meeting (cold start included), clears the badge on foreground, catches up
  // on anything that finished while the app was away, and dismisses banners for
  // meetings the user has already opened.
  //
  // Mounted here rather than in the root layout only because this is the
  // highest file in the tree this change owns. See the note in
  // src/lib/notifications/index.ts: moving the import one level up to
  // app/_layout.tsx would make the background task's handler available on a
  // background launch that never renders the tab tree.
  useNotificationLifecycle();

  /**
   * Find recordings a crash interrupted, on launch and on every foreground.
   *
   * Here rather than on the Record tab, which is where it started. Meetings is
   * the first tab, so a user whose recording died mid-meeting would only be told
   * about it if they happened to open Record — and the whole point of capturing
   * to disk is that they never have to know a crash happened to get their audio
   * back. This is the highest node that is guaranteed to mount for a signed-in
   * user, so from here it always runs.
   *
   * Safe to also be called from the Record screen: the "one at a time" and
   * "never while capturing" guards are module-level inside the sweep, not
   * per-hook.
   */
  useRecordingRecovery();

  return (
    <Tabs
      // The custom bar floats over content, so screens draw full-height and the
      // bar overlays them. `tabBar` returns our component; `sceneStyle` keeps
      // the canvas colour behind it during the fade between tabs.
      // Cast because React Navigation's BottomTabBarProps is not importable from
      // a stable path (expo-router bundles its own copy under a deep build dir).
      // CustomTabBar reads only the four fields TabBarProps declares, all of
      // which the real props satisfy structurally.
      tabBar={(props) => <CustomTabBar {...(props as unknown as TabBarProps)} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: "transparent" },
      }}
    >
      {/* Order here is the on-screen order, and it is load-bearing: Record must
          be the third of five so it lands in the centre where the elevated
          action belongs. The glyphs and labels themselves live in the tab bar's
          own TABS map. */}
      <Tabs.Screen name="meetings" />
      <Tabs.Screen name="ask" />
      <Tabs.Screen name="record" />
      <Tabs.Screen name="actions" />
      <Tabs.Screen name="account" />
    </Tabs>
  );
}
