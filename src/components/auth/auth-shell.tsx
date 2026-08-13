import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Sparkles,
  CheckCircle2,
  Mic,
  MessageSquare,
  Search,
  Users,
  Clock,
  FileAudio,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";

/**
 * No testimonials until someone actually says something.
 *
 * What was here: three invented quotes with invented authors, one of them
 * attributed to "Staff Engineer · Linear" — a real, identifiable company that
 * has said nothing about this product. Putting words in a named company's
 * mouth is not placeholder copy, it is a false endorsement, and it sat directly
 * above a "4.9 / 5 on G2" rating that no one has ever left.
 *
 * The honest substitute is not a better fake quote. It is the product's own
 * claim, which is checkable: this is what the app does with a recording.
 */
const PROMISE = {
  body: "Record a meeting. Get the decisions, the open questions, and who owes what — with the timestamp each one came from, so you can check it.",
};

export function AuthShell({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      {/* left: auth form */}
      <div className="relative flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-1">
            <AnimatedThemeToggler />
            <Link
              to="/"
              className="rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              ← Home
            </Link>
          </div>
        </div>

        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
          }}
          className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center"
        >
          <motion.h1
            variants={fadeUp}
            className="text-3xl font-semibold tracking-tight md:text-[34px]"
          >
            {title}
          </motion.h1>
          <motion.p variants={fadeUp} className="mt-2 text-sm text-muted-foreground">
            {subtitle}
          </motion.p>
          <motion.div variants={fadeUp} className="mt-8">
            {children}
          </motion.div>
        </motion.div>

        <p className="mt-8 text-center text-xs text-muted-foreground">{footer}</p>
      </div>

      {/* right: visual */}
      <RightPanel />
    </div>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  },
};

function RightPanel() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative hidden overflow-hidden border-l border-border/60 bg-surface lg:block">
      <div className="absolute inset-0 bg-grid bg-grid-fade opacity-60" />
      {/* Animated brand orb (low-cost transform animation) */}
      {!reduceMotion && (
        <motion.div
          className="pointer-events-none absolute -left-20 top-1/3 h-80 w-80 rounded-full bg-brand/25 blur-[100px]"
          animate={{ x: [0, 30, 0], y: [0, -16, 0], scale: [1, 1.08, 1] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {reduceMotion && (
        <div className="absolute -left-20 top-1/3 h-80 w-80 rounded-full bg-brand/25 blur-[100px]" />
      )}
      {!reduceMotion && (
        <motion.div
          className="pointer-events-none absolute -right-10 bottom-10 h-72 w-72 rounded-full bg-violet/20 blur-[100px]"
          animate={{ x: [0, -24, 0], y: [0, 18, 0], scale: [1, 1.12, 1] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        />
      )}
      {reduceMotion && (
        <div className="absolute -right-10 bottom-10 h-72 w-72 rounded-full bg-violet/20 blur-[100px]" />
      )}

      {/* Soft scanline accent */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />

      <div className="relative flex h-full flex-col justify-between gap-8 p-12">
        {/* Top: rotating quote card */}
        {/* Labelled "What you get", not "From a customer". The old header made
            a sourcing claim the content could not support. */}
        <div className="glass relative max-w-sm rounded-2xl p-5">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            What you get
          </p>
          <p className="mt-3 text-sm leading-relaxed">{PROMISE.body}</p>
        </div>

        {/* Middle: product preview + feature pills */}
        <div className="space-y-6">
          <FeaturePills />
          <PreviewCard reduceMotion={!!reduceMotion} />
        </div>

        {/* Bottom: stats strip + tagline */}
        <div className="space-y-5">
          <StatStrip />
          <div>
            {/* "5,000+ teams · 4.9 / 5 on G2" removed: no such rating exists
                and nobody counted those teams. The tagline that followed it —
                "Where every conversation becomes structured intelligence" — was
                the fourth variation of one sentence that also appears in the
                page title, the meta description and labels.ts. Replaced with
                the plainest true thing the product does. */}
            <p className="max-w-md text-2xl font-semibold tracking-tight">
              Stop forgetting what your team said.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  { label: "Transcription", icon: Mic },
  { label: "AI summaries", icon: Sparkles },
  { label: "Action items", icon: CheckCircle2 },
  { label: "Cross-meeting Q&A", icon: MessageSquare },
  { label: "Semantic search", icon: Search },
  { label: "Speaker diarization", icon: Users },
] as const;

function FeaturePills() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {FEATURES.map((f, i) => (
        <motion.span
          key={f.label}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 + i * 0.04, duration: 0.35 }}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-surface/70 px-2.5 py-1 text-[11px] text-muted-foreground"
        >
          <f.icon className="h-3 w-3" />
          {f.label}
        </motion.span>
      ))}
    </div>
  );
}

function PreviewCard({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
      className="glass max-w-md rounded-2xl border border-border/70 p-5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileAudio className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-sm font-medium">Q3 Launch sync</p>
        </div>
        <span className="rounded-full bg-success/15 px-1.5 py-0.5 font-mono text-[10px] text-success">
          Ready
        </span>
      </div>
      <p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
        <Clock className="h-3 w-3" /> 47:23 · 4 speakers · Today, 10:30 AM
      </p>

      <div className="mt-4 rounded-md border border-border/50 bg-background/50 p-3">
        <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          Summary
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-foreground/90">
          Team aligned on a <span className="rounded bg-brand/15 px-1 text-brand">Sept 18</span>{" "}
          launch. Engineering owns rollout doc; marketing confirms by Monday.
        </p>
      </div>

      <div className="mt-3 space-y-1.5">
        <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          Action items
        </p>
        {[
          { t: "Confirm Sept 18 with marketing", who: "Maya · Today" },
          { t: "Draft engineering rollout doc", who: "David · Tomorrow" },
          { t: "Partner outreach top 5", who: "Priya · Fri" },
        ].map((a) => (
          <div
            key={a.t}
            className="flex items-start gap-2 rounded-md bg-background/40 px-2.5 py-1.5"
          >
            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] text-foreground/90">{a.t}</p>
              <p className="truncate font-mono text-[9px] text-muted-foreground">{a.who}</p>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

const STATS = [
  { value: "47K+", label: "Hours indexed" },
  { value: "2.1M", label: "Action items" },
  { value: "98%", label: "Word accuracy" },
] as const;

function StatStrip() {
  return (
    <div className="grid max-w-md grid-cols-3 gap-px overflow-hidden rounded-xl border border-border/60 bg-border/40">
      {STATS.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 + i * 0.05, duration: 0.4 }}
          className="bg-surface px-3 py-3 text-center"
        >
          <p className="font-mono text-base font-semibold tracking-tight text-gradient">
            {s.value}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {s.label}
          </p>
        </motion.div>
      ))}
    </div>
  );
}

export function GoogleButton({ label = "Continue with Google" }: { label?: string } = {}) {
  return (
    <button
      type="button"
      className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg border border-border/80 bg-surface/60 px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="#EA4335"
          d="M12 10.2v3.9h5.5c-.2 1.4-1.6 4-5.5 4-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.1 0-.6-.1-1.1-.2-1.6H12z"
        />
      </svg>
      {label}
    </button>
  );
}
