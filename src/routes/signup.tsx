import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Loader2, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, ApiError, setAuthToken } from "@/lib/api/client";

interface SignupResponse {
  token: string;
  user: { id: string; email: string; name: string | null; is_admin: boolean };
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

function SignupPage() {
  const navigate = useNavigate();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(() => scorePassword(password), [password]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
        body: { email, password, name },
      });
      setAuthToken(res.token);
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
      title="Create your workspace."
      subtitle="Free tier, no card. Upgrade when you outgrow it."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="first">First name</Label>
            <Input id="first" placeholder="Maya" value={first} onChange={(e) => setFirst(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="last">Last name</Label>
            <Input id="last" placeholder="Chen" value={last} onChange={(e) => setLast(e.target.value)} />
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
          <Input
            id="password"
            type="password"
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
          <Link to="/terms" className="underline-offset-4 hover:underline">terms</Link> and{" "}
          <Link to="/privacy" className="underline-offset-4 hover:underline">privacy policy</Link>.
        </p>
      </form>
    </AuthShell>
  );
}
