// ════════════════════════════════════════════════════════════
// Tier 1.5 — WebSearch enrichment
//
// Looks up a product on the open web via Anthropic web_search
// tool or Brave Search and returns price / image / description
// from the first matching supplier-domain result.
//
// Idempotent: every failure path returns { found: false } so
// the calling cascade can fall through to Google / markup.
//
// Caching: hashes (brand|product|colour|code), 30d positive /
// 7d negative. Cache writes use the service role.
//
// Cap: each user has a monthly_websearch_cap; when reached,
// returns { found: false, error: 'monthly_cap_exceeded' }.
// ════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Cost table (AUD per call) ──────────────────────────────
const COST_TABLE_AUD: Record<string, number> = {
  "anthropic-websearch": 0.022,
  "brave-search": 0.008,
};

// ─── Types ──────────────────────────────────────────────────
interface EnrichInput {
  brand_name: string;
  product_name: string;
  colour?: string;
  product_code?: string;
  preferred_domain?: string;
}

interface RawSearchResult {
  url: string | null;
  price: number | null;
  image_url: string | null;
  description: string | null;
  raw_snippet?: string;
}

interface EnrichOutput {
  found: boolean;
  source: "anthropic-websearch" | "brave-search" | "cache" | "none";
  matched_url: string | null;
  price: number | null;
  image_url: string | null;
  description: string | null;
  raw_snippet: string;
  query_used: string;
  cost_aud: number;
  cache_hit: boolean;
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────
function normaliseDomain(d: string): string {
  return d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

function hostnameOf(url: string): string {
  try {
    return normaliseDomain(new URL(url).hostname);
  } catch {
    return "";
  }
}

function extractPriceFromText(text: string): number | null {
  if (!text) return null;
  const m = text.match(/\$\s?(\d{1,4}(?:[.,]\d{2})?)/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(",", "."));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function extractImageFromText(text: string): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/\S+\.(?:jpg|jpeg|png|webp)(?:\?\S*)?/i);
  return m ? m[0] : null;
}

function firstSentences(text: string, n = 2): string {
  if (!text) return "";
  const parts = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  return parts.slice(0, n).join(" ").slice(0, 400);
}

function buildQuery(input: EnrichInput): string {
  const { brand_name, product_name, colour, product_code, preferred_domain } = input;
  if (product_code && preferred_domain) {
    return `site:${preferred_domain} ${product_code}`;
  }
  if (preferred_domain) {
    return `site:${preferred_domain} "${product_name}"${colour ? ` ${colour}` : ""}`;
  }
  return `"${brand_name}" "${product_name}"${colour ? ` ${colour}` : ""} site:.com.au`;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseModelJson(text: string): RawSearchResult {
  // The model returns a JSON object somewhere in the text. Find first {...}.
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { url: null, price: null, image_url: null, description: null };
  try {
    const o = JSON.parse(m[0]);
    return {
      url: o.url || null,
      price: typeof o.price === "number" ? o.price : extractPriceFromText(String(o.price ?? "")),
      image_url: o.image_url || null,
      description: o.description || null,
      raw_snippet: text,
    };
  } catch {
    return { url: null, price: null, image_url: null, description: null, raw_snippet: text };
  }
}

// ─── Retry wrapper ──────────────────────────────────────────
async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = msg.includes("429") || msg.includes("rate_limit");
      const isLast = attempt === maxRetries;
      if (!isRateLimit || isLast) throw err;
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error("unreachable");
}

// ─── Anthropic provider ─────────────────────────────────────
async function searchViaAnthropic(query: string): Promise<RawSearchResult> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
      messages: [{
        role: "user",
        content:
          `Search the web for this query and return the most relevant product URL, ` +
          `price (AUD), image URL, and a short description. ` +
          `Query: "${query}". ` +
          `Respond ONLY with JSON: {"url":"...","price":0.00,"image_url":"...","description":"..."}. ` +
          `If you cannot find a relevant product page on the supplier's domain, respond with ` +
          `{"url":null,"price":null,"image_url":null,"description":null}.`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const blocks = (data?.content || []) as Array<{ type: string; text?: string }>;
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
  return parseModelJson(text);
}

// ─── Brave provider ─────────────────────────────────────────
async function searchViaBrave(query: string): Promise<RawSearchResult> {
  const key = Deno.env.get("BRAVE_SEARCH_API_KEY");
  if (!key) throw new Error("BRAVE_SEARCH_API_KEY not configured");
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
    { headers: { "X-Subscription-Token": key, "Accept": "application/json" } },
  );
  if (!res.ok) throw new Error(`Brave API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const first = data?.web?.results?.[0];
  if (!first) return { url: null, price: null, image_url: null, description: null };
  return {
    url: first.url || null,
    price: extractPriceFromText(first.description || first.title || ""),
    image_url: first.thumbnail?.src || extractImageFromText(first.description || ""),
    description: first.description || null,
    raw_snippet: JSON.stringify(first).slice(0, 1000),
  };
}

// ─── Main handler ───────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ found: false, error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims, error: authErr } = await supabaseUser.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ found: false, error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;

    // Service-role client for cache + log writes
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Input
    const input = (await req.json()) as EnrichInput;
    if (!input?.brand_name || !input?.product_name) {
      return new Response(
        JSON.stringify({ found: false, error: "brand_name and product_name required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const query = buildQuery(input);
    const cacheKey = await sha256Hex(
      [input.brand_name, input.product_name, input.colour || "", input.product_code || ""]
        .map((s) => s.toLowerCase().trim()).join("|"),
    );

    // ── Cache check ──
    const { data: cached } = await supabaseAdmin
      .from("search_results_cache")
      .select("*")
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached) {
      await supabaseAdmin
        .from("search_results_cache")
        .update({ hit_count: (cached.hit_count || 0) + 1 })
        .eq("cache_key", cacheKey);
      await supabaseAdmin.from("websearch_usage_log").insert({
        user_id: userId, query, source: cached.source,
        matched_url: cached.matched_url, cost_aud: 0, cache_hit: true,
      });
      const out: EnrichOutput = {
        found: !!cached.found,
        source: cached.source as EnrichOutput["source"],
        matched_url: cached.matched_url,
        price: cached.price !== null ? Number(cached.price) : null,
        image_url: cached.image_url,
        description: cached.description,
        raw_snippet: cached.raw_snippet || "",
        query_used: query,
        cost_aud: 0,
        cache_hit: true,
      };
      return new Response(JSON.stringify(out), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Cap check (this user, this calendar month) ──
    const monthStart = new Date();
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const [{ count }, { data: settings }] = await Promise.all([
      supabaseAdmin.from("websearch_usage_log")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("cache_hit", false)
        .gte("created_at", monthStart.toISOString()),
      supabaseAdmin.from("user_settings")
        .select("search_provider, monthly_websearch_cap")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    const cap = settings?.monthly_websearch_cap ?? 500;
    const provider = (settings?.search_provider ?? "anthropic") as "anthropic" | "brave";
    if ((count ?? 0) >= cap) {
      return new Response(JSON.stringify({
        found: false, source: "none", matched_url: null, price: null, image_url: null,
        description: null, raw_snippet: "", query_used: query, cost_aud: 0, cache_hit: false,
        error: "monthly_cap_exceeded",
      } satisfies EnrichOutput), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Provider call ──
    const sourceName = provider === "brave" ? "brave-search" : "anthropic-websearch";
    let raw: RawSearchResult = { url: null, price: null, image_url: null, description: null };
    try {
      raw = await callWithRetry(() =>
        provider === "brave" ? searchViaBrave(query) : searchViaAnthropic(query),
      );
    } catch (e) {
      console.warn("[enrich-via-websearch] provider failed:", e);
      raw = { url: null, price: null, image_url: null, description: null };
    }

    // Validate hostname matches preferred_domain when provided
    let valid = true;
    if (raw.url && input.preferred_domain) {
      const expected = normaliseDomain(input.preferred_domain);
      const got = hostnameOf(raw.url);
      if (got && expected && !got.endsWith(expected) && !expected.endsWith(got)) {
        valid = false;
      }
    }

    const found = !!(valid && raw.url && (raw.price || raw.description));
    const cost = COST_TABLE_AUD[sourceName] ?? 0;

    const result: EnrichOutput = {
      found,
      source: sourceName,
      matched_url: found ? raw.url : null,
      price: found ? raw.price : null,
      image_url: found ? raw.image_url : null,
      description: found ? firstSentences(raw.description || "", 2) : null,
      raw_snippet: raw.raw_snippet || "",
      query_used: query,
      cost_aud: cost,
      cache_hit: false,
    };

    // ── Persist cache + usage ──
    const ttlDays = found ? 30 : 7;
    const expiresAt = new Date(Date.now() + ttlDays * 86400_000).toISOString();
    await supabaseAdmin.from("search_results_cache").upsert({
      cache_key: cacheKey,
      matched_url: result.matched_url,
      price: result.price,
      image_url: result.image_url,
      description: result.description,
      raw_snippet: result.raw_snippet.slice(0, 4000),
      source: sourceName,
      cost_aud: cost,
      found,
      query_used: query,
      expires_at: expiresAt,
    }, { onConflict: "cache_key" });

    await supabaseAdmin.from("websearch_usage_log").insert({
      user_id: userId, query, source: sourceName,
      matched_url: result.matched_url, cost_aud: cost, cache_hit: false,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[enrich-via-websearch] error:", msg);
    // Always return found:false on error — cascade must keep going.
    return new Response(JSON.stringify({
      found: false, source: "none", matched_url: null, price: null, image_url: null,
      description: null, raw_snippet: "", query_used: "", cost_aud: 0, cache_hit: false,
      error: msg,
    } satisfies EnrichOutput), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
