import { Stack } from "expo-router";

import { stackScreenOptions } from "@/lib/screen-options";

export default function AccountStack() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: "Account" }} />
    </Stack>
  );
}
