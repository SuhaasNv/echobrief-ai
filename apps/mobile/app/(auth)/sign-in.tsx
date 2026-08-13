import { useRef, useState } from "react";
import { Text, TextInput } from "react-native";
import { router } from "expo-router";
import Animated from "react-native-reanimated";

import { authErrorMessage, useSignIn } from "@/lib/api/auth";
import { haptics } from "@/lib/haptics";
import { AuthScreen, HorizonLabel } from "@/components/auth/auth-screen";
import { AuthField, AuthFieldGroup } from "@/components/auth/auth-field";
import {
  AuthFooterLink,
  AuthFormError,
  AuthSubmitButton,
} from "@/components/auth/auth-actions";
import { useAuthEntrance } from "@/components/auth/motion";

export default function SignInScreen() {
  const signIn = useSignIn();
  const passwordRef = useRef<TextInput>(null);
  const enter = useAuthEntrance();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = /.+@.+\..+/.test(email) && password.length > 0 && !signIn.isPending;

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
    <AuthScreen variant="signIn">
      <Animated.View entering={enter(0)}>
        <HorizonLabel>Meeting intelligence</HorizonLabel>
        {/* font-display, not style={{ fontFamily }} — Uniwind's className
            resolution wins over the style prop, so setting the family there
            silently falls back to the system face. */}
        <Text
          className="mt-3 font-display text-[40px] leading-[46px] text-label"
          maxFontSizeMultiplier={1.4}
        >
          EchoBrief
        </Text>
        <Text className="mt-1.5 text-[17px] leading-[22px] text-label-secondary">
          Your meetings, remembered.
        </Text>
      </Animated.View>

      <Animated.View entering={enter(1)} className="mt-7">
        <AuthFieldGroup>
          <AuthField
            label="Email"
            placeholder="Email"
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
            divider
          />
          <AuthField
            label="Password"
            inputRef={passwordRef}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoCorrect={false}
            secure
            textContentType="password"
            autoComplete="current-password"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
            editable={!signIn.isPending}
          />
        </AuthFieldGroup>
      </Animated.View>

      {signIn.isError ? <AuthFormError message={authErrorMessage(signIn.error)} /> : null}

      <Animated.View entering={enter(2)} className="mt-4">
        <AuthSubmitButton
          label="Sign in"
          onPress={onSubmit}
          enabled={canSubmit}
          busy={signIn.isPending}
        />
      </Animated.View>

      <Animated.View entering={enter(3)} className="mt-7">
        <AuthFooterLink
          prompt="New to EchoBrief?"
          action="Create an account"
          href="/(auth)/sign-up"
        />
      </Animated.View>
    </AuthScreen>
  );
}
