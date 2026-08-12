import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        animation: "default",
        gestureEnabled: true,
        headerTransparent: true,
        headerTintColor: "#4C99F8",
        headerTitle: "",
      }}
    >
      {/* Sign-in is the root of this stack — nothing to go back to. */}
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      {/* Sign-up needs a back button. Without one the only way out is the edge
          swipe, which is undiscoverable for anyone who does not already know it. */}
      <Stack.Screen name="sign-up" options={{ headerShown: true, headerBackTitle: "Back" }} />
    </Stack>
  );
}
