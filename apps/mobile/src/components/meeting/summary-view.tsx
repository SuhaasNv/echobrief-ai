import { Pressable, Text, View } from "react-native";

import type { MeetingDetail, MomentKind, NotableMoment } from "@/lib/api/meeting-detail";
import { customName, fallbackLabel } from "@/lib/api/speaker-names";
import { formatClock, formatDuration, pluralize } from "@/lib/format";

import { useFirstView } from "./first-view";
import { Eyebrow, EmptyPane, Meter, Notice, SectionCard } from "./primitives";
import { ScoreCard } from "./score-card";

/**
 * The summary pane.
 *
 * Order is an argument: the judgement first, then the model's prose, then the
 * structured extractions, then who actually spoke. Every block is optional and
 * every one of them is skipped rather than rendered empty, because a card with
 * a heading and no content reads as a bug in the pipeline.
 */

const SPEAKER_BARS = [
  "bg-speaker-a",
  "bg-speaker-b",
  "bg-speaker-c",
  "bg-speaker-d",
  "bg-speaker-e",
] as const;

function BulletList({ items, tone }: { items: string[]; tone: "tint" | "violet" }) {
  return (
    <View className="gap-2.5">
      {items.map((item, i) => (
        <View key={i} className="flex-row gap-2.5">
          <View
            className={`mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full ${
              tone === "tint" ? "bg-tint" : "bg-violet"
            }`}
          />
          <Text className="flex-1 text-[15px] leading-[21px] text-label" selectable>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * How each kind of moment presents itself.
 *
 * The labels are all NOUNS FOR ACTS — "Pushback", "Agreement" — never adjectives
 * for people. "Pushback" describes a thing someone did that is visible in their
 * words; "Frustrated" would describe a person, from audio nobody in this
 * pipeline has heard. The wording of these five chips is the last place that
 * distinction can be lost, so it is worth guarding here as well as in the
 * prompt.
 *
 * Deliberately muted, and deliberately NOT a red/green judgement of the
 * meeting. Disagreement in a meeting is healthy and usually the most valuable
 * thing in the recording; colouring it as an error would tell the reader the
 * app disapproves. Amber marks the two kinds worth a second look, green and
 * blue mark the two that went well, grey marks the one that is neither.
 *
 * Written as whole class strings rather than composed at runtime because the
 * Tailwind transform only sees literals.
 */
const MOMENT_STYLES: Record<MomentKind, { label: string; text: string; chip: string }> = {
  disagreement: { label: "Pushback", text: "text-warning", chip: "bg-warning/10" },
  concern: { label: "Concern", text: "text-warning", chip: "bg-warning/10" },
  hesitation: { label: "Hesitation", text: "text-label-secondary", chip: "bg-fill" },
  enthusiasm: { label: "Enthusiasm", text: "text-success", chip: "bg-success/10" },
  alignment: { label: "Agreement", text: "text-tint-label", chip: "bg-tint/10" },
};

/**
 * Show the name the user gave this voice, not the label analysis stored.
 *
 * A moment records the diarization label that was current when the meeting was
 * analysed — "Speaker A". If someone has since named that voice "Priya", the
 * transcript pane says Priya and this pane would still say Speaker A, which
 * reads as two different people. Matching on either the raw fallback or the
 * current label covers both directions, and an unrecognised label is shown as
 * stored rather than dropped: the quote is still real, and hiding who said it
 * would be a worse answer than naming them the way the analysis did.
 */
function resolveSpeaker(
  stored: string | null,
  speakers: NonNullable<MeetingDetail["transcript"]>["speakers"],
): string | null {
  if (!stored) return null;
  const match = speakers.find((s) => s.label === stored || fallbackLabel(s.id) === stored);
  return match ? match.label : stored;
}

/**
 * What the conversation did, as opposed to what it covered.
 *
 * Every row is an act plus the words that prove it. The quote is not decoration
 * — it is the evidence, and the server has already checked that it appears in
 * the transcript, dropping any moment whose words it could not find. Showing it
 * means a reader who disagrees with the characterisation can see exactly what
 * it was built from, which is the only honest way to put a line like "pushed
 * back on the timeline" next to a colleague's name.
 */
function MomentsCard({
  moments,
  speakers,
  animate,
  index,
}: {
  moments: NotableMoment[];
  speakers: NonNullable<MeetingDetail["transcript"]>["speakers"];
  animate: boolean;
  index: number;
}) {
  return (
    <SectionCard animate={animate} index={index}>
      <Eyebrow>Notable moments</Eyebrow>
      <View className="gap-4">
        {moments.map((moment, i) => {
          const style = MOMENT_STYLES[moment.kind];
          // A kind this build does not know about — an older app against a newer
          // server. Skipping the row beats rendering a chip with no label.
          if (!style) return null;

          const who = resolveSpeaker(moment.speaker, speakers);
          const clock = moment.timestamp_sec === null ? null : formatClock(moment.timestamp_sec);
          const attribution = [who, clock].filter(Boolean).join("  ·  ");

          return (
            <View key={`${moment.timestamp_sec ?? "x"}-${i}`} className="gap-2">
              <View className="flex-row flex-wrap items-center gap-2">
                <View
                  className={`rounded-chip px-2 py-1 ${style.chip}`}
                  style={{ borderCurve: "continuous" }}
                >
                  <Text
                    className={`text-[11px] font-semibold uppercase ${style.text}`}
                    style={{ letterSpacing: 0.6 }}
                    maxFontSizeMultiplier={1.4}
                  >
                    {style.label}
                  </Text>
                </View>
                {attribution ? (
                  <Text
                    className="text-[13px] text-label-tertiary"
                    style={{ fontVariant: ["tabular-nums"] }}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.4}
                  >
                    {attribution}
                  </Text>
                ) : null}
              </View>

              <Text className="text-[15px] leading-[21px] text-label" selectable>
                {moment.description}
              </Text>

              {/* The rule down the left is the whole visual argument: this text
                  is someone's actual words, not the app's prose about them. */}
              <View className="border-l-2 border-separator pl-3">
                <Text className="text-[14px] leading-[20px] text-label-secondary" selectable>
                  {moment.quote}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Said once, at the foot of the card, and it is not boilerplate: it is
          the single most important sentence in this feature. Everything above
          was inferred from a transcript by a model that has never heard the
          recording, and a reader who assumes otherwise will read "Pushback" as
          a description of somebody's mood. */}
      <Text className="text-[13px] leading-[18px] text-label-tertiary" maxFontSizeMultiplier={1.6}>
        Drawn from what was said, not how it sounded.
      </Text>
    </SectionCard>
  );
}

/**
 * Talk-time distribution — the one visual the transcript itself cannot give you.
 *
 * It is also where the anonymity is most obvious: five bars against "Speaker A"
 * through "Speaker E" is a chart of nobody. So each row is the button that names
 * its voice, and the card says so once, under the rows, rather than repeating an
 * affordance five times.
 */
function SpeakersCard({
  speakers,
  animate,
  index,
  onNameSpeaker,
}: {
  speakers: NonNullable<MeetingDetail["transcript"]>["speakers"];
  animate: boolean;
  index: number;
  /** Stable across renders — see the note in transcript-view. */
  onNameSpeaker?: (speakerId: string) => void;
}) {
  const total = speakers.reduce((sum, s) => sum + Math.max(0, s.talk_time_sec), 0);
  const anyUnnamed = speakers.some((speaker) => customName(speaker) === "");

  return (
    <SectionCard animate={animate} index={index}>
      <Eyebrow>Who talked</Eyebrow>
      <View className="gap-3">
        {speakers.map((speaker, i) => {
          const share = total > 0 ? Math.max(0, speaker.talk_time_sec) / total : 0;
          const percent = Math.round(share * 100);
          const duration = formatDuration(speaker.talk_time_sec);

          const row = (
            <>
              <View className="flex-row items-baseline justify-between gap-3">
                <Text
                  className="flex-1 text-[15px] font-medium text-label"
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.6}
                >
                  {speaker.label}
                </Text>
                <Text
                  className="text-[13px] text-label-secondary"
                  style={{ fontVariant: ["tabular-nums"] }}
                  maxFontSizeMultiplier={1.4}
                >
                  {percent}%{duration ? `  ·  ${duration}` : ""}
                </Text>
              </View>
              <Meter
                value={share}
                tone={SPEAKER_BARS[i % SPEAKER_BARS.length] ?? "bg-fill"}
                animate={animate}
                delay={i * 55}
              />
            </>
          );

          const label = `${speaker.label}, ${percent} percent${duration ? `, ${duration}` : ""}`;

          if (!onNameSpeaker) {
            return (
              <View key={speaker.id} className="gap-1.5" accessible accessibilityLabel={label}>
                {row}
              </View>
            );
          }

          return (
            <Pressable
              key={speaker.id}
              onPress={() => onNameSpeaker(speaker.id)}
              accessible
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityHint="Puts a name to this voice"
              // The bars are 6pt and the label is 15pt, so the row's own height
              // is under the 44pt minimum. hitSlop rather than padding, which
              // would change the spacing of a card that is already tuned.
              hitSlop={{ top: 8, bottom: 8 }}
            >
              {({ pressed }) => (
                // The gap lives here and not on the Pressable: with a render-prop
                // child the Pressable has exactly one child, so a gap on it would
                // separate nothing and the meter would sit against its label.
                <View className="gap-1.5" style={{ opacity: pressed ? 0.55 : 1 }}>
                  {row}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Said once, and only while there is still something to fix. */}
      {onNameSpeaker && anyUnnamed ? (
        <Text
          className="text-[13px] leading-[18px] text-label-tertiary"
          maxFontSizeMultiplier={1.6}
        >
          Tap a voice to put a name to it. Names apply to this meeting only.
        </Text>
      ) : null}
    </SectionCard>
  );
}

export interface SummaryViewProps {
  meeting: MeetingDetail;
  /** Open the naming sheet for a voice. Stable across renders. */
  onNameSpeaker?: (speakerId: string) => void;
}

export function SummaryView({ meeting, onNameSpeaker }: SummaryViewProps) {
  // Count-ups and meter fills mark the reveal of the analysis. They run once per
  // meeting per session, never again on a tab flip.
  const animate = useFirstView(meeting.id);

  const summary = meeting.summary;
  const score = meeting.meeting_score;
  const speakers = meeting.transcript?.speakers ?? [];
  const segments = meeting.transcript?.segments ?? [];

  const executive = summary?.executive?.trim();
  const topics = summary?.key_topics ?? [];
  const decisions = summary?.decisions ?? [];
  const questions = summary?.open_questions ?? [];
  const chapters = summary?.chapters ?? [];
  // Absent on a response cached by an older build, and `[]` for most meetings —
  // both mean the same thing here, and both skip the card entirely. An ordinary
  // conversation shows no trace of this feature rather than a section
  // announcing that nothing notable happened, which would be a whole card
  // spent saying nothing.
  const moments = summary?.notable_moments ?? [];

  const hasSummary = Boolean(
    executive ||
    topics.length ||
    decisions.length ||
    questions.length ||
    chapters.length ||
    moments.length,
  );
  const hasSpeakers = speakers.length > 0;

  // Nothing at all. This happens when a meeting completes but analysis produced
  // no output, and it must not render as a screen of empty cards.
  if (!score && !hasSummary && !hasSpeakers) {
    return (
      <EmptyPane
        title="No analysis"
        detail={
          segments.length > 0
            ? "The model did not return a summary for this meeting. The transcript is still there to read."
            : "The model did not return a summary for this meeting."
        }
      />
    );
  }

  // Chapter clocks share the transcript's gutter rule, so the two panes line up.
  const chapterGutter =
    chapters.reduce((max, ch) => Math.max(max, ch.start_sec), 0) >= 3600 ? 58 : 44;

  const cards: React.ReactNode[] = [];
  const next = () => cards.length;

  /**
   * Is this recording long enough for a score to mean anything?
   *
   * An independent design review put it plainly: an 11-second, two-speaker test
   * recording was scoring 9.0 with EFFICIENCY 10, and that number is the largest
   * element on the flagship screen. It is also the first thing every new user
   * generates, because everyone's first recording is a test. A hero element the
   * user can immediately tell is nonsense does not just fail on its own — it
   * lends its doubt to every other AI claim beside it.
   *
   * Two minutes and at least two speakers. Below that there is no participation
   * balance to measure, no topic to stay on, and no pacing to judge: the metrics
   * are arithmetic on a sample too small to carry them. Suppressing is honest;
   * caveating a number that is already on screen is not, because people read the
   * number and not the caveat.
   *
   * The score is still COMPUTED and stored — it is in the API response and on the
   * web — so a meeting that was too short to judge is not permanently unscored.
   * This is a rendering decision about when the number has earned its size.
   */
  const SCORE_MIN_SECONDS = 120;
  const scoreIsMeaningful =
    (meeting.duration_sec ?? 0) >= SCORE_MIN_SECONDS &&
    (meeting.transcript?.speakers?.length ?? 0) >= 2;

  if (executive) {
    cards.push(
      <SectionCard key="executive" animate={animate} index={next()}>
        {/* Violet reads as "the model produced this" in this palette, and appears
            nowhere else in the app.
            It used to say so with a 6pt dot. This is an AI product, so model
            output is most of the value on the screen, and announcing it with the
            smallest mark available was the reason the app read as monochrome:
            the colour was correct, it just never occupied any area. The wash is
            6% so the body text keeps its contrast against --surface. */}
        <View className="-mx-4 -mt-4 mb-1 border-b border-violet/20 bg-violet/[0.06] px-4 pb-3 pt-4">
          {/* "Summary", not "AI summary". Naming the mechanism is the tell a
              summariser is trying to be trusted for being a robot; Granola's
              posture is that the summary simply IS the notes. The violet dot and
              wash still mark it as model-produced — that meaning is carried by
              colour, which is the app's system, without the heading having to
              say "AI" out loud. */}
          <View className="flex-row items-center gap-2">
            <View className="h-1.5 w-1.5 rounded-full bg-violet" />
            <Eyebrow>Summary</Eyebrow>
          </View>
        </View>
        <Text className="text-[17px] leading-[25px] text-label" selectable>
          {executive}
        </Text>
      </SectionCard>,
    );
  }

  if (topics.length) {
    cards.push(
      <SectionCard key="topics" animate={animate} index={next()}>
        <Eyebrow>Topics</Eyebrow>
        <View className="flex-row flex-wrap gap-2">
          {topics.map((topic) => (
            <View
              key={topic}
              className="rounded-chip bg-fill px-2.5 py-1.5"
              style={{ borderCurve: "continuous" }}
            >
              <Text className="text-[13px] text-label-secondary" maxFontSizeMultiplier={1.6}>
                {topic}
              </Text>
            </View>
          ))}
        </View>
      </SectionCard>,
    );
  }

  if (decisions.length) {
    cards.push(
      <SectionCard key="decisions" animate={animate} index={next()}>
        <Eyebrow>Decisions</Eyebrow>
        <BulletList items={decisions} tone="tint" />
      </SectionCard>,
    );
  }

  if (questions.length) {
    cards.push(
      <SectionCard key="questions" animate={animate} index={next()}>
        <Eyebrow>Open questions</Eyebrow>
        <BulletList items={questions} tone="violet" />
      </SectionCard>,
    );
  }

  // After the extractions, before the chapters. Chapters are navigation — a way
  // back into the recording — while this is substance, and burying it under the
  // table of contents would rank it below the least interesting card here.
  if (moments.length) {
    cards.push(
      <MomentsCard
        key="moments"
        moments={moments}
        speakers={speakers}
        animate={animate}
        index={next()}
      />,
    );
  }

  if (chapters.length) {
    cards.push(
      <SectionCard key="chapters" animate={animate} index={next()}>
        <Eyebrow>Chapters</Eyebrow>
        <View className="gap-3.5">
          {chapters.map((chapter) => (
            <View key={`${chapter.start_sec}-${chapter.title}`} className="flex-row gap-3">
              <Text
                className="shrink-0 pt-px text-[13px] text-tint"
                style={{ width: chapterGutter, fontVariant: ["tabular-nums"] }}
                maxFontSizeMultiplier={1.2}
              >
                {formatClock(chapter.start_sec)}
              </Text>
              <View className="flex-1 gap-1">
                <Text className="text-[15px] font-semibold text-label" selectable>
                  {chapter.title}
                </Text>
                {chapter.summary?.trim() ? (
                  <Text className="text-[14px] leading-[20px] text-label-secondary" selectable>
                    {chapter.summary}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </SectionCard>,
    );
  }

  if (hasSpeakers) {
    cards.push(
      <SpeakersCard
        key="speakers"
        speakers={speakers}
        animate={animate}
        index={next()}
        onNameSpeaker={onNameSpeaker}
      />,
    );
  }

  /**
   * LAST, and only when it has earned it.
   *
   * It used to be first — the largest element above everything else. But a score
   * is a judgement ABOUT the meeting, and everything above it is the meeting
   * itself: what was said, what was decided, who owes what. People open a
   * recording to retrieve those, not to be graded. Granola leads with decisions
   * and next steps for exactly this reason; leading with a self-assessment was
   * the structural reason this screen lost to it.
   *
   * Demoted rather than deleted: for a real hour-long meeting the breakdown is
   * genuinely useful, and it is the one view that says a meeting was lopsided.
   * It just does not go first, and it does not go at all when the recording was
   * too short to support it.
   */
  if (score && scoreIsMeaningful) {
    cards.push(<ScoreCard key="score" score={score} animate={animate} index={next()} />);
  }

  return (
    <View className="gap-3 px-4 pb-8">
      {cards}

      {/* Partial result: the pipeline scored the meeting but returned no prose.
          Saying so is better than a stack that just stops. */}
      {!hasSummary ? (
        <Notice
          title="No written summary"
          detail={
            segments.length > 0
              ? "Only the score came back for this meeting. The transcript is still there to read."
              : "Only the score came back for this meeting."
          }
        />
      ) : null}

      {segments.length > 0 ? (
        <Text
          className="px-1 pt-1 text-[13px] text-label-tertiary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {pluralize(segments.length, "transcript segment")}
          {hasSpeakers ? `  ·  ${pluralize(speakers.length, "speaker")}` : ""}
        </Text>
      ) : null}
    </View>
  );
}
