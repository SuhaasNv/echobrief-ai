import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";

import { haptics } from "@/lib/haptics";
import { pluralize } from "@/lib/format";
import {
  MAX_VOCABULARY_TERMS,
  addVocabularyTerm,
  removeVocabularyTerm,
  usePreferences,
} from "@/components/settings/preferences";
import {
  AppearingRow,
  ROW_MIN_HEIGHT,
  Row,
  Section,
  SETTINGS_HEX,
} from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";

/**
 * Custom vocabulary.
 *
 * The whole screen is one job: type a word, add it, see it in the list. The
 * result of adding is stated rather than assumed — a duplicate says duplicate
 * instead of silently doing nothing, which is the failure mode that makes
 * people type the same word four times.
 */
export default function VocabularyScreen() {
  const preferences = usePreferences();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const terms = preferences.vocabulary;
  const full = terms.length >= MAX_VOCABULARY_TERMS;
  const canAdd = draft.trim().length > 0 && !full;

  const submit = () => {
    if (!canAdd) return;

    const result = addVocabularyTerm(draft);

    if (result === "added") {
      haptics.tap();
      setDraft("");
      setNotice(null);
      return;
    }

    haptics.warning();
    setNotice(
      result === "duplicate"
        ? "That term is already on the list."
        : result === "full"
          ? `The list holds ${MAX_VOCABULARY_TERMS} terms. Remove one to add another.`
          : "Type a word or a name first.",
    );
  };

  return (
    <SettingsScroll>
      <Section
        title="Add a term"
        footer="Spell it the way it should appear in a transcript. Case is preserved."
      >
        <View className="flex-row items-center gap-3 px-4 py-2" style={{ minHeight: ROW_MIN_HEIGHT }}>
          <TextInput
            keyboardAppearance="dark"
            className="flex-1 py-2 text-[17px] text-label"
            value={draft}
            onChangeText={(next) => {
              setDraft(next);
              if (notice) setNotice(null);
            }}
            placeholder="EchoBrief, Nakamura, ARR"
            placeholderTextColor={SETTINGS_HEX.tertiary}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={submit}
            accessibilityLabel="New vocabulary term"
          />
          <Pressable
            onPress={submit}
            disabled={!canAdd}
            accessibilityRole="button"
            accessibilityLabel="Add term"
            accessibilityState={{ disabled: !canAdd }}
            className="min-h-[36px] justify-center rounded-full bg-fill px-4 active:opacity-70"
          >
            <Text
              className={`text-[15px] font-semibold ${
                canAdd ? "text-label" : "text-label-secondary"
              }`}
              maxFontSizeMultiplier={1.4}
            >
              Add
            </Text>
          </Pressable>
        </View>
      </Section>

      {notice ? (
        <Text
          className="px-5 text-[13px] leading-[18px] text-warning"
          maxFontSizeMultiplier={1.8}
          accessibilityLiveRegion="polite"
        >
          {notice}
        </Text>
      ) : null}

      {terms.length > 0 ? (
        <Section
          title={pluralize(terms.length, "term")}
          footer="Terms are stored on this iPhone and will be sent with new recordings once the transcription API accepts a word list."
        >
          {terms.map((term) => (
            <AppearingRow key={term}>
              <Row
                label={term}
                accessory={
                  <Pressable
                    onPress={() => {
                      haptics.tap();
                      removeVocabularyTerm(term);
                    }}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${term}`}
                    className="active:opacity-60"
                  >
                    <Image
                      source="sf:minus.circle.fill"
                      tintColor={SETTINGS_HEX.danger}
                      style={{ width: 20, height: 20 }}
                      contentFit="contain"
                    />
                  </Pressable>
                }
              />
            </AppearingRow>
          ))}
        </Section>
      ) : (
        <Footnote>
          No terms yet. Anything you add here is a hint to the transcriber, not a rule, so it is
          safe to add names it only occasionally gets wrong.
        </Footnote>
      )}
    </SettingsScroll>
  );
}
