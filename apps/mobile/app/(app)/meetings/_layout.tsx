import { Stack } from "expo-router";

import { stackScreenOptions } from "@/lib/screen-options";

export default function MeetingsStack() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="index"
        options={{
          title: "Meetings",
          headerSearchBarOptions: {
            placeholder: "Search titles",
            hideWhenScrolling: true,
            textColor: "#F4F5F7",
          },
        }}
      />
    </Stack>
  );
}
