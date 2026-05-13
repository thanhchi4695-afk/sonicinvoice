// Competitor Gap Agent — AI Agent (pattern 3) per the Sonic three-pattern doctrine.
//
// Crawls competitor retailer navigation, finds collection URLs that match the
// connected store's brands but are missing from the store, and saves each as a
// reviewable gap with concrete "competitor has this — you don't" framing.
//
// Long-running (up to ~3 min): we create a `gap_analysis_runs` row immediately,
// return the run_id to the caller, and continue the pipeline in EdgeRuntime.waitUntil.
//
// Auth: requires a logged-in user. Reads that user's Shopify connection.
import { createClient } from "npm:@supabase/supabase-js@2";
import { callAI, getContent } from "../_shared/ai-gateway.ts";
import { getValidShopifyToken } from "../_shared/shopify-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Competitor reference map ────────────────────────────────────────────
type Competitor = { name: string; nav_url: string };
const COMPETITOR_REFERENCES: Record<string, Competitor[]> = {
  FOOTWEAR: [
    { name: "THE ICONIC", nav_url: "https://www.theiconic.com.au/womens-shoes/" },
    { name: "Mathers", nav_url: "https://www.mathers.com.au/women-s-shoes.html" },
  ],
  SWIMWEAR: [
    { name: "THE ICONIC", nav_url: "https://www.theiconic.com.au/womens-swimwear/" },
  ],
  CLOTHING: [
    { name: "White Fox", nav_url: "https://www.whitefoxboutique.com/collections/clothing" },
    { name: "THE ICONIC", nav_url: "https://www.theiconic.com.au/womens-clothing/" },
  ],
  ACCESSORIES: [
    { name: "David Jones", nav_url: "https://www.davidjones.com/women/bags" },
    { name: "Louenhide", nav_url: "https://louenhide.com.au" },
  ],
  JEWELLERY: [
    { name: "Girls With Gems", nav_url: "https://www.girlswithgems.com/collections" },
  ],
};

const VERTICAL_KEYWORDS: Record<string, RegExp> = {
  FOOTWEAR: /\b(shoe|boot|sandal|sneaker|heel|loafer|flat|mule|footwear)\b/i,
  SWIMWEAR: /\b(swim|bikini|tankini|one[- ]?piece|rashguard|boardshort|kaftan)\b/i,
  CLOTHING: /\b(dress|top|skirt|pant|short|jumpsuit|blouse|jacket|coat|knit)\b/i,
  ACCESSORIES: /\b(bag|wallet|belt|hat|scarf|sunglass|tote|clutch|backpack)\b/i,
  JEWELLERY: /\b(necklace|earring|bracelet|ring|pendant|jewell?ery)\b/i,
};

// ─── Helpers ─────────────────────────────────────────────────────────────
function slugify(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function detectVertical(productTypes: string[], titles: string[]): string {
  const corpus = [...productTypes, ...titles].join(" ").toLowerCase();
  let best = "CLOTHING";
  let bestScore = 0;
  for (const [v, rx] of Object.entries(VERTICAL_KEYWORDS)) {
    const matches = corpus.match(new RegExp(rx, "g"));
    const score = matches?.length ?? 0;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return best;
}

interface FirecrawlResult {
  links?: string[];
  markdown?: string;
}

async function firecrawlScrape(url: string): Promise<FirecrawlResult | null> {
  if (!FIRECRAWL_API_KEY) {
    console.warn("FIRECRAWL_API_KEY not set — falling back to plain fetch");
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 SonicGapBot/1.0" } });
      if (!r.ok) return null;
      const html = await r.text();
      const links = Array.from(html.matchAll(/href=["']([^"'#?]+)["']/g)).map((m) => {
        try { return new URL(m[1], url).toString(); } catch { return ""; }
      }).filter(Boolean);
      return { links, markdown: "" };
    } catch (e) { console.warn("plain fetch failed", e); return null; }
  }
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["links", "markdown"], onlyMainContent: false }),
    });
    if (!res.ok) { console.warn(`firecrawl ${url}: ${res.status}`); return null; }
    const json = await res.json();
    const data = json?.data ?? json;
    return { links: data?.links ?? [], markdown: data?.markdown ?? "" };
  } catch (e) { console.warn("firecrawl error", e); return null; }
}

