import { useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
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
  ChevronsUpDown,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Command,
} from "lucide-react";
import { Logo } from "@/components/logo";

const nav = [
  { to: "/app", label: "Dashboard", icon: LayoutGrid, exact: true },
  { to: "/app/meetings", label: "Meetings", icon: Mic },
  { to: "/app/upload", label: "Upload", icon: Upload },
  { to: "/app/chat", label: "AI Chat", icon: MessageSquare },
  { to: "/app/action-items", label: "Action Items", icon: CheckSquare },
  { to: "/app/shared", label: "Shared Notes", icon: Users },
  { to: "/app/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });

  const isActive = (to: string, exact?: boolean) =>
    exact ? path === to : path === to || path.startsWith(`${to}/`);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 68 : 248 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border/60 bg-sidebar md:flex"
      >
        <div className="flex h-14 items-center justify-between px-3">
          {!collapsed ? <Logo /> : <div className="mx-auto h-7 w-7 rounded-md bg-foreground" />}
        </div>

        <button className="mx-3 flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-surface/40 px-2.5 py-2 text-left text-sm hover:bg-accent">
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-6 w-6 shrink-0 rounded-md bg-gradient-to-br from-brand to-violet" />
            {!collapsed && <span className="truncate font-medium">Acme Workspace</span>}
          </span>
          {!collapsed && <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        </button>

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
                {!collapsed && <span className="truncate">{n.label}</span>}
                {!collapsed && active && <span className="ml-auto h-1 w-1 rounded-full bg-brand" />}
              </Link>
            );
          })}
        </nav>

        <div className="px-2 pb-3">
          <Link
            to="/app/upload"
            className="mb-2 flex items-center justify-center gap-2 rounded-lg bg-foreground px-2.5 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> {!collapsed && "New upload"}
          </Link>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
            {!collapsed && "Collapse"}
          </button>
        </div>
      </motion.aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur-md md:px-6">
          <div className="flex max-w-md flex-1 items-center gap-2 rounded-md border border-border/60 bg-surface/60 px-2.5 py-1.5 text-sm text-muted-foreground">
            <Search className="h-3.5 w-3.5" />
            <input
              placeholder="Search meetings, people, or ask AI…"
              className="w-full bg-transparent placeholder:text-muted-foreground focus:outline-none"
            />
            <kbd className="hidden items-center gap-1 rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
          </div>
          <button className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <Bell className="h-4 w-4" />
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand" />
          </button>
          <ProfileMenu />
        </header>
        <main className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={path}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function ProfileMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand to-violet text-xs font-medium text-white">
          MC
        </div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-10 w-56 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-elegant"
          >
            <div className="border-b border-border/60 px-3 py-2.5">
              <p className="text-sm font-medium">Maya Chen</p>
              <p className="text-xs text-muted-foreground">maya@acme.co</p>
            </div>
            <div className="py-1 text-sm">
              {["Profile settings", "Billing", "Keyboard shortcuts", "Documentation"].map((i) => (
                <button key={i} className="flex w-full items-center px-3 py-1.5 text-left hover:bg-accent">
                  {i}
                </button>
              ))}
            </div>
            <div className="border-t border-border/60 py-1 text-sm">
              <Link to="/" className="flex w-full items-center px-3 py-1.5 text-muted-foreground hover:bg-accent">
                Sign out
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
