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

      <Section
        title="After processing"
        footer="Transcripts, summaries, and action items are always kept. This controls the audio file itself."
      >
        <ToggleRow
          icon="waveform"
          label="Keep the audio"
          detail="Lets you replay the moment behind any line"
          value={preferences.keepAudioAfterProcessing}
          onValueChange={(next) => setPreference("keepAudioAfterProcessing", next)}
        />
      </Section>

      {preferences.keepAudioAfterProcessing ? (
        <Section title="Keep audio for">
          {RETENTION_WINDOWS.map((choice) => (
            <Row
              key={String(choice.value)}
              label={choice.label}
              selected={preferences.retentionDays === choice.value}
              onPress={() => {
                haptics.select();
                setPreference("retentionDays", choice.value);
              }}
            />
          ))}
        </Section>
      ) : null}

      <Footnote>
        {preferences.keepAudioAfterProcessing
          ? "Audio is removed once the window passes. Deleting a meeting removes its audio immediately, whatever this is set to."
          : "Audio is discarded as soon as a meeting finishes processing, so there is no retention window to set."}
      </Footnote>
    </SettingsScroll>
  );
}
