import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Search,
  Sparkles,
  CheckCircle2,
  Share2,
  Trash2,
  ChevronRight,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Clock,
  Users,
  X,
  Pencil,
  Check,
  Copy,
  Link2,
  Link2Off,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import {
  useMeeting,
  useMeetingStatus,
  useActionItems,
  useRetryMeeting,
  useDeleteMeeting,
  usePatchMeeting,
  useMeetingAudioUrl,
  useShareMeeting,
  useFlashcards,
  useGenerateFlashcards,
  useDeleteFlashcard,
  qk,
} from "@/lib/api/hooks";
import { useQueryClient } from "@tanstack/react-query";
import type { MeetingDetail, MeetingStatusResponse } from "@/lib/schemas";
import { useActiveWorkspaceKind, useLabels } from "@/lib/workspace-store";
import { Brain, Sparkle, GraduationCap } from "lucide-react";
import { formatTimestamp, formatDuration, formatDate } from "@/lib/date-utils";
import { ProcessingTrack } from "@/components/app/processing-progress";
import { SpeakerNames } from "@/components/app/speaker-names";
import { percentForStatus, EASE } from "@/lib/processing-status";

export const Route = createFileRoute("/app/meetings_/$id")({
  head: () => ({ meta: [{ title: "Meeting — Puffin" }] }),
  component: MeetingDetailPage,
});

