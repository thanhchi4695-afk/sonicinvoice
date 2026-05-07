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
 * `aud`, so backend session-token validation works for every app at once
 * without us hardcoding which secret to use.
 *
 * ── Configuration ──────────────────────────────────────────────────────────
 *   Primary app (App Store submission):
 *     SHOPIFY_API_KEY        / SHOPIFY_API_SECRET
 *
 *   Additional apps — either numbered:
 *     SHOPIFY_API_KEY_2      / SHOPIFY_API_SECRET_2
 *     SHOPIFY_API_KEY_3      / SHOPIFY_API_SECRET_3
 *     ...
 *
 *   Or as a single JSON env var (preferred for many apps):
 *     SHOPIFY_APPS_JSON='[{"label":"splash","key":"...","secret":"..."}]'
 */

export interface ShopifyAppCreds {
  label: string;
  apiKey: string;
  apiSecret: string;
}

let _registry: ShopifyAppCreds[] | null = null;

function buildRegistry(): ShopifyAppCreds[] {
  const apps: ShopifyAppCreds[] = [];
  const seen = new Set<string>();

  const push = (label: string, key: string, secret: string) => {
    if (!key || !secret) return;
    if (seen.has(key)) return;
    seen.add(key);
    apps.push({ label, apiKey: key, apiSecret: secret });
  };

  // Primary
  push(
    "primary",
    Deno.env.get("SHOPIFY_API_KEY") ?? "",
    Deno.env.get("SHOPIFY_API_SECRET") ?? "",
  );

  // Numbered fallbacks _2 ... _9
  for (let i = 2; i <= 9; i++) {
    push(
      `app_${i}`,
      Deno.env.get(`SHOPIFY_API_KEY_${i}`) ?? "",
      Deno.env.get(`SHOPIFY_API_SECRET_${i}`) ?? "",
    );
  }

  // JSON registry
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
          );
        }
      }
    } catch (err) {
      console.error("[shopify-apps] Failed to parse SHOPIFY_APPS_JSON:", err);
    }
  }

  return apps;
}

export function getShopifyApps(): ShopifyAppCreds[] {
  if (!_registry) _registry = buildRegistry();
  return _registry;
}

export function getShopifyAppByKey(aud: string | undefined | null): ShopifyAppCreds | null {
  if (!aud) return null;
  return getShopifyApps().find((a) => a.apiKey === aud) ?? null;
}

export function getPrimaryShopifyApp(): ShopifyAppCreds | null {
  return getShopifyApps()[0] ?? null;
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
