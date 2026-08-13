import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, SectionList, Text, View } from "react-native";
import { router, Stack } from "expo-router";

import { describeError, useOnline } from "@/lib/api/errors";
import { useMeetings, type MeetingSummary } from "@/lib/api/meetings";
import { haptics } from "@/lib/haptics";
import { useTabBarInset } from "@/lib/layout";
import { ErrorState, StaleNotice } from "@/components/error-state";
import { ListEndCap } from "@/components/meetings/end-cap";
import { LibraryEmpty, NoResults } from "@/components/meetings/empty-state";
import { MeetingRow } from "@/components/meetings/meeting-row";
import { MeetingsSkeleton } from "@/components/meetings/skeleton";
import { StatHeader } from "@/components/meetings/stat-header";

/**
 * Day grouping.
 *
 * Every iOS library — Mail, Files, Photos, Voice Memos — groups by day rather
 * than showing a flat list. It gives the screen rhythm, and it lets each row
 * drop its date down to a time, which removes a column of near-identical text.
 */
function sectionTitle(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  }
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

interface Section {
  title: string;
  /** Index of this section's first row in the flattened list, for stagger. */
  offset: number;
  first: boolean;
  data: MeetingSummary[];
}

/**
 * Section heading.
 *
 * Title case, not ALL CAPS: iOS 26 moved its own headings to title case, and
 * tracked-out capitals now date a screen the way a bevelled button would.
 *
 * The count sits beside the title rather than trailing at the right margin —
 * flush right it reads as a separate column of unrelated numbers, and at the
 * baseline of the heading it reads as part of the phrase.
 */
function SectionHeader({ title, count, first }: { title: string; count: number; first: boolean }) {
  return (
    <View
      className={`flex-row items-baseline gap-2 bg-background px-4 pb-2.5 ${
        first ? "pt-1" : "pt-6"
      }`}
    >
      <Text className="text-[15px] font-semibold text-label" maxFontSizeMultiplier={1.5}>
        {title}
      </Text>
      <Text
        className="text-[13px] text-label-tertiary"
        style={{ fontVariant: ["tabular-nums"] }}
        maxFontSizeMultiplier={1.4}
      >
        {count}
      </Text>
    </View>
  );
}

/** Keystrokes are not queries. Long enough to skip the noise, short enough
    that a finished word resolves before the finger leaves the keyboard. */
const SEARCH_DEBOUNCE_MS = 250;

