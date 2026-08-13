import { View } from "react-native";

import { Bar, Pulse } from "@/components/settings/skeleton";

/**
 * Loading placeholder for the action list.
 *
 * Replaces a centred spinner that took the whole screen, segmented control
 * included, so Open / Done appeared out of nowhere the moment data landed and
 * the list shifted underneath it. This renders BELOW the control, in the shape
 * the rows will take: group heading, then cards with a check ring, two lines of
 * task text, and the recessed provenance strip. Nothing moves when the real
 * rows arrive.
 *
 * Same reasoning and same pulse as components/meetings/skeleton, which does
 * this for the library.
 */

/** Matches the 26pt CheckRing and the row's 4pt padding. */
function RowSkeleton() {
  return (
    <View
      className="overflow-hidden rounded-card border border-edge bg-surface"
      style={{ borderCurve: "continuous" }}
    >
      <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />

      <View className="flex-row items-start gap-3 p-4">
        <View className="h-[26px] w-[26px] rounded-full bg-fill" />

        <View className="flex-1 gap-2">
          <Bar width="100%" height={13} />
          <Bar width="64%" height={13} />
          <Bar width={112} height={11} className="mt-0.5" />
        </View>
      </View>

      <View className="min-h-[38px] flex-row items-center gap-2.5 border-t border-edge bg-inset px-4 py-2.5">
        <Bar width={9} height={11} className="rounded-chip" />
        <Bar width="46%" height={11} />
      </View>
    </View>
  );
}

export function ActionsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Pulse label="Loading action items">
      <View className="gap-2.5 px-4">
        <Bar width={92} height={14} />
        {Array.from({ length: rows }, (_, i) => (
          <RowSkeleton key={i} />
        ))}
      </View>
    </Pulse>
  );
}
