import { ActionSheetIOS, Alert, Pressable, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import Svg, { Circle } from "react-native-svg";

import { useRenameMeeting } from "@/lib/api/meetings";
import { haptics } from "@/lib/haptics";

import { confirmDeleteMeeting, promptRenameMeeting } from "./delete-meeting";

/**
 * Header overflow menu for a meeting.
 *
 * Presented with ActionSheetIOS, which is a real UIAlertController: the system
 * owns the sheet, the destructive row gets the system red, Cancel is grouped
 * apart, and it inherits Dynamic Type, Reduce Transparency, and VoiceOver
 * without a line of code here.
 *
 * A UIMenu attached to the bar button — the iOS 14+ pull-down menu — would be
 * a shade more modern, but every route to one goes through a native module
 * (@react-native-menu/menu, expo-context-menu) that is not in this project's
 * dependency tree, and installs are frozen. The action sheet is the correct
 * native fallback, not a web dropdown standing in for one.
 *
 * The sheet's title repeats the meeting name so the destructive row is never
 * ambiguous about what it is pointed at, and the Alert that follows names it
 * again.
 */

const TINT = "#4C99F8";
const HEADER_GLYPH = "#4C99F8";

/** `ellipsis.circle`, drawn rather than pulled from SF Symbols — nothing else
    in this app imports expo-symbols, and one glyph does not justify starting. */
function EllipsisCircle() {
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22">
      <Circle cx={11} cy={11} r={10} stroke={HEADER_GLYPH} strokeWidth={1.6} fill="none" />
      <Circle cx={6.2} cy={11} r={1.35} fill={HEADER_GLYPH} />
      <Circle cx={11} cy={11} r={1.35} fill={HEADER_GLYPH} />
      <Circle cx={15.8} cy={11} r={1.35} fill={HEADER_GLYPH} />
    </Svg>
  );
}

export function MeetingMenuButton({
  id,
  title,
  onDeleteScheduled,
}: {
  id: string;
  /** Display title, already run through displayTitle. */
  title: string;
  /** Fired once the undo window has started, for the screen to navigate away. */
  onDeleteScheduled: () => void;
}) {
  const queryClient = useQueryClient();
  const rename = useRenameMeeting(id);

  const submitRename = (next: string) => {
    rename.mutate(next, {
      onSuccess: () => haptics.success(),
      onError: (error) => {
        haptics.error();
        Alert.alert(
          "Could not rename that meeting",
          error instanceof Error ? error.message : "Try again in a moment.",
        );
      },
    });
  };

  const present = () => {
    // Light tick for opening a menu. The consequential haptics belong to the
    // items inside it, not to the act of looking at them.
    haptics.tap();

    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: ["Rename", "Delete Meeting", "Cancel"],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
        tintColor: TINT,
        // app.json pins userInterfaceStyle to "dark"; the sheet does not inherit
        // that on its own and would otherwise present light over a black app.
        userInterfaceStyle: "dark",
      },
      (index) => {
        if (index === 0) {
          promptRenameMeeting({ current: title, onSubmit: submitRename });
        } else if (index === 1) {
          confirmDeleteMeeting({ id, title, queryClient, onConfirmed: onDeleteScheduled });
        }
      },
    );
  };

  return (
    <Pressable
      onPress={present}
      accessibilityRole="button"
      accessibilityLabel="Meeting options"
      accessibilityHint="Rename or delete this meeting"
      // 44pt target around a 22pt glyph. The header gives it less vertical room
      // than that, so the padding is horizontal and hitSlop covers the rest.
      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
    >
      {({ pressed }) => (
        // Opacity only, and no transform: this sits inside a native navigation
        // bar, where a scaled child fights the bar's own layout.
        <View style={{ opacity: pressed ? 0.4 : 1 }}>
          <EllipsisCircle />
        </View>
      )}
    </Pressable>
  );
}
