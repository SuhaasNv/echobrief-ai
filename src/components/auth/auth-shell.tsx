import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Logo } from "@/components/logo";

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
    <div className="relative grid min-h-screen lg:grid-cols-2">
      {/* left panel (auth form) */}
      <div className="relative flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Logo />
          <Link to="/" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            ← Home
          </Link>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center"
        >
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </motion.div>
        <p className="mt-8 text-center text-xs text-muted-foreground">{footer}</p>
      </div>

      {/* right panel (visual) */}
      <div className="relative hidden overflow-hidden border-l border-border/60 bg-surface lg:block">
        <div className="absolute inset-0 bg-grid bg-grid-fade opacity-60" />
        <div className="absolute -left-20 top-1/3 h-80 w-80 rounded-full bg-brand/25 blur-[100px]" />
        <div className="absolute -right-10 bottom-10 h-72 w-72 rounded-full bg-violet/20 blur-[100px]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="glass max-w-sm rounded-2xl p-5">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Today, 9:42 AM</p>
            <p className="mt-2 text-sm leading-relaxed">
              "EchoBrief turned a 47-minute call into 3 decisions and 7 action items —
              before I even closed my laptop."
            </p>
            <p className="mt-4 text-xs text-muted-foreground">Sarah Lin · Head of Ops, Vertex</p>
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground/70">
              5,000+ teams · 4.9 / 5 on G2
            </p>
            <p className="mt-3 max-w-md text-2xl font-semibold tracking-tight text-gradient">
              Where every conversation becomes structured intelligence.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GoogleButton() {
  return (
    <button
      type="button"
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border/80 bg-surface/60 px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
        <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.6 4-5.5 4-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.1 0-.6-.1-1.1-.2-1.6H12z"/>
      </svg>
      Continue with Google
    </button>
  );
}
