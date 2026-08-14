import { useNotificationPreference } from "@/lib/notifications";
import { setPreference, usePreferences } from "@/components/settings/preferences";
import { Row, Section, ToggleRow } from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";

/**
 * Notifications.
 *
 * "Meeting ready" is bound to the real delivery system, which owns both the
 * stored preference and the iOS permission and reports the AND of the two. That
 * matters: a switch bound only to the app's own preference sits happily ON
 * while iOS silently drops every notification, and nothing on screen looks
 * wrong. Flipping it on repairs whichever half is missing.
 *
 * The other two have no delivery behind them yet. Rather than let someone turn
 * on a reminder that will never arrive, they are shown DISABLED with a "Coming
 * soon" note in the detail line: the row still says what it will do, so it reads
 * as not-yet-shipped rather than broken. The moment a scheduler exists, dropping
 * the `disabled` flag makes them live — the preference wiring is already here.
 */
export default function NotificationsScreen() {
  const preferences = usePreferences();
  const meetingReady = useNotificationPreference();

  return (
    <SettingsScroll>
      <Section
        title="While you're away"
        footer={
          meetingReady.requiresSystemSettings
            ? "Notifications are turned off for EchoBrief in iOS Settings, so this switch cannot turn them back on from here."
            : "Processing takes a couple of minutes, so this is the one worth leaving on."
        }
      >
        <ToggleRow
          icon="checkmark.circle"
          label="Meeting ready"
          detail="When a recording finishes processing"
          value={meetingReady.enabled}
          onValueChange={meetingReady.setEnabled}
          // Until the stored preference and the iOS status have both been read,
          // the switch would be showing a guess.
          disabled={!meetingReady.ready}
        />
        {meetingReady.requiresSystemSettings ? (
          <Row
            icon="bell"
            iconTone="neutral"
            label="Open iOS Settings"
            external
            onPress={meetingReady.openSettings}
          />
        ) : null}
      </Section>

      <Section title="Reminders">
        <ToggleRow
          icon="calendar"
          label="Action items due"
          detail="Coming soon · a reminder the morning something is due"
          value={preferences.notifyActionItemsDue}
          onValueChange={(next) => setPreference("notifyActionItemsDue", next)}
          disabled
        />
        <ToggleRow
          icon="envelope"
          iconTone="violet"
          label="Weekly digest"
          detail="Coming soon · a Monday recap of last week's meetings"
          value={preferences.notifyWeeklyDigest}
          onValueChange={(next) => setPreference("notifyWeeklyDigest", next)}
          disabled
        />
      </Section>

      <Footnote>
        Meeting-ready alerts work today. Reminders and the weekly digest are coming soon — these
        switches turn on here the moment their delivery ships.
      </Footnote>
    </SettingsScroll>
  );
}
