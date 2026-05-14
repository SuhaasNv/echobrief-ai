import { motion } from "framer-motion";
import { CheckCircle2, FileAudio, Sparkles, Users } from "lucide-react";

const transcript = [
  { t: "00:42", who: "Maya Chen", text: "Let's lock in the Q3 launch date — I'm proposing September 18.", color: "brand" },
  { t: "00:58", who: "David Park", text: "That works on engineering. Pricing page redesign ships before then.", color: "violet" },
  { t: "01:14", who: "Priya Rao", text: "I'll own the partner outreach by next Friday.", color: "success" },
];

export function DashboardPreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      className="relative mx-auto w-full max-w-6xl"
    >
      <div className="absolute -inset-x-20 -top-20 h-72 rounded-full bg-brand/20 opacity-60 blur-3xl" />
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-elegant">
        {/* window chrome */}
        <div className="flex items-center justify-between border-b border-border/60 bg-surface-elevated/60 px-4 py-2.5">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">echobrief.app/meetings/q3-planning</span>
          <span className="w-12" />
        </div>

        <div className="grid gap-px bg-border/40 md:grid-cols-[260px_minmax(0,1fr)_320px]">
          {/* sidebar */}
          <div className="hidden bg-sidebar p-4 md:block">
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-accent/60 px-2 py-2">
              <div className="h-6 w-6 rounded-md bg-gradient-to-br from-brand to-violet" />
              <span className="text-sm font-medium">Acme Workspace</span>
            </div>
            {["Dashboard", "Meetings", "Upload", "AI Chat", "Action Items", "Analytics"].map((it, i) => (
              <div
                key={it}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                  i === 1 ? "bg-accent text-foreground" : "text-muted-foreground"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />
                {it}
              </div>
            ))}
          </div>

          {/* transcript */}
          <div className="bg-surface p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Meeting</p>
                <h3 className="mt-1 text-lg font-semibold tracking-tight">Q3 Planning Sync</h3>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> 6 participants · 47 min
              </div>
            </div>
            {/* waveform */}
            <div className="mb-5 flex h-12 items-center gap-[3px] rounded-lg bg-accent/40 px-3">
              {Array.from({ length: 64 }).map((_, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-foreground/30"
                  style={{ height: `${20 + Math.abs(Math.sin(i * 0.6)) * 70}%`, opacity: i < 22 ? 1 : 0.35 }}
                />
              ))}
            </div>
            <div className="space-y-4">
              {transcript.map((line, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + i * 0.15 }}
                  className="flex gap-3"
                >
                  <span className="mt-0.5 font-mono text-[11px] text-muted-foreground">{line.t}</span>
                  <div className="min-w-0">
                    <p className={`text-xs font-medium text-${line.color}`}>{line.who}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-foreground/90">{line.text}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* AI panel */}
          <div className="hidden bg-surface-elevated p-5 md:block">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-brand" />
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">AI Summary</span>
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">
              The team aligned on a <span className="rounded bg-brand/15 px-1 text-brand">September 18</span> launch,
              contingent on the pricing page redesign and partner outreach completing by month-end.
            </p>
            <div className="mt-5 space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Action items</p>
              {[
                { who: "Priya", task: "Partner outreach", due: "Fri" },
                { who: "David", task: "Pricing page v2", due: "Aug 30" },
                { who: "Maya", task: "Confirm launch date", due: "Today" },
              ].map((a) => (
                <div
                  key={a.task}
                  className="flex items-center justify-between rounded-md border border-border/70 bg-surface px-2.5 py-2 text-xs"
                >
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-foreground">{a.task}</span>
                  </span>
                  <span className="font-mono text-muted-foreground">{a.who} · {a.due}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-2 rounded-md border border-border/70 bg-surface px-2.5 py-2 text-xs text-muted-foreground">
              <FileAudio className="h-3.5 w-3.5" /> Indexed across 142 meetings
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
