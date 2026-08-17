import { useCallback, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useReducedMotion,
} from "react-native-reanimated";
import { router, Stack, useLocalSearchParams } from "expo-router";

import { useMeetingDetail, type TranscriptSegment } from "@/lib/api/meeting-detail";
import { isProcessing } from "@/lib/api/meetings";
import { failUpload, useUploadState } from "@/lib/api/upload-progress";
import { retryUpload } from "@/lib/audio/segment-upload";
import { useMeetingPlayback } from "@/lib/audio/playback";
import { displayTitle, formatDuration, formatListDate } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { SPRING, TIMING } from "@/lib/motion";
import { useFollowScroll } from "@/components/player/follow-scroll";
import { PlayerBar } from "@/components/player/player-bar";
import { RibbonScrubber } from "@/components/player/ribbon-scrubber";
import { MeetingMenuButton } from "@/components/meeting/meeting-menu";
import { NameSpeakerSheet } from "@/components/meeting/name-speaker";
import { dismissShareToast, useShareToastNote } from "@/components/meeting/share-toast";
import { FailureCard, ProcessingView } from "@/components/meeting/processing-view";
import { SummaryView } from "@/components/meeting/summary-view";
import { TranscriptView } from "@/components/meeting/transcript-view";

type Tab = "summary" | "transcript";

/** Legend swatches — the class form of SPEAKER_TOKENS in components/ribbon. */
const SPEAKER_DOT = [
  "bg-speaker-a",
  "bg-speaker-b",
  "bg-speaker-c",
  "bg-speaker-d",
  "bg-speaker-e",
] as const;

/**
 * Segmented control.
 *
 * The indicator moves with a spring rather than a timing curve so it tracks the
 * way UISegmentedControl does. chrome is critically damped — this is a
 * high-frequency control and any bounce becomes irritating by the tenth tap.
 */
function Segmented({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: "summary", label: "Summary" },
    { key: "transcript", label: "Transcript" },
  ];

  return (
    <View
      className="mx-4 mb-4 flex-row rounded-control bg-surface p-1"
      style={{ borderCurve: "continuous" }}
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (active) return;
              haptics.select();
              onChange(tab.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            className="flex-1 items-center justify-center py-2"
            // py-2 around a 15pt line gave a ~36pt target, under the 44pt
            // minimum. Stated as a floor rather than as more padding so the
            // segment cannot fall back under it at a smaller Dynamic Type size.
            // Same fix as the Actions filter, which had the identical bug.
            style={{ minHeight: 44 }}
          >
            {active ? (
              <Animated.View
                // layout animation moves the fill between segments instead of
                // cross-fading two separate pills
                layout={LinearTransition.springify()
                  .damping(SPRING.chrome.damping)
                  .stiffness(SPRING.chrome.stiffness)}
                className="absolute inset-0 rounded-control bg-fill"
                style={{ borderCurve: "continuous" }}
              />
            ) : null}
            <Text
              className={`text-[15px] font-semibold ${
                active ? "text-label" : "text-label-secondary"
              }`}
              maxFontSizeMultiplier={1.4}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * How long a confirmation stays up.
 *
 * Long enough to read three words after the action sheet's own dismissal
 * animation has finished, short enough that it is gone before the user's next
 * tap lands anywhere near it.
 */
const TOAST_MS = 2200;

/**
 * "Summary copied" / "Sharing turned off".
 *
 * Drawn here rather than by the menu because the menu button lives inside the
 * native navigation bar, which would clip it. It reads its message from an
 * external store (components/meeting/share-toast) so showing one does not
 * re-render this screen — and this screen's render is the whole transcript.
 *
 * Local to the route for the same reason Segmented is: it has one caller, one
 * screen, and no life outside it.
 */
function ShareToast({ bottomInset }: { bottomInset: number }) {
  const note = useShareToastNote();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!note) return;

    // Announced as well as drawn. The action sheet has just dismissed, which
    // puts VoiceOver focus back on the header button, and a view that merely
    // appears near the bottom of the screen is never read — the same pairing,
    // and the same reason, as AuthFormError.
    AccessibilityInfo.announceForAccessibility(note.message);

    const timer = setTimeout(dismissShareToast, TOAST_MS);
    // Keyed on the note's id, so a second confirmation gets a full window
    // rather than inheriting what was left of the first one's.
    return () => clearTimeout(timer);
  }, [note]);

  // The store is module scope, so a note still standing when this screen goes
  // away outlives the meeting it was about — leaving the next meeting opened to
  // flash "Summary copied" for a summary nobody copied. Clearing the timer
  // above is not enough; the note itself has to go.
  useEffect(() => {
    return () => dismissShareToast();
  }, []);

  if (!note) return null;

  return (
    <Animated.View
      key={note.id}
      // FadeInDown starts 25pt BELOW its resting place and rises into it, which
      // is the right direction for something entering from the bottom edge.
      // Opacity and translate only; nothing here animates layout.
      entering={reduceMotion ? undefined : FadeInDown.duration(220)}
      exiting={reduceMotion ? undefined : FadeOut.duration(160)}
      className="absolute inset-x-4 items-center"
      style={{ bottom: bottomInset }}
      // Never eats a tap. It sits over the transcript and the player, and a
      // confirmation that swallows the play button for two seconds is worse
      // than no confirmation at all.
      pointerEvents="none"
    >
      <View
        className="rounded-control border border-edge bg-elevated px-4 py-2.5"
        style={{ borderCurve: "continuous" }}
      >
        <Text
          className="text-[14px] font-medium text-label"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={1.4}
        >
          {note.message}
        </Text>
      </View>
    </Animated.View>
  );
}

