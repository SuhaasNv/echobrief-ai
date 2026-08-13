import { Stack, usePathname } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { useTabBarInset } from "@/lib/layout";
import { stackScreenOptions } from "@/lib/screen-options";
import { CrashScreen, ErrorBoundary } from "@/components/error-boundary";

export default function MeetingsStack() {
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
        <CrashScreen
          {...props}
          title="Your meetings could not be drawn"
          bottomInset={tabBarInset}
        />
      )}
    >
      <Stack screenOptions={stackScreenOptions}>
        {/* Search options are set from the screen itself, which owns the query
            state. Declaring them here left a search field wired to nothing. */}
        <Stack.Screen name="index" options={{ title: "Meetings" }} />
        <Stack.Screen name="[id]" options={{ title: "" }} />
      </Stack>
    </ErrorBoundary>
  );
}
