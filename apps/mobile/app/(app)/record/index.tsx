import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  FadeIn,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { useQueryClient } from "@tanstack/react-query";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { File } from "expo-file-system";

import { useRecorder } from "@/lib/audio/use-recorder";
import { uploadRecording } from "@/lib/audio/upload";
import { ensureNotificationPermission } from "@/lib/notifications";
import {
  endRecordingActivity,
  startRecordingActivity,
  subscribeToRecordingControls,
  updateRecordingActivity,
  type RecordingControl,
} from "@/lib/live-activity";
import { formatClock, isPlaceholderTitle } from "@/lib/format";
import { RecordOrb, type OrbPhase } from "@/components/record-orb";

/** Tagged so the release targets this screen's lock and not someone else's. */
const KEEP_AWAKE_TAG = "echobrief-recording";

/* ---------------------------------------------------------------------------
 * Vertical budget.
 *
 * The orb is the only elastic thing on this screen, so it is sized from what is
 * actually left over rather than from a blanket fraction of the viewport. A
 * fraction cannot serve both a 874pt phone and a 667pt SE: whichever factor
 * makes the orb fill a tall screen overflows the short one, and whichever fits
 * the short one leaves a tall screen looking like three objects floating in a
 * void, which is the state this screen was in.
 *
 * Every constant below is a real measured height of something that is not the
 * orb. They are laid out as a genuine sum, so if a control's height changes the
 * orb absorbs it instead of the layout silently going 8pt over.
 * ------------------------------------------------------------------------- */

/** The READY / RECORDING eyebrow row. Fixed so the row does not jump on state. */
const EYEBROW_H = 20;
/** Eyebrow to title field. */
const HEADER_GAP = 12;
/** Title field, min height. Grows under Dynamic Type; the orb pays for that. */
const TITLE_H = 48;
/**
 * Orb to timer.
 *
 * Deliberately small. These are one instrument — a dial and its readout — and
 * at the 32pt they used to sit at the timer read as a third unrelated object
 * rather than as the orb's reading. Measured off the render: the light reaches
 * to within ~6pt of its layout box, and the timer's 62pt line box carries ~15pt
 * of leading over the digits, so 12pt here is ~22pt of visible gap.
 */
const GROUP_GAP = 12;
/** The 56px timer's line box. */
const TIMER_H = 62;
/**
 * Fixed gap between the instrument and the controls.
 *
 * Sixteen, down from 24. This is a FLOOR, not the gap you see: the instrument is
 * centred in the leftover, so whatever slack the screen has is already sitting
 * on top of it. Every point taken off here goes to the orb instead, and the
 * separation between the readout and the button is carried by that slack.
 */
const CTA_GAP = 16;
/**
 * The controls block at its TALLEST — the recording state, with Discard.
 *
 * Budgeted at its maximum in every state on purpose. Sizing the orb against the
 * idle block instead would shrink the orb by 60pt the instant recording starts,
 * which is a resize of the one element the user is looking at, triggered by the
 * one action they care about.
 */
const CONTROLS_H = 64 + 16 + 44;
/**
 * Minimum air above and below the instrument, in the tightest state.
 *
 * 24, so 12 above and 12 below while recording. It was 56, and every point of it
 * was reserved slack that the orb was forbidden to use: the screen measured 96pt
 * of nothing between the timer and the button and 65pt below the button, on a
 * screen with five elements on it. The orb's light runs to within ~6pt of its
 * box, so 12pt of layout air still reads as air rather than as a collision.
 */
const BREATHING = 24;

/**
 * How far the orb stays clear of the screen's own edges.
 *
 * The orb is allowed OUTSIDE the 24pt content padding every other element obeys.
 * It is not an element in a column, it is the background of the screen doing
 * one job, and the light falls off to the canvas colour at the edge of its own
 * box, so a wider orb reads as a bigger source rather than as something
 * touching the frame. 8pt of margin is there so it never quite kisses the
 * bezel.
 *
 * There is no separate maximum. Portrait iPhone is the only geometry this app
 * runs in (app.json pins orientation and disables tablets), so the widest the
 * orb can ever be is a 440pt Max short edge, and capping below that would just
 * reintroduce the void on the biggest screens. The height bound below is the
 * real limit on every device that has one.
 */
