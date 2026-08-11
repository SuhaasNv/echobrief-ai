import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app/app-shell";
import { getAuthToken } from "@/lib/api/client";

export const Route = createFileRoute("/app")({
  component: AuthedAppShell,
});

function AuthedAppShell() {
  const navigate = useNavigate();
  // Auth check runs client-side only (SSR has no localStorage). During the
  // initial pass we render a spinner so unauthenticated users never glimpse
  // the app shell.
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      navigate({ to: "/login", replace: true });
      setAuthed(false);
    } else {
      setAuthed(true);
    }
  }, [navigate]);

  // A stored token only proves a string exists, not that the server still
  // accepts it. apiRequest clears the session and fires this on any 401, which
  // is the only thing that gets an expired session out of the app shell.
  useEffect(() => {
    const onUnauthorized = () => {
      setAuthed(false);
      navigate({ to: "/login", replace: true });
    };
    window.addEventListener("echobrief:unauthorized", onUnauthorized);
    return () => window.removeEventListener("echobrief:unauthorized", onUnauthorized);
  }, [navigate]);

  if (authed !== true) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }

  return <AppShell />;
}
