import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, LinearTransition, useReducedMotion } from "react-native-reanimated";

import {
  groupByCompleted,
  groupByDue,
  useActionItems,
  useDeleteActionItem,
  useToggleActionItem,
  type ActionItem,
} from "@/lib/api/action-items";
import { describeError, useOnline } from "@/lib/api/errors";
import { haptics } from "@/lib/haptics";
import { useTabBarInset } from "@/lib/layout";
import { SPRING } from "@/lib/motion";
import { ErrorState, StaleNotice } from "@/components/error-state";
import { ActionRow } from "@/components/actions/action-row";
import { SwipeToDelete } from "@/components/meeting/swipe-to-delete";
import { ActionsEmptyState, type EmptyKind } from "@/components/actions/empty";
import { ActionsSkeleton } from "@/components/actions/skeleton";

type Tab = "open" | "done";

/**
 * How long a just-toggled row is held in the list it is leaving.
 *
 * The optimistic cache write is instant, so without this the row would vanish
 * on the same frame as the tap and the checkmark would never be seen. 520ms
 * covers the 70ms delay plus the 200ms draw with a beat left over to read as
 * "done", then the row exits.
 */
const SETTLE_MS = 520;

/**
 * Section header.
 *
 * Title case at label weight, matching the meetings list. It used to be an
 * 11px all-caps eyebrow; iOS 26 moved section headers to title case and all
 * caps now reads dated, so both tabs share the app's one header idiom.
 */
