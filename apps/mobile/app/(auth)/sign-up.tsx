import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { authErrorMessage, useSignUp } from "@/lib/api/auth";

const MIN_PASSWORD_LENGTH = 8;

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();
  const signUp = useSignUp();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const passwordLongEnough = password.length >= MIN_PASSWORD_LENGTH;
  const canSubmit = /.+@.+\..+/.test(email) && passwordLongEnough && !signUp.isPending;

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
            Alert.alert("Check your email", result.message, [
              { text: "Sign in", onPress: () => router.replace("/(auth)/sign-in") },
              { text: "OK", style: "cancel" },
            ]);
            return;
          }
          router.replace("/(app)");
        },
      },
    );
  };

  return (
    <View className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            paddingHorizontal: 24,
            paddingTop: insets.top + 24,
            paddingBottom: insets.bottom + 24,
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
              className="h-[52px] rounded-control bg-surface px-4 text-[17px] text-label"
              placeholder="Name (optional)"
              placeholderTextColor="#6E727A"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              textContentType="name"
              autoComplete="name"
              editable={!signUp.isPending}
            />

            <TextInput
              className="h-[52px] rounded-control bg-surface px-4 text-[17px] text-label"
              placeholder="Email"
              placeholderTextColor="#6E727A"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="email"
              editable={!signUp.isPending}
            />

            <TextInput
              className="h-[52px] rounded-control bg-surface px-4 text-[17px] text-label"
              placeholder="Password"
              placeholderTextColor="#6E727A"
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
              <Text className="px-1 text-[15px] text-danger">
                {authErrorMessage(signUp.error)}
              </Text>
            ) : null}

            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit}
              accessibilityRole="button"
              className={`mt-2 h-[52px] items-center justify-center rounded-full ${
                canSubmit ? "bg-label" : "bg-fill"
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
