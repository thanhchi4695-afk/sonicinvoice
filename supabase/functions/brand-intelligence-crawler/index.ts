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
  // New spec fields
  size_range?: string;
  key_fabric_technologies?: string[];
  price_range_aud?: { min?: number; max?: number };
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
  "blog_sample_titles": ["up to 5 of their actual titles"],
  "size_range": "e.g. XS-3XL or 6-20 — leave empty string if not detected",
  "key_fabric_technologies": ["e.g. chlorine-resistant", "4-way stretch", "recycled-nylon"],
  "price_range_aud": { "min": 0, "max": 0 }
}

Identify the PRIMARY structure type (the dominant axis the brand uses to organise products) and a SECONDARY if they clearly use two axes. Pick from the listed options exactly. For price_range_aud, infer typical price points in AUD from any prices visible in the copy; use 0,0 if none visible.`;
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
  // Spec formula: vocab>3 +0.3 · structure identified +0.2 · blog>2 +0.2 · tone +0.2 · prints>1 +0.1
  let s = 0;
  const vocabCount = x.category_vocabulary ? Object.keys(x.category_vocabulary).length : 0;
  if (vocabCount > 3) s += 0.3;
  if (x.collection_structure_type && x.collection_structure_type !== "unknown") s += 0.2;
  if ((x.blog_topics_used?.length ?? 0) > 2) s += 0.2;
  if (x.brand_tone_sample && x.brand_tone_sample.trim().length > 0) s += 0.2;
  if ((x.print_story_names?.length ?? 0) > 1) s += 0.1;
  return Math.round(s * 100) / 100;
}

function confidenceBreakdown(x: ExtractedIntelligence) {
  const vocabCount = x.category_vocabulary ? Object.keys(x.category_vocabulary).length : 0;
  return {
    category_vocabulary: { passed: vocabCount > 3, weight: 0.3, detail: `${vocabCount} entries` },
    collection_structure_type: { passed: !!x.collection_structure_type && x.collection_structure_type !== "unknown", weight: 0.2, detail: x.collection_structure_type || "unknown" },
    detected_blog_topics: { passed: (x.blog_topics_used?.length ?? 0) > 2, weight: 0.2, detail: `${x.blog_topics_used?.length ?? 0} topics` },
    brand_tone_sample: { passed: !!x.brand_tone_sample && x.brand_tone_sample.trim().length > 0, weight: 0.2, detail: x.brand_tone_sample ? `${x.brand_tone_sample.length} chars` : "empty" },
    detected_print_story_names: { passed: (x.print_story_names?.length ?? 0) > 1, weight: 0.1, detail: `${x.print_story_names?.length ?? 0} names` },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "FIRECRAWL_API_KEY not configured. Connect Firecrawl in Connectors." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth: user JWT, OR service-role bearer + body.user_id (for queue runner / cron)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401, headers: corsHeaders });
    }
    const rawBody = await req.json().catch(() => ({})) as CrawlBody & { user_id?: string };
    const serviceBearer = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
    let user: { id: string } | null = null;
    if (authHeader === serviceBearer && typeof rawBody.user_id === "string") {
      user = { id: rawBody.user_id };
    } else {
      const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await supabaseUser.auth.getUser();
      user = userData?.user ?? null;
    }
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

    const body = rawBody;
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
      extracted = await aiExtract(body.brand_name, vertical, navTitles, Array.from(blogTitlesSet), toneSample);
    } catch (e) {
      const err = `AI extraction failed: ${e instanceof Error ? e.message : String(e)}`;
      await supabase.from("brand_intelligence").update({
        crawl_status: "failed", crawl_error: err, pages_fetched: pages, last_crawled_at: new Date().toISOString(),
      }).eq("id", recordId!);
      return new Response(JSON.stringify({ error: err }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Coerce brand_tone to existing CHECK-constraint allow-list
    const ALLOWED_TONES = new Set(["aspirational","edgy","functional","luxurious","inclusive","playful","unknown"]);
    const TONE_FALLBACK: Record<string, string> = { technical: "functional", lifestyle: "aspirational", sustainable: "functional" };
    const rawTone = (extracted.brand_tone || "unknown").toLowerCase();
    const safeTone = ALLOWED_TONES.has(rawTone) ? rawTone : (TONE_FALLBACK[rawTone] || "unknown");

    // Build blog_topic_distribution from titles if AI didn't provide it
    let topicDist = extracted.blog_topic_distribution;
    if (!topicDist || Object.keys(topicDist).length === 0) {
      topicDist = (extracted.blog_topics_used ?? []).reduce<Record<string, number>>((acc, t) => {
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {});
    }

    // Step 7B: Styletread competitor reference (FOOTWEAR only) — pulls how
    // Australia's leading footwear retailer categorises this brand so the
    // SEO engine can mirror their proven taxonomy without plagiarising copy.
    let styletreadRef: any = null;
    if (vertical === "FOOTWEAR") {
      try {
        const slug = body.brand_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const stUrl = `https://www.styletread.com.au/brands/${slug}`;
        await sleep(FETCH_DELAY_MS);
        const st = await firecrawlScrape(stUrl, ["markdown", "links"]);
        pages++;
        if (st.success && st.data?.markdown) {
          const md = st.data.markdown;
          const headings = Array.from(md.matchAll(/^#{1,3}\s+(.+)$/gm)).map((m) => m[1].trim()).slice(0, 30);
          const refineLinks = (st.data.links ?? [])
            .filter((u) => /styletread\.com\.au\/(brands|collections|categories)\//i.test(u))
            .slice(0, 40);
          styletreadRef = {
            source_url: stUrl,
            page_headings: headings,
            refine_facets: refineLinks,
            captured_at: new Date().toISOString(),
          };
        }
      } catch (e) {
        console.warn("styletread reference fetch failed", e);
      }
    }

    // Step 7C: THE ICONIC reference (FOOTWEAR only) — scrape the brand's
    // ICONIC landing page to capture H1, opening copy, sub-collection links,
    // FAQ Q&A pairs, and top phrases. Mirrors Australia's #1 fashion site
    // taxonomy without copying their wording.
    let iconicRef: any = null;
    if (vertical === "FOOTWEAR") {
      try {
        const slug = body.brand_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const icUrl = `https://www.theiconic.com.au/${slug}/`;
        await sleep(FETCH_DELAY_MS);
        const ic = await firecrawlScrape(icUrl, ["markdown", "links", "html"]);
        pages++;
        if (ic.success && ic.data?.markdown) {
          const md: string = ic.data.markdown;
          const html: string = (ic.data as any).html ?? "";
          const h1Match = md.match(/^#\s+(.+)$/m);
          const h1 = h1Match ? h1Match[1].trim() : null;
          const sentences = md.replace(/[#*_>`]/g, "").split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
          const opening = sentences.slice(0, 2).join(" ").slice(0, 600);
          const subCollectionLinks = (ic.data.links ?? [])
            .filter((u) => /theiconic\.com\.au\//i.test(u) && !/[?#]/.test(u))
            .filter((u) => u.split("/").filter(Boolean).length >= 4)
            .slice(0, 30);
          // FAQ extraction: try common patterns "Q: ... A: ..." or H3 + paragraph
          const faqPairs: Array<{ q: string; a: string }> = [];
          const qaRe = /(?:^|\n)#{2,4}\s+([^\n?]+\?)\s*\n+([\s\S]+?)(?=\n#{2,4}\s|\n\n#{1,4}\s|$)/g;
          let m: RegExpExecArray | null;
          while ((m = qaRe.exec(md)) && faqPairs.length < 8) {
            const a = m[2].split("\n\n")[0].trim();
            if (a.length > 20) faqPairs.push({ q: m[1].trim(), a: a.slice(0, 400) });
          }
          // Top phrases: 2-3 word noun-ish phrases by frequency
          const stop = new Set(["the","and","for","with","from","that","this","your","you","our","are","was","has","have","not","but","all","new","now","get","off","more","shop","womens","mens","women","men"]);
          const tokens = md.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
          const bigrams: Record<string, number> = {};
          for (let i = 0; i < tokens.length - 1; i++) {
            const a = tokens[i], b = tokens[i + 1];
            if (stop.has(a) || stop.has(b)) continue;
            const k = `${a} ${b}`;
            bigrams[k] = (bigrams[k] || 0) + 1;
          }
          const topPhrases = Object.entries(bigrams).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([p, n]) => ({ phrase: p, count: n }));

          iconicRef = {
            source_url: icUrl,
            h1,
            opening_copy: opening,
            sub_collection_links: subCollectionLinks,
            faq_pairs: faqPairs,
            top_phrases: topPhrases,
            captured_at: new Date().toISOString(),
          };
        }
      } catch (e) {
        console.warn("iconic reference fetch failed", e);
      }
    }

    // Step 7D: White Fox reference (CLOTHING / SWIMWEAR) — captures nested
    // collection structure, opening copy patterns, sub-types, and trend
    // vocabulary from whitefoxboutique.com (Australia's leading single-brand
    // DTC fashion site). Used to train voice and nested-handle generation.
    let whitefoxRef: any = null;
    if (vertical === "CLOTHING" || vertical === "SWIMWEAR") {
      try {
        const wfPages = [
          "https://www.whitefoxboutique.com/collections/dresses",
          "https://www.whitefoxboutique.com/collections/tops",
          "https://www.whitefoxboutique.com/collections/sets",
        ];
        const captured: any[] = [];
        const TREND_WORDS = ["y2k","balletcore","coquette","westerncore","coastal","quiet luxury","old money","festival","resort","mob wife","grunge","preppy","minimalist","cottagecore"];
        for (const url of wfPages) {
          await sleep(FETCH_DELAY_MS);
          const wf = await firecrawlScrape(url, ["markdown", "links"]);
          pages++;
          if (!wf.success || !wf.data?.markdown) continue;
          const md: string = wf.data.markdown;
          const links: string[] = wf.data.links ?? [];
          const h1 = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
          const opening = md.replace(/[#*_>`]/g, "").split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 30).slice(0, 2).join(" ").slice(0, 600);
          const nested = links
            .filter((u) => /whitefoxboutique\.com\/collections\//i.test(u))
            .filter((u) => u.split("/collections/")[1]?.split("/").filter(Boolean).length >= 2)
            .map((u) => u.split("?")[0].split("#")[0])
            .filter((v, i, a) => a.indexOf(v) === i)
            .slice(0, 30);
          captured.push({ url, h1, opening_copy: opening, nested_handles: nested });
        }
        if (captured.length) {
          const allMd = captured.map(p => `${p.h1 ?? ""} ${p.opening_copy ?? ""}`).join(" ").toLowerCase();
          const trendVocab = TREND_WORDS.filter(t => allMd.includes(t));
          const allNested = Array.from(new Set(captured.flatMap(p => p.nested_handles))).slice(0, 80);
          whitefoxRef = { pages: captured, nested_handles: allNested, trend_vocabulary: trendVocab, captured_at: new Date().toISOString() };
        }
      } catch (e) {
        console.warn("whitefox reference fetch failed", e);
      }
    }

    const confidence = scoreConfidence(extracted);
    await supabase.from("brand_intelligence").update({
      competitor_reference_styletread: styletreadRef,
      iconic_reference: iconicRef,
      whitefox_reference: whitefoxRef,
      brand_domain: domain,
      industry_vertical: vertical,
      collection_nav_urls: allCollectionUrls,
      collection_nav_structure: extracted.collection_nav_structure || [],
      category_vocabulary: extracted.category_vocabulary || {},
      collection_structure_type: extracted.collection_structure_type || "unknown",
      collection_structure_secondary: extracted.collection_structure_secondary || null,
      subcategory_list: extracted.subcategory_list || [],
      print_story_names: extracted.print_story_names || [],
      seo_primary_keyword: extracted.seo_primary_keyword || null,
      seo_secondary_keywords: extracted.seo_secondary_keywords || [],
      brand_tone: safeTone,
      brand_tone_sample: extracted.brand_tone_sample || toneSample.slice(0, 500),
      blog_topics_used: extracted.blog_topics_used || [],
      blog_topic_distribution: topicDist,
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
