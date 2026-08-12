import { Alert, Pressable, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { clearSession } from "@/lib/api/token-store";

export default function AccountScreen() {
  const queryClient = useQueryClient();

  const confirmSignOut = () => {
    Alert.alert(
      "Sign out of EchoBrief?",
      "Recordings that haven't finished uploading will be removed from this iPhone.",
      [
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

  return (
    <View className="flex-1 bg-background px-4">
      <Stack.Screen options={{ title: "Account" }} />

      <View className="flex-1 justify-end pb-8">
        <Pressable
          onPress={confirmSignOut}
          accessibilityRole="button"
          className="h-[52px] items-center justify-center rounded-full bg-fill active:opacity-70"
        >
          <Text className="text-[17px] font-semibold text-danger">Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}