const ORB_SIDE_BLEED = 8;
/** Floor. Below this the orb stops being a hero and should just be small. */
const ORB_MIN = 168;

const CHROME_H =
  EYEBROW_H + HEADER_GAP + TITLE_H + GROUP_GAP + TIMER_H + CTA_GAP + CONTROLS_H + BREATHING;

/** --label-tertiary, dark ramp. app.json pins userInterfaceStyle to "dark", the
 *  same constraint components/player/glyphs already carries. */
const GLYPH_DIM = "#787C85";

/**
 * The edit affordance.
 *
 * The title used to be a borderless 22px TextInput and nothing else, which
 * rendered "Thu, Aug 13 at 3:47 AM" as what looks exactly like a date stamp.
 * Nobody taps a date stamp. The field around it does most of the work now; this
 * removes the last of the doubt about whether the text is yours to change.
 */
function PencilGlyph({ size = 15, color = GLYPH_DIM }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Path
        d="M12.1 1.6l2.3 2.3-1.7 1.7-2.3-2.3zM9.6 4.1l2.3 2.3-6.6 6.6-3.1.8.8-3.1z"
        fill={color}
      />
    </Svg>
  );
}

function defaultTitle(): string {
  return new Date().toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Pulsing dot beside the RECORDING label.
 *
 * Holds still when paused: a blinking light next to the word "Paused" says two
 * contradictory things, and pause has to be unambiguous — this is the control
 * people reach for when someone says something off the record.
 */
function RecordingDot({ live }: { live: boolean }) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!live) {
      pulse.value = withTiming(0.4, { duration: 200, reduceMotion: ReduceMotion.System });
      return;
    }
    pulse.value = withRepeat(
      withTiming(0.25, { duration: 900, reduceMotion: ReduceMotion.System }),
      -1,
      true,
    );
  }, [pulse, live]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return <Animated.View className="h-2 w-2 rounded-full bg-danger" style={style} />;
}

