// ══════════════════════════════════════════════════════════════
// supplier-website-rrp
// Looks up a single product's RRP in the cached supplier_website_prices.
// Called by the Phase 3 price orchestrator BEFORE the markup fallback.
//
// Match strategy (in order):
//   1. Exact handle (slugified style name)
//   2. Title contains style name (case-insensitive)
//   3. Title contains style number / SKU prefix
// Then narrow by colour if provided.
// Returns the highest matching variant price (RRP, not sale).
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

    // Resolve supplier_profile by name (case-insensitive)
    const { data: profiles } = await supabase
      .from("supplier_profiles")
      .select(
        "id, supplier_name, website_pricing_enabled, website_last_scraped_at",
      )
      .eq("user_id", userId)
      .ilike("supplier_name", vendor);

    const profile = (profiles || []).find(
      (p) => p.website_pricing_enabled,
    );
    if (!profile) {
      return new Response(
        JSON.stringify({ found: false, reason: "Website pricing not enabled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const handle = slugify(styleName);
    const titleLower = styleName.toLowerCase().trim();

    // Tokenise the style name (e.g. "Marrakesh Dress" → ["marrakesh", "dress"]).
    // We use these to enforce that EVERY token must appear in the matched
    // product_title — preventing stale fuzzy matches like "Marrakesh Top"
    // when the invoice line is "Marrakesh Dress".
    const STOP_WORDS = new Set([
      "the", "a", "an", "and", "or", "of", "in", "on", "for", "with",
    ]);
    const tokens = titleLower
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/g, ""))
      .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

    const allTokensMatch = (title: string): boolean => {
      const t = (title || "").toLowerCase();
      return tokens.every((tok) => t.includes(tok));
    };

    // 1. Try exact handle first (slugified style name → handle column)
    let { data: rows } = await supabase
      .from("supplier_website_prices")
      .select("product_title, colour, size, price, product_url, handle")
      .eq("supplier_profile_id", profile.id)
      .eq("user_id", userId)
      .eq("handle", handle);

    let matchMethod: "handle" | "all_tokens" | "style_number" | "fuzzy" = "handle";

    // 2. Fall back to title ilike, then re-filter so EVERY token must be present.
    //    Without this, "Marrakesh Dress" matched "Marrakesh Top", "Madrid Dress",
    //    etc., and reduce(max-price) picked an unrelated product's RRP.
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

    // 3. Style number fallback (still requires the style number to appear verbatim).
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

    if (!rows?.length) {
      return new Response(
        JSON.stringify({
          found: false,
          reason: "No matching product on website",
          last_scraped_at: profile.website_last_scraped_at,
          searched_tokens: tokens,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Narrow by colour if supplied
    let candidates = rows;
    if (colour) {
      const c = colour.toLowerCase();
      const colourMatches = rows.filter((r) =>
        (r.colour || "").toLowerCase().includes(c) ||
        (r.product_title || "").toLowerCase().includes(c)
      );
      if (colourMatches.length) candidates = colourMatches;
    }

    // Pick the max price (RRP, not a sale variant)
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
        confidence: 95,
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
