import { Stack } from "expo-router";

import { useColorTokens } from "@/lib/tokens";

const TOKENS = ["--tint", "--background"] as const;

export default function AuthLayout() {
  // Native navigation chrome: neither prop takes a className, so both colours
  // have to arrive resolved.
  const [tint, background] = useColorTokens(TOKENS);

  return (
    <Stack
      screenOptions={{
        // Delegates to UINavigationController, which brings the real parallax
        // push and the interactive back-swipe.
        animation: "default",
        gestureEnabled: true,
        // Transparent, so the hero video runs unbroken behind the chrome on
        // sign-up. Do not add headerStyle.backgroundColor alongside it — a
        // painted bar would cut a grey slab across the orb.
        headerTransparent: true,
        headerTintColor: tint,
        headerTitle: "",
        // Without this the native screen container is system white until the
        // screen's own View paints, which shows as a white flash on every push.
        contentStyle: { backgroundColor: background },
      }}
    >
      {/* Sign-in is the root of this stack — nothing to go back to. */}
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      {/* Sign-up needs a back button. Without one the only way out is the edge
          swipe, which is undiscoverable for anyone who does not already know it.
          The label stays spelled out rather than a bare chevron: it sits over
          video, where a lone glyph is easy to miss. */}
      <Stack.Screen name="sign-up" options={{ headerShown: true, headerBackTitle: "Back" }} />
    </Stack>
  );
}
