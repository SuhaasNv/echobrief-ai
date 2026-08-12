import { Text, View } from "react-native";
import { Stack } from "expo-router";

/**
 * Placeholder for a tab whose screen is not built yet.
 *
 * Deliberately states what the screen will do rather than apologising — the
 * same rule the shipped "open on the web" affordance follows. Delete each of
 * these as the real screen lands.
 */
export function ScreenStub({ title, description }: { title: string; description: string }) {
  return (
    <View className="flex-1 items-center justify-center bg-background px-8">
      <Stack.Screen options={{ title }} />
      <Text className="text-center text-[17px] font-semibold text-label">{title}</Text>
      <Text className="mt-2 text-center text-[15px] text-label-secondary">{description}</Text>
    </View>
  );
}
