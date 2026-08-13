import { Text, View } from "react-native";

import type { MeetingDetail } from "@/lib/api/meeting-detail";
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

/** Talk-time distribution — the one visual the transcript itself cannot give you. */
function SpeakersCard({
  speakers,
  animate,
  index,
}: {
  speakers: NonNullable<MeetingDetail["transcript"]>["speakers"];
  animate: boolean;
  index: number;
}) {
  const total = speakers.reduce((sum, s) => sum + Math.max(0, s.talk_time_sec), 0);

  return (
    <SectionCard animate={animate} index={index}>
      <Eyebrow>Who talked</Eyebrow>
      <View className="gap-3">
        {speakers.map((speaker, i) => {
          const share = total > 0 ? Math.max(0, speaker.talk_time_sec) / total : 0;
          const percent = Math.round(share * 100);
          const duration = formatDuration(speaker.talk_time_sec);

          return (
            <View
              key={speaker.id}
              className="gap-1.5"
              accessible
              accessibilityLabel={`${speaker.label}, ${percent} percent${
                duration ? `, ${duration}` : ""
              }`}
            >
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
            </View>
          );
        })}
      </View>
    </SectionCard>
  );
}

export function SummaryView({ meeting }: { meeting: MeetingDetail }) {
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

  const hasSummary = Boolean(
    executive || topics.length || decisions.length || questions.length || chapters.length,
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

  if (score) {
    cards.push(<ScoreCard key="score" score={score} animate={animate} index={next()} />);
  }

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
          <View className="flex-row items-center gap-2">
            <View className="h-1.5 w-1.5 rounded-full bg-violet" />
            <Eyebrow>AI summary</Eyebrow>
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
      <SpeakersCard key="speakers" speakers={speakers} animate={animate} index={next()} />,
    );
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
