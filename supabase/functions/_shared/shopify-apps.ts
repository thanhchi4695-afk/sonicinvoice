/**
 * Shopify multi-app credential registry.
 *
 * Some merchants install us via a separate Shopify app (e.g. a custom /
 * private app like the Splash Swimwear collaboration) while the App Store
 * submission keeps the original credentials. Session tokens are signed with
 * the API secret of *whichever* app issued them, and include the app's API
 * key in the JWT `aud` claim.
 *
 * This registry resolves the right `{ apiKey, apiSecret }` pair for a given
 * `aud` (or shop), so backend session-token validation works for every app
 * at once without us hardcoding which secret to use.
 *
 * ── Sources, in priority order ────────────────────────────────────────────
 *   1. `public.shopify_apps` table (loaded lazily via service role client)
 *   2. `SHOPIFY_APPS_JSON` env var (JSON array)
 *   3. Numbered env vars: SHOPIFY_API_KEY_2 / SHOPIFY_API_SECRET_2 ... _9
 *   4. Primary env vars: SHOPIFY_API_KEY / SHOPIFY_API_SECRET
 *
 * Entries are deduped by `apiKey` — first writer wins, so DB rows override
 * env defaults if their api_key matches.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

export interface ShopifyAppCreds {
  label: string;
  apiKey: string;
  apiSecret: string;
  shopDomain?: string | null;
}

let _envRegistry: ShopifyAppCreds[] | null = null;
let _dbRegistry: ShopifyAppCreds[] | null = null;
let _dbLoadedAt = 0;
const DB_CACHE_TTL_MS = 60_000;

function buildEnvRegistry(): ShopifyAppCreds[] {
  const apps: ShopifyAppCreds[] = [];
  const seen = new Set<string>();

  const push = (label: string, key: string, secret: string, shopDomain?: string | null) => {
    if (!key || !secret) return;
    if (seen.has(key)) return;
    seen.add(key);
    apps.push({ label, apiKey: key, apiSecret: secret, shopDomain: shopDomain ?? null });
  };

  // JSON registry first (most explicit)
  const json = Deno.env.get("SHOPIFY_APPS_JSON");
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          push(
            String(entry?.label ?? "json_app"),
            String(entry?.key ?? entry?.apiKey ?? ""),
            String(entry?.secret ?? entry?.apiSecret ?? ""),
            entry?.shop_domain ?? entry?.shopDomain ?? null,
          );
        }
      }
    } catch (err) {
      console.error("[shopify-apps] Failed to parse SHOPIFY_APPS_JSON:", err);
    }
  }

  // Numbered fallbacks _2 ... _9 (optionally pinned via SHOPIFY_API_KEY_n_SHOP)
  for (let i = 2; i <= 9; i++) {
    const k = Deno.env.get(`SHOPIFY_API_KEY_${i}`) ?? "";
    const s = Deno.env.get(`SHOPIFY_API_SECRET_${i}`) ?? "";
    const shop = Deno.env.get(`SHOPIFY_API_KEY_${i}_SHOP`) ?? null;
    push(`app_${i}`, k, s, shop);
  }

  // Primary
  push(
    "primary",
    Deno.env.get("SHOPIFY_API_KEY") ?? "",
    Deno.env.get("SHOPIFY_API_SECRET") ?? "",
  );

  return apps;
}

function getEnvRegistry(): ShopifyAppCreds[] {
  if (!_envRegistry) _envRegistry = buildEnvRegistry();
  return _envRegistry;
}

async function loadDbRegistry(): Promise<ShopifyAppCreds[]> {
  const now = Date.now();
  if (_dbRegistry && now - _dbLoadedAt < DB_CACHE_TTL_MS) {
    return _dbRegistry;
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    _dbRegistry = [];
    _dbLoadedAt = now;
    return _dbRegistry;
  }

  try {
    const supabase = createClient(url, serviceKey);
    const { data, error } = await supabase
      .from("shopify_apps")
      .select("label, api_key, api_secret, shop_domain, is_active")
      .eq("is_active", true);

    if (error) {
      console.error("[shopify-apps] DB load failed:", error.message);
      _dbRegistry = _dbRegistry ?? [];
    } else {
      _dbRegistry = (data ?? []).map((r: any) => ({
        label: r.label,
        apiKey: r.api_key,
        apiSecret: r.api_secret,
        shopDomain: r.shop_domain ?? null,
      }));
    }
  } catch (err) {
    console.error("[shopify-apps] DB load exception:", err);
    _dbRegistry = _dbRegistry ?? [];
  }

  _dbLoadedAt = now;
  return _dbRegistry;
}

/** Force the next call to re-fetch DB credentials. */
export function invalidateShopifyAppsCache(): void {
  _dbRegistry = null;
  _dbLoadedAt = 0;
}

/** Sync, env-only view (no DB call). */
export function getShopifyApps(): ShopifyAppCreds[] {
  return getEnvRegistry();
}

/** Async, merged view: DB rows first, then env fallback (deduped by apiKey). */
export async function getAllShopifyApps(): Promise<ShopifyAppCreds[]> {
  const db = await loadDbRegistry();
  const merged: ShopifyAppCreds[] = [];
  const seen = new Set<string>();
  for (const a of [...db, ...getEnvRegistry()]) {
    if (!a.apiKey || seen.has(a.apiKey)) continue;
    seen.add(a.apiKey);
    merged.push(a);
  }
  return merged;
}

/** Find an app by its API key (i.e. JWT `aud`). Checks DB first, then env. */
export async function getShopifyAppByKey(
  aud: string | undefined | null,
): Promise<ShopifyAppCreds | null> {
  if (!aud) return null;
  const all = await getAllShopifyApps();
  return all.find((a) => a.apiKey === aud) ?? null;
}

/** Find an app pinned to a specific shop domain (e.g. "splash.myshopify.com"). */
export async function getShopifyAppByShop(
  shopDomain: string | undefined | null,
): Promise<ShopifyAppCreds | null> {
  if (!shopDomain) return null;
  const all = await getAllShopifyApps();
  return all.find((a) => a.shopDomain && a.shopDomain.toLowerCase() === shopDomain.toLowerCase()) ?? null;
}

export function getPrimaryShopifyApp(): ShopifyAppCreds | null {
  const env = getEnvRegistry();
  return env.find((a) => a.label === "primary") ?? env[0] ?? null;
}

export async function getShopifyAppByLabel(label: string): Promise<ShopifyAppCreds | null> {
  const all = await getAllShopifyApps();
  return all.find((a) => a.label === label) ?? null;
}

/**
 * Decode the unverified JWT payload (base64url -> JSON). Used to peek at
 * `aud` so we can pick the right secret before verifying the signature.
 */
export function peekJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}
