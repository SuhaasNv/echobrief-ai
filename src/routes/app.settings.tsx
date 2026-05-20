import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  AlertTriangle,
  ShieldCheck,
  User,
  KeyRound,
  Trash2,
  LogOut,
  Layers,
  Check,
  Plus,
  Pencil,
  GraduationCap,
  Briefcase,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  useMe,
  useUpdateProfile,
  useChangePassword,
  useDeleteAccount,
  useWorkspaces,
  useCreateWorkspace,
  useUpdateWorkspace,
  useDeleteWorkspace,
  type Workspace,
  type WorkspaceColor,
  type WorkspaceKind,
} from "@/lib/api/hooks";
import { setAuthToken } from "@/lib/api/client";
import { setActiveWorkspace, useActiveWorkspaceId } from "@/lib/workspace-store";
import { AvatarUpload } from "@/components/app/avatar-upload";
import { formatDate } from "@/lib/date-utils";
import { useSubscription } from "@/lib/api/use-subscription";
import { UpgradeModal } from "@/components/upgrade-modal";

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
        <WorkspacesSection />
      </div>
      <div className="mt-8">
        <DangerSection />
      </div>
    </div>
  );
}

const COLOR_BG: Record<WorkspaceColor, string> = {
  brand: "from-brand to-violet",
  violet: "from-violet to-fuchsia-500",
  emerald: "from-emerald-400 to-teal-500",
  amber: "from-amber-400 to-orange-500",
  rose: "from-rose-400 to-pink-500",
  slate: "from-slate-400 to-slate-600",
};
const COLOR_OPTIONS: WorkspaceColor[] = ["brand", "violet", "emerald", "amber", "rose", "slate"];

function workspaceInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function WorkspacesSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useWorkspaces();
  const { data: subscription } = useSubscription();
  const activeId = useActiveWorkspaceId();
  const create = useCreateWorkspace();
  const update = useUpdateWorkspace();
  const del = useDeleteWorkspace();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<WorkspaceColor>("brand");
  const [newKind, setNewKind] = useState<WorkspaceKind>("professional");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<WorkspaceColor>("brand");
  const [editKind, setEditKind] = useState<WorkspaceKind>("professional");
  const [showUpgrade, setShowUpgrade] = useState(false);

  const workspaces = data?.items ?? [];

  // Check if user can create more workspaces
  const workspaceCount = workspaces.length;
  const workspaceLimit = subscription?.limits.workspaces;
  const canCreateWorkspace = workspaceLimit === null || workspaceCount < workspaceLimit;

  function handleNewWorkspaceClick() {
    if (!canCreateWorkspace) {
      setShowUpgrade(true);
      return;
    }
    setCreating(true);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const w = await create.mutateAsync({ name, color: newColor, kind: newKind });
      toast.success(`Created ${w.name}`);
      setNewName("");
      setNewColor("brand");
      setNewKind("professional");
      setCreating(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create workspace");
    }
  }

  function beginEdit(w: Workspace) {
    setEditingId(w.id);
    setEditName(w.name);
    setEditColor(w.color);
    setEditKind(w.kind);
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    const name = editName.trim();
    if (!name) return;
    try {
      await update.mutateAsync({ id: editingId, name, color: editColor, kind: editKind });
      setEditingId(null);
      qc.invalidateQueries();
      toast.success("Workspace updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update workspace");
    }
  }

  async function deleteWorkspace(w: Workspace) {
    if (!confirm(`Delete workspace "${w.name}"? This can't be undone.`)) return;
    try {
      await del.mutateAsync(w.id);
      // If we just deleted the active one, fall back to the first remaining.
      if (activeId === w.id) {
        const remaining = workspaces.filter((x) => x.id !== w.id);
        if (remaining.length > 0) setActiveWorkspace(remaining[0].id);
      }
      qc.invalidateQueries();
      toast.success("Workspace deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete");
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Layers}
        title="Workspaces"
        subtitle="Separate spaces for separate teams or projects. Each has its own meetings and AI memory."
      />

      <div className="rounded-xl border border-border/70 bg-surface">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {workspaces.map((w) => {
              const isActive = w.id === activeId;
              if (editingId === w.id) {
                return (
                  <li key={w.id} className="px-4 py-3">
                    <form onSubmit={submitEdit} className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="min-w-0 flex-1 rounded-md border border-border/70 bg-background px-2 py-1 text-sm outline-none focus:border-brand"
                          autoFocus
                          maxLength={60}
                        />
                        <ColorPicker value={editColor} onChange={setEditColor} />
                      </div>
                      <KindToggle value={editKind} onChange={setEditKind} />
                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={update.isPending}
                          className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-xs text-muted-foreground"
                        >
                          Cancel
                        </button>
                        {w.kind !== editKind && (
                          <span className="text-[10px] text-amber-500">
                            Changing kind flips the UX (vocabulary, nav, features).
                          </span>
                        )}
                      </div>
                    </form>
                  </li>
                );
              }
              return (
                <li key={w.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-xs font-medium text-white ${COLOR_BG[w.color]}`}
                  >
                    {workspaceInitials(w.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="truncate font-medium">{w.name}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${
                          w.kind === "student"
                            ? "bg-violet/15 text-violet"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {w.kind === "student" ? "Student" : "Professional"}
                      </span>
                      {isActive && (
                        <span className="rounded-full bg-brand/15 px-1.5 py-0.5 font-mono text-[10px] text-brand">
                          active
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      Created {formatDate(w.created_at, true)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveWorkspace(w.id);
                          // Drop workspace-scoped data so the next view loads
                          // fresh instead of flashing the prior workspace.
                          qc.removeQueries({ queryKey: ["meetings"] });
                          qc.removeQueries({ queryKey: ["meeting"] });
                          qc.removeQueries({ queryKey: ["action-items"] });
                          qc.removeQueries({ queryKey: ["flashcards"] });
                          toast.success(`Switched to ${w.name}`);
                        }}
                        className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        Switch
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => beginEdit(w)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label="Edit workspace"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteWorkspace(w)}
                      disabled={workspaces.length <= 1}
                      title={workspaces.length <= 1 ? "Can't delete your only workspace" : "Delete workspace"}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                      aria-label="Delete workspace"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
            <li className="px-4 py-3">
              {creating ? (
                <form onSubmit={submitCreate} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder={newKind === "student" ? "Class name" : "Workspace name"}
                      className="min-w-0 flex-1 rounded-md border border-border/70 bg-background px-2 py-1 text-sm outline-none focus:border-brand"
                      autoFocus
                      maxLength={60}
                    />
                    <ColorPicker value={newColor} onChange={setNewColor} />
                  </div>
                  <KindToggle value={newKind} onChange={setNewKind} />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={create.isPending || !newName.trim()}
                      className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreating(false);
                        setNewName("");
                        setNewKind("professional");
                      }}
                      className="text-xs text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={handleNewWorkspaceClick}
                  className="flex w-full items-center justify-center gap-2 rounded-md py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New workspace
                  {!canCreateWorkspace && (
                    <>
                      <span className="text-[10px]">
                        ({workspaceCount}/{workspaceLimit} used)
                      </span>
                      <Zap className="h-3 w-3 text-brand" />
                    </>
                  )}
                </button>
              )}
            </li>
          </ul>
        )}
      </div>

      {/* Upgrade modal for workspace quota */}
      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        reason={`Free tier allows ${workspaceLimit} workspace. Upgrade to create more.`}
        currentTier={subscription?.subscription.tier}
      />
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: WorkspaceColor;
  onChange: (c: WorkspaceColor) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {COLOR_OPTIONS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`${c} color`}
          className={`flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br ring-offset-2 ring-offset-surface transition-all ${COLOR_BG[c]} ${
            value === c ? "ring-2 ring-foreground" : "ring-0"
          }`}
        >
          {value === c && <Check className="h-2.5 w-2.5 text-white" />}
        </button>
      ))}
    </div>
  );
}

function KindToggle({
  value,
  onChange,
}: {
  value: WorkspaceKind;
  onChange: (k: WorkspaceKind) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background p-0.5">
      <button
        type="button"
        onClick={() => onChange("student")}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
          value === "student" ? "bg-violet/15 text-violet" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <GraduationCap className="h-3 w-3" /> Student
      </button>
      <button
        type="button"
        onClick={() => onChange("professional")}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
          value === "professional" ? "bg-brand/15 text-brand" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Briefcase className="h-3 w-3" /> Professional
      </button>
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

  useEffect(() => {
    setName(me.name ?? "");
  }, [me.name]);

  const nameDirty = name !== (me.name ?? "");

  // Avatar mutations save immediately (no separate "Save" click). This is
  // the right UX for image picks — user expects the change to stick the
  // moment they pick a file.
  async function saveAvatar(dataUrl: string) {
    try {
      await update.mutateAsync({ avatar_url: dataUrl });
      toast.success("Profile photo updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save photo");
      throw err;
    }
  }

  async function removeAvatar() {
    try {
      await update.mutateAsync({ avatar_url: null });
      toast.success("Profile photo removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove photo");
    }
  }

  async function saveName() {
    try {
      await update.mutateAsync({ ...(name.trim() ? { name: name.trim() } : {}) });
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  // Initials for the avatar placeholder.
  const initials = (() => {
    if (me.name && me.name.trim()) {
      const parts = me.name.trim().split(/\s+/);
      return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
    }
    return me.email.slice(0, 2).toUpperCase();
  })();

  return (
    <section className="rounded-xl border border-border/70 bg-surface p-6">
      <SectionHeader icon={User} title="Profile" subtitle="How you show up in EchoBrief." />

      <div className="mt-6 space-y-6">
        <AvatarUpload
          currentUrl={me.avatar_url}
          initials={initials}
          onChange={saveAvatar}
          onRemove={removeAvatar}
          disabled={update.isPending}
        />

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

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={saveName}
            disabled={!nameDirty || update.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {update.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Save name
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
  const qcDanger = useQueryClient();
  const del = useDeleteAccount();
  const [confirmText, setConfirmText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const armed = confirmText === "DELETE";

  function signOut() {
    setAuthToken(null);
    setActiveWorkspace(null);
    qcDanger.clear();
    navigate({ to: "/", replace: true });
  }

  async function destroy() {
    try {
      await del.mutateAsync();
      toast.success("Account deleted");
      setAuthToken(null);
      setActiveWorkspace(null);
      qcDanger.clear();
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
