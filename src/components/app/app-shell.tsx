import { useEffect, useState } from "react";
import { Link, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { LogOut, ShieldCheck, CheckCircle2, AlertTriangle, FileAudio, X } from "lucide-react";
import { setAuthToken } from "@/lib/api/client";
import { useMe, useMeetings } from "@/lib/api/hooks";
import {
  LayoutGrid,
  Mic,
  Upload,
  MessageSquare,
  CheckSquare,
  Users,
  BarChart3,
  Settings,
  Search,
  Bell,
  Plus,
  Menu,
  Command,
  GraduationCap,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useCommandPalette } from "@/components/command-palette";
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher";
import { FirstWorkspaceModal } from "@/components/app/first-workspace-modal";
import { setActiveWorkspace, useActiveWorkspaceKind, useLabels } from "@/lib/workspace-store";
import type { LabelSet } from "@/lib/copy/labels";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
  exact?: boolean;
};

function buildNav(labels: LabelSet, kind: "student" | "professional"): NavItem[] {
  const base: NavItem[] = [
    { to: "/app", label: labels.nav.dashboard, icon: LayoutGrid, exact: true },
    { to: "/app/meetings", label: labels.nav.meetings, icon: Mic },
    { to: "/app/upload", label: labels.nav.upload, icon: Upload },
    { to: "/app/chat", label: labels.nav.chat, icon: MessageSquare },
    { to: "/app/action-items", label: labels.nav.actions, icon: CheckSquare },
    { to: "/app/shared", label: labels.nav.notes, icon: Users },
  ];
  if (kind === "student") {
    base.push({ to: "/app/study", label: labels.nav.study, icon: GraduationCap });
  } else {
    base.push({ to: "/app/analytics", label: labels.nav.analytics, icon: BarChart3 });
  }
  return base;
}

const SIDEBAR_WIDTH = 248;
const STORAGE_KEY = "echobrief-sidebar-open";
const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

