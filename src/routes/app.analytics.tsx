import { createFileRoute } from "@tanstack/react-router";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";

export const Route = createFileRoute("/app/analytics")({
  head: () => ({ meta: [{ title: "Analytics — EchoBrief" }] }),
  component: AnalyticsPage,
});

const freq = Array.from({ length: 12 }).map((_, i) => ({
  m: ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"][i],
  v: 8 + Math.round(Math.sin(i * 0.7) * 6 + i * 0.8),
}));

const sentiment = Array.from({ length: 7 }).map((_, i) => ({
  d: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
  v: 0.2 + Math.abs(Math.sin(i * 1.1)) * 0.6,
}));

const speakers = [
  { name: "Maya", value: 32, fill: "oklch(0.68 0.16 255)" },
  { name: "David", value: 24, fill: "oklch(0.68 0.18 295)" },
  { name: "Priya", value: 18, fill: "oklch(0.72 0.15 160)" },
  { name: "Liam", value: 14, fill: "oklch(0.78 0.14 80)" },
  { name: "Others", value: 12, fill: "oklch(0.62 0.04 264)" },
];

function AnalyticsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">Analytics</h1>
      <p className="mt-1 text-sm text-muted-foreground">How your team meets, decides, and follows through.</p>

      <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border/70 bg-border/40 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Total meeting hours", v: "184.2", s: "↑ 12% MoM" },
          { l: "Action item closure", v: "87%", s: "↑ 4 pts" },
          { l: "Avg. meeting length", v: "38 min", s: "↓ 6 min" },
          { l: "Top topic", v: "Pricing", s: "32 meetings" },
        ].map((s) => (
          <div key={s.l} className="bg-surface p-5">
            <p className="text-xs text-muted-foreground">{s.l}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{s.v}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{s.s}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-border/70 bg-surface p-6">
          <h3 className="text-base font-medium">Meeting frequency</h3>
          <p className="text-xs text-muted-foreground">Meetings per month, last 12 months</p>
          <div className="mt-6 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={freq}>
                <defs>
                  <linearGradient id="freqArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.68 0.18 295)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="oklch(0.68 0.18 295)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="m" tickLine={false} axisLine={false} stroke="oklch(0.62 0.012 264)" tick={{ fontSize: 11 }} />
                <Tooltip
                  cursor={{ stroke: "oklch(1 0 0 / 0.1)" }}
                  contentStyle={{ background: "oklch(0.17 0.009 264)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 8, fontSize: 12 }}
                />
                <Area type="monotone" dataKey="v" stroke="oklch(0.68 0.18 295)" strokeWidth={2} fill="url(#freqArea)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-surface p-6">
          <h3 className="text-base font-medium">Speaking ratio</h3>
          <p className="text-xs text-muted-foreground">This week</p>
          <div className="mt-3 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={speakers} dataKey="value" innerRadius={50} outerRadius={75} stroke="none" paddingAngle={2}>
                  {speakers.map((s) => <Cell key={s.name} fill={s.fill} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 space-y-1.5">
            {speakers.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.fill }} />
                  {s.name}
                </span>
                <span className="font-mono text-muted-foreground">{s.value}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3 rounded-xl border border-border/70 bg-surface p-6">
          <h3 className="text-base font-medium">Sentiment trend</h3>
          <p className="text-xs text-muted-foreground">Avg. positive sentiment, last 7 days</p>
          <div className="mt-6 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sentiment} barSize={28}>
                <XAxis dataKey="d" tickLine={false} axisLine={false} stroke="oklch(0.62 0.012 264)" tick={{ fontSize: 11 }} />
                <Tooltip
                  cursor={{ fill: "oklch(1 0 0 / 0.04)" }}
                  contentStyle={{ background: "oklch(0.17 0.009 264)", border: "1px solid oklch(1 0 0 / 0.08)", borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="v" radius={[6, 6, 0, 0]} fill="oklch(0.72 0.15 160)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
