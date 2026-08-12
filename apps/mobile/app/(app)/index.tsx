import { useCallback } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Stack } from "expo-router";

import { useMeetings, type MeetingSummary } from "@/lib/api/meetings";
import { StatusBadge } from "@/components/StatusBadge";

function formatDuration(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function MeetingRow({ meeting }: { meeting: MeetingSummary }) {
  const duration = formatDuration(meeting.duration_sec);

  const meta = [
    duration,
    meeting.participant_count ? `${meeting.participant_count} speakers` : null,
    meeting.action_item_count ? `${meeting.action_item_count} tasks` : null,
  ].filter(Boolean) as string[];

  return (
    <Pressable
      // Rows highlight with a background fill on iOS; they do not scale. A
      // scaling full-width row reads as Android.
      className="active:bg-fill px-4 py-3"
      accessibilityRole="button"
    >
      <View className="flex-row items-start gap-3">
        <View className="flex-1">
          <Text className="text-[17px] font-semibold text-label" numberOfLines={2}>
            {meeting.title}
          </Text>

          {meeting.summary_excerpt ? (
            <Text className="mt-1 text-[15px] text-label-secondary" numberOfLines={2}>
              {meeting.summary_excerpt}
            </Text>
          ) : null}

          {meta.length > 0 ? (
            <Text className="mt-1.5 text-[13px] text-label-tertiary">{meta.join(" · ")}</Text>
          ) : null}
        </View>

        <StatusBadge status={meeting.status} />
      </View>
    </Pressable>
  );
}

function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center px-8 py-24">
      <Text className="text-center text-[17px] font-semibold text-label">
        Record your first meeting
      </Text>
      <Text className="mt-2 text-center text-[15px] text-label-secondary">
        EchoBrief turns it into a summary, action items, and a searchable transcript in a couple
        of minutes.
      </Text>
    </View>
  );
}

export default function MeetingsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useMeetings();

  const renderItem = useCallback(
    ({ item }: { item: MeetingSummary }) => <MeetingRow meeting={item} />,
    [],
  );

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: "Meetings" }} />

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-[17px] font-semibold text-label">Can't load your meetings.</Text>
          <Pressable
            onPress={() => void refetch()}
            className="mt-4 h-11 justify-center rounded-full bg-label px-6"
            accessibilityRole="button"
          >
            <Text className="text-[17px] font-semibold text-background">Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlashList
          data={data?.items ?? []}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={EmptyState}
          ItemSeparatorComponent={() => <View className="ml-4 h-px bg-separator" />}
          // Required for the large title to collapse and for the scroll edge
          // effect to have something to blur. React Native defaults this to
          // 'never', which is NOT the UIKit default.
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
          }
        />
      )}
    </View>
  );
}
