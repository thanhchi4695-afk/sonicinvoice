// Shared Shopify token helper.
//
// Usage from any edge function:
//
//   import { getValidShopifyToken, ShopifyReauthRequiredError } from "../_shared/shopify-token.ts";
//
//   try {
//     const { accessToken, storeUrl, apiVersion, conn } =
//       await getValidShopifyToken(supabaseAdmin, userId);
//     // ... use accessToken in X-Shopify-Access-Token header
//   } catch (err) {
//     if (err instanceof ShopifyReauthRequiredError) {
//       // Refresh token expired — surface to caller; merchant must re-launch the app.
//     }
//     throw err;
//   }
//
// Behavior summary:
// 1. If `token_expires_at` is NULL on the connection row, this is either a Custom App
//    token (which never expires) or a legacy non-expiring OAuth token. We attempt a
//    one-time token-exchange to upgrade legacy tokens to expiring ones. If exchange
//    succeeds, the new tokens are persisted. If exchange fails (e.g. the token is a
//    Custom App token that has no exchange path), we silently fall through and use
//    the existing access token unchanged.
// 2. If `token_expires_at` is present and at least 60 seconds in the future, return the
//    current access token unchanged.
// 3. Otherwise call the refresh endpoint, persist the new tokens, return the new one.
// 4. If refresh fails because the refresh token is past its 90-day window, mark the
//    connection `needs_reauth = true` and throw `ShopifyReauthRequiredError`.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const SHOPIFY_API_KEY = Deno.env.get("SHOPIFY_API_KEY")!;
const SHOPIFY_API_SECRET = Deno.env.get("SHOPIFY_API_SECRET")!;

const REFRESH_LEEWAY_MS = 60_000; // refresh if token expires in <60s
const OFFLINE_TOKEN_TYPE = "urn:shopify:params:oauth:token-type:offline-access-token";
const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";

export class ShopifyReauthRequiredError extends Error {
  constructor(public shop: string, message = "Shopify refresh token expired; merchant must re-launch the app") {
    super(message);
    this.name = "ShopifyReauthRequiredError";
  }
}

export interface ShopifyConnectionRow {
  user_id: string;
  store_url: string;
  access_token: string;
  api_version: string;
  token_expires_at: string | null;
  refresh_token: string | null;
  refresh_token_expires_at: string | null;
  needs_reauth: boolean;
  [key: string]: unknown;
}

export interface ValidTokenResult {
  accessToken: string;
  storeUrl: string;
  apiVersion: string;
  conn: ShopifyConnectionRow;
}

interface ShopifyTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

/**
 * Get a valid Shopify access token for a user, refreshing or migrating as needed.
 * Throws ShopifyReauthRequiredError if the merchant must re-launch the app.
 */
export async function getValidShopifyToken(
  supabase: SupabaseClient,
  userId: string,
): Promise<ValidTokenResult> {
  const { data: conn, error } = await supabase
    .from("shopify_connections")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !conn) {
    throw new Error("No Shopify connection found");
  }

  return await ensureValidToken(supabase, conn as ShopifyConnectionRow);
}

/**
 * Same as `getValidShopifyToken` but accepts the already-loaded connection row.
 * Useful when the caller has already done its own row lookup (e.g. via shop domain).
 */
export async function ensureValidToken(
  supabase: SupabaseClient,
  conn: ShopifyConnectionRow,
): Promise<ValidTokenResult> {
  if (conn.needs_reauth) {
    throw new ShopifyReauthRequiredError(conn.store_url);
  }

  const now = Date.now();

  // Case 1: legacy non-expiring token — attempt one-time exchange to expiring token.
  if (!conn.token_expires_at && conn.access_token) {
    const upgraded = await tryExchangeLegacyToken(supabase, conn);
    if (upgraded) return upgraded;
    // Exchange failed (e.g. Custom App token) — use existing token unchanged.
    return {
      accessToken: conn.access_token,
      storeUrl: conn.store_url,
      apiVersion: conn.api_version,
      conn,
    };
  }

  // Case 2: still valid with leeway.
  if (conn.token_expires_at) {
    const expiresAt = Date.parse(conn.token_expires_at);
    if (Number.isFinite(expiresAt) && expiresAt - now > REFRESH_LEEWAY_MS) {
      return {
        accessToken: conn.access_token,
        storeUrl: conn.store_url,
        apiVersion: conn.api_version,
        conn,
      };
    }
  }

  // Case 3: needs refresh.
  if (!conn.refresh_token) {
    await markNeedsReauth(supabase, conn.user_id, "missing refresh_token");
    throw new ShopifyReauthRequiredError(conn.store_url, "No refresh token stored");
  }

  // Refresh-token window check.
  if (conn.refresh_token_expires_at) {
    const refreshExpiresAt = Date.parse(conn.refresh_token_expires_at);
    if (Number.isFinite(refreshExpiresAt) && refreshExpiresAt <= now) {
      await markNeedsReauth(supabase, conn.user_id, "refresh_token expired");
      throw new ShopifyReauthRequiredError(conn.store_url);
    }
  }

  const refreshed = await refreshAccessToken(conn.store_url, conn.refresh_token);
  if (!refreshed) {
    await markNeedsReauth(supabase, conn.user_id, "refresh request failed");
    throw new ShopifyReauthRequiredError(conn.store_url);
  }

  const updates = tokenResponseToColumns(refreshed);
  await supabase
    .from("shopify_connections")
    .update({ ...updates, needs_reauth: false, updated_at: new Date().toISOString() })
    .eq("user_id", conn.user_id);

  // Best-effort mirror to platform_connections (used by other code paths).
  await supabase
    .from("platform_connections")
    .update({ ...updates, needs_reauth: false })
    .eq("user_id", conn.user_id)
    .eq("platform", "shopify");

  return {
    accessToken: updates.access_token,
    storeUrl: conn.store_url,
    apiVersion: conn.api_version,
    conn: { ...conn, ...updates, needs_reauth: false },
  };
}

