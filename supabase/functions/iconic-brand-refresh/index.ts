import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const FETCH_DELAY_MS = 800;

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function buildDiff(oldRef: any, newRef: any) {
  const changes: string[] = [];
  if (!oldRef && !newRef) return { hasChanges: false, changes: ["No data found on ICONIC."] };
  if (!oldRef && newRef) return { hasChanges: true, changes: ["First ICONIC reference captured."] };
  if (oldRef?.h1 !== newRef?.h1) changes.push(`H1 changed: "${oldRef?.h1 ?? "∅"}" → "${newRef?.h1 ?? "∅"}"`);
  const oldOpening = oldRef?.opening_copy?.slice(0, 60) ?? "";
  const newOpening = newRef?.opening_copy?.slice(0, 60) ?? "";
  if (oldOpening !== newOpening) changes.push("Opening copy updated.");
  const oldSubs = (oldRef?.sub_collection_links ?? []).length;
  const newSubs = (newRef?.sub_collection_links ?? []).length;
  if (oldSubs !== newSubs) changes.push(`Sub-collections: ${oldSubs} → ${newSubs}`);
  const oldFaq = (oldRef?.faq_pairs ?? []).length;
  const newFaq = (newRef?.faq_pairs ?? []).length;
  if (oldFaq !== newFaq) changes.push(`FAQ pairs: ${oldFaq} → ${newFaq}`);
  const oldPhrases = (oldRef?.top_phrases ?? []).map((p: any) => p.phrase).join(",");
  const newPhrases = (newRef?.top_phrases ?? []).map((p: any) => p.phrase).join(",");
  if (oldPhrases !== newPhrases) changes.push("Top phrases refreshed.");
  return { hasChanges: changes.length > 0, changes: changes.length ? changes : ["ICONIC page unchanged since last crawl."] };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const brandId = body.brand_id;
    if (!brandId) return new Response(JSON.stringify({ error: "brand_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row } = await supabase.from("brand_intelligence").select("brand_name,industry_vertical,iconic_reference").eq("id", brandId).single();
    if (!row) return new Response(JSON.stringify({ error: "Brand not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (row.industry_vertical !== "FOOTWEAR") {
      return new Response(JSON.stringify({ error: "ICONIC reference only runs for FOOTWEAR vertical" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!FIRECRAWL_API_KEY) {
      return new Response(JSON.stringify({ error: "FIRECRAWL_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const slug = row.brand_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const icUrl = `https://www.theiconic.com.au/${slug}/`;

    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: icUrl, formats: ["markdown", "links", "html"] }),
    });
    const ic = await res.json().catch(() => ({ success: false }));

    let iconicRef: any = null;
    if (ic.success && ic.data?.markdown) {
      const md: string = ic.data.markdown;
      const h1Match = md.match(/^#\s+(.+)$/m);
      const h1 = h1Match ? h1Match[1].trim() : null;
      const sentences = md.replace(/[#*_>`]/g, "").split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
      const opening = sentences.slice(0, 2).join(" ").slice(0, 600);
      const subCollectionLinks = (ic.data.links ?? [])
        .filter((u: string) => /theiconic\.com\.au\//i.test(u) && !/[?#]/.test(u))
        .filter((u: string) => u.split("/").filter(Boolean).length >= 4)
        .slice(0, 30);
      const faqPairs: Array<{ q: string; a: string }> = [];
      const qaRe = /(?:^|\n)#{2,4}\s+([^\n?]+\?)\s*\n+([\s\S]+?)(?=\n#{2,4}\s|\n\n#{1,4}\s|$)/g;
      let m: RegExpExecArray | null;
      while ((m = qaRe.exec(md)) && faqPairs.length < 8) {
        const a = m[2].split("\n\n")[0].trim();
        if (a.length > 20) faqPairs.push({ q: m[1].trim(), a: a.slice(0, 400) });
      }
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

    await sleep(300);
    const { error } = await supabase.from("brand_intelligence").update({ iconic_reference: iconicRef }).eq("id", brandId);
    if (error) throw error;

    const diff = buildDiff(row.iconic_reference, iconicRef);
    return new Response(JSON.stringify({
      success: true,
      brand_id: brandId,
      brand_name: row.brand_name,
      hasChanges: diff.hasChanges,
      changes: diff.changes,
      iconic_reference: iconicRef,
      captured_at: iconicRef?.captured_at,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});