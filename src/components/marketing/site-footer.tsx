import { Logo } from "@/components/logo";

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
        {[
          { title: "Product", links: ["Overview", "Features", "Integrations", "Changelog", "Roadmap"] },
          { title: "Company", links: ["About", "Customers", "Careers", "Press", "Contact"] },
          { title: "Resources", links: ["Docs", "Guides", "Security", "Status", "API"] },
        ].map((c) => (
          <div key={c.title}>
            <p className="text-xs uppercase tracking-widest text-muted-foreground/70">{c.title}</p>
            <ul className="mt-4 space-y-2.5">
              {c.links.map((l) => (
                <li key={l}>
                  <a className="text-sm text-foreground/80 transition-colors hover:text-foreground" href="#">
                    {l}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-6xl items-center justify-between border-t border-border/60 px-6 py-6 text-xs text-muted-foreground">
        <span>© {new Date().getFullYear()} EchoBrief Labs, Inc.</span>
        <span className="font-mono">SOC 2 · GDPR · HIPAA-ready</span>
      </div>
    </footer>
  );
}
