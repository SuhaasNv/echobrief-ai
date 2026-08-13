import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { initialsFor, useAccount, useUpdateProfile } from "@/lib/api/account";
import { describeActionFailure, describeError, useOnline } from "@/lib/api/errors";
import { haptics } from "@/lib/haptics";
import { ErrorState } from "@/components/error-state";
import { Avatar, useAvatarPicker } from "@/components/settings/avatar";
import {
  COMMON_TIMEZONES,
  deviceTimezone,
  setPreference,
  timezoneLabel,
  usePreferences,
} from "@/components/settings/preferences";
import {
  CollapsibleSection,
  Row,
  Section,
  TextFieldRow,
  ValueRow,
} from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";
import { useColorToken } from "@/lib/tokens";

/**
 * Profile.
 *
 * Split by where the value actually lives, because that is the only division
 * the user can act on: the display name goes to the server and needs an
 * explicit save, while the picture, the role, and the time zone are stored on
 * this device and take effect the moment they change. The footers say which is
 * which rather than leaving people to guess why one field has a button.
 */
export default function ProfileScreen() {
  const online = useOnline();
  const query = useAccount();
  const update = useUpdateProfile();
  const preferences = usePreferences();
  const avatar = useAvatarPicker(preferences.avatarUri);
  // Dark text on the near-white primary button, spinner included.
  const onPrimary = useColorToken("--background");

  const account = query.data;

  const [name, setName] = useState("");
  const [role, setRole] = useState(preferences.role);
  const [roleTouched, setRoleTouched] = useState(false);

  // Seed once the account arrives, without clobbering in-progress edits.
  useEffect(() => {
    if (account && !name) setName(account.name ?? "");
  }, [account, name]);

  // Preferences hydrate from the Keychain asynchronously, so the stored role
  // can land after first paint. Only adopt it if the field is untouched.
  useEffect(() => {
    if (!roleTouched) setRole(preferences.role);
  }, [preferences.role, roleTouched]);

  const activeZone = preferences.timezone ?? deviceTimezone();

  const onRefresh = useCallback(() => query.refetch(), [query]);

  /**
   * No account, no form.
   *
   * This is the one screen where rendering an error as a legitimate state cost
   * data rather than just confidence: the form fell back to empty strings, Save
   * became enabled the moment anything was typed, and the PATCH wrote that over
   * the real display name on the server. Nothing is rendered until the current
   * value is known, so there is no empty field to overwrite it with.
   *
   * `isPaused` sits beside `isError` deliberately. Offline with no cached
   * account is neither loading nor errored by React Query's reckoning, and it
   * used to fall straight through to the blank form.
   */
  if (!account) {
    if (query.isError || query.isPaused) {
      const copy = describeError(query.error, { online, subject: "your profile" });
      return (
        <SettingsScroll onRefresh={onRefresh}>
          <ErrorState
            title={copy.title}
            body={copy.body}
            detail={query.error?.message}
            onRetry={copy.retryable ? () => void query.refetch() : undefined}
            busy={query.isFetching}
          />
        </SettingsScroll>
      );
    }

    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator accessibilityLabel="Loading your profile" />
      </View>
    );
  }

  const dirty = name.trim() !== (account.name ?? "").trim();

  const commitRole = () => {
    const trimmed = role.trim();
    if (trimmed !== preferences.role) setPreference("role", trimmed);
  };

  return (
    <SettingsScroll onRefresh={onRefresh}>
      <View className="items-center gap-3">
        <Avatar initials={initialsFor(account)} uri={preferences.avatarUri} size={92} />

        <View className="flex-row items-center gap-4">
          <Pressable
            onPress={() => void avatar.pick()}
            disabled={avatar.busy}
            accessibilityRole="button"
            accessibilityLabel="Choose a profile picture"
            accessibilityState={{ busy: avatar.busy }}
            className="min-h-[44px] justify-center active:opacity-60"
          >
            <Text className="text-[15px] font-semibold text-tint" maxFontSizeMultiplier={1.6}>
              {preferences.avatarUri ? "Change picture" : "Add picture"}
            </Text>
          </Pressable>

          {preferences.avatarUri ? (
            <Pressable
              onPress={avatar.remove}
              accessibilityRole="button"
              accessibilityLabel="Remove profile picture"
              className="min-h-[44px] justify-center active:opacity-60"
            >
              <Text className="text-[15px] text-label-secondary" maxFontSizeMultiplier={1.6}>
                Remove
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <Footnote>
        Your picture is stored on this iPhone only. Puffin has no avatar upload yet, so it is never
        sent to your account or shared with your workspace.
      </Footnote>

      <Section title="Name" footer="Shown on shared meetings and in your workspace.">
        <TextFieldRow
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          autoCapitalize="words"
          textContentType="name"
          returnKeyType="done"
          accessibilityLabel="Display name"
        />
      </Section>

      <Section title="Email" footer="Contact support to change the address on your account.">
        {/* Always a real address now: the screen does not render at all until
            the account has loaded, so there is no placeholder case left. */}
        <ValueRow label="Address" value={account.email} />
      </Section>

      {/* "Used to tune summaries for your job" was false: preferences.role is read
          in exactly one place — account/index.tsx, to draw a grey subtitle. It is
          not in PreferencesPatch, not in UpdatePreferencesRequest, and appears
          nowhere in src/server/lib/prompts.ts. It never reaches a prompt. The
          footer now claims only what the field does. */}
      <Section title="Role" footer="Stored on this iPhone, and shown on your account screen.">
        <TextFieldRow
          value={role}
          onChangeText={(next) => {
            setRoleTouched(true);
            setRole(next);
          }}
          onBlur={commitRole}
          onEndEditing={commitRole}
          placeholder="Product manager, engineer, founder"
          autoCapitalize="sentences"
          returnKeyType="done"
          accessibilityLabel="Job title or role"
        />
      </Section>

      <CollapsibleSection
        title="Time zone"
        summary={timezoneLabel(activeZone)}
        // Both halves were false. preferences.timezone is read only inside this
        // screen, to render its own selection; there is no timezone column, due
        // dates are not formatted against it, and the weekly digest does not
        // exist. Dates render in the phone's own zone, which is what a user
        // expects anyway.
        footer="Stored on this iPhone. Dates in the app follow your phone's own time zone."
      >
        <Row
          label="Use device time zone"
          detail={timezoneLabel(deviceTimezone())}
          selected={preferences.timezone === null}
          onPress={() => {
            haptics.select();
            setPreference("timezone", null);
          }}
        />
        {COMMON_TIMEZONES.map((zone) => (
          <Row
            key={zone}
            label={timezoneLabel(zone)}
            detail={zone}
            selected={preferences.timezone === zone}
            onPress={() => {
              haptics.select();
              setPreference("timezone", zone);
            }}
          />
        ))}
      </CollapsibleSection>

      <View className="px-4">
        <Pressable
          onPress={() => {
            commitRole();
            update.mutate(
              { name: name.trim() },
              {
                onSuccess: () => haptics.success(),
                /**
                 * A buzz was the entire failure state here. Low Power Mode,
                 * Reduce Motion's haptic setting, and an active microphone all
                 * suppress the Taptic Engine silently, so on a bad save the
                 * screen could report nothing at all while the button went back
                 * to reading "Save name" as though it had never been pressed.
                 * The typed name is still in the field, so the retry is simply
                 * pressing Save again.
                 */
                onError: (error) => {
                  haptics.error();
                  Alert.alert(
                    "Your name was not saved",
                    `${describeActionFailure(error, { online })} Your account still shows the previous name. The text you typed is still in the field, so you can press Save again.`,
                  );
                },
              },
            );
          }}
          disabled={!dirty || update.isPending}
          accessibilityRole="button"
          accessibilityState={{ disabled: !dirty, busy: update.isPending }}
          className={`min-h-[52px] items-center justify-center rounded-full ${
            dirty && !update.isPending ? "bg-label active:opacity-80" : "bg-fill"
          }`}
        >
          {update.isPending ? (
            <ActivityIndicator color={onPrimary} />
          ) : (
            <Text
              className={`text-[17px] font-semibold ${
                dirty ? "text-background" : "text-label-secondary"
              }`}
            >
              {update.isSuccess && !dirty ? "Saved" : "Save name"}
            </Text>
          )}
        </Pressable>
      </View>
    </SettingsScroll>
  );
}
