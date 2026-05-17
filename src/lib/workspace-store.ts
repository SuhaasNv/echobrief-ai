/**
 * Active workspace state. Persisted via localStorage so the API client picks
 * up the X-Workspace-Id header on every request without a React render.
 *
 * Components subscribe via useActiveWorkspaceId(); switching triggers a
 * cross-tab event so other tabs stay in sync.
 */

import { useEffect, useMemo, useState } from "react";
import { getActiveWorkspaceId, setActiveWorkspaceId } from "@/lib/api/client";
import { useWorkspaces, type WorkspaceKind } from "@/lib/api/hooks";
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
 * Active workspace's `kind`. Resolves via the cached `useWorkspaces()` list;
 * returns `"professional"` as a safe default while loading or if the active
 * workspace can't be found (first paint).
 */
export function useActiveWorkspaceKind(): WorkspaceKind {
  const activeId = useActiveWorkspaceId();
  const { data } = useWorkspaces();
  return useMemo<WorkspaceKind>(() => {
    const list = data?.items ?? [];
    const active = list.find((w) => w.id === activeId) ?? list[0];
    return active?.kind ?? "professional";
  }, [activeId, data]);
}

/**
 * Vocabulary keyed by the active workspace's kind. Components import this
 * directly: `const labels = useLabels(); ... <h1>{labels.meeting.plural}</h1>`.
 */
export function useLabels(): LabelSet {
  const kind = useActiveWorkspaceKind();
  return useMemo(() => getLabels(kind), [kind]);
}
