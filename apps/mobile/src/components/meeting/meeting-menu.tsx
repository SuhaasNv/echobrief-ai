import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import Svg, { Circle } from "react-native-svg";

import { useMeetingActionItems } from "@/lib/api/action-items";
import { describeActionFailure } from "@/lib/api/errors";
import type { MeetingDetail } from "@/lib/api/meeting-detail";
import { useShareLink } from "@/lib/api/meeting-share";
import { useRenameMeeting } from "@/lib/api/meetings";
import { formatDuration, formatListDate } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { useColorToken } from "@/lib/tokens";

import { confirmDeleteMeeting, promptRenameMeeting } from "./delete-meeting";
import { MeetingMenuSheet, type MenuGroup, type MenuRow } from "./menu-sheet";
import {
  copyMeetingSummary,
  hasShareableSummary,
  shareMeetingLink,
  shareMeetingSummary,
  shareUrlForToken,
} from "./share-meeting";
import { showShareToast } from "./share-toast";

/**
 * Header overflow menu for a meeting.
 *
 * This file owns the BEHAVIOUR — which rows exist, what they do, what they
 * confirm, and how they report a failure. The sheet that draws them is
 * components/meeting/menu-sheet.tsx, and it knows nothing about meetings.
 *
 * It used to be an ActionSheetIOS, which is a real UIAlertController and got
 * the destructive tint, the grouped Cancel, and Dynamic Type for free. What it
 * could not get was any of this app: a system sheet takes a list of strings, so
 * there was nowhere to put an icon, no way to separate "share this" from
 * "destroy this", and the meeting was reduced to a title in the sheet's grey
 * header. Everything the system was giving for free is reproduced explicitly in
 * menu-sheet — including the parts that are easy to forget, which is why the
 * safe-area and Reduce Motion decisions are argued in that file rather than
 * assumed here.
 *
 * The rows are built rather than listed, because which ones exist depends on
 * the meeting: there is nothing to copy from a meeting still being processed,
 * and nothing to revoke from one that has never been shared. Indexing a fixed
 * array against a variable sheet is how these menus start firing the wrong
 * action, so each row carries its own handler.
 */

/**
 * Three dots. Not `ellipsis.circle`, and deliberately not a circle at all.
 *
 * This used to draw its own 10pt ring — a hand-copy of Apple's stock glyph —
 * INSIDE the native navigation bar, which on iOS 26 already puts a Liquid Glass
 * circle behind a header button. So there were two concentric circles, one
 * system and one ours, which is what made the control read as heavy and generic.
 * The back chevron opposite it is a bare glyph in that same glass circle; this
 * is now the same, so the two header buttons finally match.
 *
 * Colour is --label, not --tint. Blue means "this navigates" everywhere else in
 * the app; an overflow menu opens a sheet in place. Rendering it in the
 * interactive accent made the menu button the loudest thing on a screen whose
 * subject is the meeting, and left the back button — the genuinely navigational
 * one — styled as chrome beside it.
 *
 * Still hand-drawn rather than expo-symbols: nothing else in the app imports it,
 * and one glyph does not justify the dependency. With the ring gone the dots can
 * be larger and tighter, which is what makes three dots look drawn rather than
 * defaulted.
 */
function OverflowGlyph() {
  // SVG fill takes a colour, not a class name.
  const label = useColorToken("--label");

  return (
    <Svg width={22} height={22} viewBox="0 0 22 22">
      <Circle cx={5.5} cy={11} r={1.75} fill={label} />
      <Circle cx={11} cy={11} r={1.75} fill={label} />
      <Circle cx={16.5} cy={11} r={1.75} fill={label} />
    </Svg>
  );
}

