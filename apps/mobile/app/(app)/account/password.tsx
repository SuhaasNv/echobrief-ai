import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { useChangePassword } from "@/lib/api/account";
import { haptics } from "@/lib/haptics";
import { CheckGlyph, Section, TextFieldRow, SETTINGS_HEX } from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";

const MIN_LENGTH = 8;

export default function PasswordScreen() {
  const change = useChangePassword();
  const nextField = useRef<TextInput>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  const longEnough = next.length >= MIN_LENGTH;
  const differs = next.length === 0 || next !== current;
  const canSubmit = current.length > 0 && longEnough && differs && !change.isPending;

  const submit = () => {
    if (!canSubmit) return;
    change.mutate(
      { current_password: current, new_password: next },
      {
        onSuccess: () => {
          haptics.success();
          Alert.alert("Password changed", "Use your new password next time you sign in.", [
            { text: "Done", onPress: () => router.back() },
          ]);
        },
        onError: (error) => {
          haptics.error();
          Alert.alert(
            "Couldn't change password",
            error instanceof Error ? error.message : "Check your current password and try again.",
          );
        },
      },
    );
  };

  return (
    <SettingsScroll>
      <Section title="Current password">
        <TextFieldRow
          value={current}
          onChangeText={setCurrent}
          placeholder="Current password"
          secureTextEntry
          autoCapitalize="none"
          textContentType="password"
          returnKeyType="next"
          onSubmitEditing={() => nextField.current?.focus()}
          accessibilityLabel="Current password"
        />
      </Section>

      <Section title="New password">
        <TextFieldRow
          ref={nextField}
          value={next}
          onChangeText={setNext}
          placeholder="New password"
          secureTextEntry
          autoCapitalize="none"
          textContentType="newPassword"
          // Without this iOS can generate a password the API rejects, which
          // teaches people to decline the offer permanently.
          passwordRules={`minlength: ${MIN_LENGTH};`}
          returnKeyType="go"
          onSubmitEditing={submit}
          accessibilityLabel="New password"
        />

        {/* The requirement checks itself off as it is met, rather than sitting
            in a footer as a rule the user has to re-read. */}
        <View className="flex-row items-center gap-2.5 px-4 py-3" style={{ minHeight: 44 }}>
          <View className="w-[15px] items-center">
            {longEnough ? <CheckGlyph color={SETTINGS_HEX.tint} /> : null}
          </View>
          <Text
            className={`flex-1 text-[13px] ${
              longEnough ? "text-label-secondary" : "text-label-tertiary"
            }`}
            maxFontSizeMultiplier={1.8}
            accessibilityLiveRegion="polite"
          >
            {longEnough
              ? `At least ${MIN_LENGTH} characters`
              : `Use at least ${MIN_LENGTH} characters`}
          </Text>
        </View>
      </Section>

      {!differs ? (
        <Footnote>Your new password has to be different from the current one.</Footnote>
      ) : (
        <Footnote>
          Changing your password does not sign you out of this iPhone. Other devices will need the
          new password next time they sign in.
        </Footnote>
      )}

      <View className="px-4">
        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit, busy: change.isPending }}
          className={`min-h-[52px] items-center justify-center rounded-full ${
            canSubmit ? "bg-label active:opacity-80" : "bg-fill"
          }`}
        >
          {change.isPending ? (
            <ActivityIndicator color="#06070A" />
          ) : (
            <Text
              className={`text-[17px] font-semibold ${
                canSubmit ? "text-background" : "text-label-secondary"
              }`}
            >
              Change password
            </Text>
          )}
        </Pressable>
      </View>
    </SettingsScroll>
  );
}
