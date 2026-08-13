import { useUpdatePreferences } from "@/lib/api/preferences";
import { haptics } from "@/lib/haptics";
import {
  AUDIO_QUALITIES,
  RETENTION_WINDOWS,
  setPreference,
  usePreferences,
} from "@/components/settings/preferences";
import { Row, Section, ToggleRow } from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";

/**
 * Recording defaults.
 *
 * Every control here is live and persists on this device; none of them has a
 * server behind it yet. The footers say so once per group rather than
 * decorating each row with a caveat, and no row is disabled just because the
 * backend is missing — a switch that cannot be moved teaches people the screen
 * is broken.
 */
export default function RecordingScreen() {
  const preferences = usePreferences();
  const sync = useUpdatePreferences();

  return (
    <SettingsScroll>
      <Section
        title="Audio quality"
        footer="Higher quality captures more of a difficult room, at the cost of a larger upload."
      >
        {AUDIO_QUALITIES.map((choice) => (
          <Row
            key={choice.value}
            label={choice.label}
            detail={choice.detail}
            selected={preferences.audioQuality === choice.value}
            onPress={() => {
              haptics.select();
              setPreference("audioQuality", choice.value);
            }}
          />
        ))}
      </Section>

      <Section
        title="Starting a recording"
        footer="Calendar auto-start is queued behind calendar access, which this build does not request yet. Your choice is remembered for when it lands."
      >
        <ToggleRow
          icon="calendar"
          label="Auto-start on calendar events"
          detail="Begin capturing when a scheduled meeting starts"
          value={preferences.autoStartOnCalendar}
          onValueChange={(next) => setPreference("autoStartOnCalendar", next)}
        />
      </Section>

      {/*
        A statement, not a control.

        This was a "Keep the audio" switch above a six-option retention picker
        offering 7, 30, 90 and 365 days, "Until I delete it" and "Not kept",
        defaulting to 90. None of it reached the server: the values were written
        to the Keychain and read by nothing, while the cleanup job deletes every
        audio file at 7 days flat for everyone. So all six options were wrong,
        "Until I delete it" was a promise the system broke on day 8, and a user
        who chose 90 days lost their audio without ever being told.

        Saying what actually happens is the only honest option until the
        preference is plumbed through to the worker. When it is, this becomes a
        picker again — and the copy below stops needing to apologise.
      */}
      {/* A control again.
          This was a picker, then a flat statement, and now a picker once more —
          and the middle step was the honest one. It offered 7 / 30 / 90 / 365 /
          "until I delete it" while the cleanup job deleted everything at 7 days
          for everyone, so five of the six options were lies and a user who chose
          90 lost their audio on day 8 without being told. The worker now reads
          this per user (migration 0015), so the choice means something. */}
      <Section title="Keep audio for">
        {RETENTION_WINDOWS.map((choice) => (
          <Row
            key={String(choice.value)}
            label={choice.label}
            selected={preferences.retentionDays === choice.value}
            onPress={() => {
              haptics.select();
              setPreference("retentionDays", choice.value);
              void sync.mutateAsync({ audio_retention_days: choice.value });
            }}
          />
        ))}
      </Section>

      <Footnote>
        Transcripts, summaries, and action items are kept until you delete the meeting — this is the
        audio itself, which is what the player needs. Deleting a meeting removes its audio straight
        away, whatever this says.
      </Footnote>
    </SettingsScroll>
  );
}
