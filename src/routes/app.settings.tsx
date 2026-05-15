import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, ShieldCheck, User, KeyRound, Trash2, LogOut } from "lucide-react";
import { toast } from "sonner";
import {
  useMe,
  useUpdateProfile,
  useChangePassword,
  useDeleteAccount,
} from "@/lib/api/hooks";
import { setAuthToken } from "@/lib/api/client";

export const Route = createFileRoute("/app/settings")({
  head: () => ({ meta: [{ title: "Settings — EchoBrief" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: me, isLoading } = useMe();

  if (isLoading || !me) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Account, security, and danger zone.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <ProfileSection me={me} />
        <PasswordSection />
      </div>
      <div className="mt-8">
        <DangerSection />
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function ProfileSection({
  me,
}: {
  me: { id: string; email: string; name: string | null; avatar_url: string | null; is_admin: boolean };
}) {
  const update = useUpdateProfile();
  const [name, setName] = useState(me.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(me.avatar_url ?? "");

  useEffect(() => {
    setName(me.name ?? "");
    setAvatarUrl(me.avatar_url ?? "");
  }, [me.name, me.avatar_url]);

  const dirty = name !== (me.name ?? "") || avatarUrl !== (me.avatar_url ?? "");

  async function save() {
    try {
      await update.mutateAsync({
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(avatarUrl.trim() ? { avatar_url: avatarUrl.trim() } : {}),
      });
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  return (
    <section className="rounded-xl border border-border/70 bg-surface p-6">
      <SectionHeader icon={User} title="Profile" subtitle="How you show up in EchoBrief." />

      <div className="mt-6 space-y-4">
        <div className="grid gap-1.5">
          <label htmlFor="settings-email" className="text-sm font-medium">Email</label>
          <input
            id="settings-email"
            value={me.email}
            readOnly
            className="cursor-not-allowed rounded-md border border-border/60 bg-background/50 px-3 py-2 text-sm text-muted-foreground"
          />
          {me.is_admin && (
            <span className="mt-1 inline-flex items-center gap-1 self-start rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px] text-brand">
              <ShieldCheck className="h-3 w-3" /> Admin
            </span>
          )}
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="settings-name" className="text-sm font-medium">Display name</label>
          <input
            id="settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={100}
            className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm focus:border-border focus:outline-none"
          />
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="settings-avatar" className="text-sm font-medium">Avatar URL</label>
          <input
            id="settings-avatar"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://…"
            className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm focus:border-border focus:outline-none"
          />
          <p className="font-mono text-[10px] text-muted-foreground">
            Direct image URL (we'll fetch on the client).
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || update.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {update.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Save profile
          </button>
        </div>
      </div>
    </section>
  );
}

function PasswordSection() {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  function reset() {
    setCurrent(""); setNext(""); setConfirm("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!current || !next) { toast.error("Fill in both fields"); return; }
    if (next.length < 8) { toast.error("New password must be at least 8 characters"); return; }
    if (next !== confirm) { toast.error("New password and confirmation don't match"); return; }
    if (next === current) { toast.error("New password must be different from current"); return; }
    try {
      await change.mutateAsync({ current_password: current, new_password: next });
      toast.success("Password updated");
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Password change failed");
    }
  }

  return (
    <section className="rounded-xl border border-border/70 bg-surface p-6">
      <SectionHeader icon={KeyRound} title="Password" subtitle="Argon2id hashed; we never store plaintext." />
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <div className="grid gap-1.5">
          <label htmlFor="pw-current" className="text-sm font-medium">Current password</label>
          <input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm focus:border-border focus:outline-none"
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="pw-new" className="text-sm font-medium">New password</label>
          <input
            id="pw-new"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm focus:border-border focus:outline-none"
          />
          <p className="font-mono text-[10px] text-muted-foreground">Minimum 8 characters.</p>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="pw-confirm" className="text-sm font-medium">Confirm new password</label>
          <input
            id="pw-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm focus:border-border focus:outline-none"
          />
        </div>
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={change.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {change.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
            Change password
          </button>
        </div>
      </form>
    </section>
  );
}

function DangerSection() {
  const navigate = useNavigate();
  const del = useDeleteAccount();
  const [confirmText, setConfirmText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const armed = confirmText === "DELETE";

  function signOut() {
    setAuthToken(null);
    navigate({ to: "/login", replace: true });
  }

  async function destroy() {
    try {
      await del.mutateAsync();
      toast.success("Account deleted");
      setAuthToken(null);
      navigate({ to: "/", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete account");
    }
  }

  return (
    <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
      <SectionHeader icon={AlertTriangle} title="Danger zone" subtitle="Sign out from this device or delete your account." />
      <div className="mt-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Sign out</p>
            <p className="text-xs text-muted-foreground">Clears the auth token from this browser.</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-surface px-3 py-1.5 text-xs hover:bg-accent"
          >
            <LogOut className="h-3 w-3" /> Sign out
          </button>
        </div>

        <div className="rounded-lg border border-destructive/30 bg-background/40 p-4">
          <p className="text-sm font-medium">Delete account</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Permanently removes your account, every meeting, transcript, summary, action item, and
            audio file. Cannot be undone.
          </p>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/20"
            >
              <Trash2 className="h-3 w-3" /> Delete my account
            </button>
          ) : (
            <div className="mt-4 space-y-2">
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder='Type DELETE to confirm'
                className="w-full rounded-md border border-border/70 bg-background px-3 py-2 text-sm focus:border-border focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setConfirming(false); setConfirmText(""); }}
                  className="rounded-md border border-border/70 bg-surface px-3 py-1.5 text-xs hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={destroy}
                  disabled={!armed || del.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {del.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  Confirm delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