/**
 * One-time conversion of a legacy non-expiring offline token to an expiring one.
 * Returns the new ValidTokenResult on success, or null if exchange is not applicable
 * (e.g. Custom App token where exchange returns 4xx — we keep using the existing token).
 *
 * IMPORTANT: per Shopify, the original token is revoked the instant the new one is issued.
 * We persist the new tokens in the same await chain before returning.
 */
async function tryExchangeLegacyToken(
  supabase: SupabaseClient,
  conn: ShopifyConnectionRow,
): Promise<ValidTokenResult | null> {
  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    // Custom App or misconfigured environment — skip exchange.
    return null;
  }

  const url = `https://${conn.store_url}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: conn.access_token,
    subject_token_type: OFFLINE_TOKEN_TYPE,
    requested_token_type: OFFLINE_TOKEN_TYPE,
    expiring: "1",
  });

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    console.error("[shopify-token] exchange network error", err);
    await logMigration(supabase, conn, "error", String(err), "auto");
    return null;
  }

  if (!resp.ok) {
    const text = await resp.text();
    // 4xx typically means: Custom App token or a token that already has been migrated
    // by another path. Either way, leave the row alone.
    console.warn(`[shopify-token] exchange ${resp.status} for ${conn.store_url}: ${text}`);
    await logMigration(supabase, conn, resp.status === 400 ? "skipped" : "error", text, "auto");
    return null;
  }

  let json: ShopifyTokenResponse;
  try {
    json = await resp.json();
  } catch (err) {
    await logMigration(supabase, conn, "error", `invalid JSON: ${err}`, "auto");
    return null;
  }

  const updates = tokenResponseToColumns(json);

  const { error: updErr } = await supabase
    .from("shopify_connections")
    .update({ ...updates, needs_reauth: false, updated_at: new Date().toISOString() })
    .eq("user_id", conn.user_id);

  if (updErr) {
    await logMigration(supabase, conn, "error", `db update failed: ${updErr.message}`, "auto");
    // Token was rotated by Shopify but we couldn't persist — caller will see a
    // failure on next call. Surface the new token this one time so this call works.
    return {
      accessToken: updates.access_token,
      storeUrl: conn.store_url,
      apiVersion: conn.api_version,
      conn: { ...conn, ...updates, needs_reauth: false },
    };
  }

  await supabase
    .from("platform_connections")
    .update({ ...updates, needs_reauth: false })
    .eq("user_id", conn.user_id)
    .eq("platform", "shopify");

  await logMigration(supabase, conn, "success", null, "auto");

  return {
    accessToken: updates.access_token,
    storeUrl: conn.store_url,
    apiVersion: conn.api_version,
    conn: { ...conn, ...updates, needs_reauth: false },
  };
}

async function refreshAccessToken(
  shop: string,
  refreshToken: string,
): Promise<ShopifyTokenResponse | null> {
  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) return null;

  const body = new URLSearchParams({
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  try {
    const resp = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[shopify-token] refresh ${resp.status}: ${text}`);
      return null;
    }
    return (await resp.json()) as ShopifyTokenResponse;
  } catch (err) {
    console.error("[shopify-token] refresh network error", err);
    return null;
  }
}

function tokenResponseToColumns(t: ShopifyTokenResponse) {
  const now = Date.now();
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? null,
    token_expires_at: t.expires_in
      ? new Date(now + t.expires_in * 1000).toISOString()
      : null,
    refresh_token_expires_at: t.refresh_token_expires_in
      ? new Date(now + t.refresh_token_expires_in * 1000).toISOString()
      : null,
  };
}

async function markNeedsReauth(
  supabase: SupabaseClient,
  userId: string,
  reason: string,
): Promise<void> {
  console.warn(`[shopify-token] marking needs_reauth user=${userId} reason=${reason}`);
  await supabase
    .from("shopify_connections")
    .update({ needs_reauth: true, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  await supabase
    .from("platform_connections")
    .update({ needs_reauth: true })
    .eq("user_id", userId)
    .eq("platform", "shopify");
}

async function logMigration(
  supabase: SupabaseClient,
  conn: ShopifyConnectionRow,
  status: "success" | "error" | "skipped",
  errorMessage: string | null,
  triggerSource: "auto" | "admin" | "system",
): Promise<void> {
  try {
    await supabase.from("shopify_token_migration_log").insert({
      user_id: conn.user_id,
      shop_domain: conn.store_url,
      status,
      error_message: errorMessage,
      trigger_source: triggerSource,
    });
  } catch (err) {
    console.error("[shopify-token] failed to log migration", err);
  }
}

/**
 * Convert a Shopify token response into DB columns. Public so the install flow
 * (`shopify-auth-callback`, `shopify-oauth`) can persist new fields the same way.
 */
export const tokenResponseToConnectionColumns = tokenResponseToColumns;
