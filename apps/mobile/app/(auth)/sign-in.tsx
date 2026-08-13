import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Animated from "react-native-reanimated";

import { authErrorMessage, useSignIn } from "@/lib/api/auth";
import { googleAuthErrorMessage, useGoogleSignIn } from "@/lib/api/google-auth";
import { haptics } from "@/lib/haptics";
import { AuthScreen, HorizonLabel } from "@/components/auth/auth-screen";
import { AuthField, AuthFieldGroup } from "@/components/auth/auth-field";
import { AuthFooterLink, AuthFormError, AuthSubmitButton } from "@/components/auth/auth-actions";
import { AuthOrDivider, GoogleAuthButton } from "@/components/auth/google-button";
import { useAuthEntrance } from "@/components/auth/motion";

export default function SignInScreen() {
  const signIn = useSignIn();
  const googleSignIn = useGoogleSignIn();
  const passwordRef = useRef<TextInput>(null);
  const enter = useAuthEntrance();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Either route being in flight locks the other. Two sign-ins racing would
  // have two adoptSession calls writing the Keychain in an order nobody chose.
  const busy = signIn.isPending || googleSignIn.isPending;
  const canSubmit = /.+@.+\..+/.test(email) && password.length > 0 && !busy;

  /**
   * One error row for both routes.
   *
   * Rendering a second AuthFormError under the first would stack two alerts
   * and announce both, and the two failures are mutually exclusive anyway —
   * whichever attempt just finished is the one worth reading.
   */
  const errorMessage = signIn.isError
    ? authErrorMessage(signIn.error)
    : googleSignIn.isError
      ? googleAuthErrorMessage(googleSignIn.error)
      : null;

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

  const onGoogle = () => {
    if (busy) return;
    googleSignIn.mutate(undefined, {
      onSuccess: (outcome) => {
        // "cancelled" is the user backing out of the consent sheet. No haptic,
        // no message, no navigation — just the spinner stopping.
        if (outcome.status !== "signed-in") return;
        haptics.success();
        router.replace("/(app)/meetings");
      },
      onError: () => haptics.error(),
    });
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
          Puffin
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
            editable={!busy}
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
            editable={!busy}
          />
        </AuthFieldGroup>
      </Animated.View>

      {errorMessage ? <AuthFormError message={errorMessage} /> : null}

      {/* Both ways in arrive as one block rather than as two more stagger
          steps. They are alternatives, so dealing them onto the screen one
          after the other would imply an order to work through. */}
      <Animated.View entering={enter(2)} className="mt-4">
        <AuthSubmitButton
          label="Sign in"
          onPress={onSubmit}
          enabled={canSubmit}
          busy={signIn.isPending}
        />

        <View className="mt-5">
          <AuthOrDivider />
        </View>

        <View className="mt-5">
          <GoogleAuthButton
            label="Sign in with Google"
            onPress={onGoogle}
            enabled={!busy}
            busy={googleSignIn.isPending}
          />
        </View>
      </Animated.View>

      <Animated.View entering={enter(3)} className="mt-7">
        <AuthFooterLink prompt="New to Puffin?" action="Create an account" href="/(auth)/sign-up" />
      </Animated.View>
    </AuthScreen>
  );
}
