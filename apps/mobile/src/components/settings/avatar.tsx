import { useCallback, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { File, Paths } from "expo-file-system";

import { haptics } from "@/lib/haptics";
import { setPreference } from "./preferences";

/**
 * Profile picture.
 *
 * There is no avatar upload endpoint, so this does not pretend to be one: the
 * picked image is copied into the app's document directory and its URI is
 * stored locally. The UI says so plainly wherever it appears. Inventing an
 * upload that silently drops the file would be worse than no feature at all.
 *
 * The copy matters. PHPicker hands back a URI in the cache directory, which iOS
 * is free to purge whenever storage runs low — a picture chosen today would
 * quietly become a broken image next week. `Paths.document` is the location
 * that survives.
 *
 * The initials monogram is not a fallback that gets swapped out; it stays
 * underneath, so a missing or unreadable file degrades to a correct-looking
 * avatar rather than an empty circle.
 */

export function Avatar({
  initials,
  uri,
  size = 60,
}: {
  initials: string;
  uri: string | null;
  size?: number;
}) {
  return (
    <View
      className="items-center justify-center overflow-hidden rounded-full border border-edge bg-elevated"
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        className="font-display text-label"
        style={{ fontSize: Math.round(size * 0.36) }}
        maxFontSizeMultiplier={1.2}
      >
        {initials}
      </Text>

      {uri ? (
        <Image
          source={{ uri }}
          style={{ position: "absolute", width: size, height: size }}
          contentFit="cover"
          transition={140}
          // A purged or unreadable file leaves the monogram showing through.
          onError={() => undefined}
        />
      ) : null}
    </View>
  );
}

const DOCUMENT_PREFIX = "avatar-";

/** Remove a previously stored picture. Best effort; a leftover file is harmless. */
function discard(uri: string | null): void {
  if (!uri || !uri.includes(DOCUMENT_PREFIX)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The picture is already gone, or the sandbox moved between launches.
  }
}

export function useAvatarPicker(currentUri: string | null) {
  const [busy, setBusy] = useState(false);

  const pick = useCallback(async () => {
    if (busy) return;
    setBusy(true);

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        // Never a silent no-op. If the user has already said no once, iOS will
        // not ask again, so the only honest next step is Settings.
        Alert.alert(
          "Photo access is off",
          "Puffin needs access to your photo library to set a profile picture. You can turn it on in Settings.",
          [
            { text: "Not now", style: "cancel" },
            { text: "Open Settings", onPress: () => void Linking.openSettings() },
          ],
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;

      let stored = asset.uri;
      try {
        const destination = new File(Paths.document, `${DOCUMENT_PREFIX}${Date.now()}.jpg`);
        await new File(asset.uri).copy(destination);
        stored = destination.uri;
      } catch {
        // Copy failed; fall back to the picker's own URI. It may not survive a
        // cache purge, but it works now, which beats failing the interaction.
      }

      discard(currentUri);
      setPreference("avatarUri", stored);
      haptics.success();
    } catch {
      haptics.error();
      Alert.alert("Couldn't set that picture", "Try choosing it again in a moment.");
    } finally {
      setBusy(false);
    }
  }, [busy, currentUri]);

  const remove = useCallback(() => {
    discard(currentUri);
    setPreference("avatarUri", null);
    haptics.tap();
  }, [currentUri]);

  return { pick, remove, busy };
}
