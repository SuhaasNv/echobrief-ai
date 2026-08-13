import { router } from "expo-router";

import { openWeb } from "@/components/settings/links";
import { Row, Section, ValueRow } from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";

/**
 * Privacy and data.
 *
 * Nothing on this screen is a device-local setting any more — see the note on
 * the training section. Every row either states a fact the system actually
 * keeps, or opens something that works.
 *
 * Export links out to the web rather than pretending to run here: the export is
 * an archive that gets emailed, and there is no mobile endpoint for it. A row
 * that opens the browser is a working control; a row that spins and does
 * nothing is not.
 */
export default function PrivacyScreen() {
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
        {/* The real window, not the stored preference — see account/recording. */}
        <Row
          icon="clock"
          label="Audio retention"
          value="7 days"
          onPress={() => router.push("/(app)/account/recording")}
        />
      </Section>

      {/*
        A STATEMENT, not a switch — for now.

        This was a toggle labelled "Use my meetings for training", whose detail
        line promised that off meant the content is "never used to train
        models". `allowModelTraining` was written to the Keychain and read by
        nothing: zero references across src/server, packages/shared and
        migrations, and UpdatePreferencesRequest is .strict() so the field could
        not even be sent. It was a privacy control with no enforcement behind it.

        Worse, it contradicted the Legal screen, which states flatly that none of
        the subprocessors is used to train models on your content. One screen
        guaranteed training never happens; this one offered a switch to enable
        it. Both could not be true.

        So it says the true thing instead. Nothing trains on user content today,
        and that is a property of the contracts with the subprocessors rather
        than of a value on this device — which is exactly what the copy now
        claims and no more.

        The same move is on the record two files away: account/recording.tsx
        documents converting a lying retention picker into an honest statement,
        and then back into a real picker once the worker actually read it. If
        training is ever offered, this becomes a switch again — with a column, an
        API field, and something reading it.
      */}
      <Section
        title="Model training"
        footer="This is a property of our agreements with those services, not a setting on this device — so there is nothing here to switch off."
      >
        <ValueRow icon="hand.raised" label="Training on your content" value="Never" />
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
        Audio you record is sent to AssemblyAI for transcription, and transcripts are sent to OpenAI
        to produce summaries and action items. Recordings are stored on Cloudflare R2.
      </Footnote>
    </SettingsScroll>
  );
}
