import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useRecordingRecovery } from "@/lib/audio/recovery";
import { useNotificationLifecycle } from "@/lib/notifications";
import { useColorToken } from "@/lib/tokens";

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

  // UITabBar is native chrome, so this is one of the few colours that has to
  // reach JS resolved rather than through a className.
  const tint = useColorToken("--tint");

  return (
    <NativeTabs
      // Drives the Liquid Glass selection glow on iOS 26.
      tintColor={tint}
      // The tab bar collapses as content scrolls down, handing the screen back
      // to the content layer. Free legibility win on the transcript screen.
      minimizeBehavior="onScrollDown"
    >
      {/* One glyph per tab, all of them the outline (non-.fill) member of the
          SF Symbols family, and no per-state swap. Mixing filled and stroked
          glyphs across a five-tab bar is what makes an icon set look sourced
          from two places; on iOS 26 the tint and the Liquid Glass selection
          indicator already carry the selected state, so switching glyph weight
          on top of that is emphasis nobody asked for and it costs the row its
          optical consistency. */}
      <NativeTabs.Trigger name="meetings">
        <NativeTabs.Trigger.Label>Meetings</NativeTabs.Trigger.Label>
        {/* Not list.bullet.rectangle: its enclosing rounded rect is a frame the
            other four glyphs do not have, so it read as a badge rather than a
            peer. */}
        <NativeTabs.Trigger.Icon sf="list.bullet" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="ask">
        <NativeTabs.Trigger.Label>Ask</NativeTabs.Trigger.Label>
        {/* Not a magnifier of any kind. The meetings list has a real search
            field with its own magnifier, so one here collides with a live
            affordance — and text.magnifyingglass reads as the zoom control it
            resembles, not as a question. A question mark inside a speech bubble
            is the one shape that says "ask", and the bubble carries the fact
            that this tab is a conversation rather than a single query. */}
        <NativeTabs.Trigger.Icon sf="questionmark.bubble" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="record">
        <NativeTabs.Trigger.Label>Record</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="mic" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="actions">
        <NativeTabs.Trigger.Label>Actions</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="checkmark.circle" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
