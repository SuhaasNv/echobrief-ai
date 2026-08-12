import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { authErrorMessage, useSignIn } from "@/lib/api/auth";

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const signIn = useSignIn();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [revealPassword, setRevealPassword] = useState(false);

  const canSubmit = /.+@.+\..+/.test(email) && password.length > 0 && !signIn.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    signIn.mutate(
      { email: email.trim(), password },
      { onSuccess: () => router.replace("/(app)") },
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
            <Text className="text-[34px] font-bold tracking-tight text-label">EchoBrief</Text>
            <Text className="mt-2 text-[17px] text-label-secondary">
              Your meetings, remembered.
            </Text>
          </View>

          <View className="gap-3">
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
              returnKeyType="next"
              editable={!signIn.isPending}
            />

            <View className="flex-row items-center rounded-control bg-surface pr-2">
              <TextInput
                className="h-[52px] flex-1 px-4 text-[17px] text-label"
                placeholder="Password"
                placeholderTextColor="#6E727A"
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
                className="px-3 py-2"
                accessibilityRole="button"
                accessibilityLabel={revealPassword ? "Hide password" : "Show password"}
              >
                <Text className="text-[15px] font-medium text-tint-label">
                  {revealPassword ? "Hide" : "Show"}
                </Text>
              </Pressable>
            </View>

            {signIn.isError ? (
              <Text className="px-1 text-[15px] text-danger">
                {authErrorMessage(signIn.error)}
              </Text>
            ) : null}

            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit}
              accessibilityRole="button"
              // Primary CTA is neutral near-white, not brand blue. On a
              // near-black ground that is the highest-contrast element
              // available, and it is the web app's established identity.
              className={`mt-2 h-[52px] items-center justify-center rounded-full ${
                canSubmit ? "bg-label" : "bg-fill"
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
              <Pressable accessibilityRole="link" hitSlop={8}>
                <Text className="text-[15px] font-medium text-tint-label">Create an account</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