/** Stable empty identity, so the span memo does not recompute on every poll. */
const NO_SEGMENTS: TranscriptSegment[] = [];

/**
 * The upload from this device failed, and the user is standing on the meeting.
 *
 * This state has to exist here rather than as an Alert, because by the time it
 * happens the screen that started the upload is gone — ending a recording
 * navigates immediately and the transfer finishes behind the user. An alert
 * fired from a screen they left is not an option.
 *
 * Distinct from ProcessingView's failure card, which is about the SERVER
 * pipeline failing on audio it already has. Here the audio never arrived, it is
 * still on this iPhone, and the only useful thing on screen is the button that
 * sends it again. Without this the meeting would sit at `queued` forever,
 * looking like it was waiting for a worker.
 */
function UploadFailedCard({ meetingId, error }: { meetingId: string; error?: string }) {
  const [retrying, setRetrying] = useState(false);

  const retry = useCallback(() => {
    setRetrying(true);
    void (async () => {
      try {
        const started = await retryUpload(meetingId);
        if (!started) {
          // Nothing on disk to send. Saying so is better than a button that
          // appears to do nothing every time it is pressed.
          failUpload(
            meetingId,
            "The audio for this recording is no longer on this iPhone, so it cannot be uploaded again.",
          );
        }
      } catch {
        // retryUpload reports its own failure through the progress store, which
        // is what re-renders this card with the new message.
      } finally {
        setRetrying(false);
      }
    })();
  }, [meetingId]);

  return (
    <View className="mx-4 gap-3 rounded-card bg-surface p-5" style={{ borderCurve: "continuous" }}>
      <Text className="text-[17px] font-semibold text-danger">Upload didn&apos;t finish</Text>
      <Text className="text-[15px] leading-[21px] text-label-secondary" selectable>
        {error ?? "The recording could not be sent."}
      </Text>
      <Text className="text-[13px] leading-[18px] text-label-tertiary">
        The audio is still on this iPhone, so nothing was lost.
      </Text>
      <Pressable
        onPress={retry}
        disabled={retrying}
        accessibilityRole="button"
        accessibilityLabel="Try uploading again"
        accessibilityState={{ disabled: retrying }}
        className="mt-1 min-h-[50px] items-center justify-center rounded-full bg-label px-6 active:opacity-80"
      >
        {retrying ? (
          <ActivityIndicator color="#06070A" />
        ) : (
          <Text className="text-[17px] font-semibold text-background" maxFontSizeMultiplier={1.6}>
            Try again
          </Text>
        )}
      </Pressable>
    </View>
  );
}