export default function MeetingsScreen() {
  const tabBarInset = useTabBarInset();
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (searchInput === query) return;
    const id = setTimeout(() => setQuery(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput, query]);

  const {
    data,
    isLoading,
    isError,
    isPaused,
    isFetching,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMeetings(query);

  // Tracked separately from isRefetching, which is true for ANY background
  // refetch — including the poll. Binding the control to that makes the spinner
  // drop down unprompted every 15 seconds.
  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const isOnline = useOnline();

  /**
   * What a failed pull to refresh says.
   *
   * It said nothing at all: the refetch was awaited inside try/finally with no
   * catch, so the spinner retracted on a failure exactly as it does on a
   * success and the list went on showing the same rows as though they had just
   * been confirmed as current. The list is still worth showing, so this is a
   * line above it rather than a screen replacing it.
   */
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    // Offline, React Query PARKS the refetch rather than running it, and a
    // parked fetch never settles: awaiting it would leave the spinner turning
    // until the network came back. The offline line above says why instead.
    if (!isOnline) {
      haptics.warning();
      return;
    }

    setIsManualRefresh(true);
    try {
      // refetch() resolves with the failure rather than throwing, so the result
      // has to be read. The catch covers a throw from elsewhere in the chain.
      const result = await refetch();
      if (result.isError) {
        haptics.error();
        setRefreshError(
          describeError(result.error, { online: isOnline, subject: "your meetings" }).body,
        );
      } else {
        setRefreshError(null);
      }
    } catch (thrown) {
      haptics.error();
      setRefreshError(describeError(thrown, { online: isOnline, subject: "your meetings" }).body);
    } finally {
      setIsManualRefresh(false);
    }
  }, [refetch, isOnline]);

  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const total = data?.pages[0]?.total ?? items.length;
  const searching = query.trim().length > 0;

  const sections = useMemo<Section[]>(() => {
    const groups = new Map<string, MeetingSummary[]>();
    for (const meeting of items) {
      const when = meeting.recorded_at ?? meeting.created_at;
      const title = sectionTitle(when);
      const bucket = groups.get(title);
      if (bucket) bucket.push(meeting);
      else groups.set(title, [meeting]);
    }

    // The stagger has to run down the SCREEN, not restart inside each day, or
    // the second group appears before the tail of the first and the list
    // assembles out of order.
    let offset = 0;
    return Array.from(groups.entries()).map(([title, data], i) => {
      const section = { title, data, offset, first: i === 0 };
      offset += data.length;
      return section;
    });
  }, [items]);

  const failure = describeError(error, { online: isOnline, subject: "your meetings" });

  const empty = isLoading ? (
    <MeetingsSkeleton header={!searching} rows={searching ? 3 : 4} />
  ) : isError || isPaused ? (
    // Offline gets no button. React Query pauses a refetch while the device is
    // off the network, so "Try again" there is a control that cannot succeed,
    // and the state is better told than offered.
    <View className="pt-8">
      <ErrorState
        title={failure.title}
        body={failure.body}
        detail={error?.message}
        onRetry={failure.retryable ? () => void refetch() : undefined}
        busy={isFetching && !isManualRefresh}
      />
    </View>
  ) : searching ? (
    <NoResults query={query.trim()} />
  ) : (
    <LibraryEmpty />
  );

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: "Search meetings",
            // Pinned rather than hiding on scroll: the show/hide animation is
            // what makes the field lurch when it gains focus.
            hideWhenScrolling: false,
            // Every colour on the field is set explicitly. UISearchBar in a dark
            // navigation bar leaves its placeholder and magnifier on a
            // low-opacity system grey, which over this near-black canvas
            // measures well under AA and reads as an empty field with no hint
            // at all.
            //
            // Placeholder and glyph are label-secondary (#9CA1A9), not
            // label-tertiary (#6E727A). Against the field's own dark fill
            // (#1C1F25 in our ramp, and iOS composites its tertiary system fill
            // over #06070A to roughly the same value) that is 6.4:1, and 5.4:1
            // even against a considerably lighter #2C2C2E field. The previous
            // tertiary grey managed 2.6:1.
            //
            // The container stays dark on purpose: lightening the field to fix
            // a text problem would put a grey slab in the navigation bar.
            textColor: "#F4F5F7",
            hintTextColor: "#9CA1A9",
            headerIconColor: "#9CA1A9",
            tintColor: "#4C99F8",
            onChangeText: (e) => setSearchInput(e.nativeEvent.text),
            onClose: () => setSearchInput(""),
          },
        }}
      />

      {!isOnline ? (
        <StaleNotice>Offline. Showing your last synced meetings.</StaleNotice>
      ) : refreshError ? (
        <StaleNotice>{`Could not refresh. ${refreshError}`}</StaleNotice>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index, section }) => (
          <View className="px-4 pb-2.5">
            <MeetingRow
              meeting={item}
              time={timeOfDay(item.recorded_at ?? item.created_at)}
              index={section.offset + index}
            />
          </View>
        )}
        renderSectionHeader={({ section }) => (
          <SectionHeader title={section.title} count={section.data.length} first={section.first} />
        )}
        ListHeaderComponent={
          items.length > 0 && !searching ? <StatHeader meetings={items} total={total} /> : null
        }
        // Held in a variable rather than passed as a function: an inline
        // component is a new type on every render, which remounts the skeleton
        // and restarts its pulse from the top several times a second.
        ListEmptyComponent={empty}
        stickySectionHeadersEnabled={false}
        // Required for the large title to collapse and for the iOS 26 scroll
        // edge effect to have something to blur. RN defaults this to 'never',
        // which is NOT the UIKit default.
        contentInsetAdjustmentBehavior="automatic"
        // NO flexGrow, and it was never doing what its old comment claimed.
        //
        // It was there to stop the empty and error states "clinging to the top
        // of a zero-height content view", but none of them fill: LibraryEmpty,
        // NoResults and the ErrorState all position themselves with their own
        // top padding (pt-4 / pt-16 / pt-8) and none uses flex-1 or centring.
        // So the stretch moved nothing on screen — it only made the content
        // container taller than its content.
        //
        // That cost is real because this list runs contentInsetAdjustmentBehavior
        // "automatic": Yoga stretches to the ScrollView's FRAME, which extends up
        // under the large title, while UIKit's inset is what keeps the visible
        // window below it. The container came out one header taller than the
        // window, which is a screenful of dead scroll under an empty list. Same
        // trap the Ask screen documents at the top of its own contentContainer.
        contentContainerStyle={{ paddingTop: 8, paddingBottom: tabBarInset }}
        keyboardDismissMode="on-drag"
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        onEndReachedThreshold={0.6}
        ListFooterComponent={
          isFetchingNextPage ? (
            // Continues the list in its own shape rather than interrupting it
            // with a spinner.
            <View className="pt-1">
              <MeetingsSkeleton rows={1} header={false} heading={false} />
            </View>
          ) : items.length > 0 && !hasNextPage && !searching ? (
            <ListEndCap total={total} onRecord={() => router.push("/(app)/record")} />
          ) : null
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
