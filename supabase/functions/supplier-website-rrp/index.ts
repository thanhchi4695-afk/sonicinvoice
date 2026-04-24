// ══════════════════════════════════════════════════════════════
// supplier-website-rrp
//
// Looks up a single product's RRP/image/description with this
// priority chain:
//
//   1. Cached scrape in `supplier_website_prices` (per-user
//      `supplier_profiles.website_pricing_enabled = true`)
//   2. NEW — registry fallback: live `products.json` fetch from
//      a brand listed in `supplier_websites` (shared 35-brand
//      seed; users with NO supplier_profile still get website
//      RRPs because the registry is pre-populated)
//   3. Returns { found:false } so the caller can fall through
//      to Google / markup formula.
//
// The registry fetch is best-effort and time-limited; failures
// are logged to `supplier_websites.scrape_failure_count`. Brand
// names that don't match anything in the registry are recorded
// in `brand_lookup_misses` so the user knows what to add next.
// ══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function slugify(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normaliseBrand(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\+/g, "plus")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  product_type: string;
  created_at: string;
  images: { src: string }[];
  variants: { price: string; compare_at_price: string | null }[];
}

function findProductByNameAndColour(
  products: ShopifyProduct[],
  name: string,
  colour?: string,
): ShopifyProduct | null {
  if (!products?.length) return null;
  const nameLow = name.toLowerCase().trim();
  const colourLow = (colour || "").toLowerCase().trim();

  // Step 1: title contains every meaningful token of the product name
  const STOP = new Set(["the", "a", "an", "and", "or", "of", "in", "on", "for", "with"]);
  const tokens = nameLow.split(/\s+/).map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length >= 2 && !STOP.has(t));

  let candidates = products.filter((p) => {
    const t = p.title.toLowerCase();
    return tokens.every((tok) => t.includes(tok));
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Step 2: narrow by colour token
  if (colourLow) {
    const colourTokens = colourLow.split(/\s+/).filter((t) => t.length >= 4);
    const colourMatch = candidates.find((p) =>
      colourTokens.some((t) => p.title.toLowerCase().includes(t))
    );
    if (colourMatch) return colourMatch;
  }

  // Step 3: most-recently created (likely current season)
  candidates = [...candidates].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return candidates[0];
}

async function fetchFromRegistry(
  endpoint: string,
  styleName: string,
  colour?: string,
): Promise<
  | {
      price: number;
      product_url: string;
      product_title: string;
      image_url: string;
      description: string;
    }
  | null
> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(endpoint, {
      signal: ctrl.signal,
      headers: { "User-Agent": "SonicInvoice/1.0 (+https://sonicinvoices.com)" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const products = (data?.products || []) as ShopifyProduct[];
    const match = findProductByNameAndColour(products, styleName, colour);
    if (!match) return null;
    const variantPrice = parseFloat(match.variants?.[0]?.compare_at_price || match.variants?.[0]?.price || "0");
    if (!variantPrice || variantPrice <= 0) return null;
    // Reconstruct site origin to build product URL
    const origin = endpoint.replace(/\/products\.json.*$/, "");
    return {
      price: variantPrice,
      product_url: `${origin}/products/${match.handle}`,
      product_title: match.title,
      image_url: match.images?.[0]?.src || "",
      description: htmlToText(match.body_html || ""),
    };
  } catch (e) {
    console.warn("[supplier-website-rrp] registry fetch failed:", endpoint, (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    const vendor = (body.vendor as string | undefined)?.trim();
    const styleName = (body.style_name as string | undefined)?.trim();
    const styleNumber = (body.style_number as string | undefined)?.trim();
    const colour = (body.colour as string | undefined)?.trim();

    if (!vendor || !styleName) {
      return new Response(
        JSON.stringify({ error: "vendor and style_name required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ── 1. Cached path: supplier_profiles + supplier_website_prices ──
    const { data: profiles } = await supabase
      .from("supplier_profiles")
      .select("id, supplier_name, website_pricing_enabled, website_last_scraped_at")
      .eq("user_id", userId)
      .ilike("supplier_name", vendor);

    const profile = (profiles || []).find((p) => p.website_pricing_enabled);
    if (profile) {
      const handle = slugify(styleName);
      const titleLower = styleName.toLowerCase().trim();
      const STOP_WORDS = new Set(["the", "a", "an", "and", "or", "of", "in", "on", "for", "with"]);
      const tokens = titleLower
        .split(/\s+/)
        .map((t) => t.replace(/[^a-z0-9]/g, ""))
        .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

      const allTokensMatch = (title: string): boolean => {
        const t = (title || "").toLowerCase();
        return tokens.every((tok) => t.includes(tok));
      };

      let { data: rows } = await supabase
        .from("supplier_website_prices")
        .select("product_title, colour, size, price, product_url, handle")
        .eq("supplier_profile_id", profile.id)
        .eq("user_id", userId)
        .eq("handle", handle);

      let matchMethod: "handle" | "all_tokens" | "style_number" | "fuzzy" = "handle";

      if (!rows?.length && tokens.length) {
        const { data: rows2 } = await supabase
          .from("supplier_website_prices")
          .select("product_title, colour, size, price, product_url, handle")
          .eq("supplier_profile_id", profile.id)
          .eq("user_id", userId)
          .ilike("product_title", `%${tokens[0]}%`)
          .limit(200);
        const filtered = (rows2 || []).filter((r) => allTokensMatch(r.product_title));
        if (filtered.length) {
          rows = filtered;
          matchMethod = "all_tokens";
        }
      }

      if (!rows?.length && styleNumber) {
        const { data: rows3 } = await supabase
          .from("supplier_website_prices")
          .select("product_title, colour, size, price, product_url, handle")
          .eq("supplier_profile_id", profile.id)
          .eq("user_id", userId)
          .ilike("product_title", `%${styleNumber}%`)
          .limit(50);
        rows = rows3 || [];
        matchMethod = "style_number";
      }

      if (rows?.length) {
        let candidates = rows;
        if (colour) {
          const c = colour.toLowerCase();
          const colourMatches = rows.filter((r) =>
            (r.colour || "").toLowerCase().includes(c) ||
            (r.product_title || "").toLowerCase().includes(c)
          );
          if (colourMatches.length) candidates = colourMatches;
        }
        const best = candidates.reduce((a, b) =>
          Number(a.price) >= Number(b.price) ? a : b,
        );
        return new Response(
          JSON.stringify({
            found: true,
            price: Number(best.price),
            product_url: best.product_url,
            product_title: best.product_title,
            colour: best.colour,
            size: best.size,
            last_scraped_at: profile.website_last_scraped_at,
            supplier_profile_id: profile.id,
            match_method: matchMethod,
            confidence: matchMethod === "handle" ? 99 : matchMethod === "all_tokens" ? 90 : 75,
            source: "cached_profile",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ── 2. Registry fallback: live products.json fetch ──────────────
    const norm = normaliseBrand(vendor);
    let { data: registry } = await supabase
      .from("supplier_websites")
      .select("id, brand_name_display, website_url, is_shopify, products_json_endpoint, enrichment_enabled")
      .eq("brand_name_normalised", norm)
      .maybeSingle();

    // Token fallback (e.g. "Walnut" → "walnut melbourne")
    if (!registry && norm) {
      const firstToken = norm.split(" ")[0];
      if (firstToken.length >= 3) {
        const { data: fuzzy } = await supabase
          .from("supplier_websites")
          .select("id, brand_name_display, website_url, is_shopify, products_json_endpoint, enrichment_enabled")
          .ilike("brand_name_normalised", `%${firstToken}%`)
          .limit(1);
        if (fuzzy?.length) registry = fuzzy[0];
      }
    }

    if (registry?.enrichment_enabled && registry.is_shopify && registry.products_json_endpoint) {
      const liveResult = await fetchFromRegistry(
        registry.products_json_endpoint,
        styleName,
        colour,
      );
      if (liveResult) {
        return new Response(
          JSON.stringify({
            found: true,
            price: liveResult.price,
            product_url: liveResult.product_url,
            product_title: liveResult.product_title,
            image_url: liveResult.image_url,
            description: liveResult.description,
            colour: colour || null,
            match_method: "registry_live",
            confidence: 92,
            source: "registry_live",
            registry_brand: registry.brand_name_display,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // Live fetch returned nothing — increment failure counter
      await supabase
        .from("supplier_websites")
        .update({ scrape_failure_count: (registry as { scrape_failure_count?: number }).scrape_failure_count
          ? (registry as { scrape_failure_count: number }).scrape_failure_count + 1
          : 1 })
        .eq("id", registry.id);
    }

    // ── 3. Not in registry — log the miss so the user can add it ──
    if (!registry) {
      // Upsert-style: try update count first, else insert
      const { data: existing } = await supabase
        .from("brand_lookup_misses")
        .select("id, occurrence_count")
        .eq("user_id", userId)
        .eq("normalised", norm)
        .maybeSingle();
      if (existing) {
        await supabase
          .from("brand_lookup_misses")
          .update({
            occurrence_count: (existing.occurrence_count || 0) + 1,
            occurred_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("brand_lookup_misses").insert({
          user_id: userId,
          raw_brand: vendor,
          normalised: norm,
        });
      }
    }

    return new Response(
      JSON.stringify({
        found: false,
        reason: registry
          ? "Brand registered but no matching product on website"
          : "Brand not in supplier_websites registry",
        searched_brand: vendor,
        normalised: norm,
        registry_match: registry?.brand_name_display ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[supplier-website-rrp] error:", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
