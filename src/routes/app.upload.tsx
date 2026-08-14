import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UploadCloud,
  FileAudio,
  FileText,
  Mic,
  X,
  CheckCircle2,
  Sparkles,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  useUploadUrl,
  useConfirmUpload,
  useUploadTranscript,
  useCreateLiveMeeting,
} from "@/lib/api/hooks";
import type { UploadUrlRequest } from "@/lib/schemas";
import { useLabels, useActiveWorkspaceKind } from "@/lib/workspace-store";
import {
  LiveRecorderPanel,
  type LiveRecorderCompletePayload,
} from "@/components/app/live-recorder";

export const Route = createFileRoute("/app/upload")({
  head: () => ({ meta: [{ title: "Upload — EchoBrief" }] }),
  component: UploadPage,
});

const ACCEPT_MIMES: ReadonlyArray<UploadUrlRequest["content_type"]> = [
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/webm",
  "video/mp4",
  "video/webm",
];

const ACCEPT_ATTR = ACCEPT_MIMES.join(",");
const MAX_BYTES = 500 * 1024 * 1024;

// Pre-computed waveform bar heights (avoids any chance of SSR/client
// float-precision hydration mismatch).
const WAVEFORM_HEIGHTS: string[] = Array.from(
  { length: 60 },
  (_, i) => `${(20 + Math.abs(Math.sin(i * 0.6)) * 70).toFixed(4)}%`,
);

type Phase = "idle" | "ready" | "presigning" | "uploading" | "confirming" | "redirecting" | "error";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeMime(file: File): UploadUrlRequest["content_type"] | null {
  const mime = file.type;
  if (ACCEPT_MIMES.includes(mime as UploadUrlRequest["content_type"])) {
    return mime as UploadUrlRequest["content_type"];
  }
  // Some browsers send "" for unknown — fall back to extension.
  const ext = file.name.split(".").pop()?.toLowerCase();
  const guess: Record<string, UploadUrlRequest["content_type"]> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/m4a",
    mp4: "video/mp4",
    webm: "audio/webm",
  };
  return ext && ext in guess ? guess[ext] : null;
}

