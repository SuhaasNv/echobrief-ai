import { router } from "expo-router";

import { useUpdatePreferences } from "@/lib/api/preferences";
import { haptics } from "@/lib/haptics";
import { pluralize } from "@/lib/format";
import {
  LANGUAGES,
  labelFor,
  setPreference,
  usePreferences,
} from "@/components/settings/preferences";
import { CollapsibleSection, Row, Section, ToggleRow } from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";

/**
 * Transcription.
 *
 * Vocabulary gets its own screen rather than an inline list. It is the feature
 * people in this category actually use every week — diarization mangles product
 * names, surnames, and acronyms, and a term list is the only fix — so it earns
 * a surface where adding and removing entries is the whole job.
 */
export default function TranscriptionScreen() {
  const preferences = usePreferences();
  const sync = useUpdatePreferences();

  return (
    <SettingsScroll>
      <CollapsibleSection
        title="Primary language"
        summary={labelFor(LANGUAGES, preferences.language)}
        footer="Automatic detection is right almost always. Pin a language when a meeting switches between two."
      >
        {LANGUAGES.map((choice) => (
          <Row
            key={choice.value ?? "auto"}
            label={choice.label}
            detail={choice.detail}
            selected={preferences.language === choice.value}
            onPress={() => {
              haptics.select();
              setPreference("language", choice.value);
              // The worker reads this: null means "detect it", which the API
              // spells "auto" because NULL there means "never chosen" and the
              // two must not collapse. See migration 0015.
              void sync.mutateAsync({
                transcription_language: choice.value ?? "auto",
              });
            }}
          />
        ))}
      </CollapsibleSection>

      <Section
        title="Names and terms"
        footer="Words the transcriber would otherwise guess at: product names, surnames, acronyms, anything spelled unusually."
      >
        <Row
          icon="character.book.closed"
          label="Vocabulary"
          value={
            preferences.vocabulary.length > 0
              ? pluralize(preferences.vocabulary.length, "term")
              : "None"
          }
          onPress={() => router.push("/(app)/account/vocabulary")}
        />
      </Section>

      <Section
        title="Speakers"
        footer="Names apply to the meeting you set them in. Telling one voice from another across different meetings needs stored voice prints, which EchoBrief does not keep — so the next recording starts from Speaker A again."
      >
        <ToggleRow
          icon="person.2"
          label="Remember speaker names"
          value={preferences.rememberSpeakerNames}
          onValueChange={(next) => setPreference("rememberSpeakerNames", next)}
        />
      </Section>

      <Footnote>
        These preferences are stored on this iPhone. They will apply to new recordings once
        transcription settings are wired through to the processing pipeline.
      </Footnote>
    </SettingsScroll>
  );
}