function Eyebrow({ label, count, danger }: { label: string; count: number; danger?: boolean }) {
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <Text
        className={`text-[15px] font-semibold ${danger ? "text-danger" : "text-label"}`}
        maxFontSizeMultiplier={1.5}
        numberOfLines={1}
      >
        {label}
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

/**
 * Open / Done, with live counts.
 *
 * The counts come from the raw data rather than the settling-aware list, so the
 * Open count drops on the same frame as the tap: the number moving is the first
 * confirmation the user gets, before the row has even finished leaving.
 */
function Segmented({
  value,
  onChange,
  counts,
}: {
  value: Tab;
  onChange: (v: Tab) => void;
  /** Undefined until the first response lands. A count of 0 is a claim, and
      while the list is still loading it is not one the app can make yet. */
  counts?: Record<Tab, number>;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <View
      className="mx-4 flex-row rounded-control bg-surface p-1"
      style={{ borderCurve: "continuous" }}
      accessibilityRole="tablist"
    >
      {(["open", "done"] as const).map((key) => {
        const active = key === value;
        const title = key === "open" ? "Open" : "Done";

        return (
          <Pressable
            key={key}
            onPress={() => {
              if (active) return;
              haptics.select();
              onChange(key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={counts ? `${title}, ${counts[key]}` : title}
            className="flex-1 flex-row items-center justify-center gap-1.5 py-2"
            // py-2 around a 15pt line gave a ~36pt target, under the 44pt
            // minimum. Stated as a floor rather than as more padding so the
            // segment cannot fall back under it at a smaller Dynamic Type size.
            style={{ minHeight: 44 }}
          >
            {active ? (
              <Animated.View
                layout={
                  reduceMotion
                    ? undefined
                    : LinearTransition.springify()
                        .damping(SPRING.chrome.damping)
                        .stiffness(SPRING.chrome.stiffness)
                }
                className="absolute inset-0 rounded-control bg-fill"
                style={{ borderCurve: "continuous" }}
              />
            ) : null}

            <Text
              className={`text-[15px] font-semibold ${
                active ? "text-label" : "text-label-secondary"
              }`}
              maxFontSizeMultiplier={1.4}
            >
              {title}
            </Text>
            {/* The slot is held open whether or not there is a number in it,
                so the title does not slide sideways when the count arrives. */}
            <View style={{ minWidth: 14 }}>
              {counts ? (
                <Text
                  className={`text-[15px] ${
                    active ? "text-label-secondary" : "text-label-tertiary"
                  }`}
                  style={{ fontVariant: ["tabular-nums"] }}
                  maxFontSizeMultiplier={1.4}
                >
                  {counts[key]}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ActionsScreen() {
  const tabBarInset = useTabBarInset();
  const reduceMotion = useReducedMotion();
  const online = useOnline();
  const { data, isLoading, isError, isPaused, isFetching, error, refetch } = useActionItems();
  const toggle = useToggleActionItem();
  const remove = useDeleteActionItem();

  const [tab, setTab] = useState<Tab>("open");
  const [manualRefresh, setManualRefresh] = useState(false);
  /** Set when a pull to refresh failed while there were still rows worth showing. */
  const [refreshError, setRefreshError] = useState<string | null>(null);

  /**
   * Ids held in the list they are leaving while their checkmark plays.
   *
   * An array rather than a Set so the state update is a new reference React can
   * see; the list is at most a couple of ids long.
   */
  const [settling, setSettling] = useState<readonly string[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  /**
   * completed_at as it was at the moment of the tap, for held rows only.
   *
   * Un-checking an item clears completed_at, so without this a row unchecked
   * under "Today" would jump to the dateless "Completed earlier" section and
   * sit there for the length of its exit animation. A held row should leave
   * from where it was, not somewhere else.
   */
  const heldCompletedAt = useRef(new Map<string, string | null>());

  const clearHolds = useCallback(() => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
    heldCompletedAt.current.clear();
    setSettling([]);
  }, []);

  // Timers outlive the screen if the user leaves mid-animation.
  useEffect(() => clearHolds, [clearHolds]);

  const onToggle = useCallback(
    (item: ActionItem) => {
      const next = !item.completed;

      // Haptic on check only. Unchecking is a correction, not an achievement,
      // and firing on both makes working down a list feel chattery.
      if (next) haptics.tap();

      toggle.mutate({ id: item.id, completed: next });

      // Under Reduce Motion there is no animation to wait for, so the row goes
      // immediately rather than appearing to hang.
      if (reduceMotion) return;

      const existing = timers.current.get(item.id);
      if (existing) clearTimeout(existing);

      heldCompletedAt.current.set(item.id, item.completed_at);
      setSettling((ids) => (ids.includes(item.id) ? ids : [...ids, item.id]));
      timers.current.set(
        item.id,
        setTimeout(() => {
          timers.current.delete(item.id);
          heldCompletedAt.current.delete(item.id);
          setSettling((ids) => ids.filter((id) => id !== item.id));
        }, SETTLE_MS),
      );
    },
    [reduceMotion, toggle],
  );

  const onChangeTab = useCallback(
    (next: Tab) => {
      // Held rows belong to the tab they were checked in; carrying them across
      // would show a completed row under "Overdue".
      clearHolds();
      setTab(next);
    },
    [clearHolds],
  );

  // Same defect the meetings list had: a refetch that resolves with a failure
  // rather than throwing, awaited inside try/finally with no catch, so the
  // spinner retracts and the stale list reads as freshly confirmed.
  const onRefresh = useCallback(async () => {
    // Offline, React Query PARKS the refetch rather than running it, and a
    // parked fetch never settles: awaiting it would leave the spinner turning
    // until the network came back. The offline line above says why instead.
    if (!online) {
      haptics.warning();
      return;
    }

    setManualRefresh(true);
    try {
      const result = await refetch();
      if (result.isError) {
        haptics.error();
        setRefreshError(describeError(result.error, { online, subject: "your action items" }).body);
      } else {
        setRefreshError(null);
      }
    } catch (failure) {
      haptics.error();
      setRefreshError(describeError(failure, { online, subject: "your action items" }).body);
    } finally {
      setManualRefresh(false);
    }
  }, [refetch, online]);

  const all = useMemo(() => data ?? [], [data]);

  const counts = useMemo(
    () => ({
      open: all.filter((item) => !item.completed).length,
      done: all.filter((item) => item.completed).length,
    }),
    [all],
  );

  const groups = useMemo(() => {
    const visible = all.filter((item) => {
      if (settling.includes(item.id)) return true;
      return tab === "open" ? !item.completed : item.completed;
    });

    // Done is grouped by when things were finished, not by deadline: the Done
    // list's job is "here is what you got done, and when".
    if (tab === "done") {
      return groupByCompleted(
        visible.map((item) =>
          heldCompletedAt.current.has(item.id)
            ? { ...item, completed_at: heldCompletedAt.current.get(item.id) ?? null }
            : item,
        ),
      );
    }
    return groupByDue(visible);
  }, [all, settling, tab]);

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  const emptyKind: EmptyKind =
    tab === "done" ? "none-done" : all.length === 0 ? "never-any" : "all-clear";

  /**
   * Loading, failed, and empty are three different renderings.
   *
   * Loading is a shape-matched skeleton UNDER the segmented control, so the
   * chrome does not appear from nowhere and the list does not jump when data
   * lands. A failure with nothing cached owns the screen and offers a retry
   * unless retrying cannot work. A failure with rows already on screen keeps
   * the rows and states the problem in a line above them, because throwing away
   * readable data to display an error helps nobody.
   */
  const failure = describeError(error, { online, subject: "your action items" });
  const failed = (isError || isPaused) && data === undefined;
  const stale = isError && all.length > 0;

  const body = isLoading ? (
    <ActionsSkeleton />
  ) : failed ? (
    <ErrorState
      title={failure.title}
      body={failure.body}
      detail={error?.message}
      onRetry={failure.retryable ? () => void refetch() : undefined}
      busy={isFetching}
    />
  ) : total === 0 ? (
    <ActionsEmptyState kind={emptyKind} />
  ) : (
    groups.map(({ group, items }) => (
      <Animated.View
        key={group}
        entering={reduceMotion ? undefined : FadeIn.duration(180)}
        layout={
          reduceMotion
            ? undefined
            : LinearTransition.springify()
                .damping(SPRING.smooth.damping)
                .stiffness(SPRING.smooth.stiffness)
        }
        className="gap-2.5 px-4"
      >
        <Eyebrow label={group} count={items.length} danger={group === "Overdue"} />

        {items.map((item, index) => (
          // Wrapped here rather than inside ActionRow: the screen already
          // owns the mutations, and the row stays a pure presentation component.
          <SwipeToDelete
            key={item.id}
            title={item.description}
            onDelete={() => remove.mutate({ id: item.id, title: item.description })}
          >
            <ActionRow item={item} index={index} onToggle={onToggle} />
          </SwipeToDelete>
        ))}
      </Animated.View>
    ))
  );

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          // Content sits behind the native tab bar; this clearance is ours.
          paddingBottom: tabBarInset,
          gap: 20,
        }}
        refreshControl={
          <RefreshControl refreshing={manualRefresh} onRefresh={onRefresh} tintColor="#9CA1A9" />
        }
      >
        {/* The control stays put in every state, which is the whole point of
            not swapping the screen for a spinner. */}
        <Segmented
          value={tab}
          onChange={onChangeTab}
          counts={isLoading || failed ? undefined : counts}
        />

        {/* Only worth saying when there is something on screen it applies to:
            with nothing cached, the error state below already leads with it. */}
        {!online && all.length > 0 ? (
          <StaleNotice>Offline. Showing your last synced action items.</StaleNotice>
        ) : stale ? (
          <StaleNotice>{`Could not refresh. ${failure.body}`}</StaleNotice>
        ) : refreshError ? (
          <StaleNotice>{`Could not refresh. ${refreshError}`}</StaleNotice>
        ) : null}

        {body}
      </ScrollView>
    </View>
  );
}
