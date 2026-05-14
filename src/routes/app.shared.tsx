import { createFileRoute } from "@tanstack/react-router";
import { Users, FileText } from "lucide-react";

export const Route = createFileRoute("/app/shared")({
  head: () => ({ meta: [{ title: "Shared Notes — EchoBrief" }] }),
  component: SharedPage,
});

const notes = [
  { title: "Q3 launch plan — single source of truth", who: "Maya · 4 collaborators", when: "Updated 12m ago", excerpt: "Locked launch date Sep 18. Engineering owns rollout doc, marketing owns press cycle." },
  { title: "Acme account brief", who: "Jordan · 2 collaborators", when: "Updated 2h ago", excerpt: "Mid-market SaaS, 320 seats. Decision-maker is Alex (VP Eng). SSO is the deal-blocker." },
  { title: "Weekly leadership recap", who: "Maya · 6 collaborators", when: "Updated yesterday", excerpt: "Hiring plan finalized. Procurement bottleneck flagged by Eli — Sarah owns unblock." },
];

function SharedPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">Shared notes</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Living documents your team co-edits, auto-enriched with meeting context.
      </p>
      <div className="mt-8 grid gap-3">
        {notes.map((n) => (
          <a
            key={n.title}
            href="#"
            className="rounded-xl border border-border/70 bg-surface p-5 transition-colors hover:bg-surface-elevated"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent">
                <FileText className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-medium">{n.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{n.excerpt}</p>
                <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {n.who}</span>
                  <span>·</span>
                  <span>{n.when}</span>
                </div>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
