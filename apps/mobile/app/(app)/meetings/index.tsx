import { useCallback, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { onlineManager } from "@tanstack/react-query";
import { router } from "expo-router";

import { useMeetings, type MeetingSummary } from "@/lib/api/meetings";
import { formatDuration, formatListDate, pluralize } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { StatusBadge } from "@/components/status-badge";

function MeetingRow({ meeting }: { meeting: MeetingSummary }) {
  const duration = formatDuration(meeting.duration_sec);
  const date = formatListDate(meeting.recorded_at ?? meeting.created_at);

  const meta = [
    duration,
    meeting.participant_count ? pluralize(meeting.participant_count, "speaker") : null,
    meeting.action_item_count ? pluralize(meeting.action_item_count, "task") : null,
  ].filter(Boolean) as string[];

  // One label for the whole row, so VoiceOver reads it as a single cell rather
  // than four disconnected fragments.
  const a11yLabel = [meeting.title, date, ...meta].filter(Boolean).join(", ");

  return (
    <Pressable
      onPress={() => {
        haptics.select();
        router.push(`/(app)/meetings/${meeting.id}`);
      }}
      className="px-4 py-3 active:bg-fill"
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint="Opens the summary and transcript"
    >
      <View className="flex-row items-start gap-3">
        <View className="flex-1">
          <View className="flex-row items-baseline gap-2">
            <Text
              className="flex-1 text-[17px] font-semibold text-label"
              numberOfLines={2}
            >
              {meeting.title}
            </Text>
            {date ? (
              <Text
                className="shrink-0 text-[13px] text-label-secondary"
                maxFontSizeMultiplier={1.6}
              >
                {date}
              </Text>
            ) : null}
          </View>

          {meeting.summary_excerpt ? (
            <Text className="mt-1 text-[15px] text-label-secondary" numberOfLines={2}>
              {meeting.summary_excerpt}
            </Text>
          ) : null}

          {meta.length > 0 ? (
            <Text
              // label-secondary, not tertiary: tertiary on the background is
              // 4.17:1 and fails AA at this size.
              className="mt-1.5 text-[13px] text-label-secondary"
              style={{ fontVariant: ["tabular-nums"] }}
              maxFontSizeMultiplier={1.6}
            >
              {meta.join(" · ")}
            </Text>
          ) : null}
        </View>

        <StatusBadge status={meeting.status} />
      </View>
    </Pressable>
  );
}

function EmptyState() {
  return (
    <View className="items-center px-8 pt-24">
      <Text className="text-center text-[20px] font-semibold text-label">
        No meetings yet
      </Text>
      <Text className="mt-2 text-center text-[15px] text-label-secondary">
        Record a conversation and EchoBrief turns it into a summary, action items, and a
        searchable transcript.
      </Text>
      <Pressable
        onPress={() => router.push("/(app)/record")}
        accessibilityRole="button"
        className="mt-6 min-h-[50px] justify-center rounded-full bg-label px-6 active:opacity-80"
      >
        <Text className="text-[17px] font-semibold text-background">Start recording</Text>
      </Pressable>
    </View>
  );
}

export default function MeetingsScreen() {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMeetings();

  // Tracked separately from isRefetching, which is true for ANY background
  // refetch — including the 15s poll. Binding the control to that makes the
  // spinner drop down and spin unprompted four times a minute.
  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const isOnline = useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );

  const onRefresh = useCallback(async () => {
    setIsManualRefresh(true);
    try {
      await refetch();
    } finally {
      setIsManualRefresh(false);
    }
  }, [refetch]);

  const renderItem = useCallback(
    ({ item }: { item: MeetingSummary }) => <MeetingRow meeting={item} />,
    [],
  );

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator accessibilityLabel="Loading meetings" />
      </View>
    );
  }

  if (isError && items.length === 0) {
    // A connection failure and a server failure need different copy — one is
    // the user's problem to fix, the other isn't.
    const offline = !isOnline;
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text className="text-center text-[17px] font-semibold text-label">
          {offline ? "You're offline." : "Can't load your meetings."}
        </Text>
        <Text className="mt-2 text-center text-[15px] text-label-secondary">
          {offline
            ? "Your meetings will appear once you're back online."
            : (error as Error).message}
        </Text>
        <Pressable
          onPress={() => void refetch()}
          className="mt-6 min-h-[50px] justify-center rounded-full bg-label px-6 active:opacity-80"
          accessibilityRole="button"
        >
          <Text className="text-[17px] font-semibold text-background">Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {!isOnline ? (
        <View className="bg-fill px-4 py-2">
          <Text className="text-center text-[13px] text-label-secondary">
            Offline — showing your last synced meetings
          </Text>
        </View>
      ) : null}

      <FlashList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={EmptyState}
        ItemSeparatorComponent={() => <View className="ml-4 h-px bg-separator" />}
        // Required for the large title to collapse and for the iOS 26 scroll
        // edge effect to have something to blur. React Native defaults this to
        // 'never', which is NOT the UIKit default.
        contentInsetAdjustmentBehavior="automatic"
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        onEndReachedThreshold={0.6}
        ListFooterComponent={
          isFetchingNextPage ? <ActivityIndicator className="py-4" /> : null
        }
        refreshControl={
          <RefreshControl
            refreshing={isManualRefresh}
            onRefresh={onRefresh}
            // The default spinner grey is near-invisible on #06070A.
            tintColor="#9CA1A9"
          />
        }
      />
    </View>
  );
}
