import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link, router } from "expo-router";

import { authErrorMessage, useSignIn } from "@/lib/api/auth";
import { haptics } from "@/lib/haptics";
import { DISPLAY } from "@/lib/type";

export default function SignInScreen() {
  const signIn = useSignIn();
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [revealPassword, setRevealPassword] = useState(false);

  const canSubmit = /.+@.+\..+/.test(email) && password.length > 0 && !signIn.isPending;

  // VoiceOver focus stays on the button after a failed submit, so a silently
  // rendered error below the fields is never announced.
  useEffect(() => {
    if (signIn.isError) {
      AccessibilityInfo.announceForAccessibility(authErrorMessage(signIn.error));
    }
  }, [signIn.isError, signIn.error]);

  const onSubmit = () => {
    if (!canSubmit) return;
    signIn.mutate(
      { email: email.trim(), password },
      {
        onSuccess: () => {
          haptics.success();
          router.replace("/(app)/meetings");
        },
        onError: () => haptics.error(),
      },
    );
  };

  return (
    <View className="flex-1 bg-background">
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ScrollView
          // Deliberately NOT contentInsetAdjustmentBehavior="automatic". That
          // asks UIKit to inject header and safe-area insets, which is right
          // for a list under a large title and wrong for a centred form — it
          // adds phantom height, pushing content down and making a screen that
          // fits become scrollable.
          contentInsetAdjustmentBehavior="never"
          alwaysBounceVertical={false}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: 20,
            paddingVertical: 24,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <View className="mb-10">
            <Text className="text-[36px] leading-[42px] text-label"
              style={{ fontFamily: DISPLAY.bold }}>EchoBrief</Text>
            <Text className="mt-2 text-[17px] text-label-secondary">
              Your meetings, remembered.
            </Text>
          </View>

          <View className="gap-3">
            <TextInput
              // min-h, not a fixed height: Text auto-scales with Dynamic Type,
              // so a fixed 52px box clips its own label from AX1 upward.
              className="min-h-[52px] rounded-control bg-surface px-4 py-3.5 text-[17px] text-label"
              style={{ borderCurve: "continuous" }}
              placeholder="Email"
              placeholderTextColor="#767A82"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              // username + password (not emailAddress) is what makes iOS offer
              // the saved-credential QuickType bar.
              textContentType="username"
              autoComplete="email"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
              enablesReturnKeyAutomatically
              editable={!signIn.isPending}
            />

            <View
              className="flex-row items-center rounded-control bg-surface pr-2"
              style={{ borderCurve: "continuous" }}
            >
              <TextInput
                ref={passwordRef}
                className="min-h-[52px] flex-1 px-4 py-3.5 text-[17px] text-label"
                placeholder="Password"
                placeholderTextColor="#767A82"
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!revealPassword}
                textContentType="password"
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={onSubmit}
                editable={!signIn.isPending}
              />
              <Pressable
                onPress={() => setRevealPassword((v) => !v)}
                hitSlop={12}
                className="px-3 py-2 active:opacity-40"
                accessibilityRole="button"
                accessibilityLabel={revealPassword ? "Hide password" : "Show password"}
              >
                <Text className="text-[15px] font-medium text-tint-label">
                  {revealPassword ? "Hide" : "Show"}
                </Text>
              </Pressable>
            </View>

            {signIn.isError ? (
              <Text
                className="px-1 text-[15px] text-danger"
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                {authErrorMessage(signIn.error)}
              </Text>
            ) : null}

            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              accessibilityState={{ disabled: !canSubmit, busy: signIn.isPending }}
              // Primary CTA is neutral near-white, not brand blue. On a
              // near-black ground that is the highest-contrast element
              // available, and it matches the web app's identity.
              // Pressable gives NO feedback by default — active: is required.
              className={`mt-2 min-h-[52px] items-center justify-center rounded-full px-6 ${
                canSubmit ? "bg-label active:opacity-80" : "bg-fill"
              }`}
            >
              {signIn.isPending ? (
                <ActivityIndicator color="#06070A" />
              ) : (
                <Text
                  className={`text-[17px] font-semibold ${
                    canSubmit ? "text-background" : "text-label-tertiary"
                  }`}
                >
                  Sign in
                </Text>
              )}
            </Pressable>
          </View>

          <View className="mt-8 flex-row justify-center gap-1">
            <Text className="text-[15px] text-label-secondary">New to EchoBrief?</Text>
            <Link href="/(auth)/sign-up" asChild>
              <Pressable
                accessibilityRole="link"
                hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
                className="active:opacity-40"
              >
                <Text className="text-[15px] font-medium text-tint-label">
                  Create an account
                </Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
