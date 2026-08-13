import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Users,
  FileAudio,
  ListChecks,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  LayoutDashboard,
  Server,
  Activity,
  Clock,
  Database,
  Cpu,
  HardDrive,
  Sparkles,
  Pencil,
  Trash2,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { RevenueSection } from "@/components/admin/revenue-section";
import { getAuthToken } from "@/lib/api/client";
import {
  useMe,
  useAdminUsers,
  useAdminMeetings,
  useAdminQueue,
  useAdminSystem,
  useUpdateUser,
  useUpdateUserSubscription,
  useDeleteUser,
  type AdminUserRow,
  type AdminMeetingRow,
  type AdminQueueResponse,
  type AdminSystemResponse,
} from "@/lib/api/hooks";
import { formatUptime, formatDateTime, formatDuration, formatDate } from "@/lib/date-utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin Console — Puffin" }] }),
  component: AdminGate,
});

type Section = "overview" | "revenue" | "users" | "meetings" | "queue" | "system";

function AdminGate() {
  const navigate = useNavigate();
  const { data: me, isLoading: meLoading, isError: meError } = useMe();

  useEffect(() => {
    if (!meLoading && (!getAuthToken() || meError)) {
      navigate({ to: "/login", replace: true });
    }
  }, [meLoading, meError, navigate]);

  if (meLoading || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!me.is_admin) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="mt-4 text-lg font-semibold">Admin access required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account ({me.email}) doesn't have admin permissions.
        </p>
        <Link
          to="/app"
          className="mt-4 inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  return <AdminConsole adminEmail={me.email} />;
}

// ---------------------------------------------------------------------------
// Console layout — distinct sidebar-driven design separate from the app shell
// ---------------------------------------------------------------------------

const SECTIONS: Array<{ id: Section; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "revenue", label: "Revenue", icon: Wallet },
  { id: "users", label: "Users", icon: Users },
  { id: "meetings", label: "Meetings", icon: FileAudio },
  { id: "queue", label: "Queue", icon: ListChecks },
  { id: "system", label: "System", icon: Server },
];