function MeetingDetailPage() {
  const { id } = useParams({ from: "/app/meetings_/$id" });
  const navigate = useNavigate();
  const meetingQuery = useMeeting(id);
  const statusQuery = useMeetingStatus(id, meetingQuery.data?.status !== "complete");
  const actionItemsQuery = useActionItems({ meeting_id: id });
  const retry = useRetryMeeting(id);
  const del = useDeleteMeeting();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const qc = useQueryClient();

  // Only the status endpoint polls. The detail query is fetched once, so when
  // the worker finishes, `meeting.status` is still "processing" and the page
  // renders the skeleton forever. Pull the detail (and the action items the
  // worker just wrote) whenever the polled status diverges from it.
  const polledStatus = statusQuery.data?.status;
  const detailStatus = meetingQuery.data?.status;
  useEffect(() => {
    if (!polledStatus || !detailStatus || polledStatus === detailStatus) return;
    qc.invalidateQueries({ queryKey: qk.meeting(id), exact: true });
    qc.invalidateQueries({ queryKey: qk.actionItems({ meeting_id: id }) });
    // Completion used to be silent — the card just vanished. Announce it once,
    // on the transition into `complete` (not on every render while complete).
    if (polledStatus === "complete") toast.success("Meeting is ready");
  }, [polledStatus, detailStatus, id, qc]);

  const handleDelete = async () => {
    try {
      await del.mutateAsync(id);
      toast.success("Meeting deleted");
      navigate({ to: "/app/meetings" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  if (meetingQuery.isLoading) {
    // A bare centred spinner blanked the whole page on every navigation from
    // the list. Render the page's shape instead so the layout doesn't jump
    // once data lands.
    return (
      <div className="mx-auto max-w-4xl px-4 py-8" aria-busy="true">
        <div className="h-4 w-28 animate-pulse rounded bg-muted/40" />
        <div className="mt-5 h-7 w-2/3 animate-pulse rounded bg-muted/40" />
        <div className="mt-3 h-3 w-44 animate-pulse rounded bg-muted/30" />
        <div className="mt-8 space-y-3 rounded-xl border border-border/70 bg-surface p-8">
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted/40" />
          <div className="h-3 w-full animate-pulse rounded bg-muted/30" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-muted/30" />
          <div className="h-3 w-4/6 animate-pulse rounded bg-muted/30" />
        </div>
        <span className="sr-only">Loading meeting</span>
      </div>
    );
  }

  if (meetingQuery.isError || !meetingQuery.data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h2 className="text-lg font-medium">Meeting not found.</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          It may have been deleted, or you don't have access.
        </p>
        <Link
          to="/app/meetings"
          className="mt-4 inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Back to meetings
        </Link>
      </div>
    );
  }

  const meeting = meetingQuery.data;
  const status = statusQuery.data;
  const isComplete = meeting.status === "complete";
  const isFailed = meeting.status === "failed";

  return (
    <div>
      {/* Top bar */}
      <div className="sticky top-14 z-20 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 py-4 md:px-8">
          <div className="flex items-center gap-3">
            <Link
              to="/app/meetings"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Meetings
            </Link>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{formatDate(meeting.created_at)}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <EditableTitle id={meeting.id} title={meeting.title} />
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />{" "}
                  <span className="font-mono">{formatDuration(meeting.duration_sec)}</span>
                </span>
                {meeting.transcript && (
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" /> {meeting.transcript.speakers.length}
                  </span>
                )}
                {meeting.tags.map((t) => (
                  <span key={t} className="rounded-md bg-accent px-1.5 py-0.5 text-[10px]">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ShareMenu meetingId={meeting.id} shareToken={meeting.share_token} />
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete meeting"
                className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-surface px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Processing / failed / complete branching. The swap used to be a hard
          cut — one frame the progress card, the next the whole transcript.
          Crossfade on opacity only so nothing reflows. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={isFailed ? "failed" : isComplete ? "complete" : "processing"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          {isFailed ? (
            <FailedState
              meeting={meeting}
              status={status}
              onRetry={() => retry.mutate()}
              retrying={retry.isPending}
            />
          ) : !isComplete ? (
            <ProcessingState
              status={status}
              hasAudio={meeting.has_audio}
              transcriptProvided={meeting.transcript_provided}
            />
          ) : (
            <CompleteBody meeting={meeting} actionItems={actionItemsQuery.data?.items ?? []} />
          )}
        </motion.div>
      </AnimatePresence>

      {confirmDelete && (
        <DeleteConfirm
          title={meeting.title}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDelete}
          pending={del.isPending}
        />
      )}
    </div>
  );
}

function EditableTitle({ id, title }: { id: string; title: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const patch = usePatchMeeting(id);

  // If parent title changes (e.g. invalidation), sync local state when not editing.
  useEffect(() => {
    if (!editing) setValue(title);
  }, [title, editing]);

  async function save() {
    const next = value.trim();
    if (!next || next === title) {
      setEditing(false);
      setValue(title);
      return;
    }
    try {
      await patch.mutateAsync({ title: next });
      toast.success("Renamed");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
      setValue(title);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              setEditing(false);
              setValue(title);
            }
          }}
          maxLength={200}
          className="w-full max-w-lg rounded-md border border-border/70 bg-background px-2 py-1 text-2xl font-semibold tracking-tight focus:border-border focus:outline-none"
        />
        <button
          type="button"
          onClick={save}
          disabled={patch.isPending}
          aria-label="Save"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background hover:opacity-90 disabled:opacity-50"
        >
          {patch.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setValue(title);
          }}
          aria-label="Cancel"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Rename meeting"
        title="Rename"
        className="opacity-0 transition-opacity group-hover:opacity-100 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ShareMenu({ meetingId, shareToken }: { meetingId: string; shareToken: string | null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const share = useShareMeeting(meetingId);

  const shareUrl =
    shareToken && typeof window !== "undefined"
      ? `${window.location.origin}/share/${shareToken}`
      : null;

  const handleCreate = async () => {
    try {
      await share.mutateAsync(true);
      toast.success("Public link created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create link");
    }
  };

  const handleReset = async () => {
    try {
      // Disable then re-enable to generate a new token
      await share.mutateAsync(false);
      await share.mutateAsync(true);
      toast.success("Link regenerated");
      setCopied(false); // Reset copied state
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reset link");
    }
  };

  const handleDisable = async () => {
    try {
      await share.mutateAsync(false);
      toast.success("Sharing disabled");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't disable sharing");
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed — select the link manually");
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Share meeting"
        className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-surface px-3 py-1.5 text-xs hover:bg-accent"
      >
        <Share2 className="h-3 w-3" /> Share
      </button>
      {open && (
        <>
          <div role="presentation" onClick={() => setOpen(false)} className="fixed inset-0 z-40" />
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-elegant"
          >
            <div className="border-b border-border/60 px-3 py-2.5">
              <p className="text-sm font-medium">Share this meeting</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Anyone with the link can view the transcript and summary.
              </p>
            </div>
            <div className="p-3">
              {shareUrl ? (
                <>
                  <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5">
                    <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <input
                      readOnly
                      value={shareUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-foreground focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleCopy}
                      aria-label="Copy link"
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {copied ? (
                        <Check className="h-3 w-3 text-success" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                    <a
                      href={shareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open in new tab"
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={handleReset}
                      disabled={share.isPending}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border/70 bg-surface px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-60"
                    >
                      {share.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      Reset link
                    </button>
                    <button
                      type="button"
                      onClick={handleDisable}
                      disabled={share.isPending}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border/70 bg-surface px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
                    >
                      {share.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Link2Off className="h-3 w-3" />
                      )}
                      Disable
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={share.isPending}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {share.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Link2 className="h-3 w-3" />
                  )}
                  Create public link
                </button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
}

function DeleteConfirm({
  title,
  onCancel,
  onConfirm,
  pending,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="relative w-full max-w-sm rounded-xl border border-border/70 bg-popover p-5 shadow-elegant"
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/15">
          <Trash2 className="h-4 w-4 text-destructive" />
        </div>
        <h3 className="mt-4 text-base font-semibold">Delete this meeting?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          &ldquo;{title}&rdquo; will be removed permanently, along with its transcript, summary, and
          all action items. This can&apos;t be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-border/70 bg-surface px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            {pending ? "Deleting…" : "Delete meeting"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function ProcessingState({
  status,
  hasAudio,
  transcriptProvided,
}: {
  status: MeetingStatusResponse | undefined;
  hasAudio: boolean;
  transcriptProvided: boolean;
}) {
  // Three meeting shapes:
  //  1. Audio upload (hasAudio=true, transcriptProvided=false): 4 steps.
  //  2. Pasted transcript (hasAudio=false, transcriptProvided=true): only
  //     analyze + index. No audio was uploaded, no transcription ran.
  //  3. Live recording (hasAudio=true, transcriptProvided=true): audio went
  //     to R2, but transcription already happened in the browser via
  //     AssemblyAI streaming. Skip the "Transcribed" step's description
  //     about diarization (live mode is single-speaker).
  const reduceMotion = useReducedMotion();
  type StepKey = "uploaded" | "transcribed" | "analyzed" | "indexed";
  type Step = { key: StepKey; label: string; detail: string };
  const steps: Step[] = [];
  if (hasAudio) {
    steps.push({
      key: "uploaded",
      label: "Uploaded to storage",
      detail: "Audio safely landed in encrypted bucket",
    });
  }
  if (!transcriptProvided) {
    steps.push({
      key: "transcribed",
      label: "Transcribed",
      detail: "Speech-to-text with speaker diarization",
    });
  }
  steps.push({
    key: "analyzed",
    label: "Analyzed",
    detail: "Summary, decisions, and action items extracted",
  });
  steps.push({
    key: "indexed",
    label: "Indexed",
    detail: "Embeddings written for cross-meeting search",
  });

  const doneCount = steps.filter((s) => status?.progress?.[s.key]).length;
  // Percent comes from the shared status→percent map so this page and the
  // meetings list can never disagree about the same meeting.
  const percent = percentForStatus(status?.status);
  const currentStep = steps.find((s) => !status?.progress?.[s.key]) ?? steps[steps.length - 1];
  const remaining = useCountdown(status?.estimated_seconds_remaining, status?.status);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div
        className="rounded-xl border border-border/70 bg-surface p-8"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-brand" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Processing your meeting…</p>
            <p className="truncate text-xs text-muted-foreground">{currentStep.detail}</p>
          </div>
          <span className="font-mono text-xs text-muted-foreground">{percent}%</span>
        </div>

        <ProcessingTrack percent={percent} className="mt-5" />

        {/* Step list */}
        <div className="mt-6 space-y-3">
          {steps.map((s, i) => {
            const done = status?.progress?.[s.key] ?? false;
            const isCurrent = !done && i === doneCount;
            return (
              <div key={s.key} className="flex items-start gap-3 text-sm">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors ${
                    done
                      ? "bg-success/20 text-success"
                      : isCurrent
                        ? "bg-brand/15 text-brand"
                        : "border border-border/70 text-muted-foreground/60"
                  }`}
                >
                  {/* Finishing a step is the single most meaningful signal on
                      this screen, so give the badge a beat when it flips. */}
                  <AnimatePresence mode="wait" initial={false}>
                    {done ? (
                      <motion.span
                        key="done"
                        initial={reduceMotion ? false : { opacity: 0, scale: 0.6 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: EASE }}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                      </motion.span>
                    ) : isCurrent ? (
                      <motion.span key="current" initial={false}>
                        <Loader2 className="h-3 w-3 animate-spin" />
                      </motion.span>
                    ) : (
                      <motion.span key="pending" initial={false}>
                        <span className="block h-1 w-1 rounded-full bg-current" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <div className="min-w-0">
                  <p
                    className={`transition-colors ${done || isCurrent ? "text-foreground" : "text-muted-foreground/70"}`}
                  >
                    {s.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground/70">{s.detail}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <span>Updates automatically.</span>
          {remaining != null && remaining > 0 && (
            <span className="font-mono">~{remaining}s remaining</span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A time-remaining readout that actually decreases.
 *
 * The server returns a constant estimate (max(30, duration/20)), so rendering
 * it raw parked the number at e.g. "~180s" for three minutes and made the page
 * look frozen. Seed from the server value, tick down locally, and re-seed only
 * when the pipeline advances to a new stage — so it never jumps back up
 * mid-stage just because another poll returned the same constant.
 */
function useCountdown(seconds: number | null | undefined, stage: string | undefined) {
  const [remaining, setRemaining] = useState<number | null>(seconds ?? null);
  const stageRef = useRef(stage);

  useEffect(() => {
    if (seconds == null) return;
    // Re-seed on first value and whenever the stage changes.
    if (stageRef.current !== stage || remaining == null) {
      stageRef.current = stage;
      setRemaining(Math.ceil(seconds));
    }
    // `remaining` is intentionally omitted: including it would re-seed on every
    // tick and the countdown would never move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, stage]);

  useEffect(() => {
    if (remaining == null || remaining <= 0) return;
    const t = setInterval(() => {
      setRemaining((r) => (r == null ? null : Math.max(0, r - 1)));
    }, 1000);
    return () => clearInterval(t);
  }, [remaining]);

  return remaining;
}

/** The server refuses a 4th attempt (meetings.ts) — mirror that here. */
const MAX_RETRIES = 3;

function FailedState({
  meeting,
  status,
  onRetry,
  retrying,
}: {
  meeting: MeetingDetail;
  status: MeetingStatusResponse | undefined;
  onRetry: () => void;
  retrying: boolean;
}) {
  // The API already returns why it failed on both the detail and status
  // payloads; showing "something went wrong" while holding the actual reason
  // just makes the failure unactionable.
  const reason = status?.failure_reason ?? meeting.failure_reason ?? null;
  const attempts = meeting.retry_count ?? 0;
  const exhausted = attempts >= MAX_RETRIES;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Processing failed.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {exhausted ? (
                <>
                  Puffin couldn&rsquo;t process &ldquo;{meeting.title}&rdquo; after {attempts}{" "}
                  attempts. Delete it and upload again, or contact support.
                </>
              ) : (
                <>
                  Puffin couldn&rsquo;t process &ldquo;{meeting.title}&rdquo;. You can retry — most
                  failures resolve on a second attempt.
                </>
              )}
            </p>
            {reason && (
              <p className="mt-3 break-words rounded-md bg-destructive/10 px-2.5 py-2 font-mono text-[11px] text-destructive">
                {reason}
              </p>
            )}
            {attempts > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {attempts} of {MAX_RETRIES} attempts used.
              </p>
            )}
          </div>
        </div>
        <button
          onClick={onRetry}
          disabled={retrying || exhausted}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-60"
        >
          {retrying ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          {retrying ? "Retrying…" : exhausted ? "Retry limit reached" : "Retry processing"}
        </button>
      </div>
    </div>
  );
}

function CompleteBody({
  meeting,
  actionItems,
}: {
  meeting: MeetingDetail;
  actionItems: Array<{
    id: string;
    description: string;
    assignee_name: string | null;
    due_date: string | null;
    completed: boolean;
  }>;
}) {
  const segments = meeting.transcript?.segments ?? [];
  const chapters = meeting.summary?.chapters ?? [];
  const audio = useMeetingAudioUrl(meeting.id);

  // Distinct assignees the analysis step extracted, offered as one-tap names
  // for the diarized voices. Deliberately suggestions, never auto-assignment:
  // an owner named in an action item is not necessarily the person who spoke,
  // and a wrong name on a decision is worse than an anonymous one.
  const nameSuggestions = useMemo(
    () =>
      Array.from(
        new Set(
          actionItems
            .map((a) => a.assignee_name?.trim())
            .filter((n): n is string => !!n && n.length <= 80),
        ),
      ),
    [actionItems],
  );
  const audioRef = useRef<HTMLAudioElement>(null);

  const seekTo = (seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = seconds;
    // play() can reject under autoplay policy — fine if user hasn't unmuted yet.
    void el.play().catch(() => {});
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <>
      {audio.data?.url && (
        <div className="mx-auto max-w-7xl px-4 pt-6 md:px-8">
          <div className="rounded-xl border border-border/70 bg-surface p-4">
            <div className="flex items-center gap-3">
              <Sparkles className="h-3.5 w-3.5 text-brand" />
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Original recording
              </p>
            </div>
            <audio
              ref={audioRef}
              controls
              preload="metadata"
              className="mt-3 w-full"
              src={audio.data.url}
            >
              Your browser doesn't support audio playback.
            </audio>
          </div>
        </div>
      )}
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:px-8 lg:grid-cols-[220px_minmax(0,1fr)_360px]">
        {/* Chapters */}
        <aside className="hidden lg:block">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Chapters
          </p>
          <div className="mt-3 space-y-1">
            {chapters.length === 0 ? (
              <p className="text-xs text-muted-foreground">No chapters extracted.</p>
            ) : (
              chapters.map((c) => (
                <button
                  key={c.start_sec}
                  type="button"
                  onClick={() => seekTo(c.start_sec)}
                  disabled={!audio.data?.url}
                  className="group flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="mt-0.5 font-mono text-[10px] text-muted-foreground group-hover:text-brand">
                    {formatTimestamp(c.start_sec)}
                  </span>
                  <span className="text-foreground/90">{c.title}</span>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Transcript */}
        <div className="min-w-0">
          {meeting.transcript && (
            <SpeakerNames
              meetingId={meeting.id}
              speakers={meeting.transcript.speakers}
              // Names the model already pulled out of the conversation itself.
              // Being named in the meeting is better evidence someone was in
              // the room than a calendar invite they may have declined — and
              // it costs no extra OAuth scope and stores no third-party PII.
              suggestions={nameSuggestions}
            />
          )}
          <div className="mb-4 flex items-center gap-2 rounded-md border border-border/60 bg-surface/60 px-2.5 py-1.5 text-sm text-muted-foreground">
            <Search className="h-3.5 w-3.5" />
            <input
              placeholder="Search transcript"
              className="w-full bg-transparent focus:outline-none"
            />
          </div>
          <div className="space-y-5 rounded-xl border border-border/60 bg-surface p-6">
            {segments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transcript available.</p>
            ) : (
              segments.map((seg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.4) }}
                  className="group flex gap-4"
                >
                  <button
                    type="button"
                    onClick={() => seekTo(seg.start_sec)}
                    disabled={!audio.data?.url}
                    title={audio.data?.url ? "Play from here" : "No audio available"}
                    className="mt-0.5 shrink-0 font-mono text-[11px] text-muted-foreground transition-colors hover:text-brand disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-muted-foreground"
                  >
                    {formatTimestamp(seg.start_sec)}
                  </button>
                  <div className="min-w-0">
                    {seg.speaker && (
                      <p className="text-xs font-medium text-muted-foreground">{seg.speaker}</p>
                    )}
                    <p className="mt-0.5 text-sm leading-relaxed text-foreground/90">{seg.text}</p>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* AI Panel */}
        <aside className="space-y-4">
          {meeting.summary?.executive && (
            <div className="rounded-xl border border-border/70 bg-surface-elevated p-5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-brand" />
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  AI Summary
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed">{meeting.summary.executive}</p>
            </div>
          )}

          {meeting.summary && meeting.summary.decisions.length > 0 && (
            <div className="rounded-xl border border-border/70 bg-surface p-5">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Decisions
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {meeting.summary.decisions.map((d, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
                    <span className="text-foreground/90">{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {actionItems.length > 0 && (
            <div className="rounded-xl border border-border/70 bg-surface p-5">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Action items
              </p>
              <div className="mt-3 space-y-2">
                {actionItems.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start gap-2 rounded-md border border-border/60 bg-background/40 p-2.5 text-xs"
                  >
                    <CheckCircle2
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${a.completed ? "text-success" : "text-muted-foreground"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-foreground ${a.completed ? "line-through opacity-70" : ""}`}
                      >
                        {a.description}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {a.assignee_name ?? "Unassigned"}
                        {a.due_date && ` · ${formatDate(a.due_date)}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <FlashcardsPanel meetingId={meeting.id} />

          {meeting.meeting_score && (
            <MeetingScorePanel
              score={meeting.meeting_score}
              speakers={meeting.transcript?.speakers ?? []}
            />
          )}
        </aside>
      </div>
    </>
  );
}

/**
 * Rewrite "Speaker A" to the name that voice has been given.
 *
 * The score explanation is prose the model wrote at analysis time, so it still
 * says "Speaker A dominated two-thirds of talk time" after the user renames
 * that voice to Maya. Substituting at render keeps the page consistent without
 * re-running the analysis or rewriting stored text.
 */
function applySpeakerNames(text: string, speakers: Array<{ id: string; label: string }>): string {
  let out = text;
  for (const s of speakers) {
    if (s.label === `Speaker ${s.id}`) continue; // unnamed — nothing to swap
    out = out.replaceAll(`Speaker ${s.id}`, s.label);
  }
  return out;
}

function MeetingScorePanel({
  score,
  speakers,
}: {
  score: { total: number; explanation?: string };
  speakers: Array<{ id: string; label: string }>;
}) {
  const labels = useLabels();
  return (
    <div className="rounded-xl border border-border/70 bg-surface p-5">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {labels.meeting.score}
      </p>
      <div className="mt-3 flex items-baseline gap-2">
        {/* SCORE_SYSTEM scores each dimension 0–10 and totals a weighted
            average, so "/ 100" made every meeting look catastrophic. */}
        <span className="text-2xl font-semibold tracking-tight">{score.total.toFixed(1)}</span>
        <span className="text-xs text-muted-foreground">/ 10</span>
      </div>
      {score.explanation && (
        <p className="mt-2 text-xs text-muted-foreground">
          {applySpeakerNames(score.explanation, speakers)}
        </p>
      )}
    </div>
  );
}

function FlashcardsPanel({ meetingId }: { meetingId: string }) {
  const kind = useActiveWorkspaceKind();
  const flashcards = useFlashcards(kind === "student" ? meetingId : undefined);
  const generate = useGenerateFlashcards();
  const del = useDeleteFlashcard();
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  if (kind !== "student") return null;

  const items = flashcards.data?.items ?? [];

  const toggleReveal = (id: string) => {
    setRevealed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGenerate = async () => {
    try {
      await generate.mutateAsync(meetingId);
      toast.success("Flashcards ready");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't generate flashcards");
    }
  };

  return (
    <div className="rounded-xl border border-border/70 bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          <GraduationCap className="h-3.5 w-3.5 text-violet" /> Flashcards
        </p>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generate.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {generate.isPending ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Generating…
            </>
          ) : (
            <>
              <Sparkle className="h-3 w-3" /> {items.length > 0 ? "Regenerate" : "Generate"}
            </>
          )}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {items.length === 0 && !flashcards.isLoading && (
          <p className="rounded-md border border-dashed border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
            <Brain className="mb-1 inline h-3.5 w-3.5 text-muted-foreground" />
            <br />
            Generate flashcards to turn this lecture into study material.
          </p>
        )}
        {items.map((card) => {
          const shown = revealed.has(card.id);
          return (
            <div
              key={card.id}
              className="group rounded-md border border-border/60 bg-background/40 p-3 text-xs"
            >
              <p className="font-medium">{card.question}</p>
              {shown ? (
                <p className="mt-2 text-muted-foreground">{card.answer}</p>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleReveal(card.id)}
                  className="mt-2 text-[11px] text-brand hover:underline"
                >
                  Reveal answer
                </button>
              )}
              <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="font-mono uppercase">{card.difficulty ?? "—"}</span>
                <button
                  type="button"
                  onClick={() => del.mutate(card.id)}
                  className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  aria-label="Delete flashcard"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
