import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Sparkles,
  Search,
  CheckSquare,
  MessageSquare,
  Users,
  Zap,
  Lock,
  Play,
  Upload,
  Brain,
  FileText,
} from "lucide-react";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { DashboardPreview } from "@/components/marketing/dashboard-preview";
import { StatsStrip } from "@/components/marketing/stats-strip";
import { Typewriter } from "@/components/marketing/typewriter";
import { AmbientBackground } from "@/components/marketing/ambient-background";
import { ScrollFollowLine } from "@/components/marketing/scroll-follow-line";
import { Button } from "@/components/ui/button";
import { CircularTestimonials } from "@/components/ui/circular-testimonials";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EchoBrief — Meeting intelligence for modern teams" },
      {
        name: "description",
        content:
          "Upload calls, voice notes, and meetings. Get instant summaries, action items, and AI answers across every conversation.",
      },
      { property: "og:title", content: "EchoBrief — Meeting intelligence for modern teams" },
      {
        property: "og:description",
        content:
          "Your meetings finally become searchable intelligence. Summaries, action items, and AI answers across every call.",
      },
    ],
  }),
  component: Landing,
});

const ease = [0.22, 1, 0.36, 1] as const;

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease } },
};

function Landing() {
  return (
    <div className="relative min-h-screen overflow-x-clip">
      <AmbientBackground />
      <ScrollFollowLine />

      <SiteHeader />

      {/* Hero — ambient aurora (from <AmbientBackground />) shows through */}
      <section className="relative px-6 pt-24 pb-16 md:pt-32 md:pb-24">
        <div className="relative mx-auto max-w-4xl text-center">
          <motion.h1
            initial="hidden"
            animate="show"
            variants={{ ...fadeUp, show: { ...fadeUp.show, transition: { duration: 0.9, ease, delay: 0.05 } } }}
            className="text-balance text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl md:text-6xl lg:text-7xl"
          >
            <span className="text-gradient">Your meetings finally become</span>
            <br />
            <Typewriter
              className="text-gradient-brand"
              words={[
                "searchable intelligence.",
                "structured knowledge.",
                "team memory.",
                "queryable context.",
              ]}
            />
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="show"
            variants={{ ...fadeUp, show: { ...fadeUp.show, transition: { duration: 0.9, ease, delay: 0.15 } } }}
            className="mx-auto mt-6 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground md:text-lg"
          >
            Upload calls, voice notes, and meetings. Get instant summaries, action items, and AI-powered
            answers across every conversation.
          </motion.p>

          <motion.div
            initial="hidden"
            animate="show"
            variants={{ ...fadeUp, show: { ...fadeUp.show, transition: { duration: 0.9, ease, delay: 0.25 } } }}
            className="mt-10 flex flex-wrap items-center justify-center gap-3"
          >
            <Button asChild size="lg" className="group h-11 rounded-full px-5 text-sm font-medium">
              <Link to="/signup">
                Start Transcribing
                <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-11 rounded-full border-border/80 bg-surface/40 px-5 text-sm font-medium backdrop-blur"
            >
              <Link to="/">
                <Play className="mr-1 h-3.5 w-3.5 fill-current" />
                Watch Demo
              </Link>
            </Button>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-5 font-mono text-xs text-muted-foreground/70"
          >
            Free for 14 days · No credit card · 5,000+ teams onboard
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, delay: 0.4, ease }}
          className="mt-20"
        >
          <DashboardPreview />
        </motion.div>
      </section>

      <StatsStrip />

      {/* Trusted by — scrolling marquee */}
      <section className="px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <p className="text-center font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground/70">
            Trusted by product, sales, and research teams at
          </p>
          <div
            className="relative mt-8 overflow-hidden"
            style={{
              maskImage:
                "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
              WebkitMaskImage:
                "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
            }}
          >
            <motion.div
              className="flex w-max gap-12"
              animate={{ x: ["0%", "-50%"] }}
              transition={{ duration: 28, ease: "linear", repeat: Infinity }}
            >
              {[
                "Northwind",
                "Vertex",
                "Lattice",
                "Helix",
                "Parallax",
                "Foundry",
                "Northwind",
                "Vertex",
                "Lattice",
                "Helix",
                "Parallax",
                "Foundry",
              ].map((name, i) => (
                <div
                  key={`${name}-${i}`}
                  className="shrink-0 text-lg font-semibold tracking-tight text-muted-foreground/60"
                >
                  {name}
                  <span className="text-brand">.</span>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            className="mx-auto max-w-2xl text-center"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brand">Capabilities</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              An AI layer over every conversation your team has.
            </h2>
            <p className="mt-4 text-muted-foreground">
              EchoBrief turns raw audio into structured knowledge — accurate transcripts, decisions, action items,
              and answers, available the moment a call ends.
            </p>
          </motion.div>

          <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-border/80 bg-border/40 md:grid-cols-3">
            {[
              {
                icon: Sparkles,
                title: "Instant summaries",
                body: "Decisions, blockers, and next steps within 30 seconds of upload — never read a 2-hour transcript again.",
              },
              {
                icon: Search,
                title: "Cross-meeting search",
                body: "Ask 'what did pricing decide last quarter?' and get cited answers across your entire library.",
              },
              {
                icon: CheckSquare,
                title: "Auto action items",
                body: "Owners, deadlines, and context — extracted automatically and synced to Linear, Asana, or Notion.",
              },
              {
                icon: Users,
                title: "Speaker intelligence",
                body: "Diarization, talk-time ratios, and sentiment per participant — without ever sounding clinical.",
              },
              {
                icon: Zap,
                title: "Real-time processing",
                body: "Streaming transcription with sub-second latency. Watch a meeting transcribe as it happens.",
              },
              {
                icon: Lock,
                title: "Enterprise-grade trust",
                body: "SOC 2 Type II, end-to-end encryption, and per-workspace data residency. Your audio is yours.",
              },
            ].map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05, duration: 0.6, ease }}
                className="group relative bg-surface p-8 transition-colors hover:bg-surface-elevated"
              >
                <f.icon className="h-5 w-5 text-brand" strokeWidth={1.5} />
                <h3 className="mt-6 text-base font-medium tracking-tight">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-violet">Workflow</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              From audio to answers in three steps.
            </h2>
          </motion.div>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {[
              { n: "01", icon: Upload, title: "Upload or connect", body: "Drop MP3, WAV, MP4, or sync Zoom, Meet, and Teams. Live recording works too." },
              { n: "02", icon: Brain, title: "EchoBrief processes", body: "Transcription, diarization, topic segmentation, and summarization in under a minute." },
              { n: "03", icon: FileText, title: "Search, share, ship", body: "Ask questions, export action items, share decisions — all from a single workspace." },
            ].map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.7, ease }}
                className="relative rounded-xl border border-border/70 bg-surface p-7"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground/70">{s.n}</span>
                  <s.icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                </div>
                <h3 className="mt-8 text-lg font-medium tracking-tight">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* AI Chat showcase */}
      <section className="px-6 py-24">
        <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-2 md:items-center">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp}>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brand">Ask EchoBrief</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              A research assistant that's listened to every meeting you've had.
            </h2>
            <p className="mt-4 text-muted-foreground">
              No more "wait, when did we decide that?" Ask in plain English and get cited answers
              with timestamps you can jump to.
            </p>
            <div className="mt-6 space-y-2">
              {[
                "What did engineering commit to for Q3?",
                "Summarize every conversation with Acme Corp.",
                "List blockers David mentioned this month.",
              ].map((q) => (
                <div key={q} className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface px-3 py-2 text-sm">
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-mono text-xs text-muted-foreground">→</span>
                  <span>{q}</span>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease }}
            className="glass relative rounded-2xl p-5 shadow-elegant"
          >
            <div className="space-y-4">
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm">
                  What decisions were made about pricing this quarter?
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand to-violet">
                  <Sparkles className="h-3 w-3 text-white" />
                </div>
                <div className="text-sm leading-relaxed">
                  Across <span className="text-brand">4 meetings</span>, the team made three pricing decisions:
                  <ol className="mt-2 space-y-1.5 text-foreground/90">
                    <li>1. Move the Pro tier from $24 → <span className="text-foreground font-medium">$29</span> on Sep 1.</li>
                    <li>2. Introduce a <span className="text-foreground font-medium">Team plan</span> at $79/seat.</li>
                    <li>3. Sunset the legacy Starter tier by EOY.</li>
                  </ol>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {["Pricing Sync · Aug 12", "Exec Review · Aug 19", "Sales QBR · Aug 26"].map((c) => (
                      <span key={c} className="rounded-md border border-border/60 bg-background/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                <span className="text-xs text-muted-foreground">Searching 47 more meetings…</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUp}
            className="mx-auto max-w-2xl text-center"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brand">Loved by teams</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
              The teams that ship fastest run on EchoBrief.
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease }}
            className="mt-14 flex justify-center"
          >
            <CircularTestimonials
              testimonials={[
                {
                  quote:
                    "We replaced four tools with EchoBrief. Our weekly leadership meeting now writes its own follow-up.",
                  name: "Priya Iyer",
                  designation: "Head of Operations, Vertex",
                  src: "https://images.unsplash.com/photo-1592621385612-4d7129426394?q=80&w=1200&auto=format&fit=crop",
                },
                {
                  quote:
                    "The cross-meeting search is genuinely magical. It feels like having a chief of staff.",
                  name: "Arjun Sharma",
                  designation: "Founder, Helix",
                  src: "https://images.unsplash.com/photo-1564564321837-a57b7070ac4f?q=80&w=1200&auto=format&fit=crop",
                },
                {
                  quote:
                    "Action items used to vanish. Now they appear in Linear before the call ends.",
                  name: "Anika Roy",
                  designation: "VP Product, Northwind",
                  src: "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?q=80&w=1200&auto=format&fit=crop",
                },
              ]}
              autoplay
              colors={{
                name: "var(--foreground)",
                designation: "var(--muted-foreground)",
                testimony: "color-mix(in oklab, var(--foreground) 95%, transparent)",
                arrowBackground: "var(--surface-elevated)",
                arrowForeground: "var(--foreground)",
                arrowHoverBackground: "var(--brand)",
              }}
              fontSizes={{
                name: "1.5rem",
                designation: "0.95rem",
                quote: "1.05rem",
              }}
            />
          </motion.div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brand">Pricing</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">Pay for what you record.</h2>
          </motion.div>
          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {[
              { name: "Starter", price: "$0", desc: "For solo work and casual notes.", cta: "Start free", features: ["5 hrs / month", "AI summaries", "Action items", "7-day history"], featured: false },
              { name: "Pro", price: "$29", desc: "For builders and operators.", cta: "Start trial", features: ["Unlimited hours", "Cross-meeting AI search", "Linear / Notion / Slack", "12-month history", "Priority processing"], featured: true },
              { name: "Team", price: "$79", desc: "Per seat. For teams of 5+.", cta: "Talk to sales", features: ["Everything in Pro", "Workspace analytics", "SSO + SCIM", "Data residency", "Dedicated support"], featured: false },
            ].map((p) => (
              <div
                key={p.name}
                className={`relative rounded-2xl border p-7 ${
                  p.featured ? "border-brand/40 bg-surface-elevated shadow-elegant" : "border-border/70 bg-surface"
                }`}
              >
                {p.featured && (
                  <span className="absolute -top-2.5 left-7 rounded-full bg-gradient-to-r from-brand to-violet px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-white">
                    Most popular
                  </span>
                )}
                <div className="flex items-baseline justify-between">
                  <h3 className="text-base font-medium">{p.name}</h3>
                  <div>
                    <span className="text-3xl font-semibold tracking-tight">{p.price}</span>
                    <span className="ml-1 text-xs text-muted-foreground">/month</span>
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{p.desc}</p>
                <Button asChild className="mt-5 w-full rounded-full" variant={p.featured ? "default" : "outline"}>
                  <Link to="/signup">{p.cta}</Link>
                </Button>
                <ul className="mt-6 space-y-2 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-foreground/85">
                      <CheckSquare className="h-3.5 w-3.5 text-brand" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-24">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          variants={fadeUp}
          className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl border border-border/80 bg-surface p-12 text-center md:p-20"
        >
          <div className="absolute inset-0 bg-grid bg-grid-fade opacity-50" />
          <div className="absolute inset-x-0 -top-20 mx-auto h-60 w-2/3 rounded-full bg-brand/25 blur-[100px]" />
          <div className="relative">
            <h2 className="text-balance text-4xl font-semibold tracking-tight md:text-6xl">
              Stop forgetting what your team said.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-muted-foreground">
              EchoBrief is free to try for 14 days. Set it up in under 60 seconds.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="h-11 rounded-full px-5">
                <Link to="/signup">
                  Start Transcribing <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 rounded-full border-border/80 bg-background/40 px-5">
                <Link to="/app">Open the app</Link>
              </Button>
            </div>
          </div>
        </motion.div>
      </section>

      <SiteFooter />
    </div>
  );
}