function AdminConsole({ adminEmail }: { adminEmail: string }) {
  const [section, setSection] = useState<Section>("overview");
  const system = useAdminSystem();

  return (
    <div className="flex min-h-screen bg-background font-mono-display">
      {/* Sidebar — darker rail to feel like a console, not the user app */}
      <aside className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col border-r border-border/60 bg-sidebar md:flex">
        <div className="border-b border-border/60 px-4 py-4">
          <Link to="/" className="block">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Puffin
            </p>
            <div className="mt-1 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-brand" />
              <p className="text-base font-semibold tracking-tight">Admin Console</p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-2 py-3">
          {SECTIONS.map((s) => {
            const active = s.id === section;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={`group flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-accent text-foreground"
                    : "text-sidebar-foreground/80 hover:bg-accent/60 hover:text-foreground"
                }`}
              >
                <s.icon className="h-4 w-4 shrink-0" strokeWidth={1.6} />
                <span>{s.label}</span>
                {active && <span className="ml-auto h-1 w-1 rounded-full bg-brand" />}
              </button>
            );
          })}
        </nav>

        {/* Footer: live pulse + system snapshot */}
        <div className="border-t border-border/60 px-4 py-3">
          <SystemPulse system={system.data} />
          <p className="mt-3 truncate font-mono text-[10px] text-muted-foreground">
            <span className="text-foreground/70">●</span> {adminEmail}
          </p>
          <Link
            to="/app"
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Exit to app
          </Link>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        {/* Console top bar */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-background/85 px-6 py-3 backdrop-blur-md">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
            {section}
          </p>
          <div className="flex items-center gap-4 font-mono text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              live
            </span>
            <span>env: {system.data?.runtime.env ?? "—"}</span>
            <span>
              uptime: {system.data ? formatUptime(system.data.runtime.uptime_seconds) : "—"}
            </span>
          </div>
        </header>

        <div className="px-6 py-6">
          {section === "overview" && <OverviewSection />}
          {section === "revenue" && <RevenueSection />}
          {section === "users" && <UsersSection />}
          {section === "meetings" && <MeetingsSection />}
          {section === "queue" && <QueueSection />}
          {section === "system" && <SystemSection />}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function statusColor(s: "ok" | "fail" | "skipped" | undefined) {
  if (s === "ok") return "bg-success";
  if (s === "fail") return "bg-destructive";
  return "bg-muted-foreground/50";
}

function SystemPulse({ system }: { system: AdminSystemResponse | undefined }) {
  if (!system) return <div className="h-5" />;
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
        Services
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {system.services.map((svc) => (
          <span
            key={svc.name}
            title={`${svc.name}: ${svc.status}${svc.latency_ms != null ? ` (${svc.latency_ms}ms)` : ""}`}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border/60 bg-background/40 px-1.5 py-0.5 text-[10px]"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusColor(svc.status)}`} />
            {svc.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function CenterLoader() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-md border border-border/70 bg-surface p-10 text-center">
      <p className="text-sm font-medium">Could not load data.</p>
      <button
        onClick={onRetry}
        className="mt-3 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Try again
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "complete")
    return (
      <span className="rounded-sm bg-success/15 px-1.5 py-0.5 font-mono text-[10px] text-success">
        complete
      </span>
    );
  if (status === "failed")
    return (
      <span className="rounded-sm bg-destructive/15 px-1.5 py-0.5 font-mono text-[10px] text-destructive">
        failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-warning/15 px-1.5 py-0.5 font-mono text-[10px] text-warning">
      <span className="h-1 w-1 animate-pulse rounded-full bg-warning" /> {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewSection() {
  const users = useAdminUsers();
  const meetings = useAdminMeetings();
  const queue = useAdminQueue();
  const system = useAdminSystem();

  const failedLast24h = useMemo(() => {
    if (!meetings.data) return 0;
    const since = Date.now() - 24 * 60 * 60 * 1000;
    return meetings.data.items.filter(
      (m) => m.status === "failed" && new Date(m.created_at).getTime() > since,
    ).length;
  }, [meetings.data]);

  const adminCount = users.data?.items.filter((u) => u.is_admin).length ?? 0;

  const kpis = [
    {
      label: "Total users",
      value: users.data?.items.length,
      sub: adminCount > 0 ? `${adminCount} admin` : null,
      icon: Users as LucideIcon,
    },
    {
      label: "Meetings indexed",
      value: meetings.data?.items.length,
      sub: null,
      icon: FileAudio as LucideIcon,
    },
    {
      label: "Queue waiting",
      value: queue.data?.counts.waiting ?? 0,
      sub: queue.data ? `${queue.data.counts.active ?? 0} active` : null,
      icon: ListChecks as LucideIcon,
    },
    {
      label: "Failed (24h)",
      value: failedLast24h,
      sub: queue.data ? `${queue.data.counts.failed ?? 0} all-time` : null,
      icon: AlertTriangle as LucideIcon,
    },
  ];

  return (
    <div className="space-y-6">
      {/* KPI hero */}
      <section>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Key metrics
        </p>
        <div className="mt-3 grid gap-px overflow-hidden rounded-md border border-border/70 bg-border/40 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k, i) => (
            <motion.div
              key={k.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-surface p-5"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <k.icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <p className="mt-3 font-mono text-3xl font-semibold tracking-tight">
                {k.value ?? "—"}
              </p>
              {k.sub && <p className="mt-1 font-mono text-[10px] text-muted-foreground">{k.sub}</p>}
            </motion.div>
          ))}
        </div>
      </section>

      {/* System health */}
      <section>
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            System health
          </p>
          {system.data && (
            <p className="font-mono text-[10px] text-muted-foreground">
              {system.data.services.filter((s) => s.status === "ok").length}/
              {system.data.services.length} services up
            </p>
          )}
        </div>
        <div className="mt-3 grid gap-px overflow-hidden rounded-md border border-border/70 bg-border/40 sm:grid-cols-2 lg:grid-cols-3">
          {system.isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-surface p-4">
                  <div className="h-4 w-24 animate-pulse rounded bg-muted/40" />
                  <div className="mt-2 h-3 w-32 animate-pulse rounded bg-muted/30" />
                </div>
              ))
            : system.data?.services.map((svc) => (
                <div key={svc.name} className="bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${statusColor(svc.status)}`} />
                      <p className="text-sm font-medium">{svc.name}</p>
                    </div>
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">
                      {svc.status}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                    {svc.latency_ms != null ? `${svc.latency_ms}ms` : "—"}
                    {svc.detail && ` · ${svc.detail}`}
                  </p>
                </div>
              ))}
        </div>
      </section>

      {/* Recent activity */}
      <section>
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Recent activity
          </p>
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <Activity className="h-3 w-3" /> last 10
          </span>
        </div>
        <div className="mt-3 overflow-hidden rounded-md border border-border/70 bg-surface">
          {meetings.isLoading ? (
            <CenterLoader />
          ) : !meetings.data || meetings.data.items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {meetings.data.items.slice(0, 10).map((m) => (
                <li key={m.id} className="flex items-center gap-4 px-4 py-2.5 text-sm">
                  <StatusBadge status={m.status} />
                  <Link
                    to="/app/meetings/$id"
                    params={{ id: m.id }}
                    className="min-w-0 flex-1 truncate hover:underline"
                  >
                    {m.title}
                  </Link>
                  <span className="hidden font-mono text-[11px] text-muted-foreground md:inline">
                    {m.user_email}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {formatDate(m.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

interface EditUserDialogProps {
  user: AdminUserRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function EditUserDialog({ user, open, onOpenChange }: EditUserDialogProps) {
  const [name, setName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [tier, setTier] = useState<"free" | "student" | "pro" | "team">("free");
  const [status, setStatus] = useState<"active" | "cancelled" | "past_due" | "trialing">("active");

  const updateUser = useUpdateUser();
  const updateSubscription = useUpdateUserSubscription();

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setIsAdmin(user.is_admin);
      setTier((user.tier as "free" | "student" | "pro" | "team") || "free");
      setStatus(
        (user.subscription_status as "active" | "cancelled" | "past_due" | "trialing") || "active",
      );
    }
  }, [user]);

  const handleSave = async () => {
    if (!user) return;

    try {
      // Update name and is_admin
      await updateUser.mutateAsync({
        userId: user.id,
        updates: { name: name || undefined, is_admin: isAdmin },
      });

      // Update subscription
      await updateSubscription.mutateAsync({
        userId: user.id,
        updates: { tier, status },
      });

      toast.success("User updated successfully");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update user");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>
            Update user details, admin status, and subscription settings.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter name"
            />
          </div>

          {/* Admin Status */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Admin Status</Label>
              <p className="text-sm text-muted-foreground">Grant admin privileges to this user</p>
            </div>
            <Switch checked={isAdmin} onCheckedChange={setIsAdmin} />
          </div>

          {/* Subscription Tier */}
          <div className="space-y-2">
            <Label htmlFor="tier">Subscription Tier</Label>
            <Select value={tier} onValueChange={(v) => setTier(v as typeof tier)}>
              <SelectTrigger id="tier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="student">Student</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
                <SelectItem value="team">Team</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Subscription Status */}
          <div className="space-y-2">
            <Label htmlFor="status">Subscription Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="trialing">Trialing</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="past_due">Past Due</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateUser.isPending || updateSubscription.isPending}
          >
            {updateUser.isPending || updateSubscription.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteUserDialogProps {
  user: AdminUserRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function DeleteUserDialog({ user, open, onOpenChange }: DeleteUserDialogProps) {
  const deleteUser = useDeleteUser();
  const [needsConfirm, setNeedsConfirm] = useState(false);

  const handleDelete = async () => {
    if (!user) return;

    try {
      await deleteUser.mutateAsync({
        userId: user.id,
        confirm: user.is_admin,
      });
      toast.success(`User ${user.email} deleted successfully`);
      onOpenChange(false);
      setNeedsConfirm(false);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to delete user";

      // Check if we need confirmation for admin user
      if (errorMsg.includes("confirmation_required") && !needsConfirm) {
        setNeedsConfirm(true);
        toast.warning("This is an admin user. Please confirm deletion.");
      } else {
        toast.error(errorMsg);
      }
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete User</AlertDialogTitle>
          <AlertDialogDescription>
            {user?.is_admin && needsConfirm ? (
              <span className="text-destructive">
                <strong>Warning:</strong> You are about to delete an admin user. This action cannot
                be undone. All their meetings, action items, and data will be permanently deleted.
              </span>
            ) : (
              <>
                Are you sure you want to delete <strong>{user?.email}</strong>? This action cannot
                be undone. All their meetings, action items, and data will be permanently deleted.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setNeedsConfirm(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleteUser.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteUser.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete User"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function UsersSection() {
  const { data, isLoading, isError, refetch } = useAdminUsers();
  const { data: me } = useMe();
  const [editUser, setEditUser] = useState<AdminUserRow | null>(null);
  const [deleteUser, setDeleteUser] = useState<AdminUserRow | null>(null);

  if (isLoading) return <CenterLoader />;
  if (isError) return <ErrorBlock onRetry={() => refetch()} />;
  const items = data?.items ?? [];

  const getTierBadgeColor = (tier: string | null) => {
    switch (tier) {
      case "pro":
        return "bg-purple-500/15 text-purple-600 dark:text-purple-400";
      case "student":
        return "bg-brand/15 text-brand";
      case "team":
        return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
      default:
        return "bg-muted/60 text-muted-foreground";
    }
  };

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case "active":
        return "text-success";
      case "trialing":
        return "text-brand";
      case "cancelled":
        return "text-muted-foreground";
      case "past_due":
        return "text-destructive";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <>
      <section>
        <SectionHeader title="Users" count={items.length} />
        <DataTable<AdminUserRow>
          rows={items}
          columns={[
            {
              key: "email",
              label: "Email",
              render: (u) => <span className="font-mono text-xs">{u.email}</span>,
            },
            {
              key: "name",
              label: "Name",
              render: (u) => u.name ?? <span className="text-muted-foreground">—</span>,
            },
            {
              key: "role",
              label: "Role",
              render: (u) =>
                u.is_admin ? (
                  <span className="inline-flex items-center gap-1 rounded-sm bg-brand/15 px-1.5 py-0.5 font-mono text-[10px] text-brand">
                    <ShieldCheck className="h-3 w-3" /> admin
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-muted-foreground">user</span>
                ),
            },
            {
              key: "subscription",
              label: "Subscription",
              render: (u) => (
                <div className="flex flex-col gap-1">
                  <span
                    className={`inline-flex w-fit items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px] ${getTierBadgeColor(u.tier)}`}
                  >
                    {u.tier || "free"}
                  </span>
                  {u.subscription_status && (
                    <span
                      className={`font-mono text-[10px] ${getStatusColor(u.subscription_status)}`}
                    >
                      {u.subscription_status}
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: "password",
              label: "Auth",
              render: (u) =>
                u.has_password ? (
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-success">
                    <CheckCircle2 className="h-3 w-3" /> password
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-muted-foreground">oauth-only</span>
                ),
            },
            {
              key: "meetings",
              label: "Meetings",
              align: "right",
              render: (u) => <span className="font-mono text-xs">{u.meeting_count}</span>,
            },
            {
              key: "joined",
              label: "Joined",
              align: "right",
              render: (u) => (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {formatDate(u.created_at)}
                </span>
              ),
            },
            {
              key: "actions",
              label: "Actions",
              align: "right",
              render: (u) => (
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditUser(u)}
                    className="h-7 px-2"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (u.id === me?.id) {
                        toast.error("Cannot delete your own account");
                        return;
                      }
                      setDeleteUser(u);
                    }}
                    disabled={u.id === me?.id}
                    className="h-7 px-2 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ),
            },
          ]}
          emptyLabel="No users."
        />
      </section>

      <EditUserDialog
        user={editUser}
        open={!!editUser}
        onOpenChange={(open) => !open && setEditUser(null)}
      />

      <DeleteUserDialog
        user={deleteUser}
        open={!!deleteUser}
        onOpenChange={(open) => !open && setDeleteUser(null)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

function MeetingsSection() {
  const { data, isLoading, isError, refetch } = useAdminMeetings();
  if (isLoading) return <CenterLoader />;
  if (isError) return <ErrorBlock onRetry={() => refetch()} />;
  const items = data?.items ?? [];

  return (
    <section>
      <SectionHeader title="Meetings" count={items.length} />
      <DataTable<AdminMeetingRow>
        rows={items}
        columns={[
          {
            key: "title",
            label: "Title",
            render: (m) => (
              <div>
                <Link to="/app/meetings/$id" params={{ id: m.id }} className="hover:underline">
                  {m.title}
                </Link>
                {m.failure_reason && (
                  <p className="mt-0.5 truncate font-mono text-[10px] text-destructive">
                    {m.failure_reason}
                  </p>
                )}
              </div>
            ),
          },
          {
            key: "user",
            label: "User",
            render: (m) => (
              <span className="font-mono text-xs text-muted-foreground">{m.user_email}</span>
            ),
          },
          { key: "status", label: "Status", render: (m) => <StatusBadge status={m.status} /> },
          {
            key: "duration",
            label: "Duration",
            align: "right",
            render: (m) => (
              <span className="font-mono text-xs">{formatDuration(m.duration_sec)}</span>
            ),
          },
          {
            key: "created",
            label: "Created",
            align: "right",
            render: (m) => (
              <span className="font-mono text-[11px] text-muted-foreground">
                {formatDate(m.created_at)}
              </span>
            ),
          },
        ]}
        emptyLabel="No meetings."
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

function QueueSection() {
  const { data, isLoading, isError, refetch } = useAdminQueue();
  if (isLoading) return <CenterLoader />;
  if (isError) return <ErrorBlock onRetry={() => refetch()} />;
  const counts = data?.counts ?? {};
  const buckets: Array<{ label: string; key: keyof AdminQueueResponse["counts"]; color: string }> =
    [
      { label: "waiting", key: "waiting", color: "text-warning" },
      { label: "active", key: "active", color: "text-brand" },
      { label: "delayed", key: "delayed", color: "text-muted-foreground" },
      { label: "completed", key: "completed", color: "text-success" },
      { label: "failed", key: "failed", color: "text-destructive" },
    ];

  return (
    <section className="space-y-6">
      <SectionHeader title="BullMQ processing queue" count={null} />
      <div className="grid gap-px overflow-hidden rounded-md border border-border/70 bg-border/40 sm:grid-cols-5">
        {buckets.map((b) => (
          <div key={b.label} className="bg-surface p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {b.label}
            </p>
            <p className={`mt-2 font-mono text-3xl font-semibold tracking-tight ${b.color}`}>
              {counts[b.key] ?? 0}
            </p>
          </div>
        ))}
      </div>

      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Recent failures
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Last 10 jobs that exhausted retries.</p>
        <div className="mt-3 overflow-hidden rounded-md border border-border/70 bg-surface">
          {data?.recent_failed.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No recent failures.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border/60 bg-surface/60">
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Job</th>
                  <th className="px-4 py-2.5 font-medium">Reason</th>
                  <th className="px-4 py-2.5 font-medium text-right">Attempts</th>
                  <th className="px-4 py-2.5 font-medium text-right">Failed at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data?.recent_failed.map((j) => (
                  <tr key={j.id}>
                    <td className="px-4 py-3 font-mono text-xs">{j.name}</td>
                    <td className="px-4 py-3 text-xs">
                      <AlertTriangle className="mr-1 inline h-3 w-3 text-destructive" />
                      {j.failed_reason ?? "Unknown"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{j.attempts_made}</td>
                    <td className="px-4 py-3 text-right font-mono text-[11px] text-muted-foreground">
                      {j.failed_at ? formatDate(j.failed_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

function SystemSection() {
  const { data, isLoading, isError, refetch } = useAdminSystem();
  if (isLoading) return <CenterLoader />;
  if (isError || !data) return <ErrorBlock onRetry={() => refetch()} />;

  const rt = data.runtime;
  const runtimeItems = [
    { label: "Environment", value: rt.env, icon: Server },
    { label: "Node version", value: rt.node_version, icon: Cpu },
    { label: "App URL", value: rt.app_url, icon: HardDrive },
    { label: "API port", value: String(rt.api_port), icon: Database },
    { label: "Process PID", value: String(rt.pid), icon: Sparkles },
    { label: "Memory (RSS)", value: `${rt.memory_mb} MB`, icon: Activity },
    { label: "Uptime", value: formatUptime(rt.uptime_seconds), icon: Clock },
  ];

  return (
    <div className="space-y-6">
      <section>
        <SectionHeader title="Services" count={data.services.length} />
        <div className="overflow-hidden rounded-md border border-border/70 bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border/60 bg-surface/60">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Service</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Latency</th>
                <th className="px-4 py-2.5 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {data.services.map((s) => (
                <tr key={s.name} className="hover:bg-accent/30">
                  <td className="px-4 py-3 text-sm font-medium">{s.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px]">
                      <span className={`h-1.5 w-1.5 rounded-full ${statusColor(s.status)}`} />
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {s.latency_ms != null ? `${s.latency_ms}ms` : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {s.detail ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionHeader title="Runtime" count={null} />
        <div className="grid gap-px overflow-hidden rounded-md border border-border/70 bg-border/40 sm:grid-cols-2 lg:grid-cols-4">
          {runtimeItems.map((r) => (
            <div key={r.label} className="bg-surface p-4">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {r.label}
                </p>
                <r.icon className="h-3 w-3 text-muted-foreground" />
              </div>
              <p className="mt-2 truncate font-mono text-sm">{r.value}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SectionHeader({ title, count }: { title: string; count: number | null }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      {count != null && (
        <span className="font-mono text-[10px] text-muted-foreground">{count} rows</span>
      )}
    </div>
  );
}

interface Column<T> {
  key: string;
  label: string;
  align?: "right";
  render: (row: T) => React.ReactNode;
}

function DataTable<T extends { id: string }>({
  rows,
  columns,
  emptyLabel,
}: {
  rows: T[];
  columns: Column<T>[];
  emptyLabel: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border/70 bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-border/60 bg-surface/60">
          <tr className="text-xs uppercase tracking-wider text-muted-foreground">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-4 py-2.5 font-medium ${c.align === "right" ? "text-right" : "text-left"}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center text-sm text-muted-foreground"
              >
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="hover:bg-accent/30">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-4 py-3 ${c.align === "right" ? "text-right" : ""}`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
