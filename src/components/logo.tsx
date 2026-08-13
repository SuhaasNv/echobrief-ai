import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getAuthToken } from "@/lib/api/client";
import puffinHeadUrl from "@/assets/brand/puffin-head.png?url";
import puffinHeadDarkUrl from "@/assets/brand/puffin-head-dark.png?url";

export function Logo({ className = "" }: { className?: string }) {
  // Default to the marketing home; switch to /app once we know the user is
  // authenticated (client-only check). This prevents an authed user from
  // bouncing to the landing page when they click the logo from /app.
  const [target, setTarget] = useState<"/" | "/app">("/");

  useEffect(() => {
    if (getAuthToken()) setTarget("/app");
  }, []);

  return (
    <Link to={target} className={`group inline-flex items-center gap-2 ${className}`}>
      {/*
        The puffin head, not the full illustration. At 28px the whole bird —
        headphones, microphone, waveform — collapses into a smudge; the head and
        beak survive because the beak is the one shape nothing else in a nav bar
        has. Same reasoning as the app icon.

        No coloured tile behind it. The old mark was a stroke glyph that needed a
        `bg-foreground` chip to be visible, which inverted with the theme. This
        artwork carries its own black outline and white face, so it reads on both
        the light and dark canvas unaided — one asset, no theme switch, nothing
        to keep in sync.
      */}
      <span className="relative inline-flex h-7 w-7 items-center justify-center">
        {/*
          <picture> rather than two <img> toggled by JS: the browser picks the
          source from the media query before layout, so there is no flash of the
          wrong mark on load and no hydration mismatch between the server render
          and the client's actual theme.

          Two files are genuinely needed. The puffin's head is black with a white
          face — on a light canvas the black reads and the outline does the work,
          but on a dark canvas that same black merges into the background and
          leaves a white face floating with no bird around it. The dark artwork
          carries its own lighter rim for exactly this reason.
        */}
        <picture>
          <source srcSet={puffinHeadDarkUrl} media="(prefers-color-scheme: dark)" />
          <img
            src={puffinHeadUrl}
            alt=""
            className="h-7 w-7 object-contain"
            // Decorative: the wordmark beside it is the accessible name.
            aria-hidden="true"
          />
        </picture>
        <span className="pointer-events-none absolute inset-0 rounded-full bg-brand/40 opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-100" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Puffin</span>
    </Link>
  );
}
