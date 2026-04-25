// Agent 3 — Enrichment Agent
// Fired in the background after Phase 2 writes products to the DB.
// For each product, runs description + image search + websearch price lookup
// in parallel, with a 25 s per-task timeout. Never blocks the user.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ReqBody {
  user_id: string;
  product_ids: string[];
  run_id?: string | null;
}

const TASK_TIMEOUT_MS = 25_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); })
     .catch(e => { clearTimeout(t); reject(e); });
  });
}

function deriveProductType(title: string): string {
  const t = (title || "").toLowerCase();
  if (t.includes("one piece") || t.includes("onepiece") || t.includes("maillot") || t.includes("swimsuit")) return "One Piece Swimwear";
  if (t.includes("bikini top") || t.includes("bralette") || t.includes("bandeau")) return "Bikini Top";
  if (t.includes("bikini bottom") || t.includes("brief") || t.includes("hipster") || t.includes("boyleg")) return "Bikini Bottom";
  if (t.includes("rash") || t.includes("rashie")) return "Rash Guard";
  if (t.includes("boardshort") || t.includes("trunk")) return "Boardshorts";
  if (t.includes("tankini")) return "Tankini";
  if (t.includes("wetsuit")) return "Wetsuit";
  if (t.includes("dress")) return "Dress";
  if (t.includes("top")) return "Top";
  if (t.includes("short")) return "Shorts";
  return "Swimwear";
}

