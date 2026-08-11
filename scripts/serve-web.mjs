/**
 * Node server for the Railway frontend deployment.
 *
 * Serves static assets from dist/client and falls through to the TanStack
 * Start SSR fetch handler in dist/server/server.js (built with
 * vite.config.railway.ts, i.e. cloudflare plugin disabled).
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

const ssr = (await import("../dist/server/server.js")).default;

const app = new Hono();

// Hashed build assets — immutable cache
app.use(
  "/assets/*",
  serveStatic({
    root: "./dist/client",
    onFound: (_path, c) => {
      c.header("cache-control", "public, immutable, max-age=31536000");
    },
  }),
);

// Other static files (favicon, robots.txt, …)
app.use("/*", serveStatic({ root: "./dist/client" }));

// SSR fallback
app.all("*", (c) => ssr.fetch(c.req.raw, process.env, {}));

const port = Number(process.env.PORT || 3000);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[web] listening on http://0.0.0.0:${info.port}`);
});
