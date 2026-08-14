import { Stack, usePathname } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { useTabBarInset } from "@/lib/layout";
import { useStackScreenOptions } from "@/lib/screen-options";
import { CrashScreen, ErrorBoundary } from "@/components/error-boundary";

export default function MeetingsStack() {
  const screenOptions = useStackScreenOptions();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const tabBarInset = useTabBarInset();

  return (
    // See the note in app/(app)/account/_layout.tsx: catching per tab keeps a
    // broken screen from taking the tab bar and the other four tabs with it.
    // This tab carries the most third-party-shaped data — transcripts, speaker
    // arrays, summaries — so it is the likeliest place for a render throw.
    <ErrorBoundary
      resetKey={pathname}
      onReset={(attempts) => {
        if (attempts > 1) queryClient.clear();
      }}
      fallback={(props) => (
        <CrashScreen {...props} title="Your meetings didn’t load" bottomInset={tabBarInset} />
      )}
    >
      <Stack screenOptions={screenOptions}>
        {/* Search lives in the list itself (see MeetingSearchField), not the
            native nav bar: `headerSearchBarOptions` does not install its
            UISearchController on this react-native-screens / iOS pairing, so the
            field was silently absent. An in-content field is fully ours to style
            and behaves identically across OS versions. */}
        <Stack.Screen name="index" options={{ title: "Meetings" }} />
        <Stack.Screen name="[id]" options={{ title: "" }} />
      </Stack>
    </ErrorBoundary>
  );
}
