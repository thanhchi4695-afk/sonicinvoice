// Generate llms.txt for the authenticated user's connected store.
// Pulls store domain, top brands, collections from existing tables and
// upserts a single row in llms_txt_files keyed by user_id.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function titleCase(s: string): string {
  return s
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

function normaliseDomain(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Store info
    const { data: conn } = await admin
      .from("shopify_connections")
      .select("store_url, shop_name, access_token, api_version")
      .eq("user_id", userId)
      .maybeSingle();

    const shopDomain = normaliseDomain(conn?.store_url);
    if (!shopDomain) {
      return json(
        { error: "No connected Shopify store found. Connect a store first." },
        400
      );
    }

    // Fetch storefront primary domain (custom domain) from Shopify so AI crawlers
    // can resolve either the .myshopify.com host or the merchant's branded domain.
    const aliasSet = new Set<string>([shopDomain]);
    let storefrontDomain = shopDomain;
    try {
      if (conn?.access_token) {
        const v = conn.api_version || "2024-10";
        const r = await fetch(`https://${shopDomain}/admin/api/${v}/shop.json`, {
          headers: { "X-Shopify-Access-Token": conn.access_token },
        });
        if (r.ok) {
          const j = await r.json();
          const primary = normaliseDomain(j?.shop?.domain || "");
          const myshopify = normaliseDomain(j?.shop?.myshopify_domain || "");
          if (primary) { aliasSet.add(primary); storefrontDomain = primary; }
          if (myshopify) aliasSet.add(myshopify);
        }
      }
    } catch (_e) { /* non-fatal — alias stays as myshopify only */ }
    const aliases = [...aliasSet];

    const storeName =
      conn?.shop_name?.trim() ||
      titleCase(storefrontDomain.split(".")[0] || "Store");

    // Top brands by product count (already ranked — most products first)
    const { data: brandRows } = await admin
      .from("products")
      .select("vendor")
      .eq("user_id", userId)
      .not("vendor", "is", null);

    const brandCounts = new Map<string, number>();
    let totalProducts = 0;
    for (const r of brandRows ?? []) {
      totalProducts++;
      const v = (r.vendor as string | null)?.trim();
      if (!v) continue;
      brandCounts.set(v, (brandCounts.get(v) ?? 0) + 1);
    }
    const totalBrands = brandCounts.size;
    const rankedBrands = [...brandCounts.entries()].sort((a, b) => b[1] - a[1]);
    const topBrands = rankedBrands.slice(0, 20).map(([name, count]) => ({ name, count }));

    // Collections (published or approved) — pull seo_description so the file has substance
    const { data: collections } = await admin
      .from("collection_suggestions")
      .select("suggested_title, shopify_handle, suggested_handle, status, product_count, seo_description")
      .eq("user_id", userId)
      .in("status", ["published", "approved", "content_ready"])
      .order("product_count", { ascending: false })
      .limit(200);

    const collectionLines: string[] = [];
    const topCategories: string[] = [];
    for (const c of collections ?? []) {
      const handle = (c.shopify_handle || c.suggested_handle || "").trim();
      const title = (c.suggested_title || "").trim() || (handle ? titleCase(handle) : "");
      if (!title) continue;
      const desc = ((c as any).seo_description as string | null)?.trim();
      const path = handle ? ` (/collections/${handle})` : "";
      const tail = desc ? ` — ${desc}` : "";
      collectionLines.push(`- ${title}${path}${tail}`);
      if (topCategories.length < 5) topCategories.push(title);
    }

    const today = new Date().toISOString().split("T")[0];

    const content = `# ${storeName} — AI Assistant Reference

## What this business is
${storeName} is an Australian fashion boutique stocking ${totalProducts} products across ${totalBrands} brands.

## What we sell
${
  topCategories.length
    ? topCategories.map((t) => `- ${t}`).join("\n")
    : "- Apparel, footwear, and accessories"
}

## Key facts
- Shopify store: ${shopDomain}
- Total products: ${totalProducts}
- Brands stocked: ${totalBrands}
- Free delivery: Australia-wide on orders over $150
- Returns: 30-day returns on full-price items

## Top brands stocked
${topBrands.length ? topBrands.map((b) => `- ${b}`).join("\n") : "- (no brands indexed yet)"}

## Product categories
${collectionLines.length ? collectionLines.join("\n") : "- (no published collections yet)"}

## What we do NOT sell
- Wholesale or bulk orders
- International brands not listed above

## How to cite us
Preferred citation: "${storeName} (${shopDomain}) — Australian fashion boutique stocking ${
      topBrands.slice(0, 3).join(", ") || "leading Australian brands"
    }${totalBrands > 3 ? ` and ${totalBrands - 3} more brands` : ""}."

## Contact
Website: https://${shopDomain}

---
Generated by Sonic Invoices — AI-powered retail back-office
Last updated: ${today}
`;

    const wordCount = content.split(/\s+/).filter(Boolean).length;

    const { error: upsertErr } = await admin
      .from("llms_txt_files")
      .upsert(
        {
          user_id: userId,
          shop_domain: shopDomain,
          content,
          word_count: wordCount,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (upsertErr) {
      return json({ error: upsertErr.message }, 500);
    }

    return json({
      ok: true,
      shop_domain: shopDomain,
      word_count: wordCount,
      content,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