async function fetchShopifyData(storeUrl: string, accessToken: string, apiVersion: string) {
  const endpoint = `https://${storeUrl}/admin/api/${apiVersion}/graphql.json`;
  const query = `
    query {
      products(first: 250) {
        edges { node { vendor productType title } }
      }
      collections(first: 250) {
        edges { node { handle title } }
      }
    }
  `;
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query }),
  });
  const json = await r.json();
  const products = (json?.data?.products?.edges ?? []).map((e: any) => e.node);
  const collections = (json?.data?.collections?.edges ?? []).map((e: any) => e.node);
  return { products, collections };
}

// Find competitor nav links that contain any of the store's brand slugs
function findBrandLinks(links: string[], brandSlugs: string[], competitorHost: string): Array<{ url: string; brandSlug: string }> {
  const matches: Array<{ url: string; brandSlug: string }> = [];
  const seen = new Set<string>();
  for (const raw of links) {
    let u: URL;
    try { u = new URL(raw); } catch { continue; }
    if (!u.hostname.endsWith(competitorHost)) continue;
    if (/\/(products?|cart|account|checkout|policies|blogs?)(\/|$)/i.test(u.pathname)) continue;
    const path = u.pathname.toLowerCase();
    for (const bs of brandSlugs) {
      if (!bs || bs.length < 3) continue;
      // brand slug must appear as a word boundary in the path
      const rx = new RegExp(`(?:^|[/-])${bs.replace(/-/g, "[- ]?")}(?:[/-]|$)`);
      if (rx.test(path)) {
        u.hash = ""; u.search = "";
        const norm = u.toString();
        if (seen.has(norm)) continue;
        seen.add(norm);
        matches.push({ url: norm, brandSlug: bs });
      }
    }
  }
  return matches;
}

function classifyGapType(url: string): "brand_type" | "colour" | "occasion" | "intersection" | "depth" {
  const path = url.toLowerCase();
  if (/(black|white|red|blue|green|pink|nude|tan|navy|cream|gold|silver)/.test(path)) return "colour";
  if (/(wedding|party|work|holiday|race|formal|casual|beach|resort)/.test(path)) return "occasion";
  if (path.split("/").filter(Boolean).length >= 3) return "intersection";
  if (/(sale|new-?in|trending)/.test(path)) return "depth";
  return "brand_type";
}

// Use the LLM to write specific, urgent framing for a batch of gaps.
async function enrichGapsWithFraming(
  gaps: Array<{ competitor_name: string; competitor_url: string; brand: string; product_count: number; gap_type: string }>,
): Promise<Array<{ suggested_title: string; suggested_handle: string; competitor_framing: string; expected_impact: string }>> {
  if (gaps.length === 0) return [];

  const prompt = `You are an SEO consultant for a boutique retailer. For each competitor URL gap below, produce:
1. suggested_title: a clean Shopify collection title (e.g. "Walnut Melbourne Shoes")
2. suggested_handle: a kebab-case handle (e.g. "walnut-melbourne-shoes")
3. competitor_framing: ONE specific, concrete sentence that names the competitor, the exact URL, the brand, the product count, and the search traffic being missed. NEVER generic. Example good output: "THE ICONIC has a dedicated page at theiconic.com.au/womens-walnut-melbourne-shoes/ ranking for 'Walnut Melbourne shoes Australia'. You stock 89 Walnut Melbourne products and have zero brand collection — this is leaving organic traffic on the table."
4. expected_impact: "high" (brand+type page for a brand you stock heavily, >50 products), "medium" (colour/occasion or 10-50 products), or "low" (deep intersection or <10 products)

Return ONLY a JSON array, one object per input, in the same order. No prose, no markdown.

INPUTS:
${JSON.stringify(gaps, null, 2)}`;

  const resp = await callAI({
    model: "google/gemini-2.5-pro",
    messages: [
      { role: "system", content: "You output ONLY valid JSON arrays. No markdown fences." },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
    max_tokens: 4000,
  });

  let text = getContent(resp).trim();
  text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    console.warn("framing JSON parse failed", e, text.slice(0, 500));
  }
  // Fallback: deterministic framing
  return gaps.map((g) => ({
    suggested_title: `${g.brand} ${g.gap_type === "brand_type" ? "Collection" : ""}`.trim(),
    suggested_handle: slugify(`${g.brand}-${g.gap_type}`),
    competitor_framing: `${g.competitor_name} has a dedicated page at ${g.competitor_url}. You stock ${g.product_count} ${g.brand} products with no equivalent collection.`,
    expected_impact: g.product_count > 50 ? "high" : g.product_count > 10 ? "medium" : "low",
  }));
}

