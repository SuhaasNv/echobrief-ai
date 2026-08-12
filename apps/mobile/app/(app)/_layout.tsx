import { NativeTabs } from "expo-router/unstable-native-tabs";

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
        <NativeTabs.Trigger.Icon sf="sparkle.magnifyingglass" />
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
