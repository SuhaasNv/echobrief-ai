import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import { clearSession } from "@/lib/api/token-store";
import { haptics } from "@/lib/haptics";

/**
 * A native UITabBar sits above the content (that is how the glass reads), so
 * anything bottom-aligned must clear the bar plus the home indicator or it
 * renders off-screen. A ScrollView with contentInsetAdjustmentBehavior
 * handles the TOP inset; the bottom is ours.
 */
const TAB_BAR_HEIGHT = 49;

function Row({
  label,
  onPress,
  destructive,
  hint,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  hint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint={hint}
      className="min-h-[50px] justify-center px-4 active:bg-fill"
    >
      <Text
        className={`text-[17px] ${destructive ? "text-danger" : "text-label"}`}
        maxFontSizeMultiplier={1.8}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <View className="overflow-hidden rounded-card bg-surface" style={{ borderCurve: "continuous" }}>
      {children}
    </View>
  );
}

export default function AccountScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const confirmSignOut = () => {
    haptics.medium();
    Alert.alert(
      "Sign out of EchoBrief?",
      "Recordings that haven't finished uploading will be removed from this iPhone.",
      [
        // Cancel goes FIRST — iOS renders the leading button on the left, and
        // every system alert puts the safe choice there.
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () => {
            // Keychain entries survive app uninstall on iOS, so an explicit
            // clear is the only thing that actually ends the session.
            clearSession();
            queryClient.clear();
            router.replace("/(auth)/sign-in");
          },
        },
      ],
    );
  };

  const openOnWeb = (path: string) => {
    // Placeholder for the SFSafariViewController handoff. The web app's
    // /auth/callback reads a token from the URL fragment, so the real version
    // lands the user already signed in on the right screen.
    Alert.alert("Continue on the web", `This opens ${path} in your browser.`);
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: 16,
        gap: 24,
        paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 24,
      }}
    >
      <View className="gap-2">
        <Text className="px-1 text-[13px] text-label-secondary">Continue on the web</Text>
        <Section>
          <Row
            label="Settings and profile"
            hint="Opens in your browser"
            onPress={() => openOnWeb("/app/settings")}
          />
          <View className="ml-4 h-px bg-separator" />
          <Row
            label="Analytics"
            hint="Opens in your browser"
            onPress={() => openOnWeb("/app/analytics")}
          />
          <View className="ml-4 h-px bg-separator" />
          <Row
            label="Plan and billing"
            hint="Opens in your browser"
            onPress={() => openOnWeb("/app/settings")}
          />
        </Section>
      </View>

      <Section>
        <Row label="Sign out" destructive onPress={confirmSignOut} />
      </Section>
    </ScrollView>
  );
}