function uploadToR2(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 upload failed: ${xhr.status} ${xhr.statusText}`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

type Mode = "audio" | "transcript" | "live";

function UploadPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const labels = useLabels();
  const kind = useActiveWorkspaceKind();
  const [mode, setMode] = useState<Mode>("audio");
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Audio-mode title (editable before upload starts)
  const [audioTitle, setAudioTitle] = useState("");

  // Transcript-mode state
  const [transcriptTitle, setTranscriptTitle] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptSubmitting, setTranscriptSubmitting] = useState(false);

  const uploadUrl = useUploadUrl();
  const confirmUpload = useConfirmUpload();
  const uploadTranscript = useUploadTranscript();
  const createLiveMeeting = useCreateLiveMeeting();

  /**
   * After a live recording stops we have an in-memory audio blob + the
   * AssemblyAI transcript. Two-step save:
   *   1. presign + PUT the blob to R2 (reusing the existing upload path)
   *   2. POST /meetings/from-live with the audio_key + transcript text
   * Then navigate to the meeting detail page so the user sees the
   * pipeline-in-progress UI (analyze → embed → score).
   */
  async function handleLiveComplete(payload: LiveRecorderCompletePayload) {
    try {
      // 1. Request presigned URL. We synthesize a filename from the blob's
      //    MIME so the R2 key carries a sensible extension.
      const extMatch = /\/(webm|ogg|mp4|wav|mpeg)/.exec(payload.mime);
      const ext = extMatch ? extMatch[1] : "webm";
      const filename = `live-${Date.now()}.${ext === "mpeg" ? "mp3" : ext}`;

      const presign = await uploadUrl.mutateAsync({
        filename,
        size: payload.blob.size,
        content_type: payload.mime.split(";")[0] as UploadUrlRequest["content_type"],
        duration_sec: payload.durationSec,
        language: "en",
        tags: [],
        title: payload.title,
      });

      // 2. PUT the blob directly to R2.
      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.open("PUT", presign.upload_url);
        xhr.setRequestHeader("Content-Type", payload.mime.split(";")[0] || "audio/webm");
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`R2 upload failed: ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(payload.blob);
      });

      // 3. Persist the meeting + transcript and kick off analysis.
      const result = await createLiveMeeting.mutateAsync({
        title: payload.title,
        transcript_text: payload.transcript,
        audio_key: presign.audio_key,
        audio_size: payload.blob.size,
        audio_mime: payload.mime.split(";")[0] || "audio/webm",
        duration_sec: payload.durationSec,
        language: "en",
        tags: [],
      });

      toast.success("Saved — running analysis");
      navigate({ to: "/app/meetings/$id", params: { id: result.meeting_id } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't save the recording";
      toast.error(msg);
      throw err; // propagate so the recorder panel can surface the error
    }
  }

  const openPicker = () => inputRef.current?.click();

  // File pick / drop → land in "ready" so the user can edit the title first.
  const handleFiles = (incoming: FileList | File[]) => {
    const f = Array.from(incoming)[0];
    if (!f) return;

    if (f.size > MAX_BYTES) {
      toast.error(`File too large — max 500 MB. (${formatSize(f.size)})`);
      return;
    }
    if (!normalizeMime(f)) {
      toast.error("Unsupported file type. Use MP3, WAV, M4A, MP4, or WebM.");
      return;
    }

    setFile(f);
    setAudioTitle(f.name.replace(/\.[^.]+$/, ""));
    setProgress(0);
    setErrorMsg(null);
    setPhase("ready");
  };

  // Start the upload after the user confirms the title.
  const startUpload = async () => {
    if (!file) return;
    const mime = normalizeMime(file);
    if (!mime) return;
    const title = audioTitle.trim() || file.name.replace(/\.[^.]+$/, "");

    try {
      setPhase("presigning");
      const { meeting_id, upload_url } = await uploadUrl.mutateAsync({
        filename: file.name,
        content_type: mime,
        size: file.size,
        title,
        language: "en",
        tags: [],
        // Best-effort recording time. For most recorder exports lastModified
        // is when the recording was written, which beats dating the meeting to
        // whenever the user got round to uploading it. The server rejects
        // implausible values, and 0 means the browser didn't know.
        recorded_at: file.lastModified ? new Date(file.lastModified).toISOString() : undefined,
      });

      setPhase("uploading");
      await uploadToR2(upload_url, file, setProgress);

      setPhase("confirming");
      await confirmUpload.mutateAsync(meeting_id);

      setPhase("redirecting");
      toast.success("Upload complete — processing…");
      navigate({ to: "/app/meetings/$id", params: { id: meeting_id } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setErrorMsg(msg);
      setPhase("error");
      toast.error(msg);
    }
  };

  const reset = () => {
    setFile(null);
    setAudioTitle("");
    setProgress(0);
    setPhase("idle");
    setErrorMsg(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  async function submitTranscript() {
    if (!transcriptTitle.trim()) {
      toast.error("Title is required");
      return;
    }
    if (transcriptText.trim().length < 50) {
      toast.error("Paste at least 50 characters of transcript");
      return;
    }
    setTranscriptSubmitting(true);
    try {
      const res = await uploadTranscript.mutateAsync({
        title: transcriptTitle.trim(),
        transcript_text: transcriptText,
        language: "en",
        tags: [],
      });
      toast.success("Transcript queued for analysis");
      navigate({ to: "/app/meetings/$id", params: { id: res.meeting_id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit transcript");
    } finally {
      setTranscriptSubmitting(false);
    }
  }

  const inProgress = phase !== "idle" && phase !== "error";
  const transcriptWordCount = transcriptText.trim() ? transcriptText.trim().split(/\s+/).length : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">{labels.meeting.upload_cta}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {kind === "student"
          ? "Drop a lecture recording for transcription + AI summary + flashcards, or paste a transcript."
          : "Drop audio for end-to-end transcription, or paste an existing transcript to skip straight to AI analysis."}
      </p>

      {/* Tab selector */}
      <div className="mt-6 inline-flex rounded-lg border border-border/70 bg-surface/60 p-1">
        <button
          type="button"
          onClick={() => setMode("audio")}
          disabled={inProgress}
          className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
            mode === "audio"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileAudio className="h-3.5 w-3.5" /> Audio / video
        </button>
        <button
          type="button"
          onClick={() => setMode("live")}
          disabled={inProgress}
          className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
            mode === "live"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Mic className="h-3.5 w-3.5" /> Record live
          <span className="rounded-full bg-brand/15 px-1.5 py-0 font-mono text-[9px] uppercase tracking-wide text-brand">
            New
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMode("transcript")}
          disabled={inProgress}
          className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
            mode === "transcript"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="h-3.5 w-3.5" /> Paste transcript
        </button>
      </div>

      {mode === "live" ? (
        <div className="mt-8">
          <LiveRecorderPanel onComplete={handleLiveComplete} />
        </div>
      ) : mode === "transcript" ? (
        <TranscriptForm
          title={transcriptTitle}
          setTitle={setTranscriptTitle}
          text={transcriptText}
          setText={setTranscriptText}
          wordCount={transcriptWordCount}
          submitting={transcriptSubmitting}
          onSubmit={submitTranscript}
        />
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
            }}
          />

          <div
            onDragOver={(e) => {
              if (inProgress) return;
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (inProgress) return;
              if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
            }}
            onClick={() => !inProgress && openPicker()}
            className={`group relative mt-8 overflow-hidden rounded-2xl border border-dashed transition-all ${
              inProgress ? "cursor-not-allowed border-border bg-surface/40" : "cursor-pointer"
            } ${drag ? "border-brand/60 bg-brand/5" : !inProgress ? "border-border bg-surface hover:bg-surface-elevated" : ""}`}
          >
            <div className="absolute inset-0 bg-grid bg-grid-fade opacity-30" />
            <div className="relative flex flex-col items-center justify-center px-6 py-20 text-center">
              <motion.div
                animate={{ y: drag ? -4 : 0 }}
                className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-violet shadow-glow"
              >
                <UploadCloud className="h-6 w-6 text-white" />
              </motion.div>
              <p className="mt-5 text-base font-medium">
                {inProgress ? "Upload in progress…" : "Drop a file to transcribe"}
              </p>
              {!inProgress && (
                <p className="mt-1 text-sm text-muted-foreground">or click to browse</p>
              )}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5">
                {["MP3", "WAV", "M4A", "MP4", "WebM"].map((t) => (
                  <span
                    key={t}
                    className="rounded-md bg-accent px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground/70">
                Max 500 MB · Encrypted in transit
              </p>
            </div>
          </div>

          <AnimatePresence>
            {file && phase === "ready" && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 rounded-xl border border-border/70 bg-surface p-5"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent">
                    <FileAudio className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {formatSize(file.size)} · ready to upload
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={reset}
                    aria-label="Choose a different file"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-5 space-y-1.5">
                  <label htmlFor="audio-title" className="text-sm font-medium">
                    Meeting title
                  </label>
                  <input
                    id="audio-title"
                    type="text"
                    value={audioTitle}
                    onChange={(e) => setAudioTitle(e.target.value)}
                    placeholder="e.g. Q3 Launch Sync"
                    maxLength={200}
                    autoFocus
                    className="w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-border focus:outline-none"
                  />
                  <p className="font-mono text-[10px] text-muted-foreground">
                    Default is the filename — change it now or rename later on the meeting page.
                  </p>
                </div>

                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={reset}
                    className="rounded-md border border-border/70 bg-surface px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={startUpload}
                    disabled={!audioTitle.trim()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    <UploadCloud className="h-3 w-3" /> Start upload
                  </button>
                </div>
              </motion.div>
            )}

            {file && phase !== "ready" && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 rounded-xl border border-border/70 bg-surface"
              >
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                  <p className="truncate text-sm font-medium">{audioTitle || file.name}</p>
                  <span className="font-mono text-[10px] text-muted-foreground">{phase}</span>
                </div>
                <div className="flex items-center gap-4 px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent">
                    <FileAudio className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {formatSize(file.size)}
                      </span>
                    </div>
                    {/* Waveform progress */}
                    <div className="mt-2 flex h-6 items-center gap-[2px]">
                      {WAVEFORM_HEIGHTS.map((h, i) => {
                        const reached = (i / 60) * 100 < progress;
                        return (
                          <span
                            key={i}
                            className={`w-[3px] rounded-full transition-colors ${reached ? "bg-brand" : "bg-foreground/15"}`}
                            style={{ height: h }}
                          />
                        );
                      })}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        {phase === "presigning" && (
                          <span className="inline-flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> Requesting upload URL…
                          </span>
                        )}
                        {phase === "uploading" && "Uploading to storage…"}
                        {phase === "confirming" && (
                          <span className="inline-flex items-center gap-1 text-brand">
                            <Sparkles className="h-3 w-3" /> Queueing for transcription…
                          </span>
                        )}
                        {phase === "redirecting" && (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 className="h-3 w-3" /> Done — opening meeting…
                          </span>
                        )}
                        {phase === "error" && (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <AlertTriangle className="h-3 w-3" /> {errorMsg ?? "Upload failed"}
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {progress}%
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={reset}
                    disabled={inProgress}
                    aria-label="Clear"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

function TranscriptForm({
  title,
  setTitle,
  text,
  setText,
  wordCount,
  submitting,
  onSubmit,
}: {
  title: string;
  setTitle: (v: string) => void;
  text: string;
  setText: (v: string) => void;
  wordCount: number;
  submitting: boolean;
  onSubmit: () => void;
}) {
  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="mt-8 space-y-4 rounded-2xl border border-border/70 bg-surface p-6"
    >
      <div className="flex items-start gap-3 rounded-lg border border-brand/30 bg-brand/5 p-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        <p className="text-xs text-foreground/85">
          Already have a transcript from Zoom, Otter, Granola, or a manual write-up? Paste it here
          to skip transcription and jump straight to AI summary + action items + indexing for
          cross-meeting search. <span className="text-muted-foreground">No audio needed.</span>
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="transcript-title" className="text-sm font-medium">
          Meeting title
        </label>
        <input
          id="transcript-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Q3 Launch Sync"
          disabled={submitting}
          className="w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-border focus:outline-none disabled:opacity-50"
          maxLength={200}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="transcript-text" className="text-sm font-medium">
            Transcript
          </label>
          <span className="font-mono text-[10px] text-muted-foreground">
            {wordCount} words · {text.length.toLocaleString()} chars
          </span>
        </div>
        <textarea
          id="transcript-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          placeholder={
            "Paste your transcript here. Speaker labels like\n\nSpeaker 1: …\nSpeaker 2: …\n\nare supported but optional."
          }
          disabled={submitting}
          className="w-full resize-y rounded-md border border-border/70 bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground focus:border-border focus:outline-none disabled:opacity-50"
        />
        <p className="font-mono text-[10px] text-muted-foreground">
          Minimum 50 characters. Max 500,000 (≈ 80,000 words).
        </p>
      </div>

      <button
        type="submit"
        disabled={submitting || !title.trim() || text.trim().length < 50}
        className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {submitting ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Submitting…
          </>
        ) : (
          <>
            <Sparkles className="h-3.5 w-3.5" /> Analyze transcript
          </>
        )}
      </button>
    </motion.form>
  );
}
