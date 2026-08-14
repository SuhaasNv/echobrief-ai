/**
 * /api/v1/integrations
 *
 * Skeleton implementation — OAuth flows are wired but per-provider URLs and
 * token exchanges need real client IDs to be functional.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { IntegrationProvider, OAuthCallbackQuery } from "../../../lib/schemas";
import { getSql } from "../../db";
import { getEnv } from "../../env";
import { encrypt, decrypt } from "../../lib/encryption";
import type { AppBindings } from "../types";

const app = new Hono<AppBindings>();

app.get("/", async (c) => {
  const user = c.get("user");
  const sql = getSql();

  const items = await sql<
    Array<{ provider: string; workspace_name: string | null; created_at: string }>
  >`
    SELECT provider, workspace_name, created_at
    FROM integrations WHERE user_id = ${user.id}
  `;
  return c.json({ items });
});

app.post(
  "/:provider/connect",
  zValidator("param", z.object({ provider: IntegrationProvider })),
  async (c) => {
    const { provider } = c.req.valid("param");
    const user = c.get("user");
    const env = getEnv();

    if (!env.INTEGRATION_TOKEN_ENCRYPTION_KEY) {
      throw new HTTPException(500, {
        message: "INTEGRATION_TOKEN_ENCRYPTION_KEY not configured",
      });
    }

    const state = await encrypt(
      JSON.stringify({ user_id: user.id, ts: Date.now() }),
      env.INTEGRATION_TOKEN_ENCRYPTION_KEY,
    );
    const redirectUri = `${env.APP_URL}/api/v1/integrations/${provider}/callback`;
    const authorizeUrl = buildAuthorizeUrl(provider, redirectUri, state);
    return c.json({ authorize_url: authorizeUrl });
  },
);

app.get(
  "/:provider/callback",
  zValidator("param", z.object({ provider: IntegrationProvider })),
  zValidator("query", OAuthCallbackQuery),
  async (c) => {
    const { provider } = c.req.valid("param");
    const { code, state, error: oauthError } = c.req.valid("query");
    const env = getEnv();
    const sql = getSql();

    if (oauthError) {
      return c.redirect(`${env.APP_URL}/app/settings?integration_error=${oauthError}`);
    }

    if (!env.INTEGRATION_TOKEN_ENCRYPTION_KEY) {
      throw new HTTPException(500, {
        message: "INTEGRATION_TOKEN_ENCRYPTION_KEY not configured",
      });
    }

    let parsedState: { user_id: string; ts: number };
    try {
      parsedState = JSON.parse(await decrypt(state, env.INTEGRATION_TOKEN_ENCRYPTION_KEY));
    } catch {
      throw new HTTPException(400, { message: "Invalid OAuth state" });
    }

    // TODO: per-provider token exchange.
    const tokenResult = {
      access_token: `pending_${provider}_token`,
      refresh_token: null as string | null,
      expires_at: null as string | null,
      workspace_name: null as string | null,
    };
    void code;

    const encryptedAccess = await encrypt(
      tokenResult.access_token,
      env.INTEGRATION_TOKEN_ENCRYPTION_KEY,
    );
    const encryptedRefresh = tokenResult.refresh_token
      ? await encrypt(tokenResult.refresh_token, env.INTEGRATION_TOKEN_ENCRYPTION_KEY)
      : null;

    await sql`
      INSERT INTO integrations (
        user_id, provider, access_token, refresh_token, expires_at, workspace_name
      ) VALUES (
        ${parsedState.user_id}, ${provider}, ${encryptedAccess}, ${encryptedRefresh},
        ${tokenResult.expires_at}, ${tokenResult.workspace_name}
      )
      ON CONFLICT (user_id, provider) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at,
        workspace_name = EXCLUDED.workspace_name
    `;

    return c.redirect(`${env.APP_URL}/app/settings?integration_connected=${provider}`);
  },
);

app.delete(
  "/:provider",
  zValidator("param", z.object({ provider: IntegrationProvider })),
  async (c) => {
    const { provider } = c.req.valid("param");
    const user = c.get("user");
    const sql = getSql();
    await sql`DELETE FROM integrations WHERE user_id = ${user.id} AND provider = ${provider}`;
    return c.json({ ok: true });
  },
);

function buildAuthorizeUrl(
  provider: z.infer<typeof IntegrationProvider>,
  redirectUri: string,
  state: string,
): string {
  const env = getEnv();
  const encodedRedirect = encodeURIComponent(redirectUri);
  const encodedState = encodeURIComponent(state);

  switch (provider) {
    case "notion":
      return `https://api.notion.com/v1/oauth/authorize?owner=user&client_id=${env.NOTION_CLIENT_ID ?? ""}&redirect_uri=${encodedRedirect}&response_type=code&state=${encodedState}`;
    case "linear":
      return `https://linear.app/oauth/authorize?client_id=${env.LINEAR_CLIENT_ID ?? ""}&redirect_uri=${encodedRedirect}&response_type=code&scope=read,write&state=${encodedState}`;
    case "google_calendar":
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${env.GOOGLE_CLIENT_ID ?? ""}&redirect_uri=${encodedRedirect}&response_type=code&scope=${encodeURIComponent("https://www.googleapis.com/auth/calendar.events")}&state=${encodedState}&access_type=offline`;
    case "jira":
      return `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=&redirect_uri=${encodedRedirect}&response_type=code&prompt=consent&state=${encodedState}`;
    case "trello":
      return `https://trello.com/1/authorize?expiration=never&name=EchoBrief&scope=read,write&response_type=token&key=&return_url=${encodedRedirect}`;
  }
}

export default app;
