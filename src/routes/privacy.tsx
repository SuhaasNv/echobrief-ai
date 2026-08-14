import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Database, Lock, Eye, Trash2, Server, Sparkles, ArrowUpRight, X } from "lucide-react";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy — EchoBrief" }] }),
  component: PrivacyPage,
});

const NEVER = [
  "Sell your data to advertisers, brokers, or third parties",
  "Train AI models on your transcripts",
  "Read your meetings except when you ask us to",
  "Share data across customers — every workspace is isolated",
];

const VENDORS = [
  { name: "Railway", role: "Database + cache hosting", region: "US-East", encrypted: true },
  { name: "Cloudflare R2", role: "Audio file storage", region: "Global", encrypted: true },
  { name: "AssemblyAI", role: "Speech-to-text", region: "US", encrypted: true },
  { name: "OpenAI", role: "LLM + embeddings", region: "US", encrypted: true },
  { name: "Resend", role: "Transactional email", region: "US", encrypted: true },
];

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em]">
            <span className="text-brand">Privacy</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">v1.2 · May 14, 2026</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">~4 min read</span>
          </div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            We're paranoid about your meetings,
            <br />
            <span className="text-gradient-brand">so you don't have to be.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base text-muted-foreground">
            We wrote this in plain English. If something here is unclear, that's on us — email{" "}
            <a
              href="mailto:privacy@echobrief.ai"
              className="text-foreground underline-offset-4 hover:underline"
            >
              privacy@echobrief.ai
            </a>{" "}
            and we'll fix the wording.
          </p>
        </motion.div>

        {/* TL;DR */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="relative mt-10 overflow-hidden rounded-2xl border border-border/60 bg-surface/60 p-6 shadow-elegant"
        >
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand/15 blur-3xl" />
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brand">TL;DR</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {[
              {
                Icon: Lock,
                title: "Encrypted everywhere",
                body: "Audio and database at rest. TLS in transit. OAuth tokens AES-256.",
              },
              {
                Icon: Eye,
                title: "Only you see it",
                body: "Workspace isolation. You opt in to share. Public links are tokenized.",
              },
              {
                Icon: Trash2,
                title: "Yours to delete",
                body: "Account delete cascades everything in seconds — audio + DB + vectors.",
              },
            ].map(({ Icon, title, body }) => (
              <div key={title} className="rounded-xl border border-border/60 bg-background/40 p-4">
                <Icon className="h-4 w-4 text-brand" strokeWidth={1.6} />
                <p className="mt-2 text-sm font-medium text-foreground">{title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* What we collect */}
        <Section
          eyebrow="What we collect"
          title="Specifically — the audio you upload and what we make of it."
        >
          <p>
            The list is short. We can't do meeting intelligence without meeting data, so we ask for
            as little else as possible:
          </p>
          <ul className="mt-4 space-y-2">
            {[
              ["The audio file itself", "Stored encrypted in Cloudflare R2."],
              ["The transcript we generate", "Stored in our Postgres DB on Railway."],
              ["AI summary + action items", "Same DB, structured columns."],
              ["Vector embeddings", "Used for cross-meeting search via pgvector."],
              ["Your account email + name", "From whichever auth provider you used."],
            ].map(([what, where]) => (
              <li key={what} className="flex items-baseline gap-3">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-brand" />
                <span>
                  <span className="text-foreground">{what}.</span>{" "}
                  <span className="text-muted-foreground">{where}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {/* What we don't */}
        <Section eyebrow="What we don't" title="The list of things we never do.">
          <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
            {NEVER.map((line) => (
              <div
                key={line}
                className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-surface/40 p-3.5 text-sm text-foreground/90"
              >
                <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" strokeWidth={2} />
                <span>{line}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Vendors */}
        <Section eyebrow="Who else touches it" title="Sub-processors that help us run EchoBrief.">
          <p>
            These vendors process small slices of your data on our behalf. Each operates under a
            commercial agreement that prohibits using your data to train models or share it
            elsewhere.
          </p>
          <div className="mt-5 overflow-hidden rounded-xl border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-surface/60 text-left">
                <tr className="border-b border-border/60 text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Vendor</th>
                  <th className="px-4 py-2.5 font-medium">Purpose</th>
                  <th className="px-4 py-2.5 font-medium">Region</th>
                </tr>
              </thead>
              <tbody>
                {VENDORS.map((v) => (
                  <tr key={v.name} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-3 font-medium text-foreground">{v.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{v.role}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {v.region}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Retention diagram */}
        <Section eyebrow="Retention" title="How long things stick around.">
          <div className="mt-2 space-y-3">
            <RetentionRow icon={Database} label="Audio files" value="90 days, then auto-deleted" />
            <RetentionRow
              icon={Sparkles}
              label="Transcripts + AI artifacts"
              value="Until you delete the meeting"
            />
            <RetentionRow
              icon={Server}
              label="Account data"
              value="Until you delete your account"
            />
            <RetentionRow
              icon={Lock}
              label="Authentication logs"
              value="30 days for security forensics"
            />
          </div>
        </Section>

        {/* Delete CTA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mt-16 flex flex-col items-start justify-between gap-4 rounded-2xl border border-border/60 bg-gradient-to-br from-surface to-background p-6 md:flex-row md:items-center"
        >
          <div>
            <p className="text-sm font-medium text-foreground">Want it gone?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Settings → Account → Delete account. Cascades everything in seconds.
            </p>
          </div>
          <Link
            to="/app/settings"
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Open settings <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </motion.div>

        <div className="mt-16">
          <Link
            to="/"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back to home
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mt-14"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brand">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{children}</div>
    </motion.section>
  );
}

function RetentionRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Database;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-surface/40 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/10 text-brand">
          <Icon className="h-4 w-4" strokeWidth={1.6} />
        </span>
        <span className="text-sm text-foreground">{label}</span>
      </div>
      <span className="font-mono text-xs text-muted-foreground">{value}</span>
    </div>
  );
}
