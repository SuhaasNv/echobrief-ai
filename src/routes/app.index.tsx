import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowUpRight, Clock, FileAudio, Sparkles, CheckSquare, Upload, ArrowRight } from "lucide-react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  Tooltip,
} from "recharts";
import { meetings, actionItems } from "@/lib/mock-data";

export const Route = createFileRoute("/app/")({
  head: () => ({ meta: [{ title: "Dashboard — EchoBrief" }] }),
  component: Dashboard,
});

const chartData = [
  { d: "Mon", h: 1.2 }, { d: "Tue", h: 3.1 }, { d: "Wed", h: 2.4 },
  { d: "Thu", h: 4.6 }, { d: "Fri", h: 3.2 }, { d: "Sat", h: 0.4 }, { d: "Sun", h: 2.1 },
];

const stats = [
  { label: "Hours transcribed", value: "184.2", delta: "+12%", icon: Clock },
  { label: "Meetings indexed", value: "247", delta: "+8", icon: FileAudio },
  { label: "AI summaries", value: "1,420", delta: "+184", icon: Sparkles },
  { label: "Actions pending", value: "23", delta: "-4", icon: CheckSquare },
];

function Dashboard() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            Thursday, May 14
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Good morning, Maya.</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You have <span className="text-foreground">3 meetings ready</span> and{" "}
            <span className="text-foreground">5 action items</span> waiting.
          </p>
        </div>
        <Link
          to="/app/upload"
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          <Upload className="h-3.5 w-3.5" /> Upload meeting
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
              <span className={`text-xs ${s.delta.startsWith("-") ? "text-muted-foreground" : "text-success"}`}>
                {s.delta}
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Activity + Chart */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-border/70 bg-surface p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-medium">Activity</h3>
              <p className="text-xs text-muted-foreground">Hours transcribed · last 7 days</p>
            </div>
            <span className="rounded-full bg-accent px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
              17.0 hrs
            </span>
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
                <Tooltip
                  cursor={{ stroke: "oklch(1 0 0 / 0.1)" }}
                  contentStyle={{
                    background: "oklch(0.17 0.009 264)",
                    border: "1px solid oklch(1 0 0 / 0.08)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="h"
                  stroke="oklch(0.68 0.16 255)"
                  strokeWidth={2}
                  fill="url(#area)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-surface p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-medium">Action items</h3>
            <Link to="/app/action-items" className="text-xs text-muted-foreground hover:text-foreground">
              View all →
            </Link>
          </div>
          <div className="mt-4 space-y-1.5">
            {actionItems.slice(0, 5).map((a) => (
              <div key={a.id} className="group flex items-start gap-2.5 rounded-md p-2 transition-colors hover:bg-accent/60">
                <button className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border/80">
                  {a.done && <CheckSquare className="h-3 w-3 text-brand" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm ${a.done ? "text-muted-foreground line-through" : ""}`}>{a.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {a.owner} · {a.due}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent meetings */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">Recent meetings</h3>
          <Link to="/app/meetings" className="text-xs text-muted-foreground hover:text-foreground">
            All meetings →
          </Link>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-border/70 bg-surface">
          {meetings.slice(0, 4).map((m, i) => (
            <Link
              key={m.id}
              to="/app/meetings/$id"
              params={{ id: m.id }}
              className={`group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/40 ${
                i > 0 ? "border-t border-border/60" : ""
              }`}
            >
              <div className="flex -space-x-2">
                {m.participants.slice(0, 3).map((p) => (
                  <div
                    key={p.name}
                    className={`flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-medium text-white ring-2 ring-surface ${p.color}`}
                  >
                    {p.initials}
                  </div>
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{m.title}</p>
                  {m.status === "processing" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                      <span className="h-1 w-1 animate-pulse rounded-full bg-warning" />
                      Processing
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{m.summary}</p>
              </div>
              <div className="hidden text-right text-xs text-muted-foreground md:block">
                <div>{m.date}</div>
                <div className="font-mono">{m.duration}</div>
              </div>
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          ))}
        </div>
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
