"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronsUpDown, Check, Plus, Loader2 } from "lucide-react";
import {
  useWorkspaces,
  useCreateWorkspace,
  type Workspace,
  type WorkspaceColor,
} from "@/lib/api/hooks";
import { setActiveWorkspace, useActiveWorkspaceId } from "@/lib/workspace-store";
import { toast } from "sonner";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

const COLOR_BG: Record<WorkspaceColor, string> = {
  brand: "from-brand to-violet",
  violet: "from-violet to-fuchsia-500",
  emerald: "from-emerald-400 to-teal-500",
  amber: "from-amber-400 to-orange-500",
  rose: "from-rose-400 to-pink-500",
  slate: "from-slate-400 to-slate-600",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const qc = useQueryClient();
  const { data } = useWorkspaces();
  const activeId = useActiveWorkspaceId();
  const createMutation = useCreateWorkspace();

  const workspaces = data?.items ?? [];
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const activeColor = (active?.color ?? "brand") as WorkspaceColor;

  // On first load, if no active workspace is set but workspaces exist, pick first.
  useEffect(() => {
    if (!activeId && workspaces.length > 0) {
      setActiveWorkspace(workspaces[0].id);
    }
  }, [activeId, workspaces]);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const switchTo = (w: Workspace) => {
    if (w.id === activeId) {
      setOpen(false);
      return;
    }
    setActiveWorkspace(w.id);
    // Invalidate all workspace-scoped data so it refetches with the new header.
    qc.invalidateQueries();
    setOpen(false);
    toast.success(`Switched to ${w.name}`);
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await createMutation.mutateAsync({ name });
      setActiveWorkspace(created.id);
      qc.invalidateQueries();
      setNewName("");
      setCreating(false);
      setOpen(false);
      toast.success(`Created ${created.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create workspace");
    }
  };

  return (
    <div className="relative mx-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-surface/40 px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-[10px] font-medium text-white ${COLOR_BG[activeColor]}`}
          >
            {active ? initials(active.name) : "—"}
          </span>
          <span className="truncate font-medium">{active?.name ?? "No workspace"}</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div role="presentation" onClick={() => setOpen(false)} className="fixed inset-0 z-40" />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.15, ease: EASE }}
              className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-elegant"
              role="listbox"
            >
              <div className="border-b border-border/60 px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Workspaces
                </p>
              </div>
              <ul className="max-h-64 overflow-y-auto py-1">
                {workspaces.map((w) => {
                  const isActive = w.id === active?.id;
                  const color = w.color as WorkspaceColor;
                  return (
                    <li key={w.id}>
                      <button
                        type="button"
                        onClick={() => switchTo(w)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent/60 ${
                          isActive ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-[9px] font-medium text-white ${COLOR_BG[color]}`}
                        >
                          {initials(w.name)}
                        </span>
                        <span className="flex-1 truncate">{w.name}</span>
                        {isActive && <Check className="h-3.5 w-3.5 text-brand" />}
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="border-t border-border/60">
                {creating ? (
                  <form onSubmit={submitCreate} className="space-y-2 px-2 py-2">
                    <input
                      ref={inputRef}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Workspace name"
                      className="w-full rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                      maxLength={60}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={!newName.trim() || createMutation.isPending}
                        className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-foreground text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        {createMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Create"
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCreating(false);
                          setNewName("");
                        }}
                        className="h-7 rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" /> Create workspace
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
