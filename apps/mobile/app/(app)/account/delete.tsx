import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { useAccount, useDeleteAccount } from "@/lib/api/account";
import { describeActionFailure, describeError, useOnline } from "@/lib/api/errors";
import { clearSession } from "@/lib/api/token-store";
import { haptics } from "@/lib/haptics";
import { ErrorState } from "@/components/error-state";
import { CheckGlyph, Section, TextFieldRow, SETTINGS_HEX } from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";

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
        className="px-5 text-[15px] leading-[22px] text-label-secondary"
        maxFontSizeMultiplier={1.8}
      >
        Deleting your account removes every meeting, recording, transcript, summary, and action
        item. It cannot be undone, and it cannot be recovered by support.
      </Text>

      <Section title="Confirm">
        <TextFieldRow
          value={confirm}
          onChangeText={setConfirm}
          placeholder={email}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          accessibilityLabel="Type your email to confirm deletion"
        />

        <View className="flex-row items-center gap-2.5 px-4 py-3" style={{ minHeight: 44 }}>
          <View className="w-[15px] items-center">
            {matches ? <CheckGlyph color={SETTINGS_HEX.tint} /> : null}
          </View>
          <Text
            className={`flex-1 text-[13px] ${matches ? "text-label-secondary" : "text-label-tertiary"}`}
            numberOfLines={2}
            maxFontSizeMultiplier={1.8}
            accessibilityLiveRegion="polite"
          >
            {matches
              ? "Email matches. Deletion is unlocked."
              : `Type ${email} to unlock deletion.`}
          </Text>
        </View>
      </Section>

      <View className="px-4">
        <Pressable
          onPress={submit}
          disabled={!matches || del.isPending}
          accessibilityRole="button"
          accessibilityState={{ disabled: !matches, busy: del.isPending }}
          className={`min-h-[52px] items-center justify-center rounded-full ${
            matches ? "bg-danger active:opacity-80" : "border border-edge bg-fill"
          }`}
        >
          {del.isPending ? (
            <ActivityIndicator color={SETTINGS_HEX.background} />
          ) : (
            <Text
              className={`text-[17px] font-semibold ${
                matches ? "text-background" : "text-label-secondary"
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
