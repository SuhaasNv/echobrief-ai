"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useMe, useWorkspaces, useCreateWorkspace } from "@/lib/api/hooks";
import { setActiveWorkspace } from "@/lib/workspace-store";
import { toast } from "sonner";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

function defaultName(name: string | null, email: string): string {
  if (name && name.trim()) return `${name.trim().split(/\s+/)[0]}'s workspace`;
  return `${email.split("@")[0]}'s workspace`;
}

/**
 * Shown when an authenticated user has zero workspaces. Migration 0006
 * backfilled a "Personal" workspace for everyone existing, so this only fires
 * for brand-new signups in the future.
 */
export function FirstWorkspaceModal() {
  const { data: me } = useMe();
  const workspaces = useWorkspaces();
  const create = useCreateWorkspace();
  const qc = useQueryClient();

  const [name, setName] = useState<string>("");

  const needsModal = !!me && workspaces.isSuccess && (workspaces.data?.items ?? []).length === 0;

  if (!needsModal) return null;

  const finalName = name.trim() || (me ? defaultName(me.name, me.email) : "Workspace");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await create.mutateAsync({ name: finalName });
      setActiveWorkspace(created.id);
      qc.invalidateQueries();
      toast.success(`Created ${created.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create workspace");
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm px-4"
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.28, ease: EASE }}
          className="w-full max-w-md rounded-2xl border border-border/70 bg-popover p-7 shadow-elegant"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-brand">
            Welcome to Puffin
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Name your first workspace</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Workspaces keep your meetings, action items, and AI memory separate. You can add more
            later from Settings.
          </p>
          <form onSubmit={submit} className="mt-6 space-y-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={me ? defaultName(me.name, me.email) : "Workspace name"}
              autoFocus
              maxLength={60}
              className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <button
              type="submit"
              disabled={create.isPending}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {create.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…
                </>
              ) : (
                <>Create workspace</>
              )}
            </button>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
