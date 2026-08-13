import "../global.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, ThemeProvider, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";

import { useFonts } from "expo-font";
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";

import { createQueryClient, installQueryPlatformBindings } from "@/lib/query";
import { hydrateSession } from "@/lib/api/token-store";
import { subscribeToSessionEvents } from "@/lib/api/session-events";
import { navigationTheme } from "@/lib/navigation-theme";
import { ShotDriver } from "@/lib/shot-driver";
import { CrashScreen, ErrorBoundary } from "@/components/error-boundary";

// Hold the splash until the Keychain read resolves. Without this the auth guard
// runs against an empty in-memory cache and a signed-in user is flashed the
// sign-in screen on every cold start.
void SplashScreen.preventAutoHideAsync();

const queryClient = createQueryClient();

export default function RootLayout() {
  const [sessionReady, setSessionReady] = useState(false);
  // Ref, not state: this is read inside callbacks and must never trigger a
  // render or be captured stale.
  const queryClientRef = useRef(queryClient);

  // Display face only — body text stays on the system font so Dynamic Type,
  // optical sizing, and non-Latin fallback keep working. Held behind the splash
  // so headings never render in SF and then reflow into Space Grotesk.
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  const ready = sessionReady && fontsLoaded;

  useEffect(() => {
    let cancelled = false;

    hydrateSession()
      .catch(() => {
        // A Keychain failure means no session, not a broken app — fall through
        // to the sign-in screen rather than hanging on the splash forever.
      })
      .finally(() => {
        if (!cancelled) setSessionReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => installQueryPlatformBindings(), []);

  useEffect(
    () =>
      subscribeToSessionEvents((event) => {
        if (event === "unauthorized") {
          // The client has already cleared the token by this point; drop cached
          // data so the next user cannot see the previous one's meetings.
          queryClientRef.current.clear();
          router.replace("/sign-in");
          return;
        }

        // A stale workspace id was cleared and the request retried against the
        // server's fallback workspace. Everything cached is scoped to the old
        // one, so it is all wrong now.
        void queryClientRef.current.invalidateQueries();
      }),
    [],
  );

  const onLayoutReady = useCallback(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutReady}>
      <SafeAreaProvider>
        {/*
          Root boundary. Inside SafeAreaProvider so the fallback can respect the
          notch, and outside everything else so a throw in any provider, the
          navigator, or any screen is caught rather than unmounting the whole
          tree to a blank canvas.

          A repeat failure drops the query cache before remounting: a render
          crash is far more often a response shape the UI did not expect than a
          transient one, and evicting that data is the only retry that stands a
          real chance of behaving differently. Tokens live in the Keychain, not
          here, so this never signs anyone out.
        */}
        <ErrorBoundary
          onReset={(attempts) => {
            if (attempts > 1) queryClient.clear();
          }}
          fallback={(props) => <CrashScreen {...props} />}
        >
          <QueryClientProvider client={queryClient}>
            {/* Light content: the brand ground is near-black in both appearances. */}
            <StatusBar style="light" />
            {/* Without this every navigator paints its native container with
                React Navigation's light DefaultTheme background. See
                src/lib/navigation-theme.ts. */}
            <ThemeProvider value={navigationTheme}>
              <Stack
                screenOptions={{
                  headerShown: false,
                  // Delegates to UINavigationController, which brings the real
                  // parallax push and the interactive back-swipe. 'slide_from_right'
                  // is a flat JS reimplementation and reads as non-native.
                  animation: "default",
                  gestureEnabled: true,
                  fullScreenGestureEnabled: true,
                }}
              >
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(app)" />
              </Stack>
            </ThemeProvider>
            {/* Inert unless EXPO_PUBLIC_SHOT_MODE=1 at build time. */}
            <ShotDriver />
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
