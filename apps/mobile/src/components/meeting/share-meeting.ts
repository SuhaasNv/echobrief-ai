import { Alert, Clipboard, Share } from "react-native";

import type { ActionItem } from "@/lib/api/action-items";
import type { MeetingDetail } from "@/lib/api/meeting-detail";
import { displayTitle, formatDuration } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { WEB_APP_URL } from "@/components/settings/links";

import { showShareToast } from "./share-toast";

/**
 * Getting a meeting out of the app.
 *
 * Three exits, and they are deliberately not the same feature. Copy and the
 * share sheet both carry the WHOLE summary as plain text: they work with no
 * network, they leave nothing behind on the server, and what the recipient gets
 * is readable in any app that accepts text. The share link carries a URL to the
 * public viewer, which stays live, updates itself, and can be revoked — a
 * different promise, so it gets a different row.
 *
 * The text is assembled here rather than in the menu because the menu is a UI
 * concern and this is a rendering of the data model. It is also the only part
 * of the feature worth reading in isolation to check the wording.
 */

/**
 * Dates in shared text are ABSOLUTE, unlike everywhere else in the app.
 *
 * `formatListDate` answers "how recent is this" and collapses to "Yesterday" or
 * a bare weekday, which is correct beside a live list and meaningless in a
 * paragraph someone opens on Thursday in another timezone. Text that leaves the
 * device has to say what day it means.
 */
