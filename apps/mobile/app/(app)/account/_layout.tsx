import { Stack, usePathname } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { useTabBarInset } from "@/lib/layout";
import { stackScreenOptions } from "@/lib/screen-options";
import { CrashScreen, ErrorBoundary } from "@/components/error-boundary";

/**
 * Sub-screens use inline titles: a large title on a short form screen wastes a
 * fifth of the canvas restating the row you just tapped.
 *
 * Titles are the row labels, word for word. A row that says "Summaries" opening
 * a screen titled "AI output preferences" costs the user a beat working out
 * whether they landed where they meant to.
 */
const SUB_SCREENS: readonly { name: string; title: string }[] = [
  { name: "profile", title: "Profile" },
  { name: "password", title: "Password" },
  { name: "recording", title: "Recording" },
  { name: "transcription", title: "Transcription" },
  { name: "vocabulary", title: "Vocabulary" },
  { name: "summaries", title: "Summaries" },
  { name: "notifications", title: "Notifications" },
  { name: "workspaces", title: "Workspace" },
  { name: "plan", title: "Plan" },
  { name: "privacy", title: "Privacy" },
  { name: "about", title: "About" },
  { name: "legal", title: "Legal" },
  { name: "delete", title: "Delete account" },
];

export default function AccountStack() {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const tabBarInset = useTabBarInset();

  return (
    // Tab-level boundary. The root one in app/_layout.tsx catches everything,
    // but it replaces the WHOLE app, tab bar included. Catching here first means
    // a throw on one settings screen costs the user this tab and nothing else:
    // the other four keep working while they retry.
    //
    // resetKey is the route, so navigating anywhere else clears a caught error
    // on its own instead of leaving the tab stuck on its fallback.
    <ErrorBoundary
      resetKey={pathname}
      onReset={(attempts) => {
        if (attempts > 1) queryClient.clear();
      }}
      fallback={(props) => (
        <CrashScreen
          {...props}
          title="This account screen could not be drawn"
          bottomInset={tabBarInset}
        />
      )}
    >
      <Stack screenOptions={stackScreenOptions}>
        <Stack.Screen name="index" options={{ title: "Account" }} />
        {SUB_SCREENS.map(({ name, title }) => (
          <Stack.Screen key={name} name={name} options={{ title, headerLargeTitleEnabled: false }} />
        ))}
      </Stack>
    </ErrorBoundary>
  );
}
