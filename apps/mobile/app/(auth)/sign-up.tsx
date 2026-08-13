import { useRef, useState } from "react";
import { Alert, Text, TextInput } from "react-native";
import { router } from "expo-router";
import Animated from "react-native-reanimated";

import { authErrorMessage, useSignUp } from "@/lib/api/auth";
import { haptics } from "@/lib/haptics";
import { AuthScreen, HorizonLabel } from "@/components/auth/auth-screen";
import { AuthField, AuthFieldGroup } from "@/components/auth/auth-field";
import {
  AuthFooterLink,
  AuthFormError,
  AuthSubmitButton,
} from "@/components/auth/auth-actions";
import { useAuthEntrance } from "@/components/auth/motion";

const MIN_PASSWORD_LENGTH = 8;

export default function SignUpScreen() {
  const signUp = useSignUp();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const enter = useAuthEntrance();

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
    // Same hero, same dissolve, same horizon line as sign-in — only the panel
    // starts higher, because there is a third field and a native header to make
    // room for. The pair has to read as one product, and previously sign-up had
    // no video at all and looked like a screen from a different app.
    <AuthScreen variant="signUp">
      <Animated.View entering={enter(0)}>
        <HorizonLabel>Meeting intelligence</HorizonLabel>
        <Text
          className="mt-3 font-display text-[34px] leading-[40px] text-label"
          maxFontSizeMultiplier={1.4}
        >
          Create an account
        </Text>
        <Text className="mt-1.5 text-[17px] leading-[22px] text-label-secondary">
          Start turning meetings into summaries you can search.
        </Text>
      </Animated.View>

      <Animated.View entering={enter(1)} className="mt-7">
        <AuthFieldGroup>
          <AuthField
            label="Name, optional"
            placeholder="Name (optional)"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            textContentType="name"
            autoComplete="name"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => emailRef.current?.focus()}
            editable={!signUp.isPending}
            divider
          />
          <AuthField
            label="Email"
            inputRef={emailRef}
            placeholder="Email"
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
            textContentType="newPassword"
            autoComplete="new-password"
            // Without this, iOS may generate a strong password the API then
            // rejects — which trains people to decline the offer for good.
            passwordRules={`minlength: ${MIN_PASSWORD_LENGTH};`}
            returnKeyType="go"
            onSubmitEditing={onSubmit}
            editable={!signUp.isPending}
          />
        </AuthFieldGroup>

        <Text
          className={`mt-2 px-1 text-[13px] ${
            passwordLongEnough ? "text-success" : "text-label-secondary"
          }`}
          accessibilityLabel={
            passwordLongEnough
              ? "Password is long enough"
              : `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
          }
        >
          At least {MIN_PASSWORD_LENGTH} characters
        </Text>
      </Animated.View>

      {signUp.isError ? <AuthFormError message={authErrorMessage(signUp.error)} /> : null}

      <Animated.View entering={enter(2)} className="mt-4">
        <AuthSubmitButton
          label="Create account"
          onPress={onSubmit}
          enabled={canSubmit}
          busy={signUp.isPending}
        />
      </Animated.View>

      <Animated.View entering={enter(3)} className="mt-7">
        <AuthFooterLink
          prompt="Already have an account?"
          action="Sign in"
          // Pop rather than push. replace() is the fallback for a cold deep
          // link straight to sign-up, where there is no stack to pop.
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/(auth)/sign-in")
          }
        />
      </Animated.View>
    </AuthScreen>
  );
}
