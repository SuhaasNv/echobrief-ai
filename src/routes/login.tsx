import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { apiRequest, ApiError, setAuthToken } from "@/lib/api/client";
import { setActiveWorkspace } from "@/lib/workspace-store";
import { qk, type AccountMe, type Workspace } from "@/lib/api/hooks";

interface LoginResponse {
  token: string;
  user: { id: string; email: string; name: string | null; is_admin: boolean };
}

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — EchoBrief" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Both fields are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      setAuthToken(res.token);
      // Clear any workspace from a previous session so the middleware falls
      // back to the freshly signed-in user's own first workspace.
      setActiveWorkspace(null);
      // Drop the React Query cache so we don't flash the previous user's
      // workspaces / meetings / me before the new fetch resolves.
      qc.clear();

      // Pre-fetch /account/me + /workspaces IN PARALLEL before navigation.
      // Without this, the AppShell mounts with both queries pending, and
      // whichever resolves first triggers a render — usually causing a flash
      // of the wrong-default workspace ("Office" before "My class") until
      // both finally settle. Pre-fetching populates the cache so the very
      // first render of /app already has the right data.
      try {
        const [meData, wsData] = await Promise.all([
          apiRequest<AccountMe>("/account/me"),
          apiRequest<{ items: Workspace[] }>("/workspaces"),
        ]);
        qc.setQueryData(qk.account, meData);
        qc.setQueryData(qk.workspaces, wsData);
        // Choose the default workspace: prefer one matching the user's signup
        // type so a student account with both "Office" and "My class" lands
        // on "My class" by default. Fall back to the oldest workspace if
        // there's no match (or the user predates the student/pro fork).
        const preferred = meData.default_account_type
          ? wsData.items.find((w) => w.kind === meData.default_account_type) ?? wsData.items[0]
          : wsData.items[0];
        if (preferred) setActiveWorkspace(preferred.id);
      } catch {
        // Best-effort. If prefetch fails the AppShell will refetch — worst
        // case the user sees the original flash, which is the prior behavior.
      }

      toast.success("Signed in");
      // Admins land on the ops console; regular users land on the app dashboard.
      navigate({ to: res.user.is_admin ? "/admin" : "/app" });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Sign-in failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back."
      subtitle="Sign in to your EchoBrief workspace."
      footer={
        <>
          New here?{" "}
          <Link to="/signup" className="text-foreground underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              to="/forgot-password"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Forgot?
            </Link>
          </div>
          <PasswordInput
            id="password"
            placeholder="••••••••"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <Button type="submit" className="group w-full" disabled={submitting}>
          <motion.span
            key={submitting ? "loading" : "idle"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="inline-flex items-center gap-1.5"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Signing in…
              </>
            ) : (
              <>
                Sign in
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </motion.span>
        </Button>

        <p className="pt-2 text-center text-[11px] text-muted-foreground">
          By signing in you agree to our{" "}
          <Link to="/terms" className="underline-offset-4 hover:underline">terms</Link> and{" "}
          <Link to="/privacy" className="underline-offset-4 hover:underline">privacy policy</Link>.
        </p>
      </form>
    </AuthShell>
  );
}
