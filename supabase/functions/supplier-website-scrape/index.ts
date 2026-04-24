// ══════════════════════════════════════════════════════════════
// supplier-website-scrape
// Fetches a supplier's public product catalogue and caches the
// per-variant prices into supplier_website_prices.
//
// Currently supports Shopify-hosted storefronts via the public
// /products.json endpoint (paginated). Other CMS types can be
// added later (Magento, WooCommerce, custom).
// ══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
  compare_at_price: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
}
interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  variants: ShopifyVariant[];
  options?: { name: string }[];
}

function normaliseUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "");
}

async function scrapeShopify(siteUrl: string, maxPages = 25) {
  const out: Array<{
    handle: string;
    title: string;
    colour: string | null;
    size: string | null;
    price: number;
    compare_at_price: number | null;
    product_url: string;
  }> = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${siteUrl}/products.json?limit=250&page=${page}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "SonicInvoice/1.0 (price sync)" },
    });
    if (!resp.ok) break;
    const data = (await resp.json()) as { products?: ShopifyProduct[] };
    const products = data.products || [];
    if (!products.length) break;

    for (const p of products) {
      const optionNames = (p.options || []).map((o) =>
        o.name.toLowerCase()
      );
      const colourIdx = optionNames.findIndex((n) =>
        /colou?r|shade/.test(n)
      );
      const sizeIdx = optionNames.findIndex((n) => /size|sz/.test(n));

      for (const v of p.variants) {
        const opts = [v.option1, v.option2, v.option3];
        const colour = colourIdx >= 0 ? opts[colourIdx] ?? null : null;
        const size = sizeIdx >= 0 ? opts[sizeIdx] ?? null : null;
        const price = parseFloat(v.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        out.push({
          handle: p.handle,
          title: p.title,
          colour,
          size,
          price,
          compare_at_price: v.compare_at_price
            ? parseFloat(v.compare_at_price)
            : null,
          product_url: `${siteUrl}/products/${p.handle}`,
        });
      }
    }
    if (products.length < 250) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorised" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const supplierProfileId = body.supplier_profile_id as string | undefined;
    if (!supplierProfileId) {
      return new Response(
        JSON.stringify({ error: "supplier_profile_id required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Load the supplier
    const { data: supplier, error: supErr } = await supabase
      .from("supplier_profiles")
      .select(
        "id, supplier_name, website_url, website_scraper_type, website_pricing_enabled",
      )
      .eq("id", supplierProfileId)
      .eq("user_id", userId)
      .maybeSingle();

    if (supErr || !supplier) {
      return new Response(
        JSON.stringify({ error: "Supplier not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (!supplier.website_url) {
      return new Response(
        JSON.stringify({ error: "Supplier has no website_url configured" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const siteUrl = normaliseUrl(supplier.website_url);
    const scraperType = supplier.website_scraper_type || "shopify";

    let rows: Awaited<ReturnType<typeof scrapeShopify>> = [];
    if (scraperType === "shopify") {
      rows = await scrapeShopify(siteUrl);
    } else {
      return new Response(
        JSON.stringify({
          error: `Scraper type "${scraperType}" not supported yet`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!rows.length) {
      return new Response(
        JSON.stringify({
          error:
            "No products returned. Site may not be Shopify or /products.json may be blocked.",
        }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Wipe existing cache for this supplier and re-insert
    await supabase
      .from("supplier_website_prices")
      .delete()
      .eq("supplier_profile_id", supplierProfileId)
      .eq("user_id", userId);

    // Insert in chunks of 500 to stay well below row limits
    const batches: typeof rows[] = [];
    for (let i = 0; i < rows.length; i += 500) batches.push(rows.slice(i, i + 500));

    for (const batch of batches) {
      const payload = batch.map((r) => ({
        user_id: userId,
        supplier_profile_id: supplierProfileId,
        handle: r.handle,
        product_title: r.title,
        colour: r.colour,
        size: r.size,
        price: r.price,
        compare_at_price: r.compare_at_price,
        product_url: r.product_url,
        currency: "AUD",
      }));
      const { error: insErr } = await supabase
        .from("supplier_website_prices")
        .insert(payload);
      if (insErr) throw insErr;
    }

    await supabase
      .from("supplier_profiles")
      .update({
        website_last_scraped_at: new Date().toISOString(),
        website_products_cached: rows.length,
      })
      .eq("id", supplierProfileId)
      .eq("user_id", userId);

    return new Response(
      JSON.stringify({
        success: true,
        products_cached: rows.length,
        site_url: siteUrl,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[supplier-website-scrape] error:", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
