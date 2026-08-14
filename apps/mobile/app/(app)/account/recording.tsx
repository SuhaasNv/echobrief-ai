import { useUpdatePreferences } from "@/lib/api/preferences";
import { haptics } from "@/lib/haptics";
import {
  AUDIO_QUALITIES,
  RETENTION_WINDOWS,
  setPreference,
  usePreferences,
} from "@/components/settings/preferences";
import { Row, Section, ToggleRow, ValueRow } from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";

/**
 * Recording defaults.
 *
 * Most controls here persist on this device; none has a server behind it yet,
 * and the footers say so once per group rather than decorating each row. The one
 * exception is calendar auto-start: its feature (calendar access) is not in this
 * build at all, so unlike the others there is nothing a flip could even record.
 * It is shown DISABLED with a "Coming soon" note — which reads as not-yet-shipped
 * rather than broken — and dropping the flag makes it live once access lands.
 */
export default function RecordingScreen() {
  const preferences = usePreferences();
  const sync = useUpdatePreferences();

  return (
    <SettingsScroll>
      {/*
        A STATEMENT, not a picker — for now.

        This was three options (Efficient / Balanced / High) with specific
        technical promises: "smallest files, fastest upload on cellular", "best
        for noisy rooms and far-field mics", under a footer about trading quality
        against upload size. `preferences.audioQuality` was read in exactly one
        place — to draw the checkmark. RECORDING_OPTIONS in lib/audio/use-recorder
        is a module-level constant with audioQuality HIGH, sampleRate 44100 and
        64 kbps hardcoded, and there is no audio_quality field on the server. A
        user on a metered plan who picked "Efficient" to save data saved nothing.

        Making it real is not a copy change. The dual-slot recorder hands BOTH
        slots the same frozen options object precisely so useAudioRecorder cannot
        rebuild a recorder mid-meeting, which is what protects the measured seam
        continuity (1.509s captured per 1.500s window, never under). Making the
        options vary per preference reopens that, and losing audio at every
        rotation is a far worse outcome than a fixed bitrate.

        So it says what it actually records. Same move as the retention picker
        below, which was a lying control, became an honest statement, and became
        a real picker once the worker read it. If per-recording quality ships,
        this becomes a picker again — with a column, an API field, and a recorder
        that reads it.
      */}
      <Section
        title="Audio quality"
        footer="One setting, chosen for speech: high enough to transcribe a room accurately, small enough to upload on cellular. About 28 MB an hour."
      >
        <ValueRow label="Format" value="AAC, 44.1 kHz" />
      </Section>

      <Section
        title="Starting a recording"
        footer="Calendar auto-start needs calendar access, which this build does not request yet. It turns on here once that ships."
      >
        <ToggleRow
          icon="calendar"
          label="Auto-start on calendar events"
          detail="Coming soon · begin capturing when a scheduled meeting starts"
          value={preferences.autoStartOnCalendar}
          onValueChange={(next) => setPreference("autoStartOnCalendar", next)}
          disabled
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
