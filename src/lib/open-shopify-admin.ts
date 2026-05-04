/**
 * Open a Shopify Admin URL safely from anywhere in the app.
 *
 * Why: when our app runs INSIDE Shopify Admin (embedded iframe), calling
 * `window.open(url, "_blank")` or rendering `<a target="_blank">` to an
 * `admin/products/...` URL causes Shopify Admin to load that URL inside our
 * iframe — which results in a nested "Shopify-inside-Shopify" view (two
 * sidebars, two top bars). The fix is to ask App Bridge to navigate the
 * parent (top-level) frame instead.
 *
 * Behaviour:
 *   - Embedded + App Bridge available  → use App Bridge Redirect (parent navigates).
 *   - Embedded, no App Bridge          → window.open(url, "_top") which App
 *                                        Bridge v4 intercepts; falls back to
 *                                        top.location.href.
 *   - Standalone                       → window.open(url, "_blank").
 */

import { isShopifyEmbedded } from "./shopify-embedded";

/** Convert a full admin URL to an admin path (e.g. "/products/123"). */
function toAdminPath(url: string): string | null {
  try {
    const u = new URL(url);
    const i = u.pathname.indexOf("/admin");
    if (i === -1) return null;
    return u.pathname.slice(i + "/admin".length) + u.search + u.hash || "/";
  } catch {
    return null;
  }
}

export function openShopifyAdmin(url: string): void {
  if (!isShopifyEmbedded()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const shopify = (window as unknown as { shopify?: any }).shopify;
  const adminPath = toAdminPath(url);

  // App Bridge v4 global redirect API
  try {
    if (shopify?.redirect && adminPath) {
      // toAdminPath navigates the Shopify Admin shell to a new admin path
      // (top-level), which is what we want for "View product" etc.
      if (typeof shopify.redirect.toAdminPath === "function") {
        shopify.redirect.toAdminPath(adminPath);
        return;
      }
      // Older API surface
      if (typeof shopify.redirect.dispatch === "function") {
        shopify.redirect.dispatch("APP::NAVIGATION::REDIRECT::ADMIN_PATH", { path: adminPath });
        return;
      }
    }
  } catch (err) {
    console.warn("[openShopifyAdmin] App Bridge redirect failed, falling back:", err);
  }

  // Fallback: _top makes App Bridge perform a parent-frame navigation.
  try {
    const w = window.open(url, "_top");
    if (w) return;
  } catch {
    /* noop */
  }

  try {
    if (window.top) window.top.location.href = url;
  } catch {
    window.location.href = url;
  }
}
