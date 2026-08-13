import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { onlineManager, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";

import { describeActionFailure, useOnline } from "@/lib/api/errors";
import { qk } from "@/lib/api/meetings";
import {
  MAX_TITLE_CHARS,
  pickAudioFile,
  formatBytes,
  type ImportedAudio,
  type ImportRejection,
} from "@/lib/audio/file-import";
import { uploadRecording } from "@/lib/audio/upload";
import { formatListDate } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { TIMING } from "@/lib/motion";
// The leaf module, not the @/lib/notifications barrel. Importing the barrel
// evaluates ./task and ./lifecycle, which registers the background TaskManager
// task — see the same note in lib/api/meetings.ts. This screen needs one
// function from it, not the plumbing.
import { ensureNotificationPermission } from "@/lib/notifications/permissions";
import { ErrorState, StaleNotice } from "@/components/error-state";
import { ProgressRing } from "@/components/progress-ring";
import { Section, TextFieldRow, ValueRow } from "@/components/settings/rows";
import { SettingsScroll } from "@/components/settings/screen";

/**
 * Upload a recording that already exists.
 *
 * Lives in the RECORD stack, not the meetings one. Uploading a file is the
 * second way to create a meeting — the microphone is the first — and Meetings
 * is a list of things that already exist. Keeping the two creation paths in one
 * tab also means cancelling the file browser drops the user back on the
 * recorder rather than somewhere they never asked to be.
 *
 * The screen is thin on purpose. Every decision about whether a file is
 * acceptable lives in lib/audio/file-import.ts, and the upload itself is the
 * same `uploadRecording` the recorder uses — so what an uploaded meeting
 * becomes is not a parallel implementation of a recorded one, it IS one. It
 * lands in the meetings list, polls through the same processing UI, and
 * notifies through the same pending ledger, because none of that knows where
 * the audio came from.
 *
 * What is left here is the sequence: ask for a file, show what was chosen,
 * name it, send it, then get out of the way.
 */

/** Human name for a container, for the file summary. */
const CONTENT_TYPE_LABELS: Record<string, string> = {
  "audio/mpeg": "MP3",
  "audio/wav": "WAV",
  "audio/x-wav": "WAV",
  "audio/mp4": "M4A",
  "audio/m4a": "M4A",
  "audio/x-m4a": "M4A",
  "audio/aac": "AAC",
  "audio/webm": "WebM",
  "video/mp4": "MP4",
  "video/webm": "WebM",
};

type Phase =
  | { kind: "choosing" }
  | { kind: "ready"; file: ImportedAudio }
  | { kind: "rejected"; reason: ImportRejection };

/**
 * Commit action, to the same measurements as the one the empty library uses to
 * invite a first recording: near-white pill, 50pt, dark label. Blue is
 * navigation in this app and never a commit.
 *
 * Written here rather than imported from components/meetings/empty-state so
 * this screen has no reason to reach into the meetings tab for anything.
 */
function CommitButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      className="min-h-[50px] flex-row items-center justify-center self-stretch rounded-full bg-label px-6 active:opacity-80"
    >
      <Text className="text-[17px] font-semibold text-background" maxFontSizeMultiplier={1.6}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function ImportMeetingScreen() {
  const queryClient = useQueryClient();
  const isOnline = useOnline();

  const [phase, setPhase] = useState<Phase>({ kind: "choosing" });
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState(0);

  /**
   * Leaving.
   *
   * `canGoBack` because this route is reachable from a deep link, where there
   * is no recorder underneath and `back()` would do nothing. Same guard the
   * meeting detail screen uses after a delete.
   */
  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/record");
  }, []);

  /**
   * Whether this screen is still on the tree.
   *
   * The picker is a system sheet that can outlive the screen behind it — a
   * notification tap, or the user swiping the stack away while Files is open —
   * and `getDocumentAsync` resolves regardless. Read at every await boundary so
   * nothing writes state into a torn-down screen. A ref rather than state
   * because reading it must not itself cause a render.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const choose = useCallback(async () => {
    setPhase({ kind: "choosing" });

    try {
      const outcome = await pickAudioFile();
      if (!mounted.current) return;

      if (outcome.kind === "cancelled") {
        // Nothing was chosen, so this screen has nothing to be about.
        // Dismissing a file browser means "not now", not "show me a form".
        leave();
        return;
      }

      if (outcome.kind === "rejected") {
        haptics.error();
        setPhase({ kind: "rejected", reason: outcome.reason });
        return;
      }

      setPhase({ kind: "ready", file: outcome.file });
      setTitle(outcome.file.suggestedTitle);
    } catch (error) {
      if (!mounted.current) return;

      // getDocumentAsync only throws when it cannot PRESENT — no view
      // controller, or a second sheet racing the first. A refused file is a
      // resolved outcome, handled above.
      haptics.error();
      setPhase({
        kind: "rejected",
        reason: {
          title: "The file browser did not open",
          body:
            error instanceof Error
              ? error.message
              : "iOS could not present the file browser just now. Trying again usually works.",
        },
      });
    }
  }, [leave]);

  /**
   * The picker opens itself.
   *
   * Arriving here IS the request for a file; a screen that shows a "Choose a
   * file" button behind a button the user has already pressed is ceremony.
   *
   * Guarded by its own ref rather than by the dependency list: this must run
   * exactly once per mount, and getDocumentAsync throws
   * PickingInProgressException if a second call lands while the sheet is up.
   * The `mounted` ref above is what closes the state window on the way out —
   * there is no API to dismiss the system sheet from here, so cancelling is not
   * on offer and pretending otherwise in a cleanup would be theatre.
   */
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void choose();
  }, [choose]);

  const upload = useMutation({
    /**
     * Offline this must FAIL, not park.
     *
     * The default network mode holds a mutation until the network returns,
     * which here would leave the screen on a progress readout for a request
     * that has not been sent and that dies with the process — while the user
     * believes a 200MB file is on its way and is free to close the app. Same
     * reasoning as the mutations in lib/api/action-items.ts, and it matters
     * more here because the thing being lost is not a checkbox.
     */
    networkMode: "always",

    mutationFn: (file: ImportedAudio) => {
      setProgress(0);

      return uploadRecording(
        file.uri,
        {
          // Trimmed and capped again at the moment of sending. `maxLength` on
          // the field is a UI courtesy; this is the value the API stores.
          title: title.trim().slice(0, MAX_TITLE_CHARS) || file.suggestedTitle,
          // Unknown, and deliberately not guessed. Nothing the picker returns
          // carries a duration; the worker writes the real one back off the
          // transcript. See declarableDuration in lib/audio/upload.ts.
          durationSec: null,
          recordedAt: file.recordedAt,
          contentType: file.contentType,
          filename: file.filename,
        },
        { onProgress: setProgress },
      );
    },

    /**
     * Both callbacks have to cope with this screen being GONE.
     *
     * A mutation outlives the component that started it — the observer is
     * removed on unmount but the mutation keeps running and still fires the
     * options' callbacks — and an upload is exactly the operation people walk
     * away from. So neither of these may assume there is a screen to update,
     * and `mounted` decides which half of each runs.
     */
    onSuccess: async ({ meetingId }) => {
      // Unconditional: the library has a row it does not know about yet, and
      // whichever screen the user is on, that is the one that has to catch up.
      await queryClient.invalidateQueries({ queryKey: qk.allMeetings });
      haptics.success();

      // Skipped entirely if they left while it uploaded. Navigating someone
      // into a meeting from a screen they walked away from is the app taking
      // the wheel; the invalidated list above already puts the row in front of
      // them where they actually are.
      if (!mounted.current) return;

      // Pop this form off the Record stack BEFORE crossing to the meeting. A
      // tab keeps its stack for the life of the app, so a spent upload form
      // left on it is what the user would find the next time they tapped
      // Record — a file already uploaded, above a button offering to upload it
      // again.
      leave();

      // Then the same hop the recorder makes after its own upload: into the
      // meeting, which is where processing is watched.
      router.push(`/(app)/meetings/${meetingId}`);
    },

    onError: (error) => {
      // The part the user feels before they read anything.
      haptics.error();

      // Still here: the inline failure below says the rest, with the file and
      // the title they typed still on screen and a button that retries.
      if (mounted.current) return;

      // Gone: an alert is the only surface left, and silence would leave them
      // believing a recording is processing when nothing was ever sent.
      Alert.alert(
        "That recording was not added",
        `${describeActionFailure(error, { online: onlineManager.isOnline() })} The file is still on this iPhone — adding it again is safe.`,
      );
    },
  });

  // `upload.mutate` is stable across renders, so this is too — unlike `upload`
  // itself, which is a fresh object every render.
  const startUpload = upload.mutate;
  const submit = useCallback(
    (file: ImportedAudio) => {
      void (async () => {
        // The one moment the question makes sense, and the same moment the
        // Record tab asks it: the user is about to wait several minutes, so
        // "we'll tell you when it's ready" is an offer rather than an
        // interruption. Asked BEFORE the upload so permission exists before
        // they leave the app, and it never blocks the upload either way.
        await ensureNotificationPermission();
        if (!mounted.current) return;
        startUpload(file);
      })();
    },
    [startUpload],
  );

  if (upload.isPending) {
    /**
     * The same ring the meeting screen uses while it transcribes and analyses.
     *
     * This used to be a stock ActivityIndicator, a word, and a percentage — on
     * the reasoning that it should match the Record tab's upload state exactly.
     * It did, and both were wrong: a recording meets a progress indicator twice,
     * once here and once on the meeting screen, and rendering the same
     * continuous wait in two unrelated visual languages made it read as two
     * separate operations, the second of which appeared to start over at zero.
     *
     * TIMING.uploadSweep rather than the default: onProgress fires per chunk,
     * and the 850ms ease tuned for staged pipeline progress would trail the
     * transfer and then lurch to 100.
     */
    return (
      <View className="flex-1 items-center justify-center gap-6 bg-background px-8">
        <ProgressRing
          percent={Math.round(progress * 100)}
          label="Uploading"
          sweep={TIMING.uploadSweep}
        />
        <View className="items-center gap-1">
          <Text className="text-[17px] font-semibold text-label">Uploading</Text>
          <Text className="text-center text-[15px] text-label-secondary">
            Transcription starts as soon as this finishes.
          </Text>
        </View>
      </View>
    );
  }

  if (phase.kind === "choosing") {
    // The system sheet is on top of this. Anything drawn here is seen only in
    // the beat before it presents and the beat after it dismisses, so it is one
    // indicator rather than a skeleton of a form nobody has filled in yet.
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (phase.kind === "rejected") {
    return (
      <View className="flex-1 bg-background pt-8">
        <ErrorState
          title={phase.reason.title}
          body={phase.reason.body}
          onRetry={() => void choose()}
          retryLabel="Choose another file"
        />
      </View>
    );
  }

  const { file } = phase;
  const recordedLabel = file.recordedAt ? formatListDate(file.recordedAt.toISOString()) : null;

  return (
    <View className="flex-1 bg-background">
      {!isOnline ? (
        <StaleNotice>Offline. A recording cannot be added until you are back online.</StaleNotice>
      ) : null}

      {/* The settings surface, not a hand-rolled ScrollView. This screen is
          shaped exactly like a settings form — grouped rows and a field — and
          SettingsScroll already owns the three things such a screen keeps
          getting wrong: clearance for the tab bar the content sits behind, a
          reading order for the groups, and skipping that entrance under Reduce
          Motion. */}
      <SettingsScroll>
        {/* What was actually chosen, stated before anything is sent. The size
              is here because it is the number that decides how long the next
              screen takes, and the format because a file whose name says one
              thing and whose type says another is worth seeing before it is
              uploaded rather than after. */}
        <Section title="File">
          <ValueRow label="Name" value={file.filename} />
          <ValueRow
            label="Format"
            value={CONTENT_TYPE_LABELS[file.contentType] ?? file.contentType}
          />
          <ValueRow label="Size" value={formatBytes(file.size)} mono />
          {/* Only when the file's own modification date survived the bounds
                check in file-import. A row reading "Recorded —" would be the
                app claiming to know something it does not. */}
          {recordedLabel ? <ValueRow label="Recorded" value={recordedLabel} mono /> : null}
        </Section>

        <Section
          title="Title"
          footer="Taken from the file name. This is what the meeting is called in your library."
        >
          <TextFieldRow
            value={title}
            onChangeText={setTitle}
            placeholder="Untitled recording"
            accessibilityLabel="Meeting title"
            accessibilityHint="Names this meeting in your library"
            // The API caps the title at 200 characters. Enforced in the field
            // as well as on submit, so the limit is something the user meets
            // rather than something that silently truncates them.
            maxLength={MAX_TITLE_CHARS}
            returnKeyType="done"
            maxFontSizeMultiplier={1.4}
          />
        </Section>

        {upload.isError ? (
          // In place of the button rather than over the screen: the file is
          // still chosen and the title is still typed, so throwing the form
          // away to show a failure would cost the user both. `detail` carries
          // the raw text — a storage status code says more than the sentence
          // does, and describeActionFailure has no vocabulary for R2.
          <ErrorState
            title="That recording was not added"
            body={describeActionFailure(upload.error, { online: onlineManager.isOnline() })}
            detail={upload.error instanceof Error ? upload.error.message : undefined}
            onRetry={() => submit(file)}
          />
        ) : (
          <View className="px-4">
            <CommitButton label="Add to library" onPress={() => submit(file)} />
          </View>
        )}
      </SettingsScroll>
    </View>
  );
}
