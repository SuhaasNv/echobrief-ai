/**
 * Active workspace state. Persisted via localStorage so the API client picks
 * up the X-Workspace-Id header on every request without a React render.
 *
 * Components subscribe via useActiveWorkspaceId(); switching triggers a
 * cross-tab event so other tabs stay in sync.
 */

import { useEffect, useState } from "react";
import { getActiveWorkspaceId, setActiveWorkspaceId } from "@/lib/api/client";

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
