import { Stack, usePathname } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { useTabBarInset } from "@/lib/layout";
import { useStackScreenOptions } from "@/lib/screen-options";
import { CrashScreen, ErrorBoundary } from "@/components/error-boundary";

export default function ActionsStack() {
  const screenOptions = useStackScreenOptions();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const tabBarInset = useTabBarInset();

  return (
    // See the note in app/(app)/account/_layout.tsx: catching per tab keeps a
    // broken screen from taking the tab bar and the other four tabs with it.
    <ErrorBoundary
      resetKey={pathname}
      onReset={(attempts) => {
        if (attempts > 1) queryClient.clear();
      }}
      fallback={(props) => (
        <CrashScreen {...props} title="Your action items didn’t load" bottomInset={tabBarInset} />
      )}
    >
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="index" options={{ title: "Actions" }} />
      </Stack>
    </ErrorBoundary>
  );
}