function simplifyTitle(title: string): string {
  return (title || "")
    .replace(/\b(1Pc|2Pc|3Pc|1PC|2PC|3PC|One Piece|OnePiece)\b/gi, "")
    .replace(/\b(Classic|Classics|Heritage|Premium|Essential|Original|Iconic|Signature)\b/gi, "")
    .replace(/\s+[A-Z]{2,3}$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getAuDomain(vendor: string | null | undefined): string | null {
  const domains: Record<string, string> = {
    "seafolly": "seafolly.com.au",
    "baku": "bakuswimwear.com.au",
    "sea level": "sealevelswimwear.com.au",
    "sunseeker": "sunseekerbathers.com.au",
    "jantzen": "jantzen.com.au",
    "speedo": "speedo.com.au",
    "funkita": "funkita.com.au",
    "tigerlily": "tigerlilyswimwear.com.au",
    "kulani kinis": "kulanikinis.com",
    "bond eye": "bond-eyeswim.com",
    "sunnylife": "sunnylife.com.au",
    "billabong": "billabong.com/en-au",
    "rip curl": "ripcurl.com.au",
  };
  const key = (vendor || "").toLowerCase().trim();
  return domains[key] || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let body: ReqBody;
  try { body = await req.json(); } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const { user_id, product_ids: rawIds, run_id } = body;
  if (!user_id || !Array.isArray(rawIds) || rawIds.length === 0) {
    return json({ error: "user_id and product_ids[] required" }, 400);
  }
  // Deduplicate product_ids before loading — caller may send duplicates
  const product_ids = Array.from(new Set(rawIds.filter(Boolean)));
  console.log("[auto-enrich] received", rawIds.length, "ids,", product_ids.length, "unique");

  // Load products + a representative variant per product so we can pass
  // colour/SKU/style hints into websearch.
  const { data: products, error: prodErr } = await admin
    .from("products")
    .select("id, title, vendor, description, image_url, variants(id, sku, color, retail_price)")
    .eq("user_id", user_id)
    .in("id", product_ids);

  if (prodErr) return json({ error: `load products: ${prodErr.message}` }, 500);
  if (!products || products.length === 0) return json({ enriched: 0 });

  let descriptionsFound = 0;
  let imagesFound = 0;
  let pricesFound = 0;
  const errors: Array<{ product_id: string; task: string; message: string }> = [];

  await Promise.all(products.map(async (p: any) => {
    const productType = deriveProductType(p.title || "");
    const updates: Record<string, any> = {};
    const sources: string[] = [];
    const firstVariant = Array.isArray(p.variants) ? p.variants[0] : null;

    // Task A — description (requires non-empty title + brand; the function 400s otherwise)
    const descTitle = (p.title || "").trim();
    const descBrand = (p.vendor || "").trim();
    console.log("[auto-enrich] processing product:", p.id, "title:", descTitle, "brand:", descBrand, "has_existing_desc:", !!p.description);

    async function callFetchDesc(styleName: string) {
      return await withTimeout(fetch(`${supabaseUrl}/functions/v1/fetch-product-description`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          style_name: styleName,
          brand: descBrand,
          style_number: firstVariant?.sku || undefined,
          product_type: productType,
        }),
      }).then(async res => {
        const txt = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
        try { return JSON.parse(txt); } catch { return null; }
      }), TASK_TIMEOUT_MS, "fetch-product-description");
    }

    if (!p.description && descTitle && descBrand) {
      try {
        console.log("[enrich] fetching desc for:", descTitle, "|", descBrand, "| id:", p.id);
        let r = await callFetchDesc(descTitle);

        // Fallback: retry with a simplified title if the first attempt returned nothing usable
        if (!(r?.description && typeof r.description === "string" && r.description.trim().length > 20)) {
          const simple = simplifyTitle(descTitle);
          if (simple && simple.toLowerCase() !== descTitle.toLowerCase()) {
            console.log("[enrich] retry with simplified title:", simple, "| id:", p.id);
            try {
              const r2 = await callFetchDesc(simple);
              if (r2?.description && typeof r2.description === "string" && r2.description.trim().length > 20) {
                r = r2;
              }
            } catch (e2) {
              console.warn("[auto-enrich] simplified-title retry failed:", String((e2 as Error).message));
            }
          }
        }

        if (r?.description && typeof r.description === "string" && r.description.trim().length > 20) {
          updates.description = r.description;
          sources.push("gemini-description");
          descriptionsFound++;
          console.log("[auto-enrich] description FOUND for:", p.id, "length:", r.description.length, "source:", r.source_url || "unknown");
        } else {
          console.log("[auto-enrich] description NOT FOUND for:", p.id, "raw response:", JSON.stringify(r)?.slice(0, 200));
        }
      } catch (e) {
        console.warn("[auto-enrich] description error for:", p.id, String((e as Error).message));
        errors.push({ product_id: p.id, task: "description", message: String((e as Error).message) });
      }
    }

    // Task B — websearch enrichment (price + image + description fallback)
    try {
      const r = await withTimeout(fetch(`${supabaseUrl}/functions/v1/enrich-via-websearch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          "X-User-Id": user_id,
        },
        body: JSON.stringify({
          brand_name: p.vendor || "",
          product_name: p.title || "",
          colour: firstVariant?.color || undefined,
          product_code: firstVariant?.sku || undefined,
          preferred_domain: getAuDomain(p.vendor) || undefined,
        }),
      }).then(async res => {
        const txt = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
        try { return JSON.parse(txt); } catch { return null; }
      }), TASK_TIMEOUT_MS, "enrich-via-websearch");

      if (r?.found) {
        // Fill in missing description from websearch if Gemini didn't supply one
        if (!updates.description && !p.description && typeof r.description === "string" && r.description.trim().length > 20) {
          updates.description = r.description;
          sources.push("websearch-description");
          descriptionsFound++;
        }
        // Fill in missing image
        if (!p.image_url && typeof r.image_url === "string" && r.image_url.startsWith("http")) {
          updates.image_url = r.image_url;
          sources.push("websearch-image");
          imagesFound++;
        }
        // Update variant retail_price ONLY when current price is missing/zero
        if (firstVariant?.id && typeof r.price === "number" && r.price > 0) {
          const currentPrice = Number(firstVariant.retail_price) || 0;
          if (currentPrice <= 0) {
            const { error: vErr } = await admin
              .from("variants")
              .update({
                retail_price: r.price,
                updated_at: new Date().toISOString(),
              })
              .eq("id", firstVariant.id)
              .eq("user_id", user_id);
            if (!vErr) {
              pricesFound++;
              sources.push("websearch-price");
            }
          }
        }
      }
    } catch (e) {
      errors.push({ product_id: p.id, task: "websearch", message: String((e as Error).message) });
    }

    // Task C — image search (only if websearch didn't supply one)
    if (!p.image_url && !updates.image_url) {
      try {
        // Simpler category-based query — full product titles rarely index in image search
        const t = (p.title || "").toLowerCase();
        let category = "swimwear";
        if (t.includes("one piece") || t.includes("maillot") || t.includes("swimsuit")) category = "one piece swimwear";
        else if (t.includes("bikini top") || t.includes("bralette") || t.includes("bandeau")) category = "bikini top";
        else if (t.includes("bikini bottom") || t.includes("brief") || t.includes("boyleg") || t.includes("hipster")) category = "bikini bottom";
        else if (t.includes("boardshort") || t.includes("trunk")) category = "boardshorts";
        else if (t.includes("rashie") || t.includes("rash guard") || t.includes("rash")) category = "rash guard";
        else if (t.includes("tankini")) category = "tankini";
        const searchQuery = `${p.vendor || ""} ${category}`.trim().replace(/\s+/g, " ");
        console.log("[auto-enrich] image-search query for:", p.id, "→", searchQuery);

        const r = await withTimeout(fetch(`${supabaseUrl}/functions/v1/image-search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            products: [{
              brand: p.vendor || "",
              styleName: p.title || "",
              styleNumber: firstVariant?.sku || "",
              colour: firstVariant?.color || "",
              searchQuery,
            }],
          }),
        }).then(async res => {
          const txt = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
          try { return JSON.parse(txt); } catch { return null; }
        }), TASK_TIMEOUT_MS, "image-search");

        const url = r?.results?.[0]?.imageUrl;
        if (url && typeof url === "string" && url.startsWith("http")) {
          updates.image_url = url;
          sources.push("image-search");
          imagesFound++;
          console.log("[auto-enrich] image FOUND for:", p.id, "→", url.slice(0, 100));
        } else {
          console.log("[auto-enrich] image NOT FOUND for:", p.id, "results count:", r?.results?.length || 0);
        }
      } catch (e) {
        console.warn("[auto-enrich] image error for:", p.id, String((e as Error).message));
        errors.push({ product_id: p.id, task: "image", message: String((e as Error).message) });
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      updates.enriched_at = new Date().toISOString();
      updates.enrichment_source = sources.join(",");
      console.log("[auto-enrich] saving updates for:", p.id, p.title, "fields:", Object.keys(updates).join(","), "desc_len:", updates.description?.length || 0);
      const { error: upErr } = await admin
        .from("products")
        .update(updates)
        .eq("id", p.id)
        .eq("user_id", user_id);
      if (upErr) {
        console.warn("[auto-enrich] DB update FAILED for:", p.id, upErr.message);
        errors.push({ product_id: p.id, task: "update", message: upErr.message });
      } else {
        console.log("[auto-enrich] DB update OK for:", p.id);
      }
    } else {
      console.log("[auto-enrich] nothing to save for:", p.id, "(no enrichment data found)");
    }
  }));

  console.log("[auto-enrich] all products processed. descriptions:", descriptionsFound, "images:", imagesFound, "prices:", pricesFound, "errors:", errors.length);

  if (run_id) {
    const { error: runErr } = await admin.from("agent_runs").update({
      enrichment_complete: true,
      enrichment_completed_at: new Date().toISOString(),
    }).eq("id", run_id).eq("user_id", user_id);
    if (runErr) {
      console.warn("[auto-enrich] enrichment_complete update failed:", runErr.message);
    } else {
      console.log("[auto-enrich] enrichment_complete=true set for run:", run_id);
    }
  } else {
    console.log("[auto-enrich] no run_id provided — skipping agent_runs update");
  }

  return json({
    enriched: products.length,
    descriptions_found: descriptionsFound,
    images_found: imagesFound,
    prices_found: pricesFound,
    errors,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
