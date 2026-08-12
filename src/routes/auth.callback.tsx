import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/auth-shell";
import { apiRequest, setAuthToken } from "@/lib/api/client";
import { setActiveWorkspace } from "@/lib/workspace-store";
import { qk, type AccountMe, type Workspace } from "@/lib/api/hooks";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Signing in — EchoBrief" }] }),
  component: AuthCallbackPage,
});

/** Human-readable copy for the error codes the API can hand back. */
const ERROR_COPY: Record<string, string> = {
  google_sso_unconfigured: "Google sign-in isn't configured on this server.",
  access_denied: "Sign-in cancelled.",
  missing_code: "Google didn't return an authorization code.",
  invalid_state: "Sign-in request expired or was tampered with. Please try again.",
  invalid_nonce: "Sign-in request could not be verified. Please try again.",
  email_unverified: "Your Google email address isn't verified.",
  invalid_id_token: "Google's response could not be verified.",
  token_exchange_failed: "Could not complete sign-in with Google.",
  server_error: "Something went wrong finishing sign-in.",
};

/**
 * Lands the Google SSO redirect.
 *
 * The API sends the JWT in the URL fragment so it never reaches a server log.
 * We read it, store it, warm the same caches the password login warms, then
 * scrub the fragment via history.replaceState so the token isn't left sitting
 * in the address bar or in the browser's session history.
 */
function AuthCallbackPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // React 19 StrictMode double-invokes effects in dev; the fragment is cleared
  // on the first pass, so without this guard the second pass sees no token and
  // falsely reports a failure.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = params.get("token");
    const errCode = params.get("error");

    // Scrub the fragment before any await so the token isn't visible longer
    // than it must be.
    window.history.replaceState(null, "", window.location.pathname);

    if (errCode || !token) {
      const code = errCode ?? "missing_token";
      setError(ERROR_COPY[code] ?? "Sign-in failed. Please try again.");
      return;
    }

    setAuthToken(token);
    // A previous session's workspace must not leak into this one.
    setActiveWorkspace(null);
    qc.clear();

    let cancelled = false;

    void (async () => {
      // Mirrors the password-login prefetch: populate /account/me and
      // /workspaces before navigating so the app shell's first render already
      // has the right workspace instead of flashing a wrong default.
      let isAdmin = false;
      try {
        const [meData, wsData] = await Promise.all([
          apiRequest<AccountMe>("/account/me"),
          apiRequest<{ items: Workspace[] }>("/workspaces"),
        ]);
        if (cancelled) return;
        isAdmin = meData.is_admin ?? false;
        qc.setQueryData(qk.account, meData);
        qc.setQueryData(qk.workspaces, wsData);
        const preferred = meData.default_account_type
          ? (wsData.items.find((w) => w.kind === meData.default_account_type) ?? wsData.items[0])
          : wsData.items[0];
        if (preferred) setActiveWorkspace(preferred.id);
      } catch {
        // Best-effort, exactly as in login: the app shell will refetch.
      }

      if (cancelled) return;
      toast.success("Signed in");
      void navigate({ to: isAdmin ? "/admin" : "/app" });
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, qc]);

  if (error) {
    return (
      <AuthShell
        title="Sign-in failed."
        subtitle={error}
        footer={
          <a href="/login" className="text-foreground underline-offset-4 hover:underline">
            Back to sign in
          </a>
        }
      >
        <div />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Signing you in…"
      subtitle="One moment while we finish up."
      footer={<span className="text-muted-foreground">Verifying your Google account</span>}
    >
      <div className="flex justify-center py-6" role="status" aria-live="polite">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="sr-only">Signing in</span>
      </div>
    </AuthShell>
  );
}
