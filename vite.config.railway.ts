// Railway (Node) build config for the frontend SSR.
// Same as vite.config.ts but with the Cloudflare plugin disabled so the SSR
// bundle targets Node instead of Workers. Used by `npm run build:web-railway`.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  cloudflare: false,
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    server: {
      port: 8080,
      strictPort: true,
      host: true,
    },
  },
});
