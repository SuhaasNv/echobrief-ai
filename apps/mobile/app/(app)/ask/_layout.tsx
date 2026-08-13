import { Stack, usePathname } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { useTabBarInset } from "@/lib/layout";
import { stackScreenOptions } from "@/lib/screen-options";
import { CrashScreen, ErrorBoundary } from "@/components/error-boundary";

export default function AskStack() {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const tabBarInset = useTabBarInset();

  return (
    // See the note in app/(app)/account/_layout.tsx: catching per tab keeps a
    // broken screen from taking the tab bar and the other four tabs with it.
    // This tab renders streamed model output, so it is the one place where the
    // shape of what arrives is not fully under our control.
    <ErrorBoundary
      resetKey={pathname}
      onReset={(attempts) => {
        if (attempts > 1) queryClient.clear();
      }}
      fallback={(props) => (
        <CrashScreen {...props} title="Ask could not be drawn" bottomInset={tabBarInset} />
      )}
    >
      <Stack screenOptions={stackScreenOptions}>
        <Stack.Screen name="index" options={{ title: "Ask" }} />
      </Stack>
    </ErrorBoundary>
  );
}
