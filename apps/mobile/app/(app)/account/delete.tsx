import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { useAccount, useDeleteAccount } from "@/lib/api/account";
import { describeActionFailure, describeError, useOnline } from "@/lib/api/errors";
import { clearSession } from "@/lib/api/token-store";
import { haptics } from "@/lib/haptics";
import { ErrorState } from "@/components/error-state";
import { CheckGlyph, Section, TextFieldRow } from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";
import { useColorToken } from "@/lib/tokens";

/**
 * Account deletion.
 *
 * Required by App Store guideline 5.1.1(v) for any app that creates accounts,
 * and it has to be a real deletion rather than a support request.
 *
 * Typing the email is a deliberate speed bump and stays. This destroys every
 * recording, transcript, summary, and action item on the account with no undo,
 * and a single red button one tap away from a settings list is not a
 * proportionate amount of friction for that.
 *
 * Once unlocked the button is FILLED red, not a red-tinted outline. This is the
 * most destructive control in the product and it was carrying less colour than
 * a quota meter on the plan screen; a grey pill for permanent data loss is the
 * wrong weight, and red spent on a Free account's normal usage while this button
 * had none is the whole colour problem in one pair of screens.
 *
 * The label is the CANVAS colour, not near-white. #F4F5F7 on this palette's red
 * measures 2.73:1 and fails AA outright; #06070A on the same red measures
 * 6.78:1. Locked, the button is --fill with a --label-secondary label (6.35:1);
 * --label-tertiary cannot clear AA on --fill and is not used there.
 */
export default function DeleteAccountScreen() {
  const online = useOnline();
  const query = useAccount();
  const del = useDeleteAccount();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState("");
  // The spinner sits on the filled red button, so it takes the canvas colour
  // for the same reason the label does — see the note above.
  const onDanger = useColorToken("--background");

  const onRefresh = useCallback(() => query.refetch(), [query]);

  const account = query.data;

  /**
   * Without the address there is no screen.
   *
   * The confirmation compares what you type against `account.email`. When that
   * fetch failed the comparison was against an empty string, so `matches` could
   * never become true: the button stayed locked forever while the hint under it
   * asked you to type an email it was not showing you. A locked destructive
   * button with no stated reason is worse than an error, because it looks like
   * the app is refusing rather than like it is missing something.
   */
  if (!account) {
    if (query.isError || query.isPaused) {
      const copy = describeError(query.error, { online, subject: "your email address" });
      return (
        <SettingsScroll onRefresh={onRefresh}>
          <ErrorState
            title={copy.title}
            body={`${copy.body} Deleting an account has to be confirmed against the address it belongs to, so this screen cannot go ahead without it.`}
            detail={query.error?.message}
            onRetry={copy.retryable ? () => void query.refetch() : undefined}
            busy={query.isFetching}
          />
        </SettingsScroll>
      );
    }

    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator accessibilityLabel="Loading your account" />
      </View>
    );
  }

  const email = account.email;
  const matches =
    confirm.trim().length > 0 && confirm.trim().toLowerCase() === email.trim().toLowerCase();

  const submit = () => {
    if (!matches) return;
    haptics.warning();
    Alert.alert(
      "Delete your account?",
      "Every meeting, recording, transcript, and action item will be permanently removed. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            del.mutate(undefined, {
              onSuccess: () => {
                clearSession();
                queryClient.clear();
                router.replace("/(auth)/sign-in");
              },
              onError: (error) => {
                haptics.error();
                Alert.alert(
                  "Couldn't delete account",
                  `${describeActionFailure(error, { online })} Your account and everything in it are untouched.`,
                );
              },
            }),
        },
      ],
    );
  };

  return (
    <SettingsScroll onRefresh={onRefresh}>
      <Text
        className="px-4 text-[15px] leading-[22px] text-label-secondary"
        maxFontSizeMultiplier={1.8}
      >
        Deleting your account removes every meeting, recording, transcript, summary, and action
        item. It cannot be undone, and it cannot be recovered by support.
      </Text>

      <Section title="Confirm">
        <TextFieldRow
          value={confirm}
          onChangeText={setConfirm}
          // NOT the address itself. The placeholder printed the exact string
          // the field is checked against, one line above a hint that printed it
          // again — so the speed bump could be cleared by copying what the box
          // was already showing, and an empty field looked filled at a glance.
          // The hint below still says which address to type.
          placeholder="Email address"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          accessibilityLabel="Type your email to confirm deletion"
        />

        <View className="flex-row items-center gap-2.5 px-4 py-3" style={{ minHeight: 44 }}>
          <Text
            className={`flex-1 text-[13px] ${matches ? "text-label-secondary" : "text-label-tertiary"}`}
            numberOfLines={2}
            maxFontSizeMultiplier={1.8}
            accessibilityLiveRegion="polite"
          >
            {matches ? "Email matches. Deletion is unlocked." : `Type ${email} to unlock deletion.`}
          </Text>
          {/* Trailing, not leading. A 15pt glyph column in front of this
              line pushed its text to 16 + 15 + 10 = 41pt while the field
              above starts at 16pt — a 25pt step that aligned to nothing on
              the screen. Moving it after the text restores the shared left
              edge and still reserves its width, so the checkmark appearing
              does not shift the sentence. */}
          <View className="w-[15px] items-center">{matches ? <CheckGlyph /> : null}</View>
        </View>
      </Section>

      <View className="px-4">
        <Pressable
          onPress={submit}
          disabled={!matches || del.isPending}
          accessibilityRole="button"
          accessibilityState={{ disabled: !matches, busy: del.isPending }}
          /**
           * Locked is still visibly DESTRUCTIVE, not merely disabled.
           *
           * The filled red on the armed state was already right. The locked
           * state was the problem: `border-edge` + `bg-fill` + a secondary label
           * is byte-identical to the disabled "Change password" button, so the
           * one irreversible control in the app looked exactly like its most
           * routine one until the moment you had already typed your address.
           * People sort buttons by colour before they read them.
           *
           * A danger-tinted border and label instead of a fill: it reads as red
           * at a glance while staying unmistakably inactive, and it does not
           * dare you to press it. /40 on the border and /60 on the label keep
           * both below the armed state's weight — this is the quieter half of a
           * pair, and matching its intensity would make locked and armed hard to
           * tell apart, which is its own failure.
           */
          className={`min-h-[52px] items-center justify-center rounded-full ${
            matches ? "bg-danger active:opacity-80" : "border border-danger/40 bg-fill"
          }`}
        >
          {del.isPending ? (
            <ActivityIndicator color={onDanger} />
          ) : (
            <Text
              className={`text-[17px] font-semibold ${
                matches ? "text-background" : "text-danger/60"
              }`}
            >
              Delete account
            </Text>
          )}
        </Pressable>
      </View>

      <Footnote>
        If you only want to stop recording for a while, signing out leaves your account and your
        meetings exactly as they are.
      </Footnote>
    </SettingsScroll>
  );
}
