import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Filter, Plus, Clock } from "lucide-react";
import { meetings } from "@/lib/mock-data";

export const Route = createFileRoute("/app/meetings")({
  head: () => ({ meta: [{ title: "Meetings — EchoBrief" }] }),
  component: MeetingsPage,
});

function MeetingsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Meetings</h1>
          <p className="mt-1 text-sm text-muted-foreground">{meetings.length} indexed conversations.</p>
        </div>
        <Link
          to="/app/upload"
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          <Plus className="h-3.5 w-3.5" /> New meeting
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-border/60 bg-surface/60 px-2.5 py-1.5 text-sm text-muted-foreground">
          <Search className="h-3.5 w-3.5" />
          <input placeholder="Search by title, participant, or topic" className="w-full bg-transparent focus:outline-none" />
        </div>
        <button className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-surface/60 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
          <Filter className="h-3.5 w-3.5" /> Filter
        </button>
      </div>

      <div className="mt-6 grid gap-3">
        {meetings.map((m) => (
          <Link
            key={m.id}
            to="/app/meetings/$id"
            params={{ id: m.id }}
            className="group rounded-xl border border-border/70 bg-surface p-5 transition-colors hover:bg-surface-elevated"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-medium">{m.title}</h3>
                  {m.status === "processing" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                      <span className="h-1 w-1 animate-pulse rounded-full bg-warning" /> Processing
                    </span>
                  ) : (
                    <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] text-success">Ready</span>
                  )}
                  {m.tags.map((t) => (
                    <span key={t} className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </div>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{m.summary}</p>
                <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="font-mono">{m.date}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {m.duration}</span>
                  <span>{m.actionCount} actions</span>
                </div>
              </div>
              <div className="flex shrink-0 -space-x-2">
                {m.participants.map((p) => (
                  <div
                    key={p.name}
                    className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br text-[11px] font-medium text-white ring-2 ring-surface ${p.color}`}
                  >
                    {p.initials}
                  </div>
                ))}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
