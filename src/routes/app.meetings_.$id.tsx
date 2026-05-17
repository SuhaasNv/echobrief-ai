import { useEffect, useState } from "react";
import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
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
} from "lucide-react";
import { toast } from "sonner";
import { useMeeting, useMeetingStatus, useActionItems, useRetryMeeting, useDeleteMeeting, usePatchMeeting, useMeetingAudioUrl } from "@/lib/api/hooks";
import type { MeetingDetail, MeetingStatusResponse } from "@/lib/schemas";

export const Route = createFileRoute("/app/meetings/$id")({
  head: () => ({ meta: [{ title: "Meeting — EchoBrief" }] }),
  component: MeetingDetailPage,
});

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function MeetingDetailPage() {
  const { id } = useParams({ from: "/app/meetings/$id" });
  const navigate = useNavigate();
  const meetingQuery = useMeeting(id);
  const statusQuery = useMeetingStatus(id, meetingQuery.data?.status !== "complete");
  const actionItemsQuery = useActionItems({ meeting_id: id });
  const retry = useRetryMeeting(id);
  const del = useDeleteMeeting();
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
        <Link to="/app/meetings" className="mt-4 inline-block text-sm text-muted-foreground underline-offset-4 hover:underline">
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
                  <Clock className="h-3 w-3" /> <span className="font-mono">{formatDuration(meeting.duration_sec)}</span>
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
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-surface px-3 py-1.5 text-xs hover:bg-accent">
                <Share2 className="h-3 w-3" /> Share
              </button>
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

      {/* Processing / failed / complete branching */}
      {isFailed ? (
        <FailedState meeting={meeting} onRetry={() => retry.mutate()} retrying={retry.isPending} />
      ) : !isComplete ? (
        <ProcessingState status={status} />
      ) : (
        <CompleteBody
          meeting={meeting}
          actionItems={actionItemsQuery.data?.items ?? []}
        />
      )}

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
            if (e.key === "Enter") { e.preventDefault(); save(); }
            if (e.key === "Escape") { setEditing(false); setValue(title); }
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
          {patch.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setValue(title); }}
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
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            {pending ? "Deleting…" : "Delete meeting"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function ProcessingState({ status }: { status: MeetingStatusResponse | undefined }) {
  const steps = [
    { key: "uploaded", label: "Uploaded to storage", detail: "Audio safely landed in encrypted bucket" },
    { key: "transcribed", label: "Transcribed", detail: "Speech-to-text with speaker diarization" },
    { key: "analyzed", label: "Analyzed", detail: "Summary, decisions, and action items extracted" },
    { key: "indexed", label: "Indexed", detail: "Embeddings written for cross-meeting search" },
  ] as const;

  const doneCount = steps.filter((s) => status?.progress?.[s.key]).length;
  const percent = Math.round((doneCount / steps.length) * 100);
  const currentStep = steps.find((s) => !status?.progress?.[s.key]) ?? steps[steps.length - 1];

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="rounded-xl border border-border/70 bg-surface p-8">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-brand" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Processing your meeting…</p>
            <p className="truncate text-xs text-muted-foreground">{currentStep.detail}</p>
          </div>
          <span className="font-mono text-xs text-muted-foreground">{percent}%</span>
        </div>

        {/* Synced progress bar */}
        <div className="relative mt-5 h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand to-violet"
            initial={false}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
          />
          {/* shimmer effect while we're not at 100% */}
          {percent < 100 && (
            <motion.div
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-foreground/15 to-transparent"
              animate={{ x: ["-30%", "330%"] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
              style={{ left: 0 }}
            />
          )}
        </div>

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
                  {done ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : isCurrent ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <span className="h-1 w-1 rounded-full bg-current" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className={done || isCurrent ? "text-foreground" : "text-muted-foreground/70"}>
                    {s.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground/70">{s.detail}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <span>Auto-refreshes every 5 seconds.</span>
          {status?.estimated_seconds_remaining != null && status.estimated_seconds_remaining > 0 && (
            <span className="font-mono">~{Math.ceil(status.estimated_seconds_remaining)}s remaining</span>
          )}
        </div>
      </div>
    </div>
  );
}

function FailedState({
  meeting,
  onRetry,
  retrying,
}: {
  meeting: MeetingDetail;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
          <div>
            <p className="text-sm font-medium">Processing failed.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              EchoBrief couldn't process &ldquo;{meeting.title}&rdquo;. You can retry — most failures resolve on a second attempt.
            </p>
          </div>
        </div>
        <button
          onClick={onRetry}
          disabled={retrying}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-60"
        >
          {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          {retrying ? "Retrying…" : "Retry processing"}
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
  actionItems: Array<{ id: string; description: string; assignee_name: string | null; due_date: string | null; completed: boolean }>;
}) {
  const segments = meeting.transcript?.segments ?? [];
  const chapters = meeting.summary?.chapters ?? [];
  const audio = useMeetingAudioUrl(meeting.id);

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
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Chapters</p>
        <div className="mt-3 space-y-1">
          {chapters.length === 0 ? (
            <p className="text-xs text-muted-foreground">No chapters extracted.</p>
          ) : (
            chapters.map((c) => (
              <button
                key={c.start_sec}
                className="group flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">{formatTimestamp(c.start_sec)}</span>
                <span className="text-foreground/90">{c.title}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Transcript */}
      <div className="min-w-0">
        <div className="mb-4 flex items-center gap-2 rounded-md border border-border/60 bg-surface/60 px-2.5 py-1.5 text-sm text-muted-foreground">
          <Search className="h-3.5 w-3.5" />
          <input placeholder="Search transcript" className="w-full bg-transparent focus:outline-none" />
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
                <button className="mt-0.5 shrink-0 font-mono text-[11px] text-muted-foreground hover:text-foreground">
                  {formatTimestamp(seg.start_sec)}
                </button>
                <div className="min-w-0">
                  {seg.speaker && <p className="text-xs font-medium text-muted-foreground">{seg.speaker}</p>}
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
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">AI Summary</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed">{meeting.summary.executive}</p>
          </div>
        )}

        {meeting.summary && meeting.summary.decisions.length > 0 && (
          <div className="rounded-xl border border-border/70 bg-surface p-5">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Decisions</p>
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
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Action items</p>
            <div className="mt-3 space-y-2">
              {actionItems.map((a) => (
                <div key={a.id} className="flex items-start gap-2 rounded-md border border-border/60 bg-background/40 p-2.5 text-xs">
                  <CheckCircle2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${a.completed ? "text-success" : "text-muted-foreground"}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-foreground ${a.completed ? "line-through opacity-70" : ""}`}>{a.description}</p>
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

        {meeting.meeting_score && (
          <div className="rounded-xl border border-border/70 bg-surface p-5">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Meeting score</p>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight">{meeting.meeting_score.total.toFixed(0)}</span>
              <span className="text-xs text-muted-foreground">/ 100</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{meeting.meeting_score.explanation}</p>
          </div>
        )}
      </aside>
    </div>
    </>
  );
}
