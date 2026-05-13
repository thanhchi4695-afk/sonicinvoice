// Brand Intelligence Crawler — researches a brand's official website using
// Firecrawl + AI to extract category vocabulary, collection structure,
// brand tone, blog topics, and SEO keywords. Stores in brand_intelligence.
import { createClient } from "npm:@supabase/supabase-js@2";
import { callAI, getContent } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const MAX_PAGES = 10;
const FETCH_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CrawlBody {
  brand_id?: string;
  brand_name: string;
  brand_domain?: string;
  industry_vertical?: string; // FOOTWEAR | SWIMWEAR | CLOTHING | ACCESSORIES | LIFESTYLE | MULTI | UNKNOWN
}

interface FirecrawlScrapeResult {
  success: boolean;
  data?: { markdown?: string; html?: string; links?: string[]; metadata?: Record<string, unknown> };
  error?: string;
}

async function firecrawlScrape(url: string, formats: string[] = ["markdown", "links"]): Promise<FirecrawlScrapeResult> {
  if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY not configured");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats, onlyMainContent: true }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, error: json?.error || `HTTP ${res.status}` };
  // v2 returns { success, data: {...} } or { success, ...fields }
  const data = json?.data ?? json;
  return { success: true, data };
}

function normaliseDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return d;
}

async function resolveDomain(brandName: string): Promise<string | null> {
  // Try a few common patterns first
  const slug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const candidates = [
    `${slug}.com.au`,
    `${slug}.com`,
    `${slug}swimwear.com.au`,
    `${slug}swim.com.au`,
  ];
  for (const c of candidates) {
    try {
      const res = await fetch(`https://${c}`, { method: "HEAD", redirect: "follow" });
      if (res.ok) return c;
    } catch { /* ignore */ }
    await sleep(200);
  }
  return null;
}

function extractCollectionUrls(links: string[], domain: string): string[] {
  const host = domain.replace(/^www\./, "");
  const seen = new Set<string>();
  for (const raw of links) {
    try {
      const u = new URL(raw);
      if (!u.hostname.endsWith(host)) continue;
      // Shopify-style collection paths + generic /shop /category patterns
      if (/\/(collections|shop|category|categories|department)\//i.test(u.pathname) &&
          !/\/(products|product)\//i.test(u.pathname)) {
        u.hash = "";
        u.search = "";
        seen.add(u.toString());
      }
    } catch { /* ignore */ }
  }
  return Array.from(seen).slice(0, 8);
}

function extractBlogUrls(links: string[], domain: string): string[] {
  const host = domain.replace(/^www\./, "");
  const seen = new Set<string>();
  for (const raw of links) {
    try {
      const u = new URL(raw);
      if (!u.hostname.endsWith(host)) continue;
      if (/\/(blogs|blog|journal|news|stories)(\/|$)/i.test(u.pathname)) {
        u.hash = ""; u.search = "";
        seen.add(u.toString());
      }
    } catch { /* ignore */ }
  }
  return Array.from(seen);
}

interface ExtractedIntelligence {
  category_vocabulary: Record<string, string>;
  collection_structure_type: string;
  collection_structure_secondary?: string;
  collection_nav_structure: Array<{ label: string; children?: string[] }>;
  subcategory_list: string[];
  print_story_names: string[];
  seo_primary_keyword: string;
  seo_secondary_keywords: string[];
  brand_tone: string;
  brand_tone_sample: string;
  blog_topics_used: string[];
  blog_topic_distribution?: Record<string, number>;
  blog_sample_titles: string[];
}

const VERTICAL_CONTEXT: Record<string, string> = {
  FOOTWEAR: "shoe categories (heels, sandals, boots, sneakers, loafers), heel height, toe shape, material, occasion, comfort technology, gender",
  SWIMWEAR: "garment type (one piece, bikini top, bikini bottom), silhouette, cup size, function (tummy control, mastectomy, chlorine resistant), print stories, gender",
  CLOTHING: "garment type (dress, top, pants), dress style (maxi, midi, mini), occasion, fit, fabric",
  ACCESSORIES: "accessory type (tote, crossbody, clutch, jewellery), material, occasion, size, closure",
  LIFESTYLE: "product type (candle, diffuser), scent family, size, occasion",
  MULTI: "multiple product categories — analyse the actual nav to determine dominant ones",
  UNKNOWN: "any retail category — infer from the nav titles",
};

const STRUCTURE_OPTIONS = '"silhouette" | "print_story" | "function" | "style_name" | "cup_size" | "technology" | "occasion" | "material" | "gender_age" | "mixed" | "unknown"';

