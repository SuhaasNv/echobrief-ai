/**
 * Active workspace state. Persisted via localStorage so the API client picks
 * up the X-Workspace-Id header on every request without a React render.
 *
 * Components subscribe via useActiveWorkspaceId(); switching triggers a
 * cross-tab event so other tabs stay in sync.
 */

import { useEffect, useMemo, useState } from "react";
import { getActiveWorkspaceId, setActiveWorkspaceId } from "@/lib/api/client";
import { useWorkspaces, useMe, type WorkspaceKind } from "@/lib/api/hooks";
import { getLabels, type LabelSet } from "@/lib/copy/labels";

const EVENT = "echobrief:workspace-changed";

export function setActiveWorkspace(id: string | null): void {
  setActiveWorkspaceId(id);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
  }
}

export function useActiveWorkspaceId(): string | null {
  const [id, setId] = useState<string | null>(() => getActiveWorkspaceId());

  useEffect(() => {
    const handler = () => setId(getActiveWorkspaceId());
    window.addEventListener(EVENT, handler);
    // Other tabs writing to localStorage emit a `storage` event.
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  return id;
}

/**
 * Active workspace's `kind`. Resolves via the cached `useWorkspaces()` list,
 * with one important nuance: when there's no active workspace yet (first
 * paint, just signed in), prefer a workspace that matches the user's signup
 * type. This avoids a flash of "Office" (professional) before the auto-pick
 * settles on the student workspace.
 */
export function useActiveWorkspaceKind(): WorkspaceKind {
  const activeId = useActiveWorkspaceId();
  const { data } = useWorkspaces();
  const { data: me } = useMe();
  return useMemo<WorkspaceKind>(() => {
    const list = data?.items ?? [];
    const preferred = me?.default_account_type ?? null;
    // If user has explicitly selected a workspace, use its kind.
    const exact = list.find((w) => w.id === activeId);
    if (exact) return exact.kind;
    // Otherwise prefer a workspace matching the user's signup kind, falling
    // back to the user's signup kind directly (covers the brief moment when
    // workspaces are still loading), then to professional as a last resort.
    const matched = preferred ? list.find((w) => w.kind === preferred) : undefined;
    if (matched) return matched.kind;
    if (preferred) return preferred;
    return list[0]?.kind ?? "professional";
  }, [activeId, data, me?.default_account_type]);
}

/**
 * Vocabulary keyed by the active workspace's kind. Components import this
 * directly: `const labels = useLabels(); ... <h1>{labels.meeting.plural}</h1>`.
 */
export function useLabels(): LabelSet {
  const kind = useActiveWorkspaceKind();
  return useMemo(() => getLabels(kind), [kind]);
}
