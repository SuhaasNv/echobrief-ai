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
} from "react-native";
import Animated, {
  FadeIn,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useKeepAwake } from "expo-keep-awake";

import { useRecorder } from "@/lib/audio/use-recorder";
import { uploadRecording } from "@/lib/audio/upload";
import { formatClock } from "@/lib/format";
import { displayNumber } from "@/lib/type";
import { LiveWaveform } from "@/components/live-waveform";

function defaultTitle(): string {
  return new Date().toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Pulsing dot beside the RECORDING label — the only motion on this screen. */
function RecordingDot() {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.25, { duration: 900, reduceMotion: ReduceMotion.System }),
      -1,
      true,
    );
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return <Animated.View className="h-2 w-2 rounded-full bg-danger" style={style} />;
}

export default function RecordScreen() {
  const recorder = useRecorder();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(defaultTitle);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const startedAt = useRef<Date | null>(null);

  const recording = recorder.state === "recording";
  const paused = recorder.state === "paused";
  const active = recording || paused;

  // A recording screen that sleeps mid-meeting is a broken recording screen.
  useKeepAwake();

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
    // True black rather than the canvas token: this is the one immersive screen,
    // and Apple carves out exactly this case.
    <View className="flex-1 justify-between bg-black px-6 pb-10 pt-4">
      <View className="gap-6">
        <View className="h-5 flex-row items-center gap-2">
          {active ? (
            <>
              <RecordingDot />
              <Text
                className="text-[11px] font-semibold uppercase text-label-secondary"
                style={{ letterSpacing: 0.8 }}
              >
                {paused ? "Paused" : "Recording"}
              </Text>
            </>
          ) : null}
        </View>

        <TextInput
          className="text-[22px] text-label"
          value={title}
          onChangeText={setTitle}
          placeholder="Untitled meeting"
          placeholderTextColor="#6E727A"
          editable={!active}
          accessibilityLabel="Meeting title"
        />
      </View>

      <View className="items-center gap-10">
        <Text className="text-[56px] leading-[62px] text-label" style={displayNumber}>
          {formatClock(recorder.duration)}
        </Text>

        <LiveWaveform bars={recorder.bars} height={110} />
      </View>

      <View className="gap-4">
        {!active ? (
          <Pressable
            onPress={() => void onStart()}
            disabled={recorder.state === "requesting"}
            accessibilityRole="button"
            accessibilityLabel="Start recording"
            className="min-h-[64px] items-center justify-center rounded-full bg-label active:opacity-80"
          >
            <Text className="text-[17px] font-semibold text-background">Start recording</Text>
          </Pressable>
        ) : (
          <Animated.View entering={FadeIn.duration(180)} className="flex-row gap-3">
            <Pressable
              onPress={() => (paused ? recorder.resume() : recorder.pause())}
              accessibilityRole="button"
              accessibilityLabel={paused ? "Resume recording" : "Pause recording"}
              className="min-h-[64px] flex-1 items-center justify-center rounded-full bg-fill active:opacity-70"
            >
              <Text className="text-[17px] font-semibold text-label">
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
              <Text className="text-[17px] font-semibold text-label">End meeting</Text>
            </Pressable>
          </Animated.View>
        )}
      </View>
    </View>
  );
}