async function aiExtract(brandName: string, vertical: string, navTitles: string[], blogTitles: string[], toneSample: string): Promise<ExtractedIntelligence> {
  const verticalContext = VERTICAL_CONTEXT[vertical] || VERTICAL_CONTEXT.UNKNOWN;
  const prompt = `You analyse retail brand websites for a universal retail intelligence system.

Brand: ${brandName}
Industry vertical: ${vertical} — typical dimensions: ${verticalContext}

Their navigation/collection page titles (extracted from their site):
${navTitles.map((t) => `- ${t}`).join("\n") || "(none extracted)"}

Their recent blog/journal titles:
${blogTitles.map((t) => `- ${t}`).join("\n") || "(none extracted)"}

Sample of their copy:
"""
${toneSample.slice(0, 1200)}
"""

Return STRICT JSON (no prose, no markdown fences) with this exact shape:
{
  "category_vocabulary": { "Their exact category name": "Generic equivalent appropriate for ${vertical}" },
  "collection_structure_type": ${STRUCTURE_OPTIONS},
  "collection_structure_secondary": ${STRUCTURE_OPTIONS},
  "collection_nav_structure": [{"label": "Top-level nav item", "children": ["sub-item 1", "sub-item 2"]}],
  "subcategory_list": ["..."],
  "print_story_names": ["..."],
  "seo_primary_keyword": "e.g. ${brandName} ${vertical.toLowerCase()} Australia",
  "seo_secondary_keywords": ["...", "..."],
  "brand_tone": "aspirational" | "edgy" | "functional" | "luxurious" | "inclusive" | "playful" | "technical" | "lifestyle" | "sustainable" | "unknown",
  "brand_tone_sample": "60-80 word excerpt of their voice",
  "blog_topics_used": ["styling-guide" | "fit-guide" | "sizing-guide" | "sustainability" | "care-guide" | "trend-report" | "brand-story" | "destination" | "occasion-guide" | "technology-explainer" | "other"],
  "blog_topic_distribution": {"sizing-guide": 2, "care-guide": 1},
  "blog_sample_titles": ["up to 5 of their actual titles"]
}

Identify the PRIMARY structure type (the dominant axis the brand uses to organise products) and a SECONDARY if they clearly use two axes. Pick from the listed options exactly.`;
  const resp = await callAI({
    model: "google/gemini-2.5-pro",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 2500,
  });
  let text = getContent(resp).trim();
  text = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(text);
}

