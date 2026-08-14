import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
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

import { useRecorder } from "@/lib/audio/use-recorder";
import { createRecording, adoptSegment } from "@/lib/audio/segment-store";
import { setRecordingActive } from "@/lib/audio/recovery";
import {
  DEFAULT_TARGET_SECONDS,
  discardRecording,
  startSession,
  type UploadSession,
} from "@/lib/audio/segment-upload";
import { qk } from "@/lib/api/meetings";
import { ensureNotificationPermission } from "@/lib/notifications";
import {
  endRecordingActivity,
  startRecordingActivity,
  subscribeToRecordingControls,
  updateRecordingActivity,
  type RecordingControl,
} from "@/lib/live-activity";
import { formatClock, isPlaceholderTitle } from "@/lib/format";
import { useTabBarInset } from "@/lib/layout";
import { useColorToken } from "@/lib/tokens";
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

/**
 * The edit affordance.
 *
 * The title used to be a borderless 22px TextInput and nothing else, which
 * rendered "Thu, Aug 13 at 3:47 AM" as what looks exactly like a date stamp.
 * Nobody taps a date stamp. The field around it does most of the work now; this
 * removes the last of the doubt about whether the text is yours to change.
 *
 * SVG fill is not styled by className, so the tint is read rather than
 * defaulted in the parameter list — a token read is a hook.
 */
