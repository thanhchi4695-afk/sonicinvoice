// Agent 3 — Enrichment Agent
// Fired in the background after Phase 2 writes products to the DB.
// For each product, runs description + image search in parallel, with a
// 25 s per-task timeout. Never blocks the user's review screen.
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
  const types = [
    "one piece", "one-piece", "swimsuit", "bikini top", "bikini bottom",
    "rash guard", "rashie", "boardshort", "wetsuit", "tankini", "monokini",
    "bralette", "brief", "trunk", "legging", "dress", "shirt", "short", "top",
  ];
  for (const k of types) if (t.includes(k)) return k;
  return "swimwear";
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

  // Load the products we need to enrich
  const { data: products, error: prodErr } = await admin
    .from("products")
    .select("id, title, vendor, description, image_url")
    .eq("user_id", user_id)
    .in("id", product_ids);

  if (prodErr) return json({ error: `load products: ${prodErr.message}` }, 500);
  if (!products || products.length === 0) return json({ enriched: 0 });

  let descriptionsFound = 0;
  let imagesFound = 0;
  const errors: Array<{ product_id: string; task: string; message: string }> = [];

  // Process products in parallel
  await Promise.all(products.map(async (p: any) => {
    const productType = deriveProductType(p.title || "");
    const updates: Record<string, any> = {};

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
          descriptionsFound++;
        }
      } catch (e) {
        errors.push({ product_id: p.id, task: "description", message: String((e as Error).message) });
      }
    }

    // Task B — image search
    if (!p.image_url) {
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
              styleNumber: "",
              colour: "",
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
          imagesFound++;
        }
      } catch (e) {
        errors.push({ product_id: p.id, task: "image", message: String((e as Error).message) });
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
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
    prices_found: 0,
    errors,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
