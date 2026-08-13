import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@echobrief/shared/api";

import { api } from "./client";
import { tokenStore } from "./token-store";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  is_admin: boolean;
}

interface AuthSuccess {
  token: string;
  user: AuthUser;
}

/**
 * Signup returns a union. On an email collision the server responds 200 with
 * `{status, message}` and NO token — deliberate anti-enumeration, asserted by
 * the integration tests. Treating that as success is how you get an infinite
 * spinner on the most common signup error.
 */
interface AuthCollision {
  status: "ok";
  message: string;
}

type AuthResponse = AuthSuccess | AuthCollision;

function isAuthSuccess(res: AuthResponse): res is AuthSuccess {
  return "token" in res && typeof res.token === "string";
}

interface Workspace {
  id: string;
}

/** Like the other list endpoints, this returns { items }, not a bare array. */
interface WorkspaceListResponse {
  items: Workspace[];
}

/**
 * Adopt a session: persist the token, then pick a workspace.
 *
 * The workspace id is optional on every request — the server falls back to the
 * user's oldest workspace — so a failure here is non-fatal and must not block
 * sign-in.
 */
async function adoptSession(token: string): Promise<void> {
  tokenStore.setToken(token);

  try {
    const res = await api.apiRequest<WorkspaceListResponse>("/workspaces");
    const first = res?.items?.[0];
    if (first) {
      tokenStore.setWorkspaceId(first.id);
    }
  } catch {
    // Leave the header unset and let the server choose.
  }
}

export function useSignIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { email: string; password: string }) => {
      const res = await api.apiRequest<AuthSuccess>("/auth/login", {
        method: "POST",
        body: vars,
      });
      await adoptSession(res.token);
      return res;
    },
    onSuccess: () => {
      // Nothing cached should survive a session change.
      queryClient.clear();
    },
  });
}

export function useSignUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { email: string; password: string; name?: string }) => {
      const res = await api.apiRequest<AuthResponse>("/auth/signup", {
        method: "POST",
        body: vars,
      });

      if (!isAuthSuccess(res)) {
        return { collision: true as const, message: res.message };
      }

      await adoptSession(res.token);
      queryClient.clear();
      return { collision: false as const, user: res.user };
    },
  });
}

/**
 * User-facing copy for an auth failure.
 *
 * Login deliberately returns the same error for an unknown email as for a wrong
 * password. Do not make this more specific — the sameness is the security
 * property, and tests assert it.
 */
export function authErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Can't reach EchoBrief. Check your connection and try again.";
  }

  if (error.status === 401) return "Email or password is incorrect.";
  // The server's rate-limit copy already names the retry window.
  if (error.status === 429) return error.message;
  if (error.status === 400) return error.message;
  return "Can't reach EchoBrief. Check your connection and try again.";
}
