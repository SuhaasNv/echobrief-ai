import { ScrollView, Text, View } from "react-native";

/**
 * Placeholder for a tab whose screen is not built yet.
 *
 * States what the screen will do rather than apologising — the same rule the
 * shipped "open on the web" affordance follows. Styled with a muted tertiary
 * treatment so it reads as "not yet" rather than borrowing the visual language
 * of the error and empty states. Delete each as the real screen lands.
 */
export function ScreenStub({ description }: { description: string }) {
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 32 }}
    >
      <View className="items-center">
        <Text className="text-center text-[15px] text-label-tertiary">{description}</Text>
      </View>
    </ScrollView>
  );
}
