import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Search, Filter, Plus, Clock, Loader2, Users, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMeetings, useDeleteMeeting } from "@/lib/api/hooks";
import { useLabels } from "@/lib/workspace-store";

// Map server status string → progress percent for the inline bar.
const STATUS_PERCENT: Record<string, number> = {
  queued: 5,
  transcribing: 30,
  analyzing: 60,
  indexing: 85,
  complete: 100,
  failed: 0,
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued · waiting for a free worker",
  transcribing: "Transcribing audio with AssemblyAI",
  analyzing: "Extracting summary + action items",
  indexing: "Indexing for semantic search",
};

export const Route = createFileRoute("/app/meetings")({
  head: () => ({ meta: [{ title: "Meetings — EchoBrief" }] }),
  component: MeetingsPage,
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function MeetingsPage() {
  const [q, setQ] = useState("");
  const { data, isLoading, isError, refetch } = useMeetings({ q: q || undefined, limit: 50 });
  const del = useDeleteMeeting();
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
  const labels = useLabels();

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await del.mutateAsync(confirmDelete.id);
      toast.success(`Deleted "${confirmDelete.title}"`);
      setConfirmDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{labels.meeting.plural}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data ? `${data.total} indexed ${labels.meeting.plural.toLowerCase()}.` : "Loading…"}
          </p>
        </div>
        <Link
          to="/app/upload"
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          <Plus className="h-3.5 w-3.5" /> {labels.meeting.upload_cta}
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-border/60 bg-surface/60 px-2.5 py-1.5 text-sm text-muted-foreground">
          <Search className="h-3.5 w-3.5" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title, participant, or topic"
            className="w-full bg-transparent focus:outline-none"
          />
        </div>
        <button className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-surface/60 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
          <Filter className="h-3.5 w-3.5" /> Filter
        </button>
      </div>

      {isLoading ? (
        <div className="mt-12 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="mt-12 rounded-xl border border-border/70 bg-surface p-10 text-center">
          <p className="text-sm font-medium">Could not load {labels.meeting.plural.toLowerCase()}.</p>
          <button onClick={() => refetch()} className="mt-3 text-sm text-muted-foreground underline-offset-4 hover:underline">
            Try again
          </button>
        </div>
      ) : data && data.items.length === 0 ? (
        <div className="mt-12 rounded-xl border border-dashed border-border/70 bg-surface/40 py-16 text-center">
          <p className="text-sm font-medium">No {labels.meeting.plural.toLowerCase()} yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">Upload your first recording to get started.</p>
          <Link
            to="/app/upload"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            <Plus className="h-3.5 w-3.5" /> {labels.meeting.upload_cta}
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-3">
          {data?.items.map((m) => (
            <div key={m.id} className="group relative">
              {/* Delete button as a SIBLING of the link — nesting a <button>
                  inside an <a> is invalid HTML and breaks card-body clicks. */}
              <button
                type="button"
                onClick={() => setConfirmDelete({ id: m.id, title: m.title })}
                aria-label={`Delete ${m.title}`}
                title="Delete meeting"
                className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <Link
                to="/app/meetings/$id"
                params={{ id: m.id }}
                className="block rounded-xl border border-border/70 bg-surface p-5 transition-colors hover:bg-surface-elevated"
              >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-medium">{m.title}</h3>
                    {m.status === "complete" ? (
                      <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] text-success">Ready</span>
                    ) : m.status === "failed" ? (
                      <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
                        Failed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                        <span className="h-1 w-1 animate-pulse rounded-full bg-warning" /> Processing
                      </span>
                    )}
                    {m.tags.map((t) => (
                      <span key={t} className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                  {m.summary_excerpt && (
                    <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{m.summary_excerpt}</p>
                  )}

                  {/* Inline progress bar for processing meetings */}
                  {m.status !== "complete" && m.status !== "failed" && (
                    <div className="mt-3 max-w-md">
                      <div className="relative h-1 w-full overflow-hidden rounded-full bg-muted/30">
                        <motion.div
                          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand to-violet"
                          initial={false}
                          animate={{ width: `${STATUS_PERCENT[m.status] ?? 5}%` }}
                          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
                        />
                        <motion.div
                          className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-foreground/15 to-transparent"
                          animate={{ x: ["-30%", "330%"] }}
                          transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                          style={{ left: 0 }}
                        />
                      </div>
                      <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                        {STATUS_LABEL[m.status] ?? m.status} · {STATUS_PERCENT[m.status] ?? 5}%
                      </p>
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="font-mono">{formatDate(m.created_at)}</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {formatDuration(m.duration_sec)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" /> {m.participant_count}
                    </span>
                    <span>
                      {m.action_item_count} action{m.action_item_count === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              </div>
              </Link>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-sm rounded-xl border border-border/70 bg-popover p-5 shadow-elegant"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/15">
              <Trash2 className="h-4 w-4 text-destructive" />
            </div>
            <h3 className="mt-4 text-base font-semibold">Delete this meeting?</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              &ldquo;{confirmDelete.title}&rdquo; and all its transcript, summary, and action items will be
              removed. This can&apos;t be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={del.isPending}
                className="rounded-md border border-border/70 bg-surface px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={del.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {del.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                {del.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
