import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";

export interface Account {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  kind?: string;
}

export const accountKeys = {
  me: ["account", "me"] as const,
  workspaces: ["workspaces"] as const,
};

export function useAccount() {
  return useQuery({
    queryKey: accountKeys.me,
    queryFn: () => api.apiRequest<Account>("/account/me"),
  });
}

/** Like every list endpoint here, this returns { items }, not a bare array. */
interface WorkspaceList {
  items: Workspace[];
}

export function useWorkspaces() {
  return useQuery({
    queryKey: accountKeys.workspaces,
    queryFn: () => api.apiRequest<WorkspaceList>("/workspaces"),
    select: (data): Workspace[] => (Array.isArray(data?.items) ? data.items : []),
  });
}

/**
 * Every mutation here runs even when React Query thinks we are offline.
 *
 * The default networkMode PAUSES a mutation instead of failing it, which on
 * these screens means the Save button spins on a request that was never sent,
 * with no error, no timeout, and nothing to press. Worse, a paused mutation
 * only survives in memory: kill the app and the change is gone while the UI
 * still shows it as made. Failing fast means the screen can say what happened
 * and put the value back the way it was.
 */
const ALWAYS = { networkMode: "always" } as const;

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    ...ALWAYS,
    mutationFn: (body: { name?: string }) =>
      api.apiRequest<Account>("/account/me", { method: "PATCH", body }),
    onSuccess: (updated) => {
      queryClient.setQueryData(accountKeys.me, updated);
    },
  });
}

export function useChangePassword() {
  return useMutation({
    ...ALWAYS,
    mutationFn: (body: { current_password: string; new_password: string }) =>
      api.apiRequest("/account/password", { method: "POST", body }),
  });
}

/**
 * Account deletion.
 *
 * Not optional: App Store guideline 5.1.1(v) requires any app that creates
 * accounts to let people delete them from inside the app. Offering only a
 * "contact support" route is an explicit rejection reason.
 */
export function useDeleteAccount() {
  return useMutation({
    ...ALWAYS,
    mutationFn: () => api.apiRequest("/account/me", { method: "DELETE" }),
  });
}

/** Initials for the avatar. Falls back to the email when there is no name. */
export function initialsFor(account: Account | undefined): string {
  if (!account) return "?";
  const source = account.name?.trim() || account.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? (parts[1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}
