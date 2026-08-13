import { haptics } from "@/lib/haptics";
import {
  SUMMARY_LENGTHS,
  SUMMARY_STYLES,
  SUMMARY_TONES,
  setPreference,
  usePreferences,
} from "@/components/settings/preferences";
import { CollapsibleSection, Row, Section, ToggleRow } from "@/components/settings/rows";
import { Footnote, SettingsScroll } from "@/components/settings/screen";

/**
 * Summary output.
 *
 * Style, length, and tone are three separate axes on purpose: "executive brief,
 * long, warm" is a real request and a single combined preset list would need
 * thirty-six rows to express it.
 *
 * Tone is collapsed by default. It is the axis people set once and forget, and
 * leaving three more rows open pushes the action-item switch off the first
 * screen, where it is the only control here that changes what the app collects.
 */
export default function SummariesScreen() {
  const preferences = usePreferences();

  return (
    <SettingsScroll>
      <Section title="Style">
        {SUMMARY_STYLES.map((choice) => (
          <Row
            key={choice.value}
            label={choice.label}
            detail={choice.detail}
            selected={preferences.summaryStyle === choice.value}
            onPress={() => {
              haptics.select();
              setPreference("summaryStyle", choice.value);
            }}
          />
        ))}
      </Section>

      <Section title="Length">
        {SUMMARY_LENGTHS.map((choice) => (
          <Row
            key={choice.value}
            label={choice.label}
            detail={choice.detail}
            selected={preferences.summaryLength === choice.value}
            onPress={() => {
              haptics.select();
              setPreference("summaryLength", choice.value);
            }}
          />
        ))}
      </Section>

      <CollapsibleSection
        title="Tone"
        summary={SUMMARY_TONES.find((choice) => choice.value === preferences.tone)?.label}
      >
        {SUMMARY_TONES.map((choice) => (
          <Row
            key={choice.value}
            label={choice.label}
            detail={choice.detail}
            selected={preferences.tone === choice.value}
            onPress={() => {
              haptics.select();
              setPreference("tone", choice.value);
            }}
          />
        ))}
      </CollapsibleSection>

      <Section
        title="Action items"
        footer={
          preferences.detectActionItems
            ? "Commitments, owners, and deadlines are pulled out of every meeting and collected in the Actions tab."
            : "With this off, meetings are still summarized, but nothing new reaches the Actions tab."
        }
      >
        <ToggleRow
          icon="checkmark.circle"
          label="Detect action items"
          value={preferences.detectActionItems}
          onValueChange={(next) => setPreference("detectActionItems", next)}
        />
      </Section>

      <Footnote>
        Stored on this iPhone. Summaries already produced keep the shape they were written in;
        these settings apply to meetings processed from here on.
      </Footnote>
    </SettingsScroll>
  );
}