export function MeetingMenuButton({
  meeting,
  title,
  onDeleteScheduled,
}: {
  meeting: MeetingDetail;
  /** Display title, already run through displayTitle. */
  title: string;
  /** Fired once the undo window has started, for the screen to navigate away. */
  onDeleteScheduled: () => void;
}) {
  const queryClient = useQueryClient();
  const id = meeting.id;
  const rename = useRenameMeeting(id);
  const shareLink = useShareLink(id);
  // Undefined until it lands, and undefined for good when the device is
  // offline. The text renderer drops the section rather than claiming the
  // meeting produced no follow-ups.
  const { data: actionItems } = useMeetingActionItems(id);

  // The sheet is mounted only while it is open, so each presentation gets fresh
  // shared values and a fresh layout pass. Keeping it mounted and toggling a
  // prop meant resetting the entrance state by hand on every open, and a reopen
  // whose content had not changed never fired onLayout at all.
  const [open, setOpen] = useState(false);

  const submitRename = (next: string) => {
    rename.mutate(next, {
      onSuccess: () => haptics.success(),
      onError: (error) => {
        haptics.error();
        Alert.alert(
          "Could not rename that meeting",
          error instanceof Error
            ? error.message
            : "The rename didn’t save. Your title is unchanged — try again.",
        );
      },
    });
  };

  /**
   * Share the public link.
   *
   * The existing-token branch is the important one. POST /meetings/:id/share
   * does not return the current link, it mints a new one and overwrites what
   * was there — so calling it every time someone taps "Share link" would kill
   * the link they sent yesterday, from a row that says nothing about revoking
   * anything. When the meeting already carries a token we never touch the
   * server at all, which also makes a second share work offline.
   */
  const presentShareLink = () => {
    if (meeting.share_token) {
      void shareMeetingLink(shareUrlForToken(meeting.share_token), meeting);
      return;
    }

    // Same reason, one step earlier: two enable calls in flight together leave
    // two tokens, and the link the first one already handed to the share sheet
    // is the one that stops working.
    if (shareLink.isPending) return;

    shareLink.mutate(true, {
      onSuccess: (data) => {
        if (!data.share_url) {
          // `enabled: true` always answers with a URL. A null here is a server
          // this client does not understand, and silently opening an empty
          // share sheet is the worst way to find that out.
          haptics.error();
          Alert.alert(
            "Could not create a share link",
            "The server did not return a link, so nothing was shared. Try again.",
          );
          return;
        }

        haptics.success();
        void shareMeetingLink(data.share_url, meeting);
      },
      onError: (error) => {
        haptics.error();
        Alert.alert(
          "Could not create a share link",
          `${describeActionFailure(error, { online: onlineManager.isOnline() })} Nothing has been shared.`,
        );
      },
    });
  };

  /**
   * Revoke.
   *
   * Confirmed, because it is destructive to someone who is not in the room: a
   * link already sent to a colleague stops working, and they get a dead page
   * rather than a notice from us. The alert says so, and says that sharing
   * again produces a different address — which is the part people assume is
   * not true.
   */
  const confirmStopSharing = () => {
    haptics.warning();

    Alert.alert(
      "Stop sharing this meeting?",
      "The link stops working straight away, and anyone you have already sent it to will see a page saying the meeting is unavailable. Sharing again creates a different link.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Stop Sharing",
          style: "destructive",
          onPress: () => {
            haptics.medium();
            shareLink.mutate(false, {
              onSuccess: () => {
                haptics.success();
                showShareToast("Sharing turned off");
              },
              onError: (error) => {
                haptics.error();
                Alert.alert(
                  "That link is still live",
                  `${describeActionFailure(error, { online: onlineManager.isOnline() })} Nothing changed — opening the menu again retries.`,
                );
              },
            });
          },
        },
      ],
    );
  };

  /**
   * The rows, grouped.
   *
   * Same conditions as the flat list this replaces, in the same order; the only
   * addition is which card each row lands in.
   *
   * Tone follows the rule in settings/rows.tsx rather than decorating: violet
   * means a model produced the thing, red means the row destroys something, and
   * those two are the only filled chips. So the two rows that put GENERATED
   * TEXT somewhere are violet, and the share link is not — a URL is an address,
   * and painting it violet too would leave three saturated chips in one card
   * and the distinction would stop meaning anything.
   */
  const buildGroups = (): MenuGroup[] => {
    const share: MenuRow[] = [];
    const destructive: MenuRow[] = [];

    if (hasShareableSummary(meeting, actionItems)) {
      share.push({
        key: "copy",
        label: "Copy summary",
        symbol: "doc.on.doc",
        tone: "violet",
        hint: "Copies the summary and action items to the clipboard as plain text",
        run: () => copyMeetingSummary(meeting, actionItems),
      });
      share.push({
        key: "share-summary",
        label: "Share summary",
        symbol: "square.and.arrow.up",
        tone: "violet",
        hint: "Opens the share sheet with the summary as plain text",
        run: () => void shareMeetingSummary(meeting, actionItems),
      });
    }

    // A link to a meeting still in the pipeline, or one that failed, opens a
    // public page with nothing on it. That is not a link worth sending.
    if (meeting.status === "complete") {
      share.push(
        meeting.share_token
          ? {
              key: "share-link",
              label: "Share link",
              symbol: "link",
              hint: "Opens the share sheet with the public link that already exists",
              run: presentShareLink,
            }
          : {
              key: "share-link",
              label: "Create share link",
              detail: "Anyone with the link can read this meeting",
              symbol: "link.badge.plus",
              hint: "Creates a public link and opens the share sheet",
              run: presentShareLink,
            },
      );
    }

    // Offered whatever the status is. A live link has to be revocable from the
    // one screen the meeting has, even on a meeting that later failed to
    // reprocess.
    if (meeting.share_token) {
      destructive.push({
        key: "stop-sharing",
        label: "Stop sharing",
        detail: "The link stops working for everyone",
        // No `link.slash` exists in SF Symbols. `eye.slash` says the same thing
        // about the outcome the user cares about: the page stops being readable.
        symbol: "eye.slash",
        destructive: true,
        hint: "Asks for confirmation, then revokes the public link",
        run: confirmStopSharing,
      });
    }

    destructive.push({
      key: "delete",
      label: "Delete meeting",
      detail: "Recording, transcript, and summary",
      symbol: "trash",
      destructive: true,
      hint: "Asks for confirmation, then deletes this meeting with a few seconds to undo",
      run: () => confirmDeleteMeeting({ id, title, queryClient, onConfirmed: onDeleteScheduled }),
    });

    const groups: MenuGroup[] = [];
    // Dropped rather than rendered empty. A processing meeting has nothing to
    // share, and a bordered card with no rows in it reads as a rendering fault.
    if (share.length) groups.push({ key: "share", rows: share });
    groups.push({
      key: "meeting",
      rows: [
        {
          key: "rename",
          label: "Rename",
          symbol: "pencil",
          hint: "Opens a field to change the title",
          run: () => promptRenameMeeting({ current: title, onSubmit: submitRename }),
        },
      ],
    });
    groups.push({ key: "destructive", rows: destructive });

    return groups;
  };

  // Same line the detail screen shows under the title, rebuilt here rather than
  // threaded through a prop: this component already holds the meeting, and the
  // screen's copy is local to its own render.
  const meta =
    [
      formatListDate(meeting.recorded_at ?? meeting.created_at),
      formatDuration(meeting.duration_sec),
    ]
      .filter(Boolean)
      .join(" · ") || null;

  return (
    <>
      <Pressable
        onPress={() => {
          // Light tick for opening a menu. The consequential haptics belong to
          // the items inside it, not to the act of looking at them.
          haptics.tap();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Meeting options"
        accessibilityHint="Share, copy, rename, or delete this meeting"
        // 44pt target around a 22pt glyph. The header gives it less vertical room
        // than that, so the padding is horizontal and hitSlop covers the rest.
        hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
      >
        {({ pressed }) => (
          // Opacity only, and no transform: this sits inside a native navigation
          // bar, where a scaled child fights the bar's own layout.
          <View style={{ opacity: pressed ? 0.4 : 1 }}>
            <OverflowGlyph />
          </View>
        )}
      </Pressable>

      {/* Rendered from inside the navigation bar, which would clip anything
          drawn inline — the sheet is a react-native Modal for exactly that
          reason. The rows are rebuilt on each presentation so a link minted or
          revoked while the screen was open is reflected the next time. */}
      {open ? (
        <MeetingMenuSheet
          title={title}
          meta={meta}
          status={meeting.status}
          linkLive={Boolean(meeting.share_token)}
          groups={buildGroups()}
          onDismissed={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
