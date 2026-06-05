import { createFileRoute, Link } from "@tanstack/react-router";
import { FileAudio, Loader2, FileText, Users } from "lucide-react";
import { useMeetings } from "@/lib/api/hooks";
import { formatDate } from "@/lib/date-utils";
import { useLabels } from "@/lib/workspace-store";

export const Route = createFileRoute("/app/shared")({
  head: () => ({ meta: [{ title: "Shared Meetings — EchoBrief" }] }),
  component: SharedPage,
});

function SharedPage() {
  const { data, isLoading, isError, refetch } = useMeetings({ status: "complete", limit: 50 });
  const items = data?.items ?? [];
  const labels = useLabels();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">{labels.notes.library}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every processed {labels.meeting.singular.toLowerCase()} becomes a searchable, citable note.
        Click any card to open the full transcript, summary, and action items.
      </p>

      {isLoading ? (
        <div className="mt-12 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="mt-12 rounded-xl border border-border/70 bg-surface p-10 text-center">
          <p className="text-sm font-medium">Could not load notes.</p>
          <button
            onClick={() => refetch()}
            className="mt-3 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="mt-12 rounded-xl border border-dashed border-border/70 bg-surface/40 py-16 text-center">
          <FileText className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Your notes library is empty.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload a meeting or paste a transcript to start building it.
          </p>
          <Link
            to="/app/upload"
            className="mt-4 inline-block rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            Upload your first
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {items.map((m) => (
            <Link
              key={m.id}
              to="/app/meetings/$id"
              params={{ id: m.id }}
              className="group rounded-xl border border-border/70 bg-surface p-5 transition-colors hover:bg-surface-elevated"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="text-base font-medium">{m.title}</h3>
                    {m.tags.slice(0, 4).map((t) => (
                      <span
                        key={t}
                        className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  {m.summary_excerpt && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {m.summary_excerpt}
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="font-mono">{formatDate(m.created_at)}</span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" /> {m.participant_count} speaker
                      {m.participant_count === 1 ? "" : "s"}
                    </span>
                    <span>·</span>
                    <span>
                      {m.action_item_count} action item{m.action_item_count === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
