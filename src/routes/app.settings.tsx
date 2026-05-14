import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Copy, Plug } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/app/settings")({
  head: () => ({ meta: [{ title: "Settings — EchoBrief" }] }),
  component: SettingsPage,
});

const tabs = ["Profile", "Workspace", "Billing", "Integrations", "API keys", "Appearance"] as const;
type Tab = (typeof tabs)[number];

function SettingsPage() {
  const [active, setActive] = useState<Tab>("Profile");
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      <div className="mt-8 grid gap-8 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="space-y-0.5">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setActive(t)}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                active === t ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {active === "Profile" && <ProfilePanel />}
          {active === "Workspace" && <WorkspacePanel />}
          {active === "Billing" && <BillingPanel />}
          {active === "Integrations" && <IntegrationsPanel />}
          {active === "API keys" && <ApiKeysPanel />}
          {active === "Appearance" && <AppearancePanel />}
        </div>
      </div>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/70 bg-surface p-6">
      <div className="border-b border-border/60 pb-4">
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <div className="pt-5">{children}</div>
    </section>
  );
}

function ProfilePanel() {
  return (
    <Section title="Profile" desc="Update your personal information.">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-brand to-violet text-lg font-semibold text-white">
          MC
        </div>
        <div>
          <Button variant="outline" size="sm">Upload photo</Button>
          <p className="mt-1 text-[11px] text-muted-foreground">PNG or JPG · Max 2MB</p>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>First name</Label>
          <Input defaultValue="Maya" />
        </div>
        <div className="space-y-1.5">
          <Label>Last name</Label>
          <Input defaultValue="Chen" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Email</Label>
          <Input defaultValue="maya@acme.co" />
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <Button>Save changes</Button>
      </div>
    </Section>
  );
}

function WorkspacePanel() {
  return (
    <Section title="Workspace" desc="Manage your team workspace settings.">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Workspace name</Label>
          <Input defaultValue="Acme Workspace" />
        </div>
        <div className="space-y-1.5">
          <Label>URL</Label>
          <div className="flex">
            <span className="inline-flex items-center rounded-l-md border border-r-0 border-border bg-accent px-3 text-sm text-muted-foreground">
              echobrief.app/
            </span>
            <Input defaultValue="acme" className="rounded-l-none" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Default language</Label>
          <Input defaultValue="English (US)" />
        </div>
      </div>
    </Section>
  );
}

function BillingPanel() {
  return (
    <div className="space-y-6">
      <Section title="Plan" desc="You are currently on the Pro plan.">
        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 p-4">
          <div>
            <p className="text-base font-medium">Pro · $29/month</p>
            <p className="text-xs text-muted-foreground">Renews September 18 · 12 seats included</p>
          </div>
          <Button variant="outline" size="sm">Manage plan</Button>
        </div>
      </Section>
      <Section title="Usage" desc="This billing cycle.">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { l: "Hours used", v: "184.2 / Unlimited" },
            { l: "AI queries", v: "1,420 / Unlimited" },
            { l: "Storage", v: "42 GB / 100 GB" },
          ].map((s) => (
            <div key={s.l} className="rounded-lg border border-border/60 bg-background/40 p-3">
              <p className="text-[11px] text-muted-foreground">{s.l}</p>
              <p className="mt-1 text-sm font-medium">{s.v}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function IntegrationsPanel() {
  const integrations = [
    { name: "Zoom", desc: "Auto-import recordings", connected: true },
    { name: "Google Meet", desc: "Sync calendar & recordings", connected: true },
    { name: "Slack", desc: "Push summaries to channels", connected: false },
    { name: "Linear", desc: "Sync action items as issues", connected: true },
    { name: "Notion", desc: "Append summaries to pages", connected: false },
    { name: "Salesforce", desc: "Attach calls to opportunities", connected: false },
  ];
  return (
    <Section title="Integrations" desc="Connect EchoBrief to your team's tools.">
      <div className="grid gap-3 sm:grid-cols-2">
        {integrations.map((i) => (
          <div key={i.name} className="flex items-start justify-between rounded-lg border border-border/60 bg-background/40 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent">
                <Plug className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">{i.name}</p>
                <p className="text-[11px] text-muted-foreground">{i.desc}</p>
              </div>
            </div>
            <Button size="sm" variant={i.connected ? "outline" : "default"}>
              {i.connected ? "Connected" : "Connect"}
            </Button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ApiKeysPanel() {
  const [copied, setCopied] = useState(false);
  const key = "echo_sk_live_a1b2c3d4e5f6g7h8i9j0";
  return (
    <Section title="API keys" desc="Use the EchoBrief API to integrate with your stack.">
      <div className="rounded-lg border border-border/60 bg-background/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Production key</p>
            <p className="text-[11px] text-muted-foreground">Created Aug 2 · Last used 4 min ago</p>
          </div>
          <button
            onClick={() => { navigator.clipboard.writeText(key); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-surface px-2.5 py-1.5 text-xs hover:bg-accent"
          >
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <code className="mt-3 block break-all rounded-md bg-background p-2.5 font-mono text-xs text-muted-foreground">{key}</code>
      </div>
      <div className="mt-4">
        <Button variant="outline" size="sm">+ Create new key</Button>
      </div>
    </Section>
  );
}

function AppearancePanel() {
  return (
    <Section title="Appearance" desc="Customize how EchoBrief looks.">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { name: "Dark", active: true, bg: "bg-[#0d0e12]" },
          { name: "Light", active: false, bg: "bg-[#fafafa]" },
          { name: "System", active: false, bg: "bg-gradient-to-br from-[#0d0e12] to-[#fafafa]" },
        ].map((t) => (
          <button
            key={t.name}
            className={`rounded-lg border p-2 text-left transition-colors ${
              t.active ? "border-brand" : "border-border/60 hover:border-border"
            }`}
          >
            <div className={`h-20 w-full rounded-md ${t.bg}`} />
            <p className="mt-2 px-1 text-sm font-medium">{t.name}</p>
          </button>
        ))}
      </div>
    </Section>
  );
}