export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: meeting, isLoading, isError } = useMeetingDetail(id);
  const [tab, setTab] = useState<Tab>("summary");

  /**
   * An upload this device still owns for this meeting.
   *
   * Read here as well as inside ProcessingView because the FAILED case has to
   * pre-empt it: a meeting whose audio never arrived reports `queued` from the
   * server, which the processing view would render as "waiting for a free
   * worker" — a stall the user cannot act on, in place of the retry they need.
   */
  const upload = useUploadState(id);
  const uploadFailed = upload?.status === "failed";

  /**
   * The voice whose naming sheet is open, by raw diarization id ("A").
   *
   * Held here rather than in each pane because all three entry points — the
   * ribbon legend, the "Who talked" bars, and the speaker name on a transcript
   * turn — open the same sheet, and two of them live inside panes that unmount
   * when the segmented control flips. The sheet is a Modal, so it survives
   * that, but only if the state that opens it does too.
   */
  const [namingId, setNamingId] = useState<string | null>(null);

  // Stable, because it is handed to 800 memoised transcript rows. A fresh
  // identity on every five second poll would re-render all of them.
  const nameSpeaker = useCallback((speakerId: string) => {
    haptics.tap();
    setNamingId(speakerId);
  }, []);
  const closeNaming = useCallback(() => setNamingId(null), []);

  /**
   * Playback.
   *
   * Both of these are external stores rather than React state, so nothing they
   * do re-renders this screen — which matters because this render includes the
   * whole transcript. See the notes in lib/audio/playback and
   * components/player/follow-scroll.
   *
   * Declared above the early returns because hooks cannot be conditional, and
   * fed defaults until the meeting arrives.
   */
  const segments = meeting?.transcript?.segments ?? NO_SEGMENTS;
  const playback = useMeetingPlayback({
    meetingId: id,
    hasAudio: meeting?.has_audio ?? false,
    durationSec: meeting?.duration_sec ?? null,
  });
  const follow = useFollowScroll({ hasPlayer: meeting?.has_audio ?? false });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator accessibilityLabel="Loading meeting" />
      </View>
    );
  }

  if (isError || !meeting) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text className="text-center text-[17px] font-semibold text-label">
          This meeting is no longer available.
        </Text>
      </View>
    );
  }

  const meta = [
    formatListDate(meeting.recorded_at ?? meeting.created_at),
    formatDuration(meeting.duration_sec),
  ]
    .filter(Boolean)
    .join(" · ");

  const processing = isProcessing(meeting.status);
  const title = displayTitle(meeting.title, meeting.recorded_at ?? meeting.created_at);

  /**
   * Leave the screen as soon as the undo window opens.
   *
   * The request itself is deferred, so the meeting is still readable for a few
   * more seconds — but sitting on the detail view of something you just deleted,
   * watching it work, is not a state worth offering. The undo affordance is
   * waiting on the row in the list behind this screen.
   *
   * `canGoBack` because this route is reachable from a notification tap on a
   * cold start, where there is no list underneath and `back()` would do nothing.
   */
  const leaveAfterDelete = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/meetings");
  };

  // The ribbon reads a CONVERSATION. With a single speaker it degenerates into
  // a plain bar that carries no information and looks like a stalled progress
  // indicator, so it only earns its place from two speakers up.
  const speakerCount = meeting.transcript?.speakers.length ?? 0;
  const showRibbon = speakerCount >= 2 && (meeting.transcript?.segments.length ?? 0) > 0;

  // Resolved rather than stored, so a poll that renames a voice from another
  // device updates the open sheet instead of leaving it on a stale label.
  const naming = meeting.transcript?.speakers.find((s) => s.id === namingId) ?? null;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <MeetingMenuButton
              meeting={meeting}
              title={title}
              onDeleteScheduled={leaveAfterDelete}
            />
          ),
        }}
      />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        // Clears the floating player card and the tab bar beneath it, so the
        // last lines of a transcript are readable rather than parked under the
        // transport.
        //
        // contentPadding, NOT bottomInset. "automatic" already insets this
        // content by the home indicator, so bottomInset (which also includes the
        // bar and player) would count the home indicator twice. But the tab bar
        // here is a JS overlay UIKit does not know about, so contentPadding keeps
        // the bar's reserve in — it is bottomInset minus only the home indicator.
        contentContainerStyle={{ paddingBottom: follow.contentPadding }}
        /**
         * The ribbon pins instead of scrolling away.
         *
         * It is the one element here that beats both competitors — the timeline
         * you scrub IS the diarization map — and it was spending that advantage
         * on 28pt of decoration you saw once. The moment you scrolled into the
         * transcript, which is the whole reason you opened the meeting, the map
         * was gone and the only thing left was a 6pt strip in the player bar.
         *
         * Pinned, it becomes the navigation spine: wherever you are in an hour
         * of transcript, "take me back to where Priya was talking" stays a thumb
         * drag away. The follow-scroll already moves the transcript to the
         * playhead, so a scrub from the pinned strip drives the reading position
         * too — the two halves of the feature only connect once the strip is
         * reachable from anywhere in the document.
         *
         * Index 1, not 0: the meta line is its own child so the pinned band is
         * the ribbon alone. Only set when the ribbon actually renders — a null
         * child is dropped from the children array, so a fixed [1] would pin the
         * segmented control on single-speaker meetings.
         */
        /**
         * Pinned only where it earns its ~79pt.
         *
         * Three conditions, and it previously satisfied only the first:
         *
         *   `showRibbon` — there are bands to draw at all.
         *
         *   `has_audio` — RibbonScrubber degrades to a STATIC strip with no
         *   gesture when there is nothing to play (see its `available` guard).
         *   Pinning an inert colour bar to the top of a transcript-only meeting
         *   is pure cost.
         *
         *   `tab === "transcript"` — the Summary pane has no timeline to scrub
         *   to, so on Summary the strip was permanent chrome serving nothing.
         *
         * The tab condition also fixes the worse half: the segmented control is
         * the NEXT child, so pinning the ribbon let the screen's actual
         * navigation scroll away while the decoration stayed. Now Summary keeps
         * its controls reachable, and the map only pins on the pane it maps.
         */
        stickyHeaderIndices={
          showRibbon && meeting.has_audio && tab === "transcript" ? [1] : undefined
        }
        {...follow.scrollProps}
      >
        <View className="px-4 pb-3 pt-1">
          <Text
            className="text-[13px] text-label-secondary"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {meta}
          </Text>
        </View>

        {/* The signature, at hero size. Only meaningful once diarization has
            produced segments, so it holds a placeholder bar while processing
            rather than disappearing and shifting the layout. */}
        {showRibbon ? (
          // Opaque, because a pinned header is the one view in a scroll
          // container that has content moving underneath it. Transparent, the
          // transcript reads straight through the bands.
          //
          // The hairline is not decoration. Without it the pinned block has no
          // bottom edge, so a chapter title passing beneath it is simply sliced
          // in half mid-word and reads as a rendering fault rather than as
          // content going under chrome. Measured on the 30-minute fixture: the
          // word "Timeline" and its "0:00" timestamp were bisected with nothing
          // to explain the cut. One border resolves it — the same `--edge` the
          // cards already use, so the strip joins the existing surface language
          // instead of introducing a new one.
          <View className="gap-2 border-b border-edge bg-background px-4 pb-3">
            {/* Scrubbable when there is audio, identical to before when there
                  is not. Dragging along the bands is the point of the feature:
                  the colours say WHO you are scrubbing to, which is the one
                  thing an amplitude waveform can never tell you. */}
            <RibbonScrubber
              playback={playback}
              segments={meeting.transcript?.segments ?? []}
              speakers={meeting.transcript?.speakers ?? []}
              height={28}
              radius={8}
            />
            {/* The legend is also the naming control. It sits directly under
                  the bands, which is where a reader first asks who the colours
                  are — and the answer being "Speaker A" is exactly the problem
                  worth fixing at that moment. */}
            {meeting.transcript?.speakers.length ? (
              <View className="flex-row flex-wrap gap-x-4 gap-y-1">
                {meeting.transcript.speakers.map((s, i) => (
                  <Pressable
                    key={s.id}
                    onPress={() => nameSpeaker(s.id)}
                    accessibilityRole="button"
                    accessibilityLabel={s.label}
                    accessibilityHint="Puts a name to this voice"
                    hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                  >
                    {({ pressed }) => (
                      <View
                        className="flex-row items-center gap-1.5"
                        style={{ opacity: pressed ? 0.5 : 1 }}
                      >
                        <View
                          className={`h-2 w-2 rounded-full ${SPEAKER_DOT[i % SPEAKER_DOT.length]}`}
                        />
                        <Text
                          className="text-[11px] text-label-secondary"
                          // Capped and clipped: this sits in a PINNED block,
                          // and a named speaker ("Priya Raghunathan") wraps
                          // the flex-wrap legend to a second and third row —
                          // so the header grows precisely as someone adopts
                          // the naming feature the legend exists to sell.
                          maxFontSizeMultiplier={1.2}
                          numberOfLines={1}
                        >
                          {s.label}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {processing && uploadFailed ? (
          <UploadFailedCard meetingId={id} error={upload?.error} />
        ) : processing ? (
          <ProcessingView meeting={meeting} />
        ) : meeting.status === "failed" ? (
          // The SAME card ProcessingView shows, not a second copy of it. This
          // used to be an inline duplicate with no retry, so the working retry
          // button — which lives in FailureCard — was unreachable for exactly
          // the case it exists for: a meeting that has already failed.
          <FailureCard
            meetingId={id}
            reason={meeting.failure_reason ?? null}
            hasAudio={meeting.has_audio}
          />
        ) : (
          <>
            <Segmented value={tab} onChange={setTab} />
            {/* Cross-fade between panes. Exiting is faster than entering — the
                universal rule; a slow exit reads as lag. */}
            <Animated.View
              key={tab}
              entering={FadeIn.duration(TIMING.crossfade.duration)}
              exiting={FadeOut.duration(120)}
            >
              {tab === "summary" ? (
                <SummaryView meeting={meeting} onNameSpeaker={nameSpeaker} />
              ) : (
                <TranscriptView
                  meeting={meeting}
                  playback={playback}
                  follow={follow}
                  onNameSpeaker={nameSpeaker}
                />
              )}
            </Animated.View>
          </>
        )}
      </ScrollView>

      {/* Renders nothing for a transcript-only meeting. A play button that
          cannot play is worse than no player at all. */}
      {processing ? null : <PlayerBar meeting={meeting} playback={playback} follow={follow} />}

      {/* Above the transport and the tab bar, on the same measured inset the
          content already clears, so it can never land under either. */}
      <ShareToast bottomInset={follow.bottomInset} />

      {/* Mounted only while open, so each presentation gets fresh shared values
          and a fresh layout pass — the same reason the header menu mounts its
          sheet rather than toggling a prop on a permanent one. */}
      {naming ? (
        <NameSpeakerSheet meeting={meeting} speaker={naming} onDismissed={closeNaming} />
      ) : null}
    </View>
  );
}
