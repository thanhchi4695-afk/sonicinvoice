// Competitor Gap Agent — AI Agent (pattern 3) per the Sonic three-pattern doctrine.
//
// Uses Anthropic Claude with tool use (web_search, web_fetch, save_gap, finish_analysis)
// to find SEO collection gaps by comparing the connected store's collections against
// competitor retailers in the same vertical.
//
// Long-running (~1–3 min): creates a `gap_analysis_runs` row, returns the run_id, and
// continues the pipeline in EdgeRuntime.waitUntil so the HTTP request returns fast.
//
// Auth: requires a logged-in user. Uses that user's Shopify connection.
// Schema: user_id-scoped (no `stores` table in this project).

import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.27.3";
import { getValidShopifyToken } from "../_shared/shopify-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

// ─── Competitor reference map ─────────────────────────────────────────────
const COMPETITOR_REFS: Record<string, Array<{ name: string; nav_url: string; brand_url_template: string | null }>> = {
  FOOTWEAR: [
    { name: "THE ICONIC", nav_url: "https://www.theiconic.com.au/womens-shoes/", brand_url_template: "https://www.theiconic.com.au/womens-{slug}-shoes/" },
    { name: "Mathers", nav_url: "https://www.mathers.com.au/women-s-shoes.html", brand_url_template: "https://www.mathers.com.au/brands/{slug}.html" },
  ],
  SWIMWEAR: [
    { name: "THE ICONIC", nav_url: "https://www.theiconic.com.au/womens-swimwear/", brand_url_template: "https://www.theiconic.com.au/{slug}/" },
  ],
  CLOTHING: [
    { name: "White Fox Boutique", nav_url: "https://whitefoxboutique.com.au/collections", brand_url_template: null },
    { name: "THE ICONIC", nav_url: "https://www.theiconic.com.au/womens-clothing/", brand_url_template: "https://www.theiconic.com.au/{slug}/" },
  ],
  ACCESSORIES: [
    { name: "David Jones", nav_url: "https://www.davidjones.com/women/bags", brand_url_template: "https://www.davidjones.com/brand/{slug}" },
  ],
  JEWELLERY: [
    { name: "Girls With Gems", nav_url: "https://www.girlswithgems.com/collections", brand_url_template: "https://www.girlswithgems.com/collections/{slug}" },
  ],
};

function detectVertical(products: any[]): string {
  const types = products.map((p) => (p.productType || p.product_type || "").toLowerCase());
  const tags = products.flatMap((p) => (p.tags || "").toString().toLowerCase().split(","));
  const all = [...types, ...tags].join(" ");
  if (/swim|bikini|one.piece|swimwear|swimsuit|tankini/.test(all)) return "SWIMWEAR";
  if (/shoe|boot|sandal|heel|flat|loafer|sneaker|footwear/.test(all)) return "FOOTWEAR";
  if (/bag|tote|crossbody|clutch|wallet|handbag|accessory/.test(all)) return "ACCESSORIES";
  if (/necklace|earring|bracelet|ring|jewellery|jewelry/.test(all)) return "JEWELLERY";
  return "CLOTHING";
}

async function fetchShopifyData(storeUrl: string, accessToken: string, apiVersion: string) {
  const endpoint = `https://${storeUrl}/admin/api/${apiVersion}/graphql.json`;
  const query = `query {
    products(first: 250) { edges { node { vendor productType title tags } } }
    collections(first: 250) { edges { node { handle title } } }
  }`;
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query }),
  });
  const json = await r.json();
  return {
    products: (json?.data?.products?.edges ?? []).map((e: any) => e.node),
    collections: (json?.data?.collections?.edges ?? []).map((e: any) => e.node),
  };
}

