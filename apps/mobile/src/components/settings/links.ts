import { Alert } from "react-native";
import * as Linking from "expo-linking";

import { haptics } from "@/lib/haptics";

/**
 * Everything that leaves the app.
 *
 * One place for the web origin so a deployment change is a one-line edit rather
 * than a grep across six settings screens.
 *
 * These open in the system browser rather than an in-app view on purpose: legal
 * text, invoices, and account exports are things people expect to be able to
 * share, print, save to Files, and hand to someone else.
 */
export const WEB_APP_URL = "https://echobrief-production.up.railway.app";

export const SUPPORT_EMAIL = "support@echobrief.ai";

/**
 * A failed link is NOT a no-op.
 *
 * These calls used to swallow the rejection, which meant tapping "Privacy
 * Policy" on a device with no default browser, or with the scheme restricted by
 * a Screen Time or MDM profile, did nothing whatsoever. On the rows that carry
 * the privacy policy and the terms that is a disclosure the user asked for and
 * did not receive, which is a compliance problem before it is a UX one.
 *
 * So the address is put on screen instead. It cannot be tapped, but it can be
 * read, written down, and opened somewhere else, and the user knows the tap
 * registered.
 */
export function openWeb(path: string): void {
  const url = `${WEB_APP_URL}${path}`;

  void Linking.openURL(url).catch(() => {
    haptics.error();
    Alert.alert(
      "Could not open a browser",
      `This iPhone would not open the link. You can read it at:\n\n${url}`,
    );
  });
}

export function openSupportEmail(subject: string): void {
  void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`).catch(
    () => {
      haptics.error();
      Alert.alert(
        "No mail app is set up",
        `This iPhone has no mail account to send from. Support is at ${SUPPORT_EMAIL} from anywhere else.`,
      );
    },
  );
}
