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

      {/*
       * The footer changes with the switch rather than describing both states at
       * once, because the two things a user needs to know are different in each.
       * Off, the useful fact is what turning it on will and will not do. On, the
       * useful fact is that the words are gone rather than hidden — AssemblyAI
       * masks them as it transcribes, so there is no unfiltered copy anywhere,
       * and everything built from the transcript inherits the asterisks.
       *
       * Both halves say it does not reach back. It genuinely does not: the
       * setting is read when the audio is transcribed, so meetings that already
       * have a transcript are untouched, and so is a meeting being retried after
       * a later step failed. Letting someone believe this tidies up an old
       * recording would be the same lie as a setting that does nothing.
       */}
      <Section
        title="Profanity"
        footer={
          preferences.filterProfanity
            ? "The transcriber replaces swearing with asterisks as it works, so the words are never stored — summaries, action items, and search see the masked text too. Meetings already transcribed keep the words they were transcribed with."
            : "Transcripts record what was said, swearing included. Turning this on applies to recordings transcribed from here on — it does not go back and change meetings you already have."
        }
      >
        <ToggleRow
          icon="exclamationmark.bubble"
          label="Filter profanity"
          value={preferences.filterProfanity}
          onValueChange={(next) => {
            setPreference("filterProfanity", next);
            // `mutate`, not `void mutateAsync` as the language rows above do.
            // mutateAsync returns a promise that REJECTS on failure, and
            // discarding it with `void` leaves that rejection unhandled — the
            // hook's onError still shows its alert, but RN also logs an
            // unhandled rejection for it. `mutate` routes the same failure to
            // the same alert without the stray rejection.
            sync.mutate({ filter_profanity: next });
          }}
        />
      </Section>

      <Section
        title="Speakers"
        footer="Names apply to the meeting you set them in. Telling one voice from another across different meetings needs stored voice prints, which Puffin does not keep — so the next recording starts from Speaker A again."
      >
        <ToggleRow
          icon="person.2"
          label="Remember speaker names"
          value={preferences.rememberSpeakerNames}
          onValueChange={(next) => setPreference("rememberSpeakerNames", next)}
        />
      </Section>

      {/*
       * This used to say the whole screen was stored on this iPhone and would
       * apply "once transcription settings are wired through to the processing
       * pipeline". Language and vocabulary were wired through in migration 0015
       * and profanity filtering in 0019, so the sentence stopped being true and
       * started understating the app. Speaker names are the one control here
       * that really is device-local, and it is the one that still says so.
       */}
      <Footnote>
        Language, vocabulary, and profanity filtering are saved to your account and applied when a
        recording is transcribed. Speaker names are kept on this iPhone.
      </Footnote>
    </SettingsScroll>
  );
}
