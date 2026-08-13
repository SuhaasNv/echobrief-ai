import { Stack, usePathname } from "expo-router";

import { useTabBarInset } from "@/lib/layout";
import { useStackScreenOptions } from "@/lib/screen-options";
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
  // Only the upload form uses these. The recorder itself is headerless — see
  // the note above — so the stack default stays off and one screen opts in.
  const screenOptions = useStackScreenOptions();

  return (
    <ErrorBoundary
      resetKey={pathname}
      fallback={(props) => (
        <CrashScreen {...props} title="The recorder didn’t open" bottomInset={tabBarInset} />
      )}
    >
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        {/* The upload form is a pushed screen and needs a way back and a name,
            so it takes the header every other stack in the app uses. Inline
            title, matching the account sub-screens: a large title on a
            four-row form spends a fifth of the canvas restating the control
            that opened it. */}
        <Stack.Screen
          name="import"
          options={{
            ...screenOptions,
            headerShown: true,
            headerLargeTitleEnabled: false,
            title: "Upload a recording",
          }}
        />
      </Stack>
    </ErrorBoundary>
  );
}
