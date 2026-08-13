import { openWeb } from "@/components/settings/links";
import { Row, Section, ValueRow } from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";

/**
 * Where your data actually goes.
 *
 * Named processors rather than a generic "we use third-party services" line.
 * Anyone recording a room full of other people is owed the specific list, and
 * in several jurisdictions is required to be able to state it.
 *
 * The documents open in the system browser: legal text is something people
 * expect to be able to share, print, and keep.
 */
export default function LegalScreen() {
  return (
    <SettingsScroll>
      <Section title="Documents">
        <Row
          icon="doc.text"
          iconTone="neutral"
          label="Privacy Policy"
          external
          onPress={() => openWeb("/privacy")}
        />
        <Row
          icon="doc.text"
          iconTone="neutral"
          label="Terms of Service"
          external
          onPress={() => openWeb("/terms")}
        />
      </Section>

      <Section
        title="Processors"
        footer="Each one receives only what it needs to do its part, and none of them is used to train models on your content."
      >
        {/*
          All three neutral. Summaries carried iconTone="violet" — violet means
          "a model produced this" elsewhere in the app, which is true of the
          summary but not of the ROW: these three rows all name a subprocessor,
          and colouring one of them made a nine-row screen look like it had a
          stuck pressed state. The distinction the colour was reaching for is
          already carried by the value beside it.
        */}
        <ValueRow icon="waveform" iconTone="neutral" label="Transcription" value="AssemblyAI" />
        <ValueRow icon="doc.plaintext" iconTone="neutral" label="Summaries" value="OpenAI" />
        <ValueRow
          icon="internaldrive"
          iconTone="neutral"
          label="Audio storage"
          value="Cloudflare R2"
        />
      </Section>

      <Footnote>
        Recording laws differ by country and by state. Where you are, you may be required to tell
        everyone in the room that a recording has started.
      </Footnote>
    </SettingsScroll>
  );
}