// ─── Main pipeline ───────────────────────────────────────────────────────
async function runPipeline(userId: string, runId: string) {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  async function step(s: string) {
    console.log(`[gap-agent] ${runId} ${s}`);
    await admin.from("gap_analysis_runs").update({ current_step: s }).eq("id", runId);
  }

  async function fail(msg: string) {
    console.error(`[gap-agent] ${runId} FAILED: ${msg}`);
    await admin.from("gap_analysis_runs").update({
      status: "failed", completed_at: new Date().toISOString(), error_message: msg,
    }).eq("id", runId);
  }

  try {
    await step("Loading Shopify connection");
    const { accessToken, storeUrl, apiVersion } = await getValidShopifyToken(admin, userId);

    await step("Fetching products and collections from Shopify");
    const { products, collections } = await fetchShopifyData(storeUrl, accessToken, apiVersion);
    if (products.length === 0) {
      await fail("No products found in Shopify store");
      return;
    }

    const productTypes = products.map((p: any) => p.productType).filter(Boolean);
    const titles = products.map((p: any) => p.title).filter(Boolean);
    const vertical = detectVertical(productTypes, titles);
    await admin.from("gap_analysis_runs").update({ vertical }).eq("id", runId);

    // Brand → product count
    const brandCounts = new Map<string, number>();
    for (const p of products) {
      const v = (p.vendor || "").trim();
      if (v) brandCounts.set(v, (brandCounts.get(v) ?? 0) + 1);
    }
    const brands = Array.from(brandCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30); // top 30 brands by product count

    const brandSlugMap = new Map(brands.map(([b]) => [slugify(b), b]));
    const brandSlugs = Array.from(brandSlugMap.keys());

    const existingHandles = new Set<string>(collections.map((c: any) => c.handle));

    await step(`Vertical=${vertical}, ${brands.length} brands, ${existingHandles.size} existing collections`);

    const refs = COMPETITOR_REFERENCES[vertical] || [];
    let storesChecked = 0;
    const candidateGaps: Array<any> = [];

    for (const comp of refs) {
      await step(`Crawling ${comp.name}`);
      const compHost = new URL(comp.nav_url).hostname.replace(/^www\./, "");
      const scraped = await firecrawlScrape(comp.nav_url);
      storesChecked += 1;
      if (!scraped?.links?.length) {
        console.warn(`No links from ${comp.name}`);
        continue;
      }
      const matches = findBrandLinks(scraped.links, brandSlugs, compHost);
      console.log(`[gap-agent] ${comp.name}: ${matches.length} brand-matching links`);

      for (const m of matches) {
        const brand = brandSlugMap.get(m.brandSlug);
        if (!brand) continue;
        const productCount = brandCounts.get(brand) ?? 0;
        const candidateHandle = slugify(brand);
        // Skip if a close handle already exists
        const handleExists = Array.from(existingHandles).some((h) => h.includes(candidateHandle) || candidateHandle.includes(h));
        if (handleExists) continue;
        candidateGaps.push({
          competitor_name: comp.name,
          competitor_url: m.url,
          brand,
          product_count: productCount,
          gap_type: classifyGapType(m.url),
        });
      }
      await sleep(500); // rate-limit between competitors
    }

    if (candidateGaps.length === 0) {
      await admin.from("gap_analysis_runs").update({
        status: "complete",
        completed_at: new Date().toISOString(),
        competitor_stores_checked: storesChecked,
        gaps_found: 0,
        current_step: "No gaps found",
      }).eq("id", runId);
      return;
    }

    // De-duplicate by (brand, gap_type) — keep first competitor reference per dimension
    const seen = new Set<string>();
    const unique = candidateGaps.filter((g) => {
      const k = `${g.brand}::${g.gap_type}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 25); // cap to 25 to bound LLM cost

    await step(`Generating framing for ${unique.length} gaps`);
    const enriched = await enrichGapsWithFraming(unique);

    const rows = unique.map((g, i) => {
      const e = enriched[i] ?? {};
      return {
        user_id: userId,
        run_id: runId,
        competitor_name: g.competitor_name,
        competitor_url: g.competitor_url,
        gap_type: g.gap_type,
        brand: g.brand,
        product_count_in_store: g.product_count,
        suggested_handle: e.suggested_handle || slugify(`${g.brand}-${g.gap_type}`),
        suggested_title: e.suggested_title || `${g.brand} Collection`,
        smart_rule_column: "vendor",
        smart_rule_relation: "equals",
        smart_rule_condition: g.brand,
        competitor_framing: e.competitor_framing
          || `${g.competitor_name} has a dedicated page at ${g.competitor_url}. You stock ${g.product_count} ${g.brand} products and have no equivalent collection.`,
        expected_impact: ["high", "medium", "low"].includes(e.expected_impact) ? e.expected_impact : "medium",
        status: "pending",
      };
    });

    // upsert one at a time so unique-handle conflicts don't kill the whole batch
    let inserted = 0;
    for (const row of rows) {
      const { error } = await admin.from("competitor_gaps")
        .upsert(row, { onConflict: "user_id,suggested_handle", ignoreDuplicates: true });
      if (!error) inserted += 1;
      else console.warn("gap insert error", error.message);
    }

    await admin.from("gap_analysis_runs").update({
      status: "complete",
      completed_at: new Date().toISOString(),
      gaps_found: inserted,
      competitor_stores_checked: storesChecked,
      current_step: `Found ${inserted} gaps`,
    }).eq("id", runId);

    console.log(`[gap-agent] ${runId} complete: ${inserted} gaps, ${storesChecked} competitors checked`);
  } catch (err) {
    await fail((err as Error).message || String(err));
  }
}

// ─── Edge entrypoint ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: authErr } = await userClient.auth.getClaims(token);
    if (authErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Refuse to start if a run is already active for this user
    const { data: existing } = await admin
      .from("gap_analysis_runs")
      .select("id, status, started_at")
      .eq("user_id", userId)
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1);
    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({
        run_id: existing[0].id,
        status: "already_running",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: run, error: runErr } = await admin
      .from("gap_analysis_runs")
      .insert({ user_id: userId, status: "running", current_step: "Queued" })
      .select("id")
      .single();
    if (runErr || !run) throw runErr || new Error("Could not create run");

    // Fire-and-forget the long pipeline
    // @ts-ignore — Deno Deploy / Supabase Edge: EdgeRuntime exists at runtime
    (globalThis as any).EdgeRuntime?.waitUntil?.(runPipeline(userId, run.id))
      ?? runPipeline(userId, run.id); // local fallback

    return new Response(JSON.stringify({ run_id: run.id, status: "started" }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[gap-agent] entrypoint error", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
