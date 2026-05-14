import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthShell, GoogleButton } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create account — EchoBrief" }] }),
  component: SignupPage,
});

function SignupPage() {
  return (
    <AuthShell
      title="Create your workspace."
      subtitle="Start your 14-day trial. No card required."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <div className="space-y-3">
        <GoogleButton />
        <div className="relative my-2 text-center">
          <div className="absolute inset-0 top-1/2 h-px bg-border" />
          <span className="relative bg-background px-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            or with email
          </span>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            window.location.href = "/app";
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="first">First name</Label>
              <Input id="first" placeholder="Maya" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last">Last name</Label>
              <Input id="last" placeholder="Chen" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Work email</Label>
            <Input id="email" type="email" placeholder="you@company.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" placeholder="At least 8 characters" />
          </div>
          <Button type="submit" className="w-full">Create account</Button>
          <p className="text-center text-[11px] text-muted-foreground">
            By continuing you agree to our Terms and Privacy Policy.
          </p>
        </form>
      </div>
    </AuthShell>
  );
}
