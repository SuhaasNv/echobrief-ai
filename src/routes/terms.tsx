import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Handshake, Zap, AlertTriangle, Scale, Mail } from "lucide-react";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of Service — EchoBrief" }] }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em]">
            <span className="text-brand">Terms of Service</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">v1.0 · May 14, 2026</span>
          </div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            The rules,
            <br />
            <span className="text-gradient-brand">written like a human did it.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base text-muted-foreground">
            We're not going to make you scroll through ten pages of capital
            letters. Here are the seven things that matter, with plain-English
            translations underneath.
          </p>
        </motion.div>

        {/* The deal */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="relative mt-10 overflow-hidden rounded-2xl border border-border/60 bg-surface/60 p-6 shadow-elegant"
        >
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-violet/15 blur-3xl" />
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brand">
            The deal in one sentence
          </p>
          <p className="mt-3 text-xl leading-relaxed tracking-tight text-foreground">
            You give us audio. We give you a transcript, a summary, action items,
            and the ability to ask questions about every meeting you've ever
            uploaded. You can take your data and leave whenever you want.
          </p>
        </motion.div>

        <Clause
          icon={Handshake}
          number="01"
          title="Your account is yours"
          plain="You own your meetings. You're responsible for what you upload."
          legal="You may not upload audio for which you lack the legal right to record or process. You're responsible for complying with two-party consent laws and any contractual recording restrictions that apply to you."
        />

        <Clause
          icon={Zap}
          number="02"
          title="What we provide"
          plain="A working app, ~99% of the time, with the features described on the marketing site."
          legal="The Service is provided on an 'as-is' basis. We target 99% uptime measured monthly but make no guarantee. Scheduled maintenance and force-majeure events are excluded."
        />

        <Clause
          icon={Scale}
          number="03"
          title="What we charge for"
          plain="Free tier exists. Paid tier unlocks more meetings, longer retention, and integrations."
          legal="Pricing and tier inclusions are listed on the Pricing page and may change with 30 days notice for paid plans. Free tier features may change without notice."
        />

        <Clause
          icon={AlertTriangle}
          number="04"
          title="What you can't do"
          plain="Don't try to break the app, reverse-engineer it, or use it for something illegal."
          legal="You may not (a) probe or test the vulnerability of the Service without explicit written consent, (b) reverse engineer or attempt to extract source code, (c) use the Service to violate any applicable law, (d) automate beyond reasonable rate limits."
        />

        <Clause
          icon={Mail}
          number="05"
          title="AI output"
          plain="AI is good but not perfect. Don't act on it without sanity-checking."
          legal="Transcripts, summaries, and action items are AI-generated and may contain errors. EchoBrief is not liable for decisions made based solely on AI output. Always verify against the source audio for material decisions."
        />

        <Clause
          icon={Scale}
          number="06"
          title="Cancellation"
          plain="Cancel any time. We don't do trick renewals."
          legal="You may terminate your account at any time from Settings → Account. Pre-paid fees for the current billing period are non-refundable. We may terminate accounts that violate these terms with 7 days notice (or immediately for severe violations)."
        />

        <Clause
          icon={AlertTriangle}
          number="07"
          title="Liability"
          plain="If we break something, the most you can claim from us is what you paid us in the last 12 months."
          legal="To the maximum extent permitted by law, EchoBrief's aggregate liability for any claim arising out of the Service is limited to the fees you paid in the twelve months preceding the claim. We are not liable for indirect, incidental, or consequential damages."
        />

        {/* Contact */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mt-16 rounded-2xl border border-border/60 bg-gradient-to-br from-surface to-background p-6"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brand">
            Questions
          </p>
          <p className="mt-2 text-sm text-foreground">
            Genuinely confused by something? That's a bug in our writing. Email{" "}
            <a
              href="mailto:hello@echobrief.ai"
              className="text-foreground underline-offset-4 hover:underline"
            >
              hello@echobrief.ai
            </a>{" "}
            and a human will respond within two business days.
          </p>
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

function Clause({
  icon: Icon,
  number,
  title,
  plain,
  legal,
}: {
  icon: typeof Handshake;
  number: string;
  title: string;
  plain: string;
  legal: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mt-10 grid gap-4 border-t border-border/60 pt-10 md:grid-cols-[auto_1fr]"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand/10 text-brand">
          <Icon className="h-4 w-4" strokeWidth={1.6} />
        </span>
        <div className="md:hidden">
          <p className="font-mono text-xs text-muted-foreground">{number}</p>
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        </div>
        <p className="hidden font-mono text-xs text-muted-foreground md:block">{number}</p>
      </div>
      <div>
        <h3 className="hidden text-lg font-semibold tracking-tight md:block">{title}</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-foreground">{plain}</p>
        <details className="group mt-3 text-sm">
          <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
            Show the legal version
          </summary>
          <p className="mt-2 rounded-lg border border-border/60 bg-surface/40 p-3 text-xs leading-relaxed text-muted-foreground">
            {legal}
          </p>
        </details>
      </div>
    </motion.div>
  );
}