function absoluteDate(iso: string | null | undefined): string | null {
  if (!iso) return null;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Same rule as above, shorter, for the parenthetical on a task. */
function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function actionItemLine(item: ActionItem): string {
  const due = shortDate(item.due_date);
  const context = [item.assignee_name?.trim() || null, due ? `due ${due}` : null].filter(Boolean);

  // Completed items stay in the list and say so. Dropping them would hand the
  // recipient a to-do list that claims work nobody has started, on exactly the
  // meetings where the most has already been done.
  return [
    `• ${item.description.trim()}`,
    context.length ? ` (${context.join(", ")})` : "",
    item.completed ? " — done" : "",
  ].join("");
}

/**
 * The blocks below the title, in reading order: what happened, what was
 * decided, what happens next.
 *
 * Every block is omitted rather than rendered empty, matching the summary pane:
 * a heading with nothing under it reads as a pipeline fault, and in text there
 * is no layout to soften it.
 *
 * @param actionItems Undefined while the list is loading or when the request
 *                    failed — offline, most often. The section is dropped, not
 *                    replaced with a claim that there are none.
 */
function bodyBlocks(meeting: MeetingDetail, actionItems: ActionItem[] | undefined): string[] {
  const blocks: string[] = [];

  const executive = meeting.summary?.executive?.trim();
  if (executive) blocks.push(executive);

  const decisions = (meeting.summary?.decisions ?? []).map((d) => d.trim()).filter(Boolean);
  if (decisions.length) {
    blocks.push(["Decisions", ...decisions.map((d) => `• ${d}`)].join("\n"));
  }

  const items = (actionItems ?? []).filter((item) => item.description.trim().length > 0);
  if (items.length) {
    blocks.push(["Action items", ...items.map(actionItemLine)].join("\n"));
  }

  return blocks;
}

/**
 * True when there is something worth sending beyond a title and a date.
 *
 * The menu asks before it offers Copy and Share, because a clipboard holding
 * two lines of metadata is a worse outcome than no button at all — the user
 * pastes it into a message before they can tell it is empty.
 */
export function hasShareableSummary(
  meeting: MeetingDetail,
  actionItems: ActionItem[] | undefined,
): boolean {
  return bodyBlocks(meeting, actionItems).length > 0;
}

/**
 * The meeting as plain text.
 *
 * Plain, not Markdown. This lands in Messages, Mail, Slack and Notes, and only
 * one of those renders `##` as a heading; the rest show the hashes. Bare
 * headings and bullet characters read correctly in all of them.
 */
export function buildMeetingText(
  meeting: MeetingDetail,
  actionItems: ActionItem[] | undefined,
): string {
  const meta = [
    absoluteDate(meeting.recorded_at ?? meeting.created_at),
    formatDuration(meeting.duration_sec),
  ].filter(Boolean);

  const header = [displayTitle(meeting.title), meta.join(" · ")].filter(Boolean).join("\n");

  return [header, ...bodyBlocks(meeting, actionItems)].join("\n\n");
}

/**
 * Copy, with a confirmation the user can actually see.
 *
 * `Clipboard.setString` is synchronous and returns nothing — there is no
 * success or failure to report, so the confirmation states what was asked for
 * rather than what came back. The toast is not decoration: haptics are
 * suppressed in Low Power Mode and whenever the user has turned them off, and
 * lib/haptics is explicit that they are never the only feedback.
 *
 * Clipboard comes from react-native core, which deprecates it in favour of
 * @react-native-clipboard/clipboard. That is a native module and this project
 * does not add those (see the note in meeting-menu). The core implementation
 * still works and warns once per launch, which is the cheaper of the two costs.
 */
export function copyMeetingSummary(meeting: MeetingDetail, actionItems: ActionItem[] | undefined) {
  Clipboard.setString(buildMeetingText(meeting, actionItems));
  haptics.success();
  showShareToast("Summary copied");
}

/**
 * The system share sheet, carrying the text itself.
 *
 * No network, no server round-trip, nothing minted: this path works on a plane.
 * `subject` is what Mail puts in the subject line — without it a shared summary
 * arrives titled "Shared from EchoBrief" or blank, depending on the target.
 *
 * A dismissed sheet is a normal outcome and says nothing. A REJECTED one means
 * the sheet could not be presented at all, and that has to be reported or the
 * menu row is indistinguishable from a dead button.
 */
export async function shareMeetingSummary(
  meeting: MeetingDetail,
  actionItems: ActionItem[] | undefined,
): Promise<void> {
  const title = displayTitle(meeting.title);

  try {
    await Share.share({ message: buildMeetingText(meeting, actionItems) }, { subject: title });
  } catch (error) {
    haptics.error();
    Alert.alert(
      "Could not open the share sheet",
      error instanceof Error
        ? error.message
        : "iOS would not present it. The summary is still on this screen.",
    );
  }
}

/**
 * The public link, in the same sheet.
 *
 * Separate from the text share above so the failure copy can name the right
 * thing: here a rejection strands a link that has already been created on the
 * server, and telling the user it exists is what lets them try again without
 * minting a second one.
 */
export async function shareMeetingLink(url: string, meeting: MeetingDetail): Promise<void> {
  const title = displayTitle(meeting.title);

  try {
    // `url` ONLY. iOS turns each field into a separate activity item, so also
    // passing the address as `message` sends it twice — once as text and once
    // as a link — and Messages renders both. As a bare url it gets the rich
    // preview, Safari offers "Open", and Mail does not escape it. The public
    // page carries the meeting's title, so nothing is lost by leaving it out.
    await Share.share({ url }, { subject: title });
  } catch (error) {
    haptics.error();
    Alert.alert(
      "Could not open the share sheet",
      `The link is ready at ${url}${
        error instanceof Error ? `, but iOS would not present it: ${error.message}` : "."
      }`,
    );
  }
}

/**
 * The viewer URL for a token we already hold.
 *
 * The server builds share_url from its own APP_URL and that response is
 * authoritative, which is why the enable path uses it instead of this. But the
 * detail query carries only the raw token, so re-sharing an existing link has
 * to assemble the address here — exactly what the web app does with
 * window.location.origin. WEB_APP_URL has to track the API's APP_URL: both
 * answer "where does a browser reach EchoBrief".
 *
 * Building it locally is also what lets a second share of the same meeting work
 * with no network.
 */
export function shareUrlForToken(token: string): string {
  return `${WEB_APP_URL}/share/${token}`;
}
