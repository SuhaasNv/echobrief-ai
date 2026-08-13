import { router } from "expo-router";
import Constants from "expo-constants";

import { openSupportEmail, openWeb } from "@/components/settings/links";
import { Row, Section, ValueRow } from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";

/**
 * About.
 *
 * The version and build come from the running app's own config rather than a
 * hardcoded string, which is the only way they stay true after a release. A
 * support screen whose version number is stale is worse than one with none: it
 * sends people to report bugs against a build they are not running.
 */
export default function AboutScreen() {
  const config = Constants.expoConfig;
  const version = config?.version ?? "1.0.0";
  const build = config?.ios?.buildNumber ?? "1";

  return (
    <SettingsScroll>
      <Section title="Version">
        <ValueRow icon="info.circle" iconTone="neutral" label="Puffin" value={version} mono />
        <ValueRow label="Build" value={build} mono />
      </Section>

      <Section
        title="Support"
        footer={`Include your version number (${version}) so we can tell which build you are on.`}
      >
        <Row
          icon="envelope"
          label="Email support"
          external
          onPress={() => openSupportEmail(`Puffin iOS ${version} (${build})`)}
        />
        <Row
          icon="questionmark.circle"
          iconTone="neutral"
          label="Help centre"
          external
          onPress={() => openWeb("/about")}
        />
      </Section>

      <Section title="Legal">
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
        <Row label="How your data is handled" onPress={() => router.push("/(app)/account/legal")} />
      </Section>

      <Footnote>
        Puffin turns meeting audio into transcripts, summaries, and action items you can search
        across every meeting you have captured.
      </Footnote>
    </SettingsScroll>
  );
}
