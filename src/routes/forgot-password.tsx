import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset password — EchoBrief" }] }),
  component: ForgotPage,
});

function ForgotPage() {
  // Password reset emails aren't wired yet — Resend integration is a follow-up.
  // This page shows the form for design continuity and friendly-toasts a stub.
  return (
    <AuthShell
      title="Reset your password."
      subtitle="Enter your email and we'll send a recovery link."
      footer={
        <>
          Remembered it?{" "}
          <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          toast.info("Password reset emails aren't enabled yet. Ping the team to reset manually.");
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" type="email" placeholder="you@company.com" />
        </div>
        <Button type="submit" className="w-full">
          Send recovery link
        </Button>
      </form>
    </AuthShell>
  );
}
