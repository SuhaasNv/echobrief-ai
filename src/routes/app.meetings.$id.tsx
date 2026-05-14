import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Play,
  Pause,
  Search,
  Sparkles,
  CheckCircle2,
  TrendingUp,
  Smile,
  Share2,
  MoreHorizontal,
  ChevronRight,
} from "lucide-react";
import { meetings, transcriptLines } from "@/lib/mock-data";

export const Route = createFileRoute("/app/meetings/$id")({
  head: () => ({ meta: [{ title: "Meeting — EchoBrief" }] }),
  component: MeetingDetail,
});

const chapters = [
  { t: "00:00", title: "Opening & context" },
  { t: "00:30", title: "Launch date proposal" },
  { t: "01:30", title: "Marketing & comms" },
  { t: "02:15", title: "Pricing tier decisions" },
];

function MeetingDetail() {
  const { id } = useParams({ from: "/app/meetings/$id" });
  const meeting = meetings.find((m) => m.id === id) ?? meetings[0];
  const [playing, setPlaying] = useState(false);

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
            <span className="text-xs text-muted-foreground">{meeting.date}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{meeting.title}</h1>
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex -space-x-1.5">
                  {meeting.participants.map((p) => (
                    <div
                      key={p.name}
                      title={p.name}
                      className={`flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-medium text-white ring-2 ring-background ${p.color}`}
                    >
                      {p.initials}
                    </div>
                  ))}
                </div>
                <span>{meeting.participants.length} participants</span>
                <span>·</span>
                <span className="font-mono">{meeting.duration}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-surface px-3 py-1.5 text-xs hover:bg-accent">
                <Share2 className="h-3 w-3" /> Share
              </button>
              <button className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/70 bg-surface text-muted-foreground hover:bg-accent">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Player */}
          <div className="mt-5 flex items-center gap-3 rounded-lg border border-border/60 bg-surface px-3 py-2">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background transition-transform hover:scale-105"
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 translate-x-px" />}
            </button>
            <span className="font-mono text-xs text-muted-foreground">00:42</span>
            <div className="flex h-7 flex-1 items-center gap-[2px]">
              {Array.from({ length: 120 }).map((_, i) => (
                <span
                  key={i}
                  className="w-[2px] rounded-full bg-foreground/40"
                  style={{ height: `${15 + Math.abs(Math.sin(i * 0.4)) * 75}%`, opacity: i < 18 ? 1 : 0.3 }}
                />
              ))}
            </div>
            <span className="font-mono text-xs text-muted-foreground">{meeting.duration}</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:px-8 lg:grid-cols-[220px_minmax(0,1fr)_360px]">
        {/* Chapters */}
        <aside className="hidden lg:block">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Chapters</p>
          <div className="mt-3 space-y-1">
            {chapters.map((c, i) => (
              <button
                key={c.t}
                className={`group flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                  i === 1 ? "bg-accent" : ""
                }`}
              >
                <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">{c.t}</span>
                <span className="text-foreground/90">{c.title}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Transcript */}
        <div className="min-w-0">
          <div className="mb-4 flex items-center gap-2 rounded-md border border-border/60 bg-surface/60 px-2.5 py-1.5 text-sm text-muted-foreground">
            <Search className="h-3.5 w-3.5" />
            <input placeholder="Search transcript" className="w-full bg-transparent focus:outline-none" />
          </div>
          <div className="space-y-5 rounded-xl border border-border/60 bg-surface p-6">
            {transcriptLines.map((l, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="group flex gap-4"
              >
                <button className="mt-0.5 shrink-0 font-mono text-[11px] text-muted-foreground hover:text-foreground">
                  {l.t}
                </button>
                <div className="min-w-0">
                  <p className={`text-xs font-medium text-${l.color}`}>{l.who}</p>
                  <p
                    className={`mt-0.5 text-sm leading-relaxed ${
                      l.highlight
                        ? "rounded-md bg-brand/10 px-2 py-1 text-foreground ring-1 ring-brand/20"
                        : "text-foreground/90"
                    }`}
                  >
                    {l.text}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* AI Panel */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-surface-elevated p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-brand" />
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">AI Summary</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed">
              The team aligned on a <span className="rounded bg-brand/15 px-1 text-brand">September 18</span> launch
              date. Engineering will own the rollout doc, marketing needs confirmation by Monday, and the legacy
              Starter tier will continue through end of year.
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-surface p-5">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Decisions</p>
            <ul className="mt-3 space-y-2 text-sm">
              {[
                "Q3 launch date set to September 18",
                "Keep Starter tier through end of year",
                "Engineering owns the rollout doc",
              ].map((d) => (
                <li key={d} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
                  <span className="text-foreground/90">{d}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-border/70 bg-surface p-5">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Action items</p>
            <div className="mt-3 space-y-2">
              {[
                { t: "Confirm Sept 18 with marketing", who: "Maya", due: "Today" },
                { t: "Draft engineering rollout doc", who: "David", due: "Tomorrow" },
                { t: "Partner outreach to top 5", who: "Priya", due: "Fri" },
              ].map((a) => (
                <div key={a.t} className="flex items-start gap-2 rounded-md border border-border/60 bg-background/40 p-2.5 text-xs">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground">{a.t}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{a.who} · {a.due}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border/70 bg-surface p-4">
              <Smile className="h-3.5 w-3.5 text-success" />
              <p className="mt-2 text-xs text-muted-foreground">Sentiment</p>
              <p className="text-sm font-medium">Positive</p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">+0.42</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-surface p-4">
              <TrendingUp className="h-3.5 w-3.5 text-brand" />
              <p className="mt-2 text-xs text-muted-foreground">Talk balance</p>
              <p className="text-sm font-medium">Even</p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">4 speakers</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
