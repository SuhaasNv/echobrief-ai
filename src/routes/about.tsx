import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Mic, Search, Workflow, Brain, ArrowUpRight } from "lucide-react";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [{ title: "About — EchoBrief" }] }),
  component: AboutPage,
});

const TIMELINE = [
  {
    year: "2024",
    title: "Whisper got good",
    body: "Open-source transcription crossed the accuracy threshold where humans stopped noticing the errors. Suddenly the bottleneck wasn't 'what was said' but 'what does it mean'.",
  },
  {
    year: "2025",
    title: "Long-context LLMs landed",
    body: "Models that could digest a full meeting in one pass arrived in a usable form. Summary became table stakes. The new question: can the meeting itself become a queryable object?",
  },
  {
    year: "2026",
    title: "We built EchoBrief",
    body: "Not because transcription is new. Because every product in this space stops at 'here's the transcript'. We wanted something that treats every meeting as a node in a permanent, searchable knowledge graph.",
  },
];

const PILLARS = [
  {
    Icon: Mic,
    title: "Audio in, intelligence out",
    body: "Upload anything — Zoom export, voice memo, podcast feed. The output is structure: decisions, owners, deadlines, topics.",
  },
  {
    Icon: Brain,
    title: "Cross-meeting memory",
    body: "Vector search over every meeting you've ever uploaded. \"Did we decide on the auth approach?\" gets an answer with the exact 14-second clip cited.",
  },
  {
    Icon: Workflow,
    title: "Pipelines, not chats",
    body: "Action items flow into Notion, Linear, your calendar. Follow-up emails write themselves. The meeting becomes the start of the work, not the end.",
  },
  {
    Icon: Search,
    title: "Search that actually finds things",
    body: "Not keyword search over transcripts. Semantic search over what was meant. \"Concerns about pricing\" pulls every moment a customer hedged on cost — even when they never said the word.",
  },
];

function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-16 md:py-24">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brand">
            About EchoBrief
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-6xl">
            Meetings shouldn't end
            <br />
            <span className="text-gradient-brand">when they end.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            Knowledge workers spend ~22 hours a week in meetings. The decisions
            made in those rooms drive everything — and the moment the call ends,
            most of that signal disappears. EchoBrief is the layer that captures
            it.
          </p>
        </motion.div>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="mt-14 grid gap-3 sm:grid-cols-3"
        >
          {[
            { value: "21.5h", label: "Avg weekly time in meetings, knowledge workers" },
            { value: "~30%", label: "Decisions forgotten within 7 days" },
            { value: "~60%", label: "Action items that go untracked" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-border/60 bg-surface/40 p-5"
            >
              <p className="font-mono text-3xl font-semibold tracking-tight text-foreground">
                {s.value}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </motion.div>

        {/* Why now timeline */}
        <section className="mt-24">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brand">
              Why now
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              Three things had to be true.
            </h2>
          </motion.div>

          <div className="relative mt-12">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-brand/40 via-border/60 to-transparent md:left-[15px]" />
            {TIMELINE.map((t, i) => (
              <motion.div
                key={t.year}
                initial={{ opacity: 0, x: -8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{
                  duration: 0.6,
                  delay: i * 0.08,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="relative grid grid-cols-[auto_1fr] items-start gap-5 pb-10 md:gap-8"
              >
                <div className="relative z-10 flex h-4 w-4 shrink-0 items-center justify-center md:h-8 md:w-8">
                  <span className="h-3 w-3 rounded-full bg-brand shadow-glow md:h-3.5 md:w-3.5" />
                </div>
                <div>
                  <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                    {t.year}
                  </p>
                  <h3 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
                    {t.title}
                  </h3>
                  <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
                    {t.body}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* What we believe */}
        <section className="mt-24">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brand">
              What we're building
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              An AI layer over your team's conversations.
            </h2>
            <p className="mt-4 max-w-2xl text-muted-foreground">
              Four ideas we keep coming back to:
            </p>
          </motion.div>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {PILLARS.map(({ Icon, title, body }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{
                  duration: 0.6,
                  delay: i * 0.06,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="group relative overflow-hidden rounded-2xl border border-border/60 bg-surface/40 p-6 transition-colors hover:bg-surface/70"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-brand/10 text-brand">
                  <Icon className="h-4 w-4" strokeWidth={1.6} />
                </span>
                <h3 className="mt-4 text-lg font-semibold tracking-tight">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative mt-24 overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-surface to-background p-10 md:p-14"
        >
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-brand/15 blur-3xl" />
          <div className="absolute -left-10 -bottom-10 h-64 w-64 rounded-full bg-violet/15 blur-3xl" />
          <div className="relative">
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brand">
              Try it
            </p>
            <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
              Upload a meeting. Watch it become something you can actually use.
            </h2>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/signup"
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                Get started <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                to="/"
                hash="features"
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                See features
              </Link>
            </div>
          </div>
        </motion.section>
      </main>
      <SiteFooter />
    </div>
  );
}
