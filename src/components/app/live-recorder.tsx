"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Mic,
  MicOff,
  Pause,
  Play,
  Square,
  AlertCircle,
  Loader2,
  Clock,
  ShieldAlert,
} from "lucide-react";
import {
  LiveRecorder,
  type RecorderState,
  type RecorderResult,
  type TranscriptSegment,
} from "@/lib/audio/recorder";
import { fetchStreamingToken } from "@/lib/api/hooks";
import { useLabels } from "@/lib/workspace-store";

/**
 * Detect whether this browser can support live recording. We need all three:
 *   - getUserMedia (mic access)
 *   - AudioWorklet (PCM downsampling off the main thread)
 *   - MediaRecorder (parallel audio blob for R2 upload)
 *
 * Modern Chrome / Edge / Firefox / Safari 16+ all satisfy this. Older Safari,
 * embedded webviews, and some mobile browsers don't — show a friendly fallback
 * instead of a confusing API error.
 */
function detectBrowserSupport(): { ok: boolean; missing: string[] } {
  if (typeof window === "undefined") return { ok: true, missing: [] };
  const missing: string[] = [];
  if (!navigator.mediaDevices?.getUserMedia) missing.push("microphone access");
  if (typeof AudioWorkletNode === "undefined") missing.push("AudioWorklet");
  if (typeof MediaRecorder === "undefined") missing.push("audio recording");
  return { ok: missing.length === 0, missing };
}

const SOFT_DURATION_WARN_SEC = 55 * 60; // 55 minutes — surface a "wrap up soon" banner
const HARD_DURATION_CAP_SEC = 3 * 60 * 60; // 3 hours — matches AssemblyAI session cap

export interface LiveRecorderCompletePayload extends RecorderResult {
  title: string;
}

interface LiveRecorderProps {
  onComplete: (result: LiveRecorderCompletePayload) => Promise<void> | void;
  /** Optional: pre-fill the meeting title. */
  defaultTitle?: string;
}

function formatDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function LiveRecorderPanel({ onComplete, defaultTitle }: LiveRecorderProps) {
  const labels = useLabels();
  const reduceMotion = useReducedMotion();
  const recorderRef = useRef<LiveRecorder | null>(null);
  const [support, setSupport] = useState<{ ok: boolean; missing: string[] }>({
    ok: true,
    missing: [],
  });

  const [state, setState] = useState<RecorderState>("idle");
  const [segments, setSegments] = useState<readonly TranscriptSegment[]>([]);
  const [level, setLevel] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [connected, setConnected] = useState(false);
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [saving, setSaving] = useState(false);

  // Detect browser support on mount (after hydration so SSR isn't surprised).
  useEffect(() => {
    setSupport(detectBrowserSupport());
  }, []);

  // Tick the duration counter once per second while recording.
  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  // Auto-pause when the tab backgrounds (iOS Safari/Android Chrome will
  // suspend AudioContext anyway; pausing explicitly gives a cleaner UX).
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && recorderRef.current?.state === "recording") {
        recorderRef.current.pause();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Hard-stop at the AssemblyAI session cap so the user gets a clean save
  // instead of an abrupt connection-dropped error.
  useEffect(() => {
    if (state !== "recording") return;
    if (elapsedSec < HARD_DURATION_CAP_SEC) return;
    void handleStop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedSec, state]);

  // Clean up the recorder on unmount.
  useEffect(() => {
    return () => recorderRef.current?.destroy();
  }, []);

  const transcriptText = useMemo(
    () =>
      segments
        .map((s) => s.text)
        .join(" ")
        .trim(),
    [segments],
  );

  async function handleStart() {
    setErrorMsg(null);
    setPermissionDenied(false);
    setConnected(false);
    setSegments([]);
    setElapsedSec(0);
    const rec = new LiveRecorder({
      fetchToken: async () => {
        const t = await fetchStreamingToken();
        return { token: t.token, ws_url: t.ws_url };
      },
    });
    recorderRef.current = rec;
    rec.addEventListener("state", (e: Event) => {
      const ev = e as CustomEvent<RecorderState>;
      setState(ev.detail);
    });
    rec.addEventListener("connected", () => setConnected(true));
    rec.addEventListener("partial", () => setSegments(rec.getSegments().slice()));
    rec.addEventListener("final", () => setSegments(rec.getSegments().slice()));
    rec.addEventListener("level", (e: Event) => {
      const ev = e as CustomEvent<number>;
      setLevel(ev.detail);
    });
    rec.addEventListener("error", (e: Event) => {
      const ev = e as CustomEvent<{ message: string }>;
      setErrorMsg(ev.detail.message);
    });
    try {
      await rec.start();
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setPermissionDenied(true);
      }
      // other errors already surfaced via the "error" event
    }
  }

  async function handleStop() {
    const rec = recorderRef.current;
    if (!rec) return;
    setSaving(true);
    try {
      const result = await rec.stop();
      if (!result.transcript || result.transcript.length < 1) {
        // No words came back from AssemblyAI. Most common causes:
        // mic muted, mic at wrong device, room silent, or WebSocket never
        // received audio. Surface as a hard error so the user can retry.
        setErrorMsg(
          connected
            ? "We didn't catch any speech. Make sure your mic isn't muted and try again."
            : "Couldn't reach the transcription service. Check your network and try again.",
        );
        setState("error");
        setSaving(false);
        return;
      }
      const finalTitle =
        title.trim() ||
        `${labels.meeting.singular} ${new Date().toLocaleString(undefined, {
          dateStyle: "short",
          timeStyle: "short",
        })}`;
      await onComplete({ ...result, title: finalTitle });
      // Reset for "record another" — but parent typically navigates away.
      setSegments([]);
      setElapsedSec(0);
      setTitle("");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Couldn't save the recording");
    } finally {
      setSaving(false);
    }
  }

  function handlePause() {
    recorderRef.current?.pause();
  }

  async function handleResume() {
    await recorderRef.current?.resume();
  }

  const isLive = state === "recording" || state === "paused";
  const isBusy = state === "starting" || state === "stopping" || state === "permission";
  const softCapReached = elapsedSec >= SOFT_DURATION_WARN_SEC;
  const remainingToHardCap = Math.max(0, HARD_DURATION_CAP_SEC - elapsedSec);

  // Browser doesn't support the recording stack — show a fallback panel
  // pointing at the existing upload-a-file flow. This is the first thing
  // rendered so a user on (say) iOS 15 doesn't see a broken mic button.
  if (!support.ok) {
    return (
      <div className="rounded-2xl border border-border/70 bg-surface p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
          <MicOff className="h-5 w-5 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-base font-medium">Live recording isn't supported here</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Your browser is missing: {support.missing.join(", ")}. On iOS, update to version 16 or
          newer. Or use the <strong>Audio / video</strong> tab to upload a file recorded with
          another app.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Title input (visible during recording for context) */}
      <div className="space-y-1.5">
        <label htmlFor="live-title" className="text-xs text-muted-foreground">
          {labels.meeting.singular} title{" "}
          <span className="text-muted-foreground/60">(optional)</span>
        </label>
        <input
          id="live-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`e.g. ${labels.meeting.singular} on ${new Date().toLocaleDateString()}`}
          className="h-10 w-full rounded-md border border-border/70 bg-background px-3 text-sm outline-none focus:border-brand"
          maxLength={200}
        />
      </div>

      {/* Main mic affordance */}
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border/70 bg-surface p-8">
        <MicButton
          state={state}
          isBusy={isBusy}
          onStart={handleStart}
          onStop={handleStop}
          reduceMotion={!!reduceMotion}
          level={level}
        />

        {/* Status + duration */}
        <div className="flex flex-col items-center gap-1">
          <p className="font-mono text-2xl font-medium tabular-nums">
            {formatDuration(elapsedSec)}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {state === "idle" && <span>Tap the mic to begin</span>}
            {state === "permission" && <span>Waiting for mic permission…</span>}
            {state === "starting" && <span>Connecting to transcription…</span>}
            {state === "recording" && (
              <>
                {connected ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
                    </span>
                    <span className="font-medium text-foreground">Live</span>
                    <span>— speak naturally</span>
                  </span>
                ) : (
                  <span>Connecting transcription… speak after the dot turns red</span>
                )}
              </>
            )}
            {state === "paused" && <span>Paused — return to this tab to continue</span>}
            {state === "stopping" && <span>Finishing transcript…</span>}
            {state === "stopped" && <span>Saved</span>}
            {state === "error" && <span className="text-destructive">{errorMsg}</span>}
          </div>
        </div>

        {/* Volume meter */}
        {isLive && !reduceMotion && <VolumeMeter level={level} muted={state === "paused"} />}

        {/* Secondary controls */}
        {isLive && (
          <div className="flex items-center gap-2">
            {state === "recording" ? (
              <button
                type="button"
                onClick={handlePause}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/70 bg-background px-4 text-xs font-medium transition-colors hover:bg-accent"
              >
                <Pause className="h-3.5 w-3.5" /> Pause
              </button>
            ) : (
              <button
                type="button"
                onClick={handleResume}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-xs font-medium text-background transition-opacity hover:opacity-90"
              >
                <Play className="h-3.5 w-3.5" /> Resume
              </button>
            )}
            <button
              type="button"
              onClick={handleStop}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-destructive px-4 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              {saving ? "Saving…" : "Stop"}
            </button>
          </div>
        )}
      </div>

      {/* Permission-denied panel — separate from the generic error because
          recovery is different (the user must open browser settings). */}
      <AnimatePresence>
        {permissionDenied && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="rounded-md border border-destructive/40 bg-destructive/5 p-4"
          >
            <div className="flex items-start gap-2 text-sm text-destructive">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">Microphone access blocked</p>
                <p className="text-destructive/80">
                  Grant mic permission in your browser's address bar (click the lock icon next to
                  the URL), then click the mic to try again.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Soft-cap "wrap up soon" banner. Surfaces at 55min so the user can
          finish their thought before AssemblyAI's 3-hour hard cap. */}
      <AnimatePresence>
        {isLive && softCapReached && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-foreground"
          >
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p>
              You've been recording for {Math.floor(elapsedSec / 60)} minutes.
              {remainingToHardCap > 0
                ? ` Sessions auto-stop at 3 hours (${Math.ceil(remainingToHardCap / 60)} min left).`
                : " Stopping now."}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generic error banner (everything except permission-denied) */}
      <AnimatePresence>
        {errorMsg && state === "error" && !permissionDenied && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{errorMsg}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live transcript */}
      <div>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Transcript
        </p>
        <div
          aria-live="polite"
          className="min-h-[120px] max-h-[320px] overflow-y-auto rounded-xl border border-border/70 bg-surface p-5 text-sm leading-relaxed"
        >
          {transcriptText.length === 0 ? (
            <p className="text-muted-foreground">
              {isLive ? "Listening for speech…" : `Words will appear here as you speak.`}
            </p>
          ) : (
            <p>
              {segments.map((seg) =>
                seg.final ? (
                  <span key={seg.id}>{seg.text} </span>
                ) : (
                  <span key={seg.id} className="italic text-muted-foreground">
                    {seg.text}{" "}
                  </span>
                ),
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function MicButton({
  state,
  isBusy,
  onStart,
  onStop,
  reduceMotion,
  level,
}: {
  state: RecorderState;
  isBusy: boolean;
  onStart: () => Promise<void> | void;
  onStop: () => Promise<void> | void;
  reduceMotion: boolean;
  level: number;
}) {
  const recording = state === "recording";
  const paused = state === "paused";
  const error = state === "error";

  const handleClick = () => {
    if (isBusy) return;
    if (state === "idle" || state === "stopped" || error) onStart();
    else if (state === "recording" || state === "paused") onStop();
  };

  return (
    <div className="relative">
      {/* Pulsing rings while recording */}
      {recording && !reduceMotion && (
        <>
          <motion.span
            className="absolute inset-0 rounded-full bg-brand/30"
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: 1 + level * 0.6, opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut", repeat: Infinity }}
            style={{ pointerEvents: "none" }}
          />
          <motion.span
            className="absolute inset-0 rounded-full bg-brand/20"
            initial={{ scale: 1, opacity: 0.4 }}
            animate={{ scale: 1.4, opacity: 0 }}
            transition={{ duration: 1.2, ease: "easeOut", repeat: Infinity, delay: 0.3 }}
            style={{ pointerEvents: "none" }}
          />
        </>
      )}

      <button
        type="button"
        onClick={handleClick}
        disabled={isBusy}
        aria-label={
          recording || paused ? "Stop recording" : isBusy ? "Starting…" : "Start recording"
        }
        className={`relative inline-flex h-24 w-24 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          recording
            ? "bg-destructive text-destructive-foreground"
            : paused
              ? "bg-warning text-foreground"
              : error
                ? "bg-destructive/20 text-destructive"
                : "bg-foreground text-background hover:opacity-90"
        }`}
      >
        {isBusy ? (
          <Loader2 className="h-8 w-8 animate-spin" />
        ) : recording || paused ? (
          <Square className="h-8 w-8 fill-current" />
        ) : error ? (
          <MicOff className="h-8 w-8" />
        ) : (
          <Mic className="h-9 w-9" />
        )}
      </button>
    </div>
  );
}

function VolumeMeter({ level, muted }: { level: number; muted: boolean }) {
  const bars = 12;
  const active = muted ? 0 : Math.round(level * bars);
  return (
    <div className="flex h-6 items-end gap-1">
      {Array.from({ length: bars }, (_, i) => {
        const isActive = i < active;
        const height = 4 + i * 1.5;
        return (
          <span
            key={i}
            className={`w-1 rounded-sm transition-colors ${isActive ? "bg-brand" : "bg-border/70"}`}
            style={{ height: `${Math.min(height, 22)}px` }}
          />
        );
      })}
    </div>
  );
}
