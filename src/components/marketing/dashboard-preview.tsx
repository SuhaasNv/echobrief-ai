import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  FileAudio,
  Sparkles,
  Users,
  Lock,
  Mic,
  Upload,
  MessageSquare,
  CheckSquare,
  BarChart3,
  LayoutGrid,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";

type NavId = "dashboard" | "meetings" | "upload" | "ai-chat" | "action-items" | "analytics";

interface NavItem {
  id: NavId;
  label: string;
  icon: LucideIcon;
  locked: boolean;
}

const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutGrid, locked: false },
  { id: "meetings", label: "Meetings", icon: Mic, locked: false },
  { id: "upload", label: "Upload", icon: Upload, locked: true },
  { id: "ai-chat", label: "AI Chat", icon: MessageSquare, locked: true },
  { id: "action-items", label: "Action Items", icon: CheckSquare, locked: true },
  { id: "analytics", label: "Analytics", icon: BarChart3, locked: true },
];

const transcript = [
  { t: "00:42", who: "Maya Chen", text: "Let's lock in the Q3 launch date — I'm proposing September 18.", color: "brand" },
  { t: "00:58", who: "David Park", text: "That works on engineering. Pricing page redesign ships before then.", color: "violet" },
  { t: "01:14", who: "Priya Rao", text: "I'll own the partner outreach by next Friday.", color: "success" },
];

const meetingList = [
  { title: "Q3 Planning Sync", date: "Aug 14", duration: "47m", tags: ["#planning"], participants: 6 },
  { title: "Pricing Page Review", date: "Aug 13", duration: "32m", tags: ["#product"], participants: 4 },
  { title: "Customer · Northwind", date: "Aug 12", duration: "58m", tags: ["#sales"], participants: 3 },
  { title: "Engineering Standup", date: "Aug 12", duration: "18m", tags: ["#eng"], participants: 8 },
  { title: "Investor Update", date: "Aug 11", duration: "1h 4m", tags: ["#exec"], participants: 5 },
];

export function DashboardPreview() {
  const [view, setView] = useState<NavId>("dashboard");
  const [lockedFeature, setLockedFeature] = useState<NavItem | null>(null);

  const handleNavClick = (item: NavItem) => {
    if (item.locked) {
      setLockedFeature(item);
    } else {
      setView(item.id);
    }
  };

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
          <span className="font-mono text-[11px] text-muted-foreground">
            echobrief.app{view === "dashboard" ? "/meetings/q3-planning" : "/meetings"}
          </span>
          <span className="w-12" />
        </div>

        <div className="relative grid gap-px bg-border/40 md:grid-cols-[260px_minmax(0,1fr)_320px]">
          {/* sidebar — interactive nav */}
          <div className="hidden bg-sidebar p-4 md:block">
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-accent/60 px-2 py-2">
              <div className="h-6 w-6 rounded-md bg-gradient-to-br from-brand to-violet" />
              <span className="text-sm font-medium">Acme Workspace</span>
            </div>
            <div className="space-y-0.5">
              {NAV.map((item) => {
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item)}
                    className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                      active
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    }`}
                  >
                    <item.icon className="h-3.5 w-3.5" strokeWidth={1.6} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.locked && (
                      <Lock className="h-3 w-3 text-muted-foreground/60 transition-colors group-hover:text-brand" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* middle content — `layout` on the wrapper smooths the height
              transition between the two views (Dashboard tends to be taller
              than Meetings list, so swapping caused a visible height pop). */}
          <motion.div
            layout
            transition={{
              layout: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
            }}
            className="relative overflow-hidden bg-surface"
          >
            <AnimatePresence mode="wait" initial={false}>
              {view === "dashboard" && (
                <motion.div
                  key="dashboard"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="p-6"
                >
                  <MeetingView />
                </motion.div>
              )}
              {view === "meetings" && (
                <motion.div
                  key="meetings"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="p-6"
                >
                  <MeetingsList onPickMeeting={() => setView("dashboard")} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* right AI panel */}
          <div className="hidden bg-surface-elevated p-5 md:block">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-brand" />
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                AI Summary
              </span>
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">
              The team aligned on a{" "}
              <span className="rounded bg-brand/15 px-1 text-brand">September 18</span> launch,
              contingent on the pricing page redesign and partner outreach completing by month-end.
            </p>
            <div className="mt-5 space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Action items
              </p>
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
                  <span className="font-mono text-muted-foreground">
                    {a.who} · {a.due}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-2 rounded-md border border-border/70 bg-surface px-2.5 py-2 text-xs text-muted-foreground">
              <FileAudio className="h-3.5 w-3.5" /> Indexed across 142 meetings
            </div>
          </div>

          {/* Locked-feature modal — inline overlay, not portaled */}
          <LockedModal feature={lockedFeature} onClose={() => setLockedFeature(null)} />
        </div>
      </div>
    </motion.div>
  );
}

function MeetingView() {
  return (
    <>
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
            style={{
              height: `${20 + Math.abs(Math.sin(i * 0.6)) * 70}%`,
              opacity: i < 22 ? 1 : 0.35,
            }}
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
    </>
  );
}

function MeetingsList({ onPickMeeting }: { onPickMeeting: () => void }) {
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">All meetings</p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight">Last 30 days</h3>
        </div>
        <span className="text-xs text-muted-foreground">{meetingList.length} meetings</span>
      </div>

      <div className="space-y-2">
        {meetingList.map((m, i) => (
          <motion.button
            key={m.title}
            type="button"
            onClick={onPickMeeting}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 bg-surface-elevated/50 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-surface-elevated"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent">
                <Mic className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{m.title}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {m.date} · {m.duration} · {m.participants} ppl
                </p>
              </div>
            </div>
            <span className="hidden font-mono text-[10px] uppercase tracking-widest text-muted-foreground sm:inline">
              {m.tags.join(" ")}
            </span>
          </motion.button>
        ))}
      </div>
    </>
  );
}

function LockedModal({
  feature,
  onClose,
}: {
  feature: NavItem | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {feature && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-border/80 bg-surface-elevated p-6 shadow-elegant"
          >
            {/* glow */}
            <div className="pointer-events-none absolute -inset-x-12 -top-12 h-32 rounded-full bg-brand/20 blur-3xl" />
            <div className="relative">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border/60 bg-background">
                <feature.icon className="h-4 w-4 text-brand" strokeWidth={1.6} />
              </div>
              <h3 className="mt-4 text-lg font-semibold tracking-tight">
                {feature.label} is part of the full app
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Sign in to try {feature.label.toLowerCase()} on your own meetings — free
                for 14 days, no card.
              </p>
              <div className="mt-5 flex gap-2">
                <Link
                  to="/signup"
                  className="group inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
                >
                  Sign in to try
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-border/60 bg-background px-3 py-2 text-sm transition-colors hover:bg-accent"
                >
                  Not now
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
