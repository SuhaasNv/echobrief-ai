import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";

import { authErrorMessage, useSignUp } from "@/lib/api/auth";
import { haptics } from "@/lib/haptics";

const MIN_PASSWORD_LENGTH = 8;

export default function SignUpScreen() {
  const signUp = useSignUp();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const passwordLongEnough = password.length >= MIN_PASSWORD_LENGTH;
  const canSubmit = /.+@.+\..+/.test(email) && passwordLongEnough && !signUp.isPending;

  useEffect(() => {
    if (signUp.isError) {
      AccessibilityInfo.announceForAccessibility(authErrorMessage(signUp.error));
    }
  }, [signUp.isError, signUp.error]);

  const onSubmit = () => {
    if (!canSubmit) return;

    signUp.mutate(
      {
        email: email.trim(),
        password,
        ...(name.trim() ? { name: name.trim() } : {}),
      },
      {
        onSuccess: (result) => {
          if (result.collision) {
            // 200 with no token means the email already exists. The server
            // deliberately does not say so outright; surface its wording rather
            // than inventing more specific copy.
            haptics.warning();
            Alert.alert("Check your email", result.message, [
              // Cancel first — iOS renders the leading button on the left.
              { text: "OK", style: "cancel" },
              { text: "Sign in", onPress: () => router.replace("/(auth)/sign-in") },
            ]);
            return;
          }
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
          contentInsetAdjustmentBehavior="automatic"
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
            <Text className="text-[34px] font-bold tracking-tight text-label">
              Create an account
            </Text>
            <Text className="mt-2 text-[17px] text-label-secondary">
              Start turning meetings into summaries you can search.
            </Text>
          </View>

          <View className="gap-3">
            <TextInput
              className="min-h-[52px] rounded-control bg-surface px-4 py-3.5 text-[17px] text-label"
              style={{ borderCurve: "continuous" }}
              placeholder="Name (optional)"
              placeholderTextColor="#767A82"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              textContentType="name"
              autoComplete="name"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => emailRef.current?.focus()}
              editable={!signUp.isPending}
            />

            <TextInput
              ref={emailRef}
              className="min-h-[52px] rounded-control bg-surface px-4 py-3.5 text-[17px] text-label"
              style={{ borderCurve: "continuous" }}
              placeholder="Email"
              placeholderTextColor="#767A82"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="email"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
              enablesReturnKeyAutomatically
              editable={!signUp.isPending}
            />

            <TextInput
              ref={passwordRef}
              className="min-h-[52px] rounded-control bg-surface px-4 py-3.5 text-[17px] text-label"
              style={{ borderCurve: "continuous" }}
              placeholder="Password"
              placeholderTextColor="#767A82"
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
              // Without this, iOS may generate a strong password the API then
              // rejects — which trains people to decline the offer for good.
              passwordRules={`minlength: ${MIN_PASSWORD_LENGTH};`}
              returnKeyType="go"
              onSubmitEditing={onSubmit}
              editable={!signUp.isPending}
            />

            <Text
              className={`px-1 text-[13px] ${
                passwordLongEnough ? "text-success" : "text-label-secondary"
              }`}
            >
              At least {MIN_PASSWORD_LENGTH} characters
            </Text>

            {signUp.isError ? (
              <Text
                className="px-1 text-[15px] text-danger"
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                {authErrorMessage(signUp.error)}
              </Text>
            ) : null}

            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Create account"
              accessibilityState={{ disabled: !canSubmit, busy: signUp.isPending }}
              className={`mt-2 min-h-[52px] items-center justify-center rounded-full px-6 ${
                canSubmit ? "bg-label active:opacity-80" : "bg-fill"
              }`}
            >
              {signUp.isPending ? (
                <ActivityIndicator color="#06070A" />
              ) : (
                <Text
                  className={`text-[17px] font-semibold ${
                    canSubmit ? "text-background" : "text-label-tertiary"
                  }`}
                >
                  Create account
                </Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
