import { Text, View } from "react-native";

import type { MeetingDetail } from "@/lib/api/meeting-detail";
import { formatClock, formatDuration, pluralize } from "@/lib/format";
import { displayNumber } from "@/lib/type";

/** Uppercase micro-eyebrow — the most portable piece of the web app's identity. */
function Eyebrow({ children }: { children: string }) {
  return (
    <Text
      className="text-[11px] font-semibold uppercase text-label-secondary"
      style={{ letterSpacing: 0.8 }}
      maxFontSizeMultiplier={1.4}
    >
      {children}
    </Text>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      className="gap-3 rounded-card bg-surface p-5"
      style={{ borderCurve: "continuous" }}
    >
      {children}
    </View>
  );
}

/**
 * Meeting score.
 *
 * Deliberately the visual anchor of the screen: one large number carries more
 * weight than a paragraph, and it is the only place the app makes a judgement
 * rather than a transcription. Score is out of 10, not 100.
 */
function ScoreCard({ score }: { score: NonNullable<MeetingDetail["meeting_score"]> }) {
  const pct = Math.max(0, Math.min(1, score.total / 10));

  return (
    <Card>
      <Eyebrow>Meeting score</Eyebrow>

      <View className="flex-row items-end gap-1.5">
        <Text className="text-[52px] leading-[56px] text-label" style={displayNumber}>
          {score.total.toFixed(1)}
        </Text>
        <Text className="pb-2 text-[17px] text-label-tertiary">/ 10</Text>
      </View>

      {/* Data as decoration — the bar gives the number somewhere to live. */}
      <View className="h-1.5 overflow-hidden rounded-full bg-fill">
        <View className="h-full rounded-full bg-tint" style={{ width: `${pct * 100}%` }} />
      </View>

      <Text className="text-[15px] leading-[21px] text-label-secondary" selectable>
        {score.explanation}
      </Text>
    </Card>
  );
}

/** Talk-time distribution — turns speaker data into the screen's second visual. */
function SpeakersCard({ speakers }: { speakers: MeetingDetail["transcript"] }) {
  if (!speakers || speakers.speakers.length === 0) return null;

  const total = speakers.speakers.reduce((sum, s) => sum + s.talk_time_sec, 0);
  if (total <= 0) return null;

  const BAR = ["bg-speaker-a", "bg-speaker-b", "bg-speaker-c", "bg-speaker-d", "bg-speaker-e"];

  return (
    <Card>
      <Eyebrow>Who talked</Eyebrow>
      <View className="gap-3">
        {speakers.speakers.map((s, i) => {
          const share = s.talk_time_sec / total;
          return (
            <View key={s.id} className="gap-1.5">
              <View className="flex-row items-baseline justify-between">
                <Text className="text-[15px] font-medium text-label">{s.label}</Text>
                <Text
                  className="text-[13px] text-label-secondary"
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  {Math.round(share * 100)}% · {formatDuration(s.talk_time_sec) ?? "—"}
                </Text>
              </View>
              <View className="h-1.5 overflow-hidden rounded-full bg-fill">
                <View
                  className={`h-full rounded-full ${BAR[i % BAR.length]}`}
                  style={{ width: `${Math.max(share * 100, 2)}%` }}
                />
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function BulletList({ items, tone }: { items: string[]; tone: "tint" | "violet" }) {
  return (
    <View className="gap-2.5">
      {items.map((item, i) => (
        <View key={i} className="flex-row gap-2.5">
          <View
            className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
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

export function SummaryView({ meeting }: { meeting: MeetingDetail }) {
  const summary = meeting.summary;

  return (
    <View className="gap-3 px-4 pb-8">
      {meeting.meeting_score ? <ScoreCard score={meeting.meeting_score} /> : null}

      {summary?.executive ? (
        <Card>
          {/* Violet reads as "the AI did something" in this palette. */}
          <View className="flex-row items-center gap-2">
            <View className="h-1.5 w-1.5 rounded-full bg-violet" />
            <Eyebrow>AI summary</Eyebrow>
          </View>
          <Text className="text-[17px] leading-[25px] text-label" selectable>
            {summary.executive}
          </Text>
        </Card>
      ) : null}

      {summary?.key_topics.length ? (
        <Card>
          <Eyebrow>Topics</Eyebrow>
          <View className="flex-row flex-wrap gap-2">
            {summary.key_topics.map((topic) => (
              <View
                key={topic}
                className="rounded-chip bg-fill px-2.5 py-1.5"
                style={{ borderCurve: "continuous" }}
              >
                <Text className="text-[13px] text-label-secondary">{topic}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {summary?.decisions.length ? (
        <Card>
          <Eyebrow>Decisions</Eyebrow>
          <BulletList items={summary.decisions} tone="tint" />
        </Card>
      ) : null}

      {summary?.open_questions.length ? (
        <Card>
          <Eyebrow>Open questions</Eyebrow>
          <BulletList items={summary.open_questions} tone="violet" />
        </Card>
      ) : null}

      {summary?.chapters.length ? (
        <Card>
          <Eyebrow>Chapters</Eyebrow>
          <View className="gap-3">
            {summary.chapters.map((ch) => (
              <View key={`${ch.start_sec}-${ch.title}`} className="flex-row gap-3">
                <Text
                  className="w-[52px] shrink-0 text-[13px] text-tint"
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  {formatClock(ch.start_sec)}
                </Text>
                <View className="flex-1 gap-0.5">
                  <Text className="text-[15px] font-medium text-label">{ch.title}</Text>
                  <Text className="text-[14px] leading-[20px] text-label-secondary">
                    {ch.summary}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <SpeakersCard speakers={meeting.transcript} />

      {meeting.transcript?.segments.length ? (
        <Text className="px-1 text-[13px] text-label-tertiary">
          {pluralize(meeting.transcript.segments.length, "transcript segment")}
        </Text>
      ) : null}
    </View>
  );
}
