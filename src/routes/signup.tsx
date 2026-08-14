import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, ArrowRight, Check, GraduationCap, Briefcase } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/auth-shell";
import { GoogleButton, AuthDivider } from "@/components/auth/google-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { apiRequest, ApiError, setAuthToken } from "@/lib/api/client";
import { setActiveWorkspace } from "@/lib/workspace-store";
import { useQueryClient } from "@tanstack/react-query";
import { qk, type AccountMe, type Workspace } from "@/lib/api/hooks";

interface SignupResponse {
  // Token is absent when the server suppressed email enumeration (e.g. the
  // email is already registered). Client must treat missing token as a
  // non-success case.
  token?: string;
  user?: { id: string; email: string; name: string | null; is_admin: boolean };
  status?: "ok";
  message?: string;
}

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create account — EchoBrief" }] }),
  component: SignupPage,
});

function scorePassword(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string; color: string } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  const map: Record<number, { label: string; color: string }> = {
    0: { label: "Too short", color: "bg-muted" },
    1: { label: "Weak", color: "bg-destructive" },
    2: { label: "Okay", color: "bg-warning" },
    3: { label: "Strong", color: "bg-success" },
    4: { label: "Very strong", color: "bg-success" },
  };
  return { score: s as 0 | 1 | 2 | 3 | 4, ...map[s] };
}

type AccountType = "student" | "professional";

function SignupPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(() => scorePassword(password), [password]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountType) {
      toast.error("Pick student or professional first");
      return;
    }
    if (!first.trim() || !email || !password) {
      toast.error("Name, email, and password are all required");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (strength.score < 2) {
      toast.error("Pick a stronger password");
      return;
    }
    setSubmitting(true);
    try {
      const name = [first.trim(), last.trim()].filter(Boolean).join(" ");
      const res = await apiRequest<SignupResponse>("/auth/signup", {
        method: "POST",
        body: { email, password, name, account_type: accountType },
      });
      if (!res.token) {
        // Server suppressed details to prevent email enumeration. Show the
        // generic message and stay on the page — let the user try signing in.
        toast.message(res.message ?? "If this email is new, your account has been created.", {
          duration: 6000,
        });
        return;
      }
      setAuthToken(res.token);
      // Clear any stale active-workspace from a previous session so the
      // middleware falls back to the user's brand-new first workspace.
      setActiveWorkspace(null);
      qc.clear();

      // Pre-fetch me + workspaces so /app renders correctly on first paint.
      // Signup just created exactly one workspace of the right kind, but we
      // still need both queries in the cache before navigation to avoid the
      // "first render with no data" → "second render with data" double-paint.
      try {
        const [meData, wsData] = await Promise.all([
          apiRequest<AccountMe>("/account/me"),
          apiRequest<{ items: Workspace[] }>("/workspaces"),
        ]);
        qc.setQueryData(qk.account, meData);
        qc.setQueryData(qk.workspaces, wsData);
        const preferred = meData.default_account_type
          ? (wsData.items.find((w) => w.kind === meData.default_account_type) ?? wsData.items[0])
          : wsData.items[0];
        if (preferred) setActiveWorkspace(preferred.id);
      } catch {
        // Best-effort. Fall through to AppShell's own fetching.
      }

      toast.success("Welcome to EchoBrief");
      navigate({ to: "/app" });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Sign-up failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title={accountType === "student" ? "Start learning smarter." : "Create your workspace."}
      subtitle={
        accountType === "student"
          ? "Lectures, notes, flashcards — all searchable."
          : "Free tier, no card. Upgrade when you outgrow it."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            What brings you here?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <TypeCard
              icon={GraduationCap}
              label="I'm a student"
              hint="Lectures · Flashcards · Study"
              active={accountType === "student"}
              onClick={() => setAccountType("student")}
            />
            <TypeCard
              icon={Briefcase}
              label="I'm a professional"
              hint="Meetings · Action items · Integrations"
              active={accountType === "professional"}
              onClick={() => setAccountType("professional")}
            />
          </div>
        </div>

        <AnimatePresence initial={false}>
          {accountType && (
            <motion.div
              key="google-signup"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <GoogleButton label="Sign up" accountType={accountType} disabled={submitting} />
              <AuthDivider />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {accountType && (
            <motion.form
              key="signup-form"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
              onSubmit={handleSubmit}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="first">First name</Label>
                  <Input
                    id="first"
                    placeholder="Maya"
                    value={first}
                    onChange={(e) => setFirst(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="last">Last name</Label>
                  <Input
                    id="last"
                    placeholder="Chen"
                    value={last}
                    onChange={(e) => setLast(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Work email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                {password && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className="space-y-1.5"
                  >
                    <div className="flex gap-1">
                      {[0, 1, 2, 3].map((i) => (
                        <span
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            i < strength.score ? strength.color : "bg-muted"
                          }`}
                        />
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{strength.label}</span>
                      <span className="flex items-center gap-1.5 font-mono">
                        {password.length >= 8 && <Check className="h-3 w-3 text-success" />}
                        {password.length}+ chars
                      </span>
                    </div>
                  </motion.div>
                )}
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
                      Creating workspace…
                    </>
                  ) : (
                    <>
                      Create account
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </motion.span>
              </Button>

              <p className="text-center text-[11px] text-muted-foreground">
                By continuing you agree to our{" "}
                <Link to="/terms" className="underline-offset-4 hover:underline">
                  terms
                </Link>{" "}
                and{" "}
                <Link to="/privacy" className="underline-offset-4 hover:underline">
                  privacy policy
                </Link>
                .
              </p>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </AuthShell>
  );
}

function TypeCard({
  icon: Icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
        active
          ? "border-brand/60 bg-brand/5 ring-2 ring-brand/30"
          : "border-border/70 bg-surface/40 hover:border-border hover:bg-surface"
      }`}
    >
      <Icon
        className={`h-4 w-4 ${active ? "text-brand" : "text-muted-foreground"}`}
        strokeWidth={1.6}
      />
      <span className="text-sm font-medium">{label}</span>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </button>
  );
}