function scoreConfidence(x: ExtractedIntelligence): number {
  let s = 0;
  if (x.category_vocabulary && Object.keys(x.category_vocabulary).length > 0) s += 0.25;
  if (x.collection_structure_type && x.collection_structure_type !== "unknown") s += 0.20;
  if (x.blog_topics_used?.length > 0) s += 0.20;
  if (x.brand_tone_sample && x.brand_tone_sample.length > 30) s += 0.20;
  if (x.print_story_names?.length > 0) s += 0.15;
  return Math.round(s * 100) / 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "FIRECRAWL_API_KEY not configured. Connect Firecrawl in Connectors." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth: need user_id
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401, headers: corsHeaders });
    }
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await supabaseUser.auth.getUser();
    const user = userData?.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Kill switch
    const { data: settings } = await supabase
      .from("app_settings")
      .select("brand_intelligence_enabled")
      .eq("singleton", true)
      .maybeSingle();
    if (settings && settings.brand_intelligence_enabled === false) {
      return new Response(JSON.stringify({ error: "Brand Intelligence is disabled in app settings." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as CrawlBody;
    if (!body.brand_name) {
      return new Response(JSON.stringify({ error: "brand_name required" }), { status: 400, headers: corsHeaders });
    }
    const vertical = (body.industry_vertical || "UNKNOWN").toUpperCase();

    const { data: existing } = await supabase
      .from("brand_intelligence")
      .select("id, brand_domain, industry_vertical")
      .eq("user_id", user.id)
      .eq("brand_name", body.brand_name)
      .maybeSingle();

    let recordId = existing?.id ?? body.brand_id ?? null;
    let domain = body.brand_domain ? normaliseDomain(body.brand_domain) : (existing?.brand_domain ?? null);

    if (!domain) {
      domain = await resolveDomain(body.brand_name);
    }
    if (!domain) {
      const errPayload = { user_id: user.id, brand_name: body.brand_name, industry_vertical: vertical, crawl_status: "failed", crawl_error: "Could not resolve domain", last_crawled_at: new Date().toISOString() };
      if (recordId) await supabase.from("brand_intelligence").update(errPayload).eq("id", recordId);
      else await supabase.from("brand_intelligence").insert(errPayload);
      return new Response(JSON.stringify({ error: "Could not resolve domain. Please provide brand_domain." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const startPayload = {
      user_id: user.id,
      brand_name: body.brand_name,
      brand_domain: domain,
      industry_vertical: vertical,
      crawl_status: "crawling",
      crawl_error: null,
    };
    if (recordId) {
      await supabase.from("brand_intelligence").update(startPayload).eq("id", recordId);
    } else {
      const { data: ins } = await supabase.from("brand_intelligence").insert(startPayload).select("id").single();
      recordId = ins?.id ?? null;
    }

    let pages = 0;
    const navTitles: string[] = [];
    const allCollectionUrls: string[] = [];
    const blogTitlesSet = new Set<string>();
    let toneSample = "";

    // Step 1: scrape homepage
    const home = await firecrawlScrape(`https://${domain}`, ["markdown", "links"]);
    pages++;
    if (!home.success || !home.data) {
      const err = `Homepage scrape failed: ${home.error || "unknown"}`;
      await supabase.from("brand_intelligence").update({
        crawl_status: "failed", crawl_error: err, pages_fetched: pages, last_crawled_at: new Date().toISOString(),
      }).eq("id", recordId!);
      return new Response(JSON.stringify({ error: err }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const homeMd = home.data.markdown ?? "";
    toneSample += homeMd.split("\n").filter((l) => l.trim().length > 60).slice(0, 4).join(" ");

    const links = home.data.links ?? [];
    const collectionUrls = extractCollectionUrls(links, domain);
    const blogIndexUrls = extractBlogUrls(links, domain);
    allCollectionUrls.push(...collectionUrls);

    // Step 2: scrape up to 6 collection pages for h1 titles
    const colPagesToFetch = collectionUrls.slice(0, 6);
    for (const url of colPagesToFetch) {
      if (pages >= MAX_PAGES) break;
      await sleep(FETCH_DELAY_MS);
      const r = await firecrawlScrape(url, ["markdown"]);
      pages++;
      if (!r.success || !r.data?.markdown) continue;
      const md = r.data.markdown;
      // Extract first H1 or the page title from metadata
      const h1Match = md.match(/^#\s+(.+)$/m);
      const title = h1Match?.[1]?.trim() || (r.data.metadata?.title as string | undefined) || "";
      if (title) navTitles.push(title);
      if (toneSample.length < 1500) {
        toneSample += " " + md.split("\n").filter((l) => l.trim().length > 60).slice(0, 2).join(" ");
      }
    }

    // Step 3: scrape blog index for titles
    if (blogIndexUrls.length > 0 && pages < MAX_PAGES) {
      await sleep(FETCH_DELAY_MS);
      const r = await firecrawlScrape(blogIndexUrls[0], ["markdown"]);
      pages++;
      if (r.success && r.data?.markdown) {
        const md = r.data.markdown;
        // Pull markdown headings as candidate blog titles
        const headings = Array.from(md.matchAll(/^#{1,3}\s+(.+)$/gm)).map((m) => m[1].trim());
        for (const h of headings) {
          if (h.length > 8 && h.length < 140 && !/cookie|subscribe|newsletter|menu/i.test(h)) {
            blogTitlesSet.add(h);
          }
          if (blogTitlesSet.size >= 10) break;
        }
      }
    }

    // Step 4: AI synthesis
    let extracted: ExtractedIntelligence;
    try {
      extracted = await aiExtract(body.brand_name, navTitles, Array.from(blogTitlesSet), toneSample);
    } catch (e) {
      const err = `AI extraction failed: ${e instanceof Error ? e.message : String(e)}`;
      await supabase.from("brand_intelligence").update({
        crawl_status: "failed", crawl_error: err, pages_fetched: pages, last_crawled_at: new Date().toISOString(),
      }).eq("id", recordId!);
      return new Response(JSON.stringify({ error: err }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const confidence = scoreConfidence(extracted);
    await supabase.from("brand_intelligence").update({
      brand_domain: domain,
      collection_nav_urls: allCollectionUrls,
      category_vocabulary: extracted.category_vocabulary || {},
      collection_structure_type: extracted.collection_structure_type || "unknown",
      subcategory_list: extracted.subcategory_list || [],
      print_story_names: extracted.print_story_names || [],
      seo_primary_keyword: extracted.seo_primary_keyword || null,
      seo_secondary_keywords: extracted.seo_secondary_keywords || [],
      brand_tone: extracted.brand_tone || "unknown",
      brand_tone_sample: extracted.brand_tone_sample || toneSample.slice(0, 500),
      blog_topics_used: extracted.blog_topics_used || [],
      blog_sample_titles: extracted.blog_sample_titles || Array.from(blogTitlesSet).slice(0, 5),
      crawl_confidence: confidence,
      crawl_status: "crawled",
      crawl_error: null,
      pages_fetched: pages,
      last_crawled_at: new Date().toISOString(),
    }).eq("id", recordId!);

    return new Response(JSON.stringify({
      success: true,
      brand_id: recordId,
      domain,
      pages_fetched: pages,
      confidence,
      extracted,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("brand-intelligence-crawler error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
