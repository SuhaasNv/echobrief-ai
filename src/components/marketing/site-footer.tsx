import { Link } from "@tanstack/react-router";
import { Logo } from "@/components/logo";

interface FooterLink {
  label: string;
  to?: string;
  hash?: string;
  href?: string;
  external?: boolean;
}

const COLUMNS: Array<{ title: string; links: FooterLink[] }> = [
  {
    title: "Product",
    links: [
      { label: "Features", to: "/", hash: "features" },
      { label: "Pricing", to: "/", hash: "pricing" },
      { label: "Sign in", to: "/login" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "Contact", href: "mailto:hello@echobrief.ai", external: true },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", to: "/privacy" },
      { label: "Terms", to: "/terms" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-32 border-t border-border/60">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 md:grid-cols-5">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">
            Meeting intelligence for teams who treat their conversations as a knowledge base.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <p className="text-xs uppercase tracking-widest text-muted-foreground/70">{c.title}</p>
            <ul className="mt-4 space-y-2.5">
              {c.links.map((l) => (
                <li key={l.label}>
                  {l.external && l.href ? (
                    <a
                      href={l.href}
                      className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </a>
                  ) : l.to ? (
                    <Link
                      to={l.to}
                      hash={l.hash}
                      className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex flex-col items-start justify-between gap-2 border-t border-border/60 px-6 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center max-w-6xl">
        <span>© {new Date().getFullYear()} EchoBrief Labs</span>
        <span className="font-mono">Built with TanStack Start · OpenAI · AssemblyAI · Railway</span>
      </div>
    </footer>
  );
}