export function AppShell() {
  // Default open; restore preference on mount.
  const [open, setOpen] = useState(true);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const palette = useCommandPalette();
  const kind = useActiveWorkspaceKind();
  const labels = useLabels();
  const nav = buildNav(labels, kind);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "false") setOpen(false);
  }, []);

  const toggleSidebar = () => {
    setOpen((o) => {
      const next = !o;
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, String(next));
      }
      return next;
    });
  };

  // ⌘B / Ctrl+B toggles the sidebar — matches VS Code / Linear / Notion.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const isActive = (to: string, exact?: boolean) =>
    exact ? path === to : path === to || path.startsWith(`${to}/`);

  return (
    <div className="flex min-h-screen bg-background">
      <FirstWorkspaceModal />
      {/* Sidebar — animates width to 0 when closed, releasing space to main */}
      <motion.aside
        initial={false}
        animate={{ width: open ? SIDEBAR_WIDTH : 0 }}
        transition={{ duration: 0.32, ease: EASE }}
        className="sticky top-0 hidden h-screen shrink-0 overflow-hidden border-r border-border/60 bg-sidebar md:block"
      >
        {/* Inner container at the natural width so children don't reflow as
            the outer wrapper shrinks — gives the slide-in/out a clean feel. */}
        <div
          className="flex h-screen flex-col"
          style={{ width: SIDEBAR_WIDTH }}
        >
          <div className="flex h-14 items-center px-3">
            <Logo />
          </div>

          <WorkspaceSwitcher />

          <nav className="mt-4 flex-1 space-y-0.5 px-2">
            {nav.map((n) => {
              const active = isActive(n.to, n.exact);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`group flex items-center gap-3 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-accent text-foreground"
                      : "text-sidebar-foreground/80 hover:bg-accent/60 hover:text-foreground"
                  }`}
                >
                  <n.icon className="h-4 w-4 shrink-0" strokeWidth={1.6} />
                  <span className="truncate">{n.label}</span>
                  {active && <span className="ml-auto h-1 w-1 rounded-full bg-brand" />}
                </Link>
              );
            })}
          </nav>

          <div className="px-2 pb-3">
            <Link
              to="/app/upload"
              className="flex items-center justify-center gap-2 rounded-lg bg-foreground px-2.5 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" /> New upload
            </Link>
          </div>
        </div>
      </motion.aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 grid h-14 grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur-md md:px-6">
          {/* Left: burger + (logo when sidebar collapsed) */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={open ? "Hide sidebar" : "Show sidebar"}
              aria-expanded={open}
              title={open ? "Hide sidebar (⌘B)" : "Show sidebar (⌘B)"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Menu className="h-4 w-4" strokeWidth={1.6} />
            </button>
            <AnimatePresence>
              {!open && (
                <motion.div
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: 0.18, ease: EASE }}
                  className="hidden md:block"
                >
                  <Logo />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Center: command palette trigger */}
          <button
            type="button"
            onClick={palette.toggle}
            aria-label="Open command palette"
            className="group mx-auto flex w-full max-w-md items-center gap-2 rounded-md border border-border/60 bg-surface/60 px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:border-border hover:bg-surface"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 truncate">Search meetings, navigate, or ask AI…</span>
            <kbd className="hidden items-center gap-1 rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
          </button>

          {/* Right: theme, bell, profile — profile is the corner-right item */}
          <div className="flex items-center gap-1">
            <AnimatedThemeToggler />
            <NotificationsBell />
            <ProfileMenu />
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={path}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

const DISMISSED_KEY = "echobrief-dismissed-notifications";

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissed(set: Set<string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(set)));
}

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const meetings = useMeetings({ limit: 10 });
  const allItems = meetings.data?.items ?? [];

  useEffect(() => {
    setDismissed(loadDismissed());
  }, []);

  const items = allItems.filter((m) => !dismissed.has(m.id));

  // Unread = meetings that finished (complete or failed) in the last 24h, and not dismissed.
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const unreadCount = items.filter((m) => {
    if (m.status !== "complete" && m.status !== "failed") return false;
    const t = new Date(m.created_at).getTime();
    return t > since;
  }).length;

  const dismissOne = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveDismissed(next);
      return next;
    });
  };

  const clearAll = () => {
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const m of allItems) next.add(m.id);
      saveDismissed(next);
      return next;
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-brand px-1 font-mono text-[9px] font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div role="presentation" onClick={() => setOpen(false)} className="fixed inset-0 z-40" />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-elegant"
            >
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
                <p className="text-sm font-medium">Activity</p>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <span className="rounded-full bg-brand/15 px-1.5 py-0.5 font-mono text-[10px] text-brand">
                      {unreadCount} new today
                    </span>
                  )}
                  {items.length > 0 && (
                    <button
                      type="button"
                      onClick={clearAll}
                      className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      Clear all
                    </button>
                  )}
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {items.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    You're all caught up.
                  </p>
                ) : (
                  items.map((m) => {
                    const Icon =
                      m.status === "complete" ? CheckCircle2 :
                      m.status === "failed" ? AlertTriangle :
                      FileAudio;
                    const colorClass =
                      m.status === "complete" ? "text-success" :
                      m.status === "failed" ? "text-destructive" :
                      "text-muted-foreground";
                    const label =
                      m.status === "complete" ? "ready to read" :
                      m.status === "failed" ? "processing failed" :
                      `processing · ${m.status}`;
                    return (
                      <div
                        key={m.id}
                        className="group relative flex items-start gap-3 border-b border-border/40 px-3 py-2.5 text-sm transition-colors last:border-b-0 hover:bg-accent/50"
                      >
                        <Link
                          to="/app/meetings/$id"
                          params={{ id: m.id }}
                          onClick={() => setOpen(false)}
                          className="flex min-w-0 flex-1 items-start gap-3"
                        >
                          <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${colorClass}`} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate pr-6">{m.title}</p>
                            <p className="truncate font-mono text-[10px] text-muted-foreground">
                              {label} · {timeAgo(m.created_at)}
                            </p>
                          </div>
                        </Link>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            dismissOne(m.id);
                          }}
                          aria-label="Dismiss notification"
                          className="absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              <Link
                to="/app/meetings"
                onClick={() => setOpen(false)}
                className="block border-t border-border/60 px-3 py-2 text-center text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                View all meetings →
              </Link>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function initials(name: string | null, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();

  const signOut = () => {
    setAuthToken(null);
    setActiveWorkspace(null);
    qc.clear();
    navigate({ to: "/", replace: true });
  };

  if (!me) {
    return <div className="h-7 w-7 rounded-full bg-accent" />;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-accent"
      >
        {me.avatar_url ? (
          <img
            src={me.avatar_url}
            alt={me.name ?? me.email}
            className="h-7 w-7 rounded-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand to-violet text-xs font-medium text-white">
            {initials(me.name, me.email)}
          </div>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div role="presentation" onClick={() => setOpen(false)} className="fixed inset-0 z-40" />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-10 z-50 w-56 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-elegant"
            >
              <div className="border-b border-border/60 px-3 py-2.5">
                <p className="text-sm font-medium">{me.name ?? "Account"}</p>
                <p className="truncate text-xs text-muted-foreground">{me.email}</p>
              </div>
              <div className="border-t border-border/60 py-1 text-sm">
                <Link
                  to="/app/settings"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Settings className="h-3.5 w-3.5" /> Settings
                </Link>
              </div>
              {me.is_admin && (
                <div className="border-t border-border/60 py-1 text-sm">
                  <Link
                    to="/admin"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> Admin dashboard
                  </Link>
                </div>
              )}
              <div className="border-t border-border/60 py-1 text-sm">
                <button
                  type="button"
                  onClick={signOut}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

