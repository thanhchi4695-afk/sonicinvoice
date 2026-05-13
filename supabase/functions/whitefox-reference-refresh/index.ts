// Whitefox reference refresh — scrapes whitefoxboutique.com.au for nested
// collection structure, opening copy, sub-types, and trend vocabulary.
// Mirrors iconic-brand-refresh but targets the White Fox single-brand DTC
// reference (used for CLOTHING / SWIMWEAR voice training).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

// Pages to inspect for the reference set. Kept small to stay under credit budget.
const WHITEFOX_PAGES = [
  "https://www.whitefoxboutique.com/collections/dresses",
  "https://www.whitefoxboutique.com/collections/tops",
  "https://www.whitefoxboutique.com/collections/sets",
  "https://www.whitefoxboutique.com/collections/swim",
];

function buildDiff(oldRef: any, newRef: any) {
  const changes: string[] = [];
  if (!oldRef && !newRef) return { hasChanges: false, changes: ["No data found on White Fox."] };
  if (!oldRef && newRef) return { hasChanges: true, changes: ["First White Fox reference captured."] };
  const oldPages = (oldRef?.pages ?? []).length;
  const newPages = (newRef?.pages ?? []).length;
  if (oldPages !== newPages) changes.push(`Pages: ${oldPages} → ${newPages}`);
  const oldNested = (oldRef?.nested_handles ?? []).length;
  const newNested = (newRef?.nested_handles ?? []).length;
  if (oldNested !== newNested) changes.push(`Nested collections: ${oldNested} → ${newNested}`);
  const oldTrends = (oldRef?.trend_vocabulary ?? []).join(",");
  const newTrends = (newRef?.trend_vocabulary ?? []).join(",");
  if (oldTrends !== newTrends) changes.push("Trend vocabulary updated.");
  const oldOpening = oldRef?.pages?.[0]?.opening_copy?.slice(0, 60) ?? "";
  const newOpening = newRef?.pages?.[0]?.opening_copy?.slice(0, 60) ?? "";
  if (oldOpening !== newOpening) changes.push("Opening copy refreshed.");
  return { hasChanges: changes.length > 0, changes: changes.length ? changes : ["White Fox unchanged since last crawl."] };
}

const TREND_WORDS = [
  "y2k","balletcore","coquette","westerncore","coastal","quiet luxury","old money",
  "festival","resort","mob wife","grunge","preppy","minimalist","cottagecore",
];

async function scrapePage(url: string) {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown", "links"], onlyMainContent: true }),
  });
  const j = await res.json().catch(() => ({ success: false }));
  if (!j.success || !j.data?.markdown) return null;

  const md: string = j.data.markdown;
  const links: string[] = j.data.links ?? [];

  const h1 = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
  const opening = md
    .replace(/[#*_>`]/g, "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30)
    .slice(0, 2)
    .join(" ")
    .slice(0, 600);

  const nested = links
    .filter((u) => /whitefoxboutique\.com\/collections\//i.test(u))
    .filter((u) => u.split("/collections/")[1]?.split("/").filter(Boolean).length >= 2)
    .map((u) => u.split("?")[0].split("#")[0])
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 30);

  const subTypes = links
    .filter((u) => /whitefoxboutique\.com\/collections\//i.test(u))
    .map((u) => u.split("/collections/")[1]?.split("/")[0])
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 20) as string[];

  return { url, h1, opening_copy: opening, nested_handles: nested, sub_types: subTypes, fetched_at: new Date().toISOString() };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const brandId = body.brand_id;
    if (!brandId) {
      return new Response(JSON.stringify({ error: "brand_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "FIRECRAWL_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row } = await supabase
      .from("brand_intelligence")
      .select("brand_name,industry_vertical,whitefox_reference")
      .eq("id", brandId)
      .single();
    if (!row) {
      return new Response(JSON.stringify({ error: "Brand not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pages: any[] = [];
    for (const url of WHITEFOX_PAGES) {
      const p = await scrapePage(url);
      if (p) pages.push(p);
      await new Promise((r) => setTimeout(r, 500));
    }

    const allMd = pages.map((p) => `${p.h1 ?? ""} ${p.opening_copy ?? ""}`).join(" ").toLowerCase();
    const trendVocab = TREND_WORDS.filter((t) => allMd.includes(t));
    const allNested = Array.from(new Set(pages.flatMap((p) => p.nested_handles ?? []))).slice(0, 80);
    const allSubTypes = Array.from(new Set(pages.flatMap((p) => p.sub_types ?? []))).slice(0, 40);

    const newRef = pages.length
      ? { pages, nested_handles: allNested, sub_types: allSubTypes, trend_vocabulary: trendVocab, captured_at: new Date().toISOString() }
      : null;

    const { error } = await supabase.from("brand_intelligence").update({ whitefox_reference: newRef }).eq("id", brandId);
    if (error) throw error;

    const diff = buildDiff(row.whitefox_reference, newRef);
    return new Response(JSON.stringify({
      success: true,
      brand_id: brandId,
      brand_name: row.brand_name,
      hasChanges: diff.hasChanges,
      changes: diff.changes,
      pages_scraped: pages.length,
      whitefox_reference: newRef,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