// ─── Pipeline ────────────────────────────────────────────────────────────
async function runPipeline(userId: string, runId: string) {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const updateStep = async (step: string) => {
    console.log(`[gap-agent] ${runId} ${step}`);
    await admin.from("gap_analysis_runs").update({ current_step: step }).eq("id", runId);
  };
  const fail = async (msg: string) => {
    console.error(`[gap-agent] ${runId} FAILED: ${msg}`);
    await admin.from("gap_analysis_runs").update({
      status: "failed", completed_at: new Date().toISOString(), error_message: msg,
    }).eq("id", runId);
  };

  try {
    await updateStep("Loading Shopify connection");
    const { accessToken, storeUrl, apiVersion } = await getValidShopifyToken(admin, userId);

    await updateStep("Fetching products and collections from Shopify");
    const { products, collections } = await fetchShopifyData(storeUrl, accessToken, apiVersion);
    if (products.length === 0) { await fail("No products found in Shopify store"); return; }

    const existingHandles = new Set<string>(collections.map((c: any) => c.handle));
    const vertical = detectVertical(products);
    const brands = [...new Set(products.map((p: any) => p.vendor).filter(Boolean))].slice(0, 15) as string[];
    const competitors = COMPETITOR_REFS[vertical] || COMPETITOR_REFS.CLOTHING;

    await admin.from("gap_analysis_runs").update({ vertical, brands_checked: brands.length }).eq("id", runId);
    await updateStep(`Vertical=${vertical}, ${brands.length} brands, ${competitors.length} competitors`);

    const systemPrompt = `You are an SEO gap analysis agent for an Australian Shopify boutique.

STORE DATA:
- Vertical: ${vertical}
- Brands stocked: ${brands.join(", ")}
- Existing collection handles: ${[...existingHandles].slice(0, 50).join(", ")}

COMPETITOR REFERENCES TO CHECK:
${competitors.map((c) => `- ${c.name}: ${c.nav_url}`).join("\n")}

YOUR JOB:
1. For each competitor, fetch their nav and brand pages for the brands this store stocks.
2. Find collection URLs the competitor has that this store is missing.
3. For each gap, call save_gap with full details — competitor URL, brand, gap_type, suggested handle/title, smart-collection rule, and a SPECIFIC competitor_framing sentence.
4. Be concrete: name the competitor, the URL, the brand, and the search traffic being missed.

GAP TYPES: brand_type | colour | occasion | intersection | depth
IMPACT: high (brand has 20+ products & no collection) | medium (5-19 products or colour/occasion) | low (deep niche)

Example competitor_framing:
"THE ICONIC has a dedicated page at theiconic.com.au/womens-walnut-melbourne-shoes/ that ranks for 'Walnut Melbourne shoes Australia'. You stock 89 Walnut Melbourne products but have no equivalent collection — leaving organic traffic on the table."

When done analysing all competitors, call finish_analysis.`;

    const tools: Anthropic.Tool[] = [
      { name: "web_search", description: "Search the web for competitor collection pages",
        input_schema: { type: "object" as const, properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "web_fetch", description: "Fetch a URL and extract collection-related links",
        input_schema: { type: "object" as const, properties: { url: { type: "string" } }, required: ["url"] } },
      { name: "save_gap", description: "Save a competitor gap to the database",
        input_schema: { type: "object" as const, properties: {
          competitor_name: { type: "string" },
          competitor_url: { type: "string" },
          gap_type: { type: "string", enum: ["brand_type","colour","occasion","intersection","depth"] },
          brand: { type: "string" },
          suggested_handle: { type: "string" },
          suggested_title: { type: "string" },
          smart_rule_column: { type: "string" },
          smart_rule_relation: { type: "string" },
          smart_rule_condition: { type: "string" },
          competitor_framing: { type: "string" },
          expected_impact: { type: "string", enum: ["high","medium","low"] },
        }, required: ["competitor_name","competitor_url","gap_type","suggested_handle","suggested_title","competitor_framing","expected_impact"] } },
      { name: "finish_analysis", description: "Mark the analysis as complete",
        input_schema: { type: "object" as const, properties: { summary: { type: "string" } }, required: ["summary"] } },
    ];

    const messages: Anthropic.MessageParam[] = [{
      role: "user",
      content: `Analyse the competitor collections for this store. Check all ${competitors.length} competitor(s) for all ${brands.length} brand(s). Find every collection the competitors have that this store is missing. Save each gap with save_gap, then call finish_analysis.`,
    }];

    let gapsFound = 0;
    let finished = false;
    const MAX_ITERATIONS = 30;

    for (let iter = 0; iter < MAX_ITERATIONS && !finished; iter++) {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: systemPrompt,
        tools,
        messages,
      });
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn") break;

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        let result = "";

        if (block.name === "web_search") {
          const { query } = block.input as { query: string };
          await updateStep(`Searching: "${query}"`);
          try {
            const searchRes = await anthropic.messages.create({
              model: "claude-sonnet-4-20250514",
              max_tokens: 2000,
              tools: [{ type: "web_search_20250305" as any, name: "web_search" }],
              messages: [{ role: "user", content: `Search for: ${query}. Return the top 5 result URLs and titles.` }],
            });
            const text = searchRes.content.find((b) => b.type === "text");
            result = text?.type === "text" ? text.text : "No results";
          } catch (e) { result = `Search failed: ${(e as Error).message}`; }

        } else if (block.name === "web_fetch") {
          const { url } = block.input as { url: string };
          await updateStep(`Fetching: ${url}`);
          try {
            const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SonicGapBot/1.0)" } });
            const html = await r.text();
            const links = [...html.matchAll(/href="([^"]*(?:collections|shoes|bags|swimwear|brand|jewell?ery)[^"]*)"/gi)]
              .map((m) => m[1])
              .filter((v, i, a) => a.indexOf(v) === i)
              .slice(0, 100);
            result = `Page links found:\n${links.join("\n")}`;
          } catch (e) { result = `Fetch failed: ${(e as Error).message}`; }

        } else if (block.name === "save_gap") {
          const input = block.input as any;
          const handle = String(input.suggested_handle || "").toLowerCase();
          if (!handle) {
            result = "Skipped — empty handle";
          } else if (existingHandles.has(handle)) {
            result = `Skipped — collection ${handle} already exists`;
          } else {
            const { error } = await admin.from("competitor_gaps").insert({
              user_id: userId,
              run_id: runId,
              competitor_name: input.competitor_name,
              competitor_url: input.competitor_url,
              gap_type: input.gap_type,
              brand: input.brand ?? null,
              suggested_handle: handle,
              suggested_title: input.suggested_title,
              smart_rule_column: input.smart_rule_column ?? null,
              smart_rule_relation: input.smart_rule_relation ?? null,
              smart_rule_condition: input.smart_rule_condition ?? null,
              competitor_framing: input.competitor_framing,
              expected_impact: input.expected_impact ?? "medium",
              status: "pending",
            });
            if (error) {
              result = `Save failed: ${error.message}`;
            } else {
              gapsFound++;
              existingHandles.add(handle);
              result = `Gap saved: ${input.suggested_title}`;
            }
          }

        } else if (block.name === "finish_analysis") {
          finished = true;
          result = "Analysis marked complete";
        }

        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }

      if (toolResults.length > 0) messages.push({ role: "user", content: toolResults });
    }

    await admin.from("gap_analysis_runs").update({
      status: "complete",
      completed_at: new Date().toISOString(),
      gaps_found: gapsFound,
      competitor_stores_checked: competitors.length,
      brands_checked: brands.length,
      current_step: `Complete — ${gapsFound} gaps found`,
    }).eq("id", runId);

    console.log(`[gap-agent] ${runId} complete: ${gapsFound} gaps, ${competitors.length} competitors`);
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
      .select("id, status")
      .eq("user_id", userId)
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1);
    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ run_id: existing[0].id, status: "already_running" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: run, error: runErr } = await admin
      .from("gap_analysis_runs")
      .insert({ user_id: userId, status: "running", current_step: "Queued" })
      .select("id")
      .single();
    if (runErr || !run) throw runErr || new Error("Could not create run");

    // @ts-ignore — Deno Deploy / Supabase Edge: EdgeRuntime exists at runtime
    (globalThis as any).EdgeRuntime?.waitUntil?.(runPipeline(userId, run.id))
      ?? runPipeline(userId, run.id);

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
