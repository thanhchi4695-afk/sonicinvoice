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
  const { user_id, product_ids, run_id } = body;
  if (!user_id || !Array.isArray(product_ids) || product_ids.length === 0) {
    return json({ error: "user_id and product_ids[] required" }, 400);
  }

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

    // Task A — description
    if (!p.description) {
      try {
        const r = await withTimeout(fetch(`${supabaseUrl}/functions/v1/fetch-product-description`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            style_name: p.title,
            brand: p.vendor || "",
            product_type: productType,
          }),
        }).then(async res => {
          const txt = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
          try { return JSON.parse(txt); } catch { return null; }
        }), TASK_TIMEOUT_MS, "fetch-product-description");

        if (r?.description && typeof r.description === "string" && r.description.trim().length > 20) {
          updates.description = r.description;
          sources.push("gemini-description");
          descriptionsFound++;
        }
      } catch (e) {
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
              searchQuery: `${p.vendor || ""} ${p.title || ""}`.trim(),
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
        }
      } catch (e) {
        errors.push({ product_id: p.id, task: "image", message: String((e as Error).message) });
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      updates.enriched_at = new Date().toISOString();
      updates.enrichment_source = sources.join(",");
      const { error: upErr } = await admin
        .from("products")
        .update(updates)
        .eq("id", p.id)
        .eq("user_id", user_id);
      if (upErr) errors.push({ product_id: p.id, task: "update", message: upErr.message });
    }
  }));

  if (run_id) {
    await admin.from("agent_runs").update({
      enrichment_complete: true,
      enrichment_completed_at: new Date().toISOString(),
    }).eq("id", run_id).eq("user_id", user_id);
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
