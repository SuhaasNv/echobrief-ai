import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useNotificationLifecycle } from "@/lib/notifications";

/**
 * Native tab bar — a real UITabBar via react-native-screens.
 *
 * This is deliberately NOT expo-router's JS <Tabs>. Because the app is built
 * against the iOS 26 SDK, a real UITabBar adopts Liquid Glass, the scroll edge
 * effect, and correct Reduce Transparency / Increase Contrast behaviour for
 * free. The JS tab bar is a plain View and gets none of it.
 *
 * Consequence: tabBarBackgroundColor and blurEffect are inert on iOS 26 — the
 * system derives the background from the content scrolling underneath. Do not
 * try to paint it.
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

  return (
    <NativeTabs
      // Drives the Liquid Glass selection glow on iOS 26.
      tintColor="#4C99F8"
      // The tab bar collapses as content scrolls down, handing the screen back
      // to the content layer. Free legibility win on the transcript screen.
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="meetings">
        <NativeTabs.Trigger.Label>Meetings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "list.bullet.rectangle", selected: "list.bullet.rectangle.fill" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="ask">
        <NativeTabs.Trigger.Label>Ask</NativeTabs.Trigger.Label>
        {/* Not sparkle.magnifyingglass. The sparkle is the generic "AI did
            something" glyph every product shipped in the same eighteen months,
            and it says nothing this tab does not already say in a word. This
            searches the TEXT of every meeting, which is what the symbol shows. */}
        <NativeTabs.Trigger.Icon sf="text.magnifyingglass" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="record">
        <NativeTabs.Trigger.Label>Record</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "mic", selected: "mic.fill" }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="actions">
        <NativeTabs.Trigger.Label>Actions</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "checkmark.circle", selected: "checkmark.circle.fill" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
