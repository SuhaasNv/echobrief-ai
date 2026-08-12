import { ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";

/**
 * Meeting detail — the payoff screen. Summary, transcript with speaker
 * attribution, action items, and tap-to-seek playback all land here.
 *
 * Stubbed so the list rows navigate somewhere real rather than announcing
 * themselves as buttons and doing nothing.
 */
export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 8 }}
    >
      <Stack.Screen options={{ title: "Meeting" }} />
      <Text className="text-[15px] text-label-tertiary">
        Summary, transcript, and action items land here next.
      </Text>
      <Text className="text-[13px] text-label-tertiary" selectable>
        {id}
      </Text>
    </ScrollView>
  );
}
