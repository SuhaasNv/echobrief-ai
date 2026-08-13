import { Stack, usePathname } from "expo-router";

import { useTabBarInset } from "@/lib/layout";
import { CrashScreen, ErrorBoundary } from "@/components/error-boundary";

/**
 * No header on the recorder.
 *
 * It is an immersive, single-purpose screen — a large "Record" title above the
 * canvas eats a fifth of the screen to restate what the selected tab already
 * says, and a header slab fights the near-black background.
 *
 * The boundary here deliberately does NOT clear the query cache on repeated
 * failure, unlike the other tabs. A throw while a recording is in progress must
 * not take the recorder's in-memory state with it, and there is no server query
 * on this screen worth resetting anyway. Losing a meeting someone is in the
 * middle of recording is a worse outcome than a stale cache.
 */
export default function RecordStack() {
  const pathname = usePathname();
  const tabBarInset = useTabBarInset();

  return (
    <ErrorBoundary
      resetKey={pathname}
      fallback={(props) => (
        <CrashScreen
          {...props}
          title="The recorder could not be drawn"
          bottomInset={tabBarInset}
        />
      )}
    >
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
      </Stack>
    </ErrorBoundary>
  );
}