export default function RecordScreen() {
  const recorder = useRecorder();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(defaultTitle);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const startedAt = useRef<Date | null>(null);

  const recording = recorder.state === "recording";
  const paused = recorder.state === "paused";
  const active = recording || paused;
  const phase: OrbPhase = recording ? "recording" : paused ? "paused" : "armed";

  /**
   * Top inset, measured rather than guessed.
   *
   * This was `pt-16` — a hardcoded 64pt that happened to clear the 62pt inset on
   * the device it was written on by two points. There is no header on this
   * route, so nothing else on the screen handles the inset and there is nothing
   * to catch it when it is wrong; a 12pt gap under a 59pt inset is a 71pt
   * padding, and the constant would have put the eyebrow 7pt inside the sensor
   * housing.
   */
  const topPad = insets.top + 12;

  /**
   * Bottom inset, measured the same way as the top one.
   *
   * `insets.bottom` on a screen inside the native tab bar is ALREADY the
   * distance to the bar's top edge: 83pt here, being the 49pt bar plus the 34pt
   * home indicator. `useTabBarInset()` adds the bar's height again, which put
   * this screen's padding at 148 for a requested 16 and left the Start button
   * hanging 65pt above the tab bar with nothing in between. Confirmed in device
   * pixels; the player and the Ask composer had the same 49pt hole for the same
   * reason. See components/player/metrics for the full note.
   */
  const bottomPad = insets.bottom + 16;

  /**
   * The orb takes what is left, and what is left is arithmetic.
   *
   * See CHROME_H. The height bound is the whole content column minus everything
   * that is not the orb; the width bound is the screen itself, less a hair of
   * margin, because the orb is allowed to bleed past the content padding.
   *
   *   402x874  -> 383  (height binds; width would allow 386)
   *   393x852  -> 364  (height binds)
   *   440x956  -> 424  (width binds)
   *   375x667  -> 252  (height binds — the shortest device this app supports)
   *
   * Which leaves 12pt of air above and below the instrument in the recording
   * state wherever height binds, and ~42pt idle, where the difference is the
   * seat kept warm for Discard. It was 28 and ~58 against a bottom inset that
   * counted the tab bar twice, and the idle figure was the 96pt hole the review
   * measured between the timer and the button.
   *
   * ORB_MIN never binds on a supported geometry; it is there so that an
   * unforeseen one renders a small orb rather than a zero-width view.
   */
  const { width, height } = useWindowDimensions();
  const orbSize = Math.round(
    Math.max(ORB_MIN, Math.min(width - ORB_SIDE_BLEED * 2, height - topPad - bottomPad - CHROME_H)),
  );

  // A recording screen that sleeps mid-meeting is a broken recording screen —
  // but only WHILE recording.
  //
  // `useKeepAwake()` was unconditional here, and NativeTabs keeps tab screens
  // mounted for the life of the app. So visiting the Record tab once stopped the
  // device auto-locking anywhere in the app, for the rest of the session. That
  // is a battery and privacy bug, not a recording feature.
  useEffect(() => {
    if (!active) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {
        // Already released, or never acquired because activation lost a race
        // with a fast stop. Nothing to recover.
      });
    };
  }, [active]);

  // Depend on the two stable pieces rather than the whole recorder object.
  // reset is useCallback'd with no deps, and state does not change when reset
  // runs, so this settles after one pass instead of re-firing forever.
  const { state: recorderState, reset: resetRecorder } = recorder;
  useFocusEffect(
    useCallback(() => {
      // Tab screens stay mounted, so without this the previous recording's
      // duration and waveform are still on screen when you come back.
      if (recorderState === "idle") resetRecorder();
    }, [recorderState, resetRecorder]),
  );

  /**
   * Whether this screen is the one on screen.
   *
   * NativeTabs keeps every tab's screen mounted, so the orb's clockwork — two
   * infinite repeat loops and eight animated SVG layers — kept running on the UI
   * thread the entire time the user was on Meetings, Ask, Actions or Account.
   * Not a frame of it was ever visible. The orb freezes where it stands on blur
   * and resumes from that exact value on focus, so this costs nothing visually.
   *
   * A separate useFocusEffect from the reset above, with a genuinely empty
   * dependency list. Folded into that one it would inherit `recorderState`, and
   * every recorder transition would tear the callback down and rebuild it —
   * a false blur/focus pair, and a needless restart of all ten clocks, on every
   * start, pause, resume and stop.
   */
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const announce = useCallback((message: string) => {
    // Haptics are deliberately absent everywhere on this screen: iOS suppresses
    // the Taptic Engine while the mic is active, so the call would succeed and
    // produce nothing. Announcements carry the state change instead.
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  const onStart = useCallback(async () => {
    await recorder.start();
    startedAt.current = new Date();
    announce("Recording started");
  }, [recorder, announce]);

  /**
   * Abandon a recording without transcribing it.
   *
   * Not optional. Without this the only exit from an in-progress recording is
   * "End meeting", which uploads the audio to R2 and runs it through
   * AssemblyAI and OpenAI. Someone who decides mid-meeting that this should
   * not be recorded had no way to act on that, which is a privacy failure, not
   * a missing convenience.
   *
   * The local file is deleted rather than left behind: an abandoned recording
   * sitting in the app container is the thing the user just said they did not
   * want to exist.
   */
  const onDiscard = useCallback(() => {
    Alert.alert(
      "Discard this recording?",
      "The audio will be deleted from this iPhone. It is not uploaded and cannot be recovered.",
      [
        // Cancel leads, matching every destructive system alert.
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const uri = await recorder.stop();
              if (uri) {
                try {
                  new File(uri).delete();
                } catch {
                  // Already gone, or the container moved between launches.
                  // Nothing recoverable to do, and failing loudly here would
                  // only alarm someone who asked us to throw the file away.
                }
              }
              recorder.reset();
              setTitle(defaultTitle());
              announce("Recording discarded");
            })();
          },
        },
      ],
    );
  }, [recorder, announce]);

  const onStop = useCallback(async () => {
    const uri = await recorder.stop();
    announce("Recording stopped");

    if (!uri) {
      Alert.alert("Nothing recorded", "That recording was empty.");
      return;
    }
    if (recorder.duration < 2) {
      Alert.alert("Too short", "That recording is too short to transcribe.");
      return;
    }

    // The one moment this question makes sense. The user has just finished a
    // meeting and is about to wait several minutes for it to process, so
    // "we'll tell you when it's ready" is an offer rather than an interruption.
    //
    // Asked BEFORE the upload starts, because permission has to exist before
    // they leave the app, and leaving immediately is exactly what we want them
    // to feel free to do. A no-op once the answer is settled either way, and it
    // never blocks the upload: whatever they choose, the recording still goes.
    await ensureNotificationPermission();

    setUploading(true);
    try {
      const { meetingId } = await uploadRecording(
        uri,
        {
          title: title.trim() || defaultTitle(),
          durationSec: recorder.duration,
          recordedAt: startedAt.current ?? new Date(),
        },
        { onProgress: setProgress },
      );

      await queryClient.invalidateQueries({ queryKey: ["meetings"] });
      setTitle(defaultTitle());
      router.push(`/(app)/meetings/${meetingId}`);
    } catch (error) {
      Alert.alert(
        "Upload failed",
        error instanceof Error ? error.message : "Your recording is still on this iPhone.",
      );
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }, [recorder, title, queryClient, announce]);

  // Live Activity — the Dynamic Island and Lock Screen pill.
  //
  // Mirrored off recorder state rather than poked from each handler, and that
  // is what makes it impossible to orphan: every exit from a recording — End,
  // Discard, a control pressed in the island itself, a denied permission — goes
  // through a state change, so there is no fourth code path left to forget.
  // Read through a ref because the title is a controlled input; keying the
  // effect on it would re-run this on every keystroke.
  const titleRef = useRef(title);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    if (recorderState === "recording" || recorderState === "paused") {
      // Both calls, every time. start is ignored once a pill exists, so this
      // costs nothing after the first pass and removes the need to track
      // whether we have already started one.
      // Empty when the user has not named this yet. The recorder pre-fills the
      // field with a timestamp, and passing that through put "Thu, Aug 13 at
      // 10:22 AM" on the Lock Screen directly beneath the Lock Screen's own
      // clock — the card's most-read line spent on information already on
      // screen twice. The widget drops the line entirely when it is empty and
      // gives the space to the waveform instead.
      startRecordingActivity({
        title: isPlaceholderTitle(titleRef.current) ? "" : titleRef.current.trim(),
      });
      updateRecordingActivity({ paused: recorderState === "paused" });
    } else {
      endRecordingActivity();
    }
  }, [recorderState]);

  // Pause / Resume / End pressed in the island. They arrive in this process
  // rather than the widget extension's — see RecordingIntents.swift — so they
  // drive the real recorder instead of a copy of its state.
  //
  // Held behind a ref so the subscription is made once. onStop's identity
  // changes on every metering tick, and resubscribing ten times a second would
  // open a window where a press lands with nobody listening.
  const onControl = useRef<(control: RecordingControl) => void>(() => undefined);
  useEffect(() => {
    onControl.current = (control) => {
      if (control === "pause") recorder.pause();
      else if (control === "resume") recorder.resume();
      else void onStop();
    };
  }, [recorder, onStop]);

  useEffect(() => subscribeToRecordingControls((control) => onControl.current(control)), []);

  if (recorder.state === "denied") {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text className="text-center text-[17px] font-semibold text-label">
          Microphone access is off.
        </Text>
        <Text className="mt-2 text-center text-[15px] text-label-secondary">
          Turn it on in Settings to record meetings.
        </Text>
        <Pressable
          onPress={() => void Linking.openSettings()}
          accessibilityRole="button"
          className="mt-6 min-h-[50px] justify-center rounded-full bg-label px-6 active:opacity-80"
        >
          <Text className="text-[17px] font-semibold text-background">Open Settings</Text>
        </Pressable>
      </View>
    );
  }

  if (uploading) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <ActivityIndicator />
        <Text className="mt-4 text-[17px] font-semibold text-label">Uploading</Text>
        <Text
          className="mt-1 text-[15px] text-label-secondary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {Math.round(progress * 100)}%
        </Text>
      </View>
    );
  }

  return (
    // Canvas token, not true black. #06070A carries a deliberate blue cast (the
    // blue channel sits above the red), so a pure-black screen reads as a
    // different colour temperature the moment you tab between it and any other
    // screen. Immersion is not worth the seam.
    //
    // One axis. The eyebrow and the title used to be left-aligned while the orb,
    // the timer and the button were centred, which put two competing vertical
    // axes on a screen with six elements on it. The orb cannot move off centre,
    // so everything else came to it.
    //
    // justify-between is gone. With three children it split the slack into two
    // equal voids — ~92pt above the orb and ~97pt below the timer — which is how
    // a hero, its readout and its control ended up reading as three unrelated
    // objects adrift. The instrument is now one centred group; the controls are
    // pinned to the bottom inset with a fixed gap; and the orb is sized from
    // what is genuinely left over rather than from a fraction of the viewport,
    // which is what stops the slack reappearing on a taller phone.
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: topPad, paddingBottom: bottomPad }}
    >
      <View className="items-center" style={{ gap: HEADER_GAP }}>
        <View className="flex-row items-center justify-center gap-2" style={{ height: EYEBROW_H }}>
          {active ? (
            <>
              <RecordingDot live={recording} />
              <Text
                className="text-[11px] font-semibold uppercase text-label-secondary"
                style={{ letterSpacing: 0.8 }}
                maxFontSizeMultiplier={1.4}
              >
                {paused ? "Paused" : "Recording"}
              </Text>
            </>
          ) : (
            <Text
              className="text-[11px] font-semibold uppercase text-label-tertiary"
              style={{ letterSpacing: 0.8 }}
              maxFontSizeMultiplier={1.4}
            >
              Ready
            </Text>
          )}
        </View>

        {/* A real field, not a bare TextInput.

            This is the meeting's name and it is editable, and until now it said
            neither of those things: 22px of label colour on the canvas with no
            fill, no border and no glyph renders "Thu, Aug 13 at 3:47 AM" as a
            date stamp. It was discoverable only by tapping text that gives no
            reason to be tapped. The fill and the pencil are the affordance; the
            17px is because a title field is a control, not a headline, and the
            orb is the thing that should be big on this screen. */}
        <View
          className="w-full flex-row items-center rounded-control border border-edge bg-surface"
          style={{ borderCurve: "continuous" }}
        >
          <TextInput
            // Explicit, not inherited. RN's default maps to
            // UIKeyboardAppearanceDefault, which follows the SYSTEM appearance
            // rather than the app's forced-dark style, so the keyboard came up
            // white inside a black app.
            keyboardAppearance="dark"
            className="min-h-[48px] flex-1 px-10 py-3 text-center text-[17px] font-medium text-label"
            value={title}
            onChangeText={setTitle}
            placeholder="Untitled meeting"
            // Mirrors --label-tertiary on the dark ramp. react-native-svg and
            // placeholderTextColor are both outside className resolution, so
            // this hex cannot follow the token and has to be kept in step by
            // hand. Measured 4.65:1 on --surface, which is the fill behind it.
            placeholderTextColor={GLYPH_DIM}
            editable={!active}
            accessibilityLabel="Meeting title"
            accessibilityHint="Names this recording"
            maxFontSizeMultiplier={1.3}
          />

          {/* Absolutely placed so it cannot pull the centred text off axis, and
              gone while recording, when the field genuinely is not editable. */}
          {active ? null : (
            <View className="absolute right-3.5" pointerEvents="none">
              <PencilGlyph />
            </View>
          )}
        </View>
      </View>

      {/* The instrument: dial and readout, one group, centred in everything the
          header and the controls do not use. */}
      <View className="flex-1 items-center justify-center" style={{ gap: GROUP_GAP }}>
        {/* Full bleed. Stretched to the parent and then given back the screen's
            24pt padding as negative margin, so the orb is centred in the WHOLE
            width and can be wider than the column the header and the buttons
            live in. Stated rather than left to overflow: a child that is simply
            bigger than its parent renders the same today and disappears the day
            something upstream clips. */}
        <View className="items-center" style={{ alignSelf: "stretch", marginHorizontal: -24 }}>
          <RecordOrb level={recorder.level} phase={phase} size={orbSize} focused={focused} />
        </View>

        {/* Tabular figures are not optional: the timer reflows ten times a
            second, and proportional digits make the whole line twitch on every
            tick. */}
        <Text
          className="font-display text-[56px] leading-[62px] text-label"
          // letterSpacing separates adjacent ones. Space Grotesk Bold's tabular
          // `one` is slab-footed, so at any clock reading 1:11 or 11:11 the foot
          // bars touch and the digits fuse into a single mark.
          style={{ fontVariant: ["tabular-nums"], letterSpacing: 1 }}
          accessibilityLabel={`Elapsed ${formatClock(recorder.duration)}`}
          // The tightest cap on the screen, and the one that matters most. RN
          // scales a style lineHeight by the same multiplier as the font size,
          // so the 62pt line box travels with the digits and nothing clips —
          // but 56px is already a hero numeral, and at AX5 uncapped it is 145pt
          // of glyph in a 402pt column. 1.15 puts the ceiling at 64px.
          maxFontSizeMultiplier={1.15}
        >
          {formatClock(recorder.duration)}
        </Text>
      </View>

      <View className="gap-4" style={{ marginTop: CTA_GAP }}>
        {!active ? (
          <Pressable
            onPress={() => void onStart()}
            disabled={recorder.state === "requesting"}
            accessibilityRole="button"
            accessibilityLabel="Start recording"
            className="min-h-[64px] items-center justify-center rounded-full bg-label active:opacity-80"
          >
            <Text className="text-[17px] font-semibold text-background" maxFontSizeMultiplier={1.4}>
              Start recording
            </Text>
          </Pressable>
        ) : (
          <Animated.View entering={FadeIn.duration(180)} className="flex-row gap-3">
            <Pressable
              onPress={() => (paused ? recorder.resume() : recorder.pause())}
              accessibilityRole="button"
              accessibilityLabel={paused ? "Resume recording" : "Pause recording"}
              className="min-h-[64px] flex-1 items-center justify-center rounded-full bg-fill active:opacity-70"
            >
              {/* 1.4, not 1.8. These two sit side by side at half the column
                  each, so their labels run out of horizontal room long before
                  the 64pt button runs out of vertical. */}
              <Text className="text-[17px] font-semibold text-label" maxFontSizeMultiplier={1.4}>
                {paused ? "Resume" : "Pause"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => void onStop()}
              accessibilityRole="button"
              accessibilityLabel="End meeting"
              className="min-h-[64px] flex-1 items-center justify-center rounded-full bg-danger active:opacity-80"
            >
              {/* "End meeting", not "Stop recording" — the user is finishing a
                  meeting, not operating a tape deck. */}
              <Text className="text-[17px] font-semibold text-label" maxFontSizeMultiplier={1.4}>
                End meeting
              </Text>
            </Pressable>
          </Animated.View>
        )}

        {/* Discard sits below the primary pair rather than beside them. It is a
            real escape hatch, so it must be reachable without a hunt, but it
            destroys work, so it must never sit under a thumb travelling toward
            Pause. Text-only weight is the whole point: findable, not inviting. */}
        {active ? (
          <Animated.View entering={FadeIn.duration(180)}>
            <Pressable
              onPress={onDiscard}
              accessibilityRole="button"
              accessibilityLabel="Discard recording"
              accessibilityHint="Deletes this recording without transcribing it"
              className="min-h-[44px] items-center justify-center active:opacity-60"
            >
              <Text
                className="text-[15px] font-medium text-label-secondary"
                maxFontSizeMultiplier={1.6}
              >
                Discard
              </Text>
            </Pressable>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}
