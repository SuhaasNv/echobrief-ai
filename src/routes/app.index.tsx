import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowUpRight, Clock, FileAudio, Sparkles, CheckSquare, Upload, ArrowRight, Loader2 } from "lucide-react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { useMe, useMeetings, useActionItems } from "@/lib/api/hooks";
import { useLabels } from "@/lib/workspace-store";

export const Route = createFileRoute("/app/")({
  head: () => ({ meta: [{ title: "Dashboard — EchoBrief" }] }),
  component: Dashboard,
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function firstName(name: string | null | undefined, email: string): string {
  if (name && name.trim()) return name.trim().split(" ")[0];
  return email.split("@")[0];
}

function Dashboard() {
  const meQuery = useMe();
  const meetingsQuery = useMeetings({ limit: 5 });
  const allMeetingsQuery = useMeetings({ limit: 100 });
  const openActionsQuery = useActionItems({ completed: false });
  const labels = useLabels();

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  // Compute hours-transcribed-per-day for the last 7 days from real meetings.
  const { chartData, totalHours } = useMemo(() => {
    const items = allMeetingsQuery.data?.items ?? [];
    const days: Array<{ d: string; key: string; h: number }> = [];
    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ d: d.toLocaleDateString(undefined, { weekday: "short" }), key, h: 0 });
    }
    let totalSec = 0;
    for (const m of items) {
      const sec = m.duration_sec ?? 0;
      totalSec += sec;
      const dayKey = new Date(m.created_at).toISOString().slice(0, 10);
      const bucket = days.find((b) => b.key === dayKey);
      if (bucket) bucket.h += sec / 3600;
    }
    return { chartData: days, totalHours: totalSec / 3600 };
  }, [allMeetingsQuery.data]);

  const weekHours = chartData.reduce((s, b) => s + b.h, 0);

  const stats = [
    {
      label: `${labels.meeting.plural} indexed`,
      value: meetingsQuery.data ? String(meetingsQuery.data.total) : "—",
      delta: null as string | null,
      icon: FileAudio,
    },
    {
      label: `${labels.actions.plural} pending`,
      value: openActionsQuery.data ? String(openActionsQuery.data.items.length) : "—",
      delta: null,
      icon: CheckSquare,
    },
    { label: "Hours transcribed", value: totalHours > 0 ? totalHours.toFixed(1) : "—", delta: null, icon: Clock },
    { label: "AI summaries", value: "—", delta: null, icon: Sparkles },
  ];

  const recentMeetings = meetingsQuery.data?.items.slice(0, 4) ?? [];
  const openActions = openActionsQuery.data?.items.slice(0, 5) ?? [];
  const meetingsReady = meetingsQuery.data?.items.filter((m) => m.status === "complete").length ?? 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">{today}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {meQuery.data ? `Good to see you, ${firstName(meQuery.data.name, meQuery.data.email)}.` : "Welcome back."}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {meetingsQuery.isLoading || openActionsQuery.isLoading ? (
              "Loading your workspace…"
            ) : (
              <>
                You have <span className="text-foreground">{meetingsReady} {labels.meeting.singular.toLowerCase()}{meetingsReady === 1 ? "" : "s"} ready</span> and{" "}
                <span className="text-foreground">
                  {openActions.length} {labels.actions.singular.toLowerCase()}{openActions.length === 1 ? "" : "s"}
                </span>{" "}
                waiting.
              </>
            )}
          </p>
        </div>
        <Link
          to="/app/upload"
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          <Upload className="h-3.5 w-3.5" /> {labels.meeting.upload_cta}
        </Link>
      </div>

      {/* Stats */}
      <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border/70 bg-border/40 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-surface p-5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <s.icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight">{s.value}</span>
              {s.delta && (
                <span className={`text-xs ${s.delta.startsWith("-") ? "text-muted-foreground" : "text-success"}`}>
                  {s.delta}
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Activity + Action items */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border/70 bg-surface p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-medium">Activity</h3>
              <p className="text-xs text-muted-foreground">Hours transcribed · last 7 days</p>
            </div>
            <span className="rounded-full bg-accent px-2.5 py-1 font-mono text-[10px] text-muted-foreground">{weekHours.toFixed(1)} hrs</span>
          </div>
          <div className="mt-6 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.68 0.16 255)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="oklch(0.68 0.16 255)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="d" tickLine={false} axisLine={false} stroke="oklch(0.62 0.012 264)" tick={{ fontSize: 11 }} />
                <YAxis hide />
                <Tooltip
                  formatter={(v) => [`${typeof v === "number" ? v.toFixed(2) : v} hrs`, "transcribed"]}
                  cursor={{ stroke: "oklch(1 0 0 / 0.1)" }}
                  contentStyle={{
                    background: "oklch(0.17 0.009 264)",
                    border: "1px solid oklch(1 0 0 / 0.08)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area type="monotone" dataKey="h" stroke="oklch(0.68 0.16 255)" strokeWidth={2} fill="url(#area)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-surface p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-medium">{labels.actions.plural}</h3>
            <Link to="/app/action-items" className="text-xs text-muted-foreground hover:text-foreground">
              View all →
            </Link>
          </div>
          {openActionsQuery.isLoading ? (
            <div className="mt-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : openActions.length === 0 ? (
            <p className="mt-6 text-center text-xs text-muted-foreground">No open actions.</p>
          ) : (
            <div className="mt-4 space-y-1.5">
              {openActions.map((a) => (
                <div key={a.id} className="group flex items-start gap-2.5 rounded-md p-2 transition-colors hover:bg-accent/60">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border/80" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{a.description}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {a.assignee_name ?? "Unassigned"}
                      {a.due_date && ` · ${formatDate(a.due_date)}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent meetings */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">Recent {labels.meeting.plural.toLowerCase()}</h3>
          <Link to="/app/meetings" className="text-xs text-muted-foreground hover:text-foreground">
            All {labels.meeting.plural.toLowerCase()} →
          </Link>
        </div>
        {meetingsQuery.isLoading ? (
          <div className="mt-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : recentMeetings.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border/70 bg-surface/40 py-12 text-center">
            <p className="text-sm font-medium">No {labels.meeting.plural.toLowerCase()} yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">Upload your first recording to get started.</p>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-border/70 bg-surface">
            {recentMeetings.map((m, i) => (
              <Link
                key={m.id}
                to="/app/meetings/$id"
                params={{ id: m.id }}
                className={`group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/40 ${i > 0 ? "border-t border-border/60" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{m.title}</p>
                    {m.status !== "complete" && m.status !== "failed" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                        <span className="h-1 w-1 animate-pulse rounded-full bg-warning" /> Processing
                      </span>
                    )}
                  </div>
                  {m.summary_excerpt && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{m.summary_excerpt}</p>
                  )}
                </div>
                <div className="hidden text-right text-xs text-muted-foreground md:block">
                  <div>{formatDate(m.created_at)}</div>
                  <div className="font-mono">{formatDuration(m.duration_sec)}</div>
                </div>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Quick AI prompt */}
      <Link
        to="/app/chat"
        className="mt-6 flex items-center justify-between rounded-xl border border-border/70 bg-surface p-5 transition-colors hover:bg-surface-elevated"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-violet">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-medium">Ask EchoBrief about your meetings</p>
            <p className="text-xs text-muted-foreground">"What did we decide about pricing this quarter?"</p>
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    </div>
  );
}
