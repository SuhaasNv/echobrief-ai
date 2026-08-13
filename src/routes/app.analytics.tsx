import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Loader2 } from "lucide-react";
import { useMeetings, useActionItems } from "@/lib/api/hooks";
import { useActiveWorkspaceKind } from "@/lib/workspace-store";

export const Route = createFileRoute("/app/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Puffin" }] }),
  component: AnalyticsGate,
});

function AnalyticsGate() {
  const kind = useActiveWorkspaceKind();
  const navigate = useNavigate();
  useEffect(() => {
    if (kind === "student") {
      navigate({ to: "/app", replace: true });
    }
  }, [kind, navigate]);
  if (kind === "student") return null;
  return <AnalyticsPage />;
}

const tooltipStyle = {
  background: "oklch(0.17 0.009 264)",
  border: "1px solid oklch(1 0 0 / 0.08)",
  borderRadius: 8,
  fontSize: 12,
} as const;

function AnalyticsPage() {
  const meetings = useMeetings({ limit: 100 });
  const actionItems = useActionItems();

  const isLoading = meetings.isLoading || actionItems.isLoading;

  const stats = useMemo(() => {
    const items = meetings.data?.items ?? [];
    const actions = actionItems.data?.items ?? [];

    const totalSec = items.reduce((s, m) => s + (m.duration_sec ?? 0), 0);
    const completeMeetings = items.filter((m) => m.status === "complete");
    const avgSec = completeMeetings.length
      ? completeMeetings.reduce((s, m) => s + (m.duration_sec ?? 0), 0) / completeMeetings.length
      : 0;

    const completedCount = actions.filter((a) => a.completed).length;
    const closureRate = actions.length ? Math.round((completedCount / actions.length) * 100) : 0;

    const tagCounts = new Map<string, number>();
    items.forEach((m) => m.tags.forEach((t) => tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)));
    const topTag = [...tagCounts.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      totalHours: (totalSec / 3600).toFixed(1),
      totalMeetings: items.length,
      avgDurationMin: Math.round(avgSec / 60),
      closureRate,
      completedActionItems: completedCount,
      openActionItems: actions.length - completedCount,
      topTag: topTag ? { name: topTag[0], count: topTag[1] } : null,
    };
  }, [meetings.data, actionItems.data]);

  // 12-month frequency: count meetings created in each of the last 12 months.
  const monthlyData = useMemo(() => {
    const items = meetings.data?.items ?? [];
    const now = new Date();
    const buckets: Array<{ m: string; v: number; key: string }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.push({
        m: d.toLocaleDateString(undefined, { month: "short" }),
        v: 0,
        key,
      });
    }
    items.forEach((mtg) => {
      const d = new Date(mtg.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bucket = buckets.find((b) => b.key === key);
      if (bucket) bucket.v += 1;
    });
    return buckets;
  }, [meetings.data]);

  // Status pipeline
  const statusData = useMemo(() => {
    const items = meetings.data?.items ?? [];
    const colors: Record<string, string> = {
      complete: "oklch(0.72 0.15 160)",
      transcribing: "oklch(0.72 0.16 80)",
      analyzing: "oklch(0.68 0.16 255)",
      indexing: "oklch(0.68 0.18 295)",
      queued: "oklch(0.62 0.04 264)",
      failed: "oklch(0.65 0.22 22)",
    };
    const counts = new Map<string, number>();
    items.forEach((m) => counts.set(m.status, (counts.get(m.status) ?? 0) + 1));
    return [...counts.entries()].map(([name, value]) => ({
      name,
      value,
      fill: colors[name] ?? "oklch(0.62 0.04 264)",
    }));
  }, [meetings.data]);

  const actionPie = useMemo(
    () => [
      { name: "Completed", value: stats.completedActionItems, fill: "oklch(0.72 0.15 160)" },
      { name: "Open", value: stats.openActionItems, fill: "oklch(0.68 0.16 255)" },
    ],
    [stats],
  );

  // Top tags (top 6)
  const tagData = useMemo(() => {
    const items = meetings.data?.items ?? [];
    const counts = new Map<string, number>();
    items.forEach((m) => m.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([t, v]) => ({ tag: t, v }));
  }, [meetings.data]);

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-7xl items-center justify-center px-4 py-24">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalMeetings = stats.totalMeetings;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">Analytics</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Real numbers from your meetings. Updates as new recordings finish processing.
      </p>

      {totalMeetings === 0 ? (
        <div className="mt-12 rounded-xl border border-dashed border-border/70 bg-surface/40 py-16 text-center">
          <p className="text-sm font-medium">No data yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload your first meeting to start populating this view.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border/70 bg-border/40 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                l: "Total meeting hours",
                v: stats.totalHours,
                s: `${stats.totalMeetings} meetings`,
              },
              {
                l: "Action item closure",
                v: `${stats.closureRate}%`,
                s: `${stats.completedActionItems} of ${stats.completedActionItems + stats.openActionItems}`,
              },
              {
                l: "Avg. meeting length",
                v: `${stats.avgDurationMin} min`,
                s: "complete meetings only",
              },
              {
                l: "Top tag",
                v: stats.topTag?.name ?? "—",
                s: stats.topTag ? `${stats.topTag.count} meetings` : "no tags yet",
              },
            ].map((s) => (
              <div key={s.l} className="bg-surface p-5">
                <p className="text-xs text-muted-foreground">{s.l}</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{s.v}</p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">{s.s}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="rounded-xl border border-border/70 bg-surface p-6 lg:col-span-2">
              <h3 className="text-base font-medium">Meeting frequency</h3>
              <p className="text-xs text-muted-foreground">
                Meetings created per month · last 12 months
              </p>
              <div className="mt-6 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyData}>
                    <defs>
                      <linearGradient id="freqArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="oklch(0.68 0.18 295)" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="oklch(0.68 0.18 295)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="m"
                      tickLine={false}
                      axisLine={false}
                      stroke="oklch(0.62 0.012 264)"
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis hide allowDecimals={false} />
                    <Tooltip
                      cursor={{ stroke: "oklch(1 0 0 / 0.1)" }}
                      contentStyle={tooltipStyle}
                    />
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke="oklch(0.68 0.18 295)"
                      strokeWidth={2}
                      fill="url(#freqArea)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-surface p-6">
              <h3 className="text-base font-medium">Action items</h3>
              <p className="text-xs text-muted-foreground">Completed vs open</p>
              <div className="mt-3 h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={actionPie}
                      dataKey="value"
                      innerRadius={50}
                      outerRadius={75}
                      stroke="none"
                      paddingAngle={2}
                    >
                      {actionPie.map((s) => (
                        <Cell key={s.name} fill={s.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 space-y-1.5">
                {actionPie.map((s) => (
                  <div key={s.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: s.fill }} />
                      {s.name}
                    </span>
                    <span className="font-mono text-muted-foreground">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-surface p-6">
              <h3 className="text-base font-medium">Pipeline status</h3>
              <p className="text-xs text-muted-foreground">Where every meeting stands right now</p>
              <div className="mt-3 h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      dataKey="value"
                      innerRadius={50}
                      outerRadius={75}
                      stroke="none"
                      paddingAngle={2}
                    >
                      {statusData.map((s) => (
                        <Cell key={s.name} fill={s.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 space-y-1.5">
                {statusData.map((s) => (
                  <div key={s.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: s.fill }} />
                      {s.name}
                    </span>
                    <span className="font-mono text-muted-foreground">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {tagData.length > 0 && (
              <div className="rounded-xl border border-border/70 bg-surface p-6 lg:col-span-2">
                <h3 className="text-base font-medium">Top tags</h3>
                <p className="text-xs text-muted-foreground">Most-used tags across your meetings</p>
                <div className="mt-6 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={tagData} barSize={28}>
                      <XAxis
                        dataKey="tag"
                        tickLine={false}
                        axisLine={false}
                        stroke="oklch(0.62 0.012 264)"
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis hide allowDecimals={false} />
                      <Tooltip
                        cursor={{ fill: "oklch(1 0 0 / 0.04)" }}
                        contentStyle={tooltipStyle}
                      />
                      <Bar dataKey="v" radius={[6, 6, 0, 0]} fill="oklch(0.72 0.15 160)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
