import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, SectionList, Text, View } from "react-native";
import { router } from "expo-router";

import { describeError, useOnline } from "@/lib/api/errors";
import { useMeetings, type MeetingSummary } from "@/lib/api/meetings";
import { haptics } from "@/lib/haptics";
import { SCROLL_TAB_BAR_AIR } from "@/lib/layout";
import { useColorTokens } from "@/lib/tokens";
import { ErrorState, StaleNotice } from "@/components/error-state";
import { ListEndCap } from "@/components/meetings/end-cap";
import { LibraryEmpty, NoResults } from "@/components/meetings/empty-state";
import { FavoritesSectionHeader } from "@/components/meetings/favorites-section-header";
import { MeetingRow } from "@/components/meetings/meeting-row";
import { RecoveryBanner } from "@/components/meetings/recovery-banner";
import { MeetingSearchField } from "@/components/meetings/search-field";
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
  /** "favorites" gets the collapsible header; every day gets the plain one. */
  kind: "favorites" | "day";
  title: string;
  /** Index of this section's first row in the flattened list, for stagger. */
  offset: number;
  first: boolean;
  /** Header count. A collapsed favorites section has empty data but a real count. */
  count: number;
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

/**
 * The one colour UIRefreshControl needs, resolved. It is a native control handed
 * to UIKit through a prop, so its spinner tint is not reachable by a className.
 * (Search moved to the in-content MeetingSearchField, which resolves its own.)
 */
const TOKENS = ["--label-secondary"] as const;

export default function MeetingsScreen() {
  const [secondary] = useColorTokens(TOKENS);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  // Session-scoped, defaulting open. Persisting it across launches would mean a
  // preference key and a server round-trip for a fold state; the section is
  // cheap to re-open, so it starts shown.
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(false);

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
  const searching = searchInput.trim().length > 0;

  // The field is pinned once there is anything to search, and stays put through a
  // no-result query so it can be cleared. It is only withheld from the pristine
  // empty library, where LibraryEmpty owns the screen and there is nothing to
  // filter yet.
  const showSearch = searching || items.length > 0;

  const sections = useMemo<Section[]>(() => {
    // Favorites lift into their own pinned, collapsible group at the top of the
    // full library, and drop out of the day sections so nothing appears twice —
    // un-favouriting a meeting returns it to its date. A search is already a
    // filter, so it groups purely by day across everything that matched rather
    // than fighting the results with a second grouping.
    const favorites = searching ? [] : items.filter((m) => m.is_favorite);
    const rest = searching ? items : items.filter((m) => !m.is_favorite);

    const groups = new Map<string, MeetingSummary[]>();
    for (const meeting of rest) {
      const when = meeting.recorded_at ?? meeting.created_at;
      const title = sectionTitle(when);
      const bucket = groups.get(title);
      if (bucket) bucket.push(meeting);
      else groups.set(title, [meeting]);
    }

    // The stagger has to run down the SCREEN, not restart inside each day, or
    // the second group appears before the tail of the first and the list
    // assembles out of order.
    const out: Section[] = [];
    let offset = 0;

    if (favorites.length > 0) {
      out.push({
        kind: "favorites",
        title: "Favorites",
        // Collapsed keeps the header and its count but sheds the rows.
        data: favoritesCollapsed ? [] : favorites,
        count: favorites.length,
        offset,
        first: true,
      });
      offset += favoritesCollapsed ? 0 : favorites.length;
    }

    for (const [title, data] of groups) {
      out.push({
        kind: "day",
        title,
        data,
        count: data.length,
        offset,
        first: out.length === 0,
      });
      offset += data.length;
    }

    return out;
  }, [items, searching, favoritesCollapsed]);

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
      {/* Above the search field: an interrupted recording waiting on a decision
          is more urgent than filtering the list, and it clears itself once the
          user answers. */}
      <RecoveryBanner />

      {showSearch ? (
        <MeetingSearchField value={searchInput} onChangeText={setSearchInput} />
      ) : null}

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
        renderSectionHeader={({ section }) =>
          section.kind === "favorites" ? (
            <FavoritesSectionHeader
              count={section.count}
              collapsed={favoritesCollapsed}
              onToggle={() => setFavoritesCollapsed((c) => !c)}
            />
          ) : (
            <SectionHeader title={section.title} count={section.count} first={section.first} />
          )
        }
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
        //
        // The bottom padding is AIR ONLY for the same reason. That inset UIKit
        // applies is not top-only: it also clears the tab bar, so the
        // `useTabBarInset()` that used to sit here spent the bar's 83pt twice
        // and left the list scrolling a bar past its own end cap.
        contentContainerStyle={{ paddingTop: 8, paddingBottom: SCROLL_TAB_BAR_AIR }}
        keyboardDismissMode="on-drag"
        // Open a result on the first tap while the keyboard is up, rather than
        // spending that tap only to dismiss it.
        keyboardShouldPersistTaps="handled"
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
            // The default spinner grey is near-invisible on the canvas.
            tintColor={secondary}
          />
        }
      />
    </View>
  );
}