function PencilGlyph({ size = 15, color }: { size?: number; color?: string }) {
  const tertiary = useColorToken("--label-tertiary");

  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Path
        d="M12.1 1.6l2.3 2.3-1.7 1.7-2.3-2.3zM9.6 4.1l2.3 2.3-6.6 6.6-3.1.8.8-3.1z"
        fill={color ?? tertiary}
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

/**
 * Directory name for a recording, decided before anything else happens.
 *
 * Local to this device and never sent anywhere, so it does not need to be a
 * real UUID — it needs to be unique among the handful of recordings that can
 * exist on one phone at once, and it needs to be available synchronously, with
 * no native module and no round trip, because capture must not wait for it.
 */
function newLocalId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function RecordScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(defaultTitle);
  // placeholderTextColor is a prop rather than a style, so it is outside
  // className resolution and has to arrive already resolved.
  const placeholder = useColorToken("--label-tertiary");

  /**
   * The recording in progress, and the thing uploading it.
   *
   * Refs rather than state because neither is rendered and both are read from
   * callbacks that must not go stale — `onSegment` in particular is captured by
   * the rotation path, which runs while the microphone is live.
   *
   * The session is deliberately NOT owned by this screen's lifecycle. It lives
   * at module scope in segment-upload, because the user ends a meeting and
   * navigates away immediately and the upload has to outlive this component.
   */
  const localIdRef = useRef<string | null>(null);
  const sessionRef = useRef<UploadSession | null>(null);

  /**
   * A segment has closed. File it under its index, then hand it to the uploader.
   *
   * The move is what makes the segment durable and unambiguous — until it lands
   * the file is a `recording-<uuid>.aac` with nothing to say which meeting or
   * which position it belongs to. Only after it is filed is the uploader told,
   * so a crash between the two leaves a file that the recovery sweep can still
   * place, never an index pointing at nothing.
   */
  const filedRef = useRef<Promise<void>>(Promise.resolve());

  const onSegment = useCallback(({ index, uri }: { index: number; uri: string }) => {
    const localId = localIdRef.current;
    if (!localId) return;

    // Chained, and the chain is awaited before finalize.
    //
    // Filing is asynchronous and `onSegment` is called from the rotation path,
    // which cannot block on it — the microphone is live. But the LAST segment is
    // filed at the same instant the user ends the meeting, so without this the
    // finalize could ask the server to close a recording whose final segment had
    // not been enqueued yet. The server would correctly report it missing, and
    // the recovery round would go looking for a file that was still being moved.
    filedRef.current = filedRef.current.then(async () => {
      try {
        const stored = await adoptSegment(localId, index, uri);
        if (!stored) return;
        sessionRef.current?.enqueue(index);
      } catch {
        // The segment stays where it is and this index goes unregistered.
        // Finalize reports it as missing, which is the recovery path — failing
        // the whole recording over one segment would be worse.
      }
    });
  }, []);

  /**
   * Rotation cadence, read live rather than captured.
   *
   * POST /meetings/segmented echoes the server's own `segment_target_seconds`,
   * and it usually answers a beat AFTER capture has started — capture must not
   * wait on the network. So the first segment uses the default and every
   * rotation after it asks again.
   */
  const getTargetSeconds = useCallback(
    () => sessionRef.current?.targetSeconds ?? DEFAULT_TARGET_SECONDS,
    [],
  );

  const recorder = useRecorder({ onSegment, getTargetSeconds });

  /**
   * Pick up anything a previous run left behind.
   *
   * Disabled while this screen is itself recording, so the sweep can never
   * collide with the session currently writing segments.
   */
  const idle = recorder.state === "idle" || recorder.state === "denied";
  // Publish capture state so the layout's sweep cannot fire while this screen is
  // writing segments — it would hand a second uploader the same indexes.
  useEffect(() => {
    setRecordingActive(!idle);
    return () => setRecordingActive(false);
  }, [idle]);

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
   * Bottom inset. Uses useTabBarInset now that the tab bar is a JS overlay:
   * `insets.bottom` is just the home indicator, so the bar's height has to be
   * added explicitly or the Start button parks behind the floating bar.
   */
  const bottomPad = useTabBarInset(16);

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

  /**
   * Start capturing, and open the meeting in parallel.
   *
   * The order matters. The directory and the manifest are created first and
   * synchronously, so the very first segment has somewhere durable to land;
   * `startSession` then fires POST /meetings/segmented WITHOUT being awaited,
   * and `recorder.start()` follows immediately. A recording made with no signal
   * still captures — the segments queue on disk and the meeting is opened when
   * the network comes back.
   */
  const onStart = useCallback(async () => {
    const localId = newLocalId();
    const chosen = title.trim() || defaultTitle();

    try {
      const manifest = createRecording({
        localId,
        title: chosen,
        recordedAt: new Date(),
        targetSeconds: DEFAULT_TARGET_SECONDS,
      });
      localIdRef.current = localId;
      sessionRef.current = startSession(manifest);
    } catch {
      Alert.alert("Could not start", "There is no room on this iPhone to store the recording.");
      return;
    }

    try {
      await recorder.start();
    } catch (error) {
      // Nothing was captured, so leave nothing behind — including the meeting
      // row the session may already have opened.
      void discardRecording(localId);
      localIdRef.current = null;
      sessionRef.current = null;
      Alert.alert(
        "Could not start",
        error instanceof Error ? error.message : "The microphone is not available.",
      );
      return;
    }

    announce("Recording started");
  }, [recorder, announce, title]);

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
              await recorder.stop();
              // Before deleting the directory, or a file move still in flight
              // would recreate it a moment after it was thrown away.
              await filedRef.current;

              // Every segment, not just the last one, plus the meeting row the
              // session opened when recording started. A discarded recording
              // that left a row behind would put a permanent empty meeting in
              // the library — and segments left on disk are exactly the thing
              // the user just said should not exist.
              const localId = localIdRef.current;
              localIdRef.current = null;
              sessionRef.current = null;
              if (localId) {
                await discardRecording(localId).catch(() => undefined);
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

  /**
   * End the meeting.
   *
   * There is no upload screen. The user goes straight to the meeting and the
   * upload finishes behind them, which is honest rather than cosmetic: by the
   * time they press this, every segment but the last has already been uploaded
   * and confirmed, so there genuinely is almost nothing left to send.
   *
   * The one thing that IS awaited is the meeting id, because there is nowhere
   * to navigate without it — and it has usually been sitting in the session
   * since the moment recording started.
   */
  const onStop = useCallback(async () => {
    const session = sessionRef.current;
    const localId = localIdRef.current;
    const { totalSegments, durationSec } = await recorder.stop();
    announce("Recording stopped");

    // Every segment, including the one that just closed, is now filed under its
    // index and handed to the uploader. See filedRef.
    await filedRef.current;

    if (!session || !localId || totalSegments === 0) {
      Alert.alert("Nothing recorded", "That recording was empty.");
      if (localId) await discardRecording(localId).catch(() => undefined);
      localIdRef.current = null;
      sessionRef.current = null;
      return;
    }

    if (durationSec < 2) {
      Alert.alert("Too short", "That recording is too short to transcribe.");
      await discardRecording(localId).catch(() => undefined);
      localIdRef.current = null;
      sessionRef.current = null;
      recorder.reset();
      return;
    }

    // The one moment this question makes sense. The user has just finished a
    // meeting and is about to wait several minutes for it to process, so
    // "we'll tell you when it's ready" is an offer rather than an interruption.
    //
    // Asked BEFORE they leave, because permission has to exist before the app
    // goes to the background, and leaving immediately is exactly what we want
    // them to feel free to do. A no-op once the answer is settled either way,
    // and it never blocks the upload: whatever they choose, the recording goes.
    await ensureNotificationPermission();

    let meetingId: string;
    try {
      meetingId = await session.open();
    } catch {
      // No meeting row, so nowhere to send the user and nothing for a progress
      // ring to attach to. The audio is safe on disk and the recovery sweep
      // will offer it on the next launch, so this is the one failure that still
      // belongs on THIS screen — the user has not gone anywhere yet.
      Alert.alert(
        "Could not reach Puffin",
        "Your recording is saved on this iPhone. It will be uploaded the next time you open the app with a connection.",
      );
      localIdRef.current = null;
      sessionRef.current = null;
      recorder.reset();
      setTitle(defaultTitle());
      return;
    }

    // Not awaited. This is the whole point: the finalize, the last segment and
    // any gap recovery all happen behind the user, reporting to the progress
    // store the meeting screen is already watching.
    void session.finish({ totalSegments, durationSec });

    localIdRef.current = null;
    sessionRef.current = null;
    recorder.reset();
    setTitle(defaultTitle());

    await queryClient.invalidateQueries({ queryKey: qk.allMeetings });
    router.push(`/(app)/meetings/${meetingId}`);
  }, [recorder, queryClient, announce]);

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

  // There is deliberately no "Uploading 87%" state here any more.
  //
  // A recording used to meet a progress indicator twice: a full-screen one on
  // this tab that ran to 100 and vanished, and then the meeting screen's own
  // ring starting again at zero. One continuous wait in two visual languages,
  // the second of which read as the first having failed. The meeting screen now
  // owns the whole wait, and this screen's job ends when the recorder stops.
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
      /*
        px-4, not px-6. This screen was the only one in the app at a 24pt
        gutter — every card, field and button everywhere else lands on 16pt —
        so the content column visibly stepped inward the moment you swiped from
        Meetings to Record. An 8pt discontinuity is small enough that nobody
        names it and large enough that the two tabs stop feeling like one app.
        The px-6 on the button below is INTERNAL pill padding and is unrelated.
      */
      className="flex-1 bg-background px-4"
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
            // --label-tertiary, measured at 4.65:1 on --surface, which is the
            // fill behind it.
            placeholderTextColor={placeholder}
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
            /**
             * Red, with a record dot. It was a near-white pill.
             *
             * Recording is red on every camera, every voice recorder and every
             * phone ever made, and this is the app's single most important
             * action — so a white pill read as a form's Submit, not as "begin
             * capturing this room". It was also the ONLY inverted button in the
             * app, so it had no siblings to be understood against.
             *
             * The dot is not decoration: it is the same mark the Live Activity
             * and the RECORDING label use, so the control you press and the
             * indicator you then watch on the Lock Screen are visibly the same
             * idea. Red already means destructive on Delete account — that is
             * not a collision, it is the same underlying meaning both places:
             * this one matters, look at it.
             */
            className="min-h-[64px] flex-row items-center justify-center gap-2.5 rounded-full bg-danger active:opacity-80"
          >
            <View className="h-3 w-3 rounded-full bg-background" />
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

        {/* One 44pt slot below the primary control, holding a different thing in
            each state. It is the seat CONTROLS_H has always reserved for
            Discard, so nothing above it moves and the orb is not charged a point
            for the second occupant.

            Recording: Discard. A real escape hatch, so it must be reachable
            without a hunt, but it destroys work, so it must never sit under a
            thumb travelling toward Pause. Text-only weight is the whole point:
            findable, not inviting.

            Idle: upload an existing file. This is the app's SECOND way to make a
            meeting, and the screen has to say so somewhere — the recorder is
            where a meeting gets created, and a file you already have is the
            other way of creating one. Deliberately not a second pill: two
            near-white buttons stacked would make the user choose between two
            primaries on a screen whose entire job is to be pressed once. Tint,
            because this navigates, and blue is navigation everywhere in this
            app. */}
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
        ) : (
          // No entrance animation, unlike Discard. Discard appears in response
          // to a press; this is simply the resting state of the screen, and
          // fading it in on every mount would animate something that was
          // already there.
          <Pressable
            // No haptic, like every other control on this screen: lib/haptics.ts
            // documents why the Taptic Engine is off limits here. The screen
            // pushing is the feedback.
            onPress={() => router.push("/(app)/record/import")}
            accessibilityRole="button"
            accessibilityLabel="Upload a file"
            accessibilityHint="Choose an audio file on this iPhone or in iCloud Drive and add it as a meeting"
            className="min-h-[44px] items-center justify-center active:opacity-60"
          >
            {/* --tint-label, not --tint. They are the same value under the
                forced dark appearance this app ships, but the two exist so that
                accent TEXT can be darkened independently of accent chrome the
                day a light theme lands — and this is text on the canvas. Same
                token the auth screens use for their inline actions. */}
            <Text className="text-[15px] font-medium text-tint-label" maxFontSizeMultiplier={1.6}>
              Upload a file
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
