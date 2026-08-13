import { router } from "expo-router";

import { labelFor, RETENTION_WINDOWS, setPreference, usePreferences } from "@/components/settings/preferences";
import { openWeb } from "@/components/settings/links";
import { Row, Section, ToggleRow } from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";

/**
 * Privacy and data.
 *
 * The training control is opt-IN and defaults off. An opt-out toggle for
 * training on someone's meeting recordings is the wrong default in a product
 * whose entire content is other people's confidential conversations, and the
 * label says what it covers rather than hiding behind "help us improve".
 *
 * Export links out to the web rather than pretending to run here: the export is
 * an archive that gets emailed, and there is no mobile endpoint for it. A row
 * that opens the browser is a working control; a row that spins and does
 * nothing is not.
 */
export default function PrivacyScreen() {
  const preferences = usePreferences();

  return (
    <SettingsScroll>
      <Section
        title="Your data"
        footer="The export includes every transcript, summary, and action item on your account."
      >
        <Row
          icon="square.and.arrow.up"
          label="Export my data"
          external
          onPress={() => openWeb("/app/settings")}
          hint="Opens your account settings on the web"
        />
        <Row
          icon="clock"
          label="Audio retention"
          value={
            preferences.keepAudioAfterProcessing
              ? labelFor(RETENTION_WINDOWS, preferences.retentionDays)
              : "Not kept"
          }
          onPress={() => router.push("/(app)/account/recording")}
        />
      </Section>

      <Section
        title="Model training"
        footer="Off by default. Transcription and summarization still work exactly the same either way; this only controls whether your content may be used to improve models."
      >
        <ToggleRow
          icon="hand.raised"
          label="Use my meetings for training"
          detail="Off means your recordings, transcripts, and summaries are never used to train models"
          value={preferences.allowModelTraining}
          onValueChange={(next) => setPreference("allowModelTraining", next)}
        />
      </Section>

      <Section title="Account">
        <Row
          icon="doc.text"
          iconTone="neutral"
          label="Privacy Policy"
          external
          onPress={() => openWeb("/privacy")}
        />
        <Row
          icon="trash"
          label="Delete account"
          destructive
          onPress={() => router.push("/(app)/account/delete")}
        />
      </Section>

      <Footnote>
        Audio you record is sent to AssemblyAI for transcription, and transcripts are sent to
        OpenAI to produce summaries and action items. Recordings are stored on Cloudflare R2.
      </Footnote>
    </SettingsScroll>
  );
}
