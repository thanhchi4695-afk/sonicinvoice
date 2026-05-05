// shopify-import: takes a parse_jobs.id, groups output_rows by handle,
// and creates/updates products via Shopify Admin REST API.
// Rate-limited to 2 requests/second (Shopify standard tier).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface OutputRow {
  handle: string;
  title: string;
  vendor?: string | null;
  productCategory?: string | null;
  type?: string | null;
  tags?: string;
  option1Name?: string;
  option1Value?: string | null;
  option2Name?: string;
  option2Value?: string | null;
  variantSku?: string | null;
  variantPrice?: number | null;
  variantCostPerItem?: number | null;
  variantInventoryQty?: number | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function shopifyFetch(
  storeUrl: string,
  apiVersion: string,
  accessToken: string,
  path: string,
  init: RequestInit = {},
) {
  const url = `https://${storeUrl}/admin/api/${apiVersion}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  return resp;
}

function buildVariantPayload(row: OutputRow) {
  const v: Record<string, unknown> = {
    option1: row.option1Value ?? "Default",
    option2: row.option2Value ?? undefined,
    sku: row.variantSku ?? undefined,
    price: row.variantPrice != null ? row.variantPrice.toFixed(2) : undefined,
    inventory_management: "shopify",
    inventory_quantity: row.variantInventoryQty ?? 0,
  };
  if (row.variantCostPerItem != null) {
    // Cost is set via inventory_item; Shopify accepts it as `cost` on variant create.
    (v as any).cost = row.variantCostPerItem.toFixed(2);
  }
  return v;
}

function variantKey(row: OutputRow) {
  return `${(row.option1Value ?? "").trim().toLowerCase()}|${(row.option2Value ?? "").trim().toLowerCase()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = userData.user.id;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const jobId: string | undefined = body?.jobId;
  if (!jobId) {
    return new Response(JSON.stringify({ error: "jobId is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Load job (must belong to user)
  const { data: job, error: jobErr } = await admin
    .from("parse_jobs")
    .select("id, user_id, output_rows, status, supplier_name")
    .eq("id", jobId)
    .single();
  if (jobErr || !job || job.user_id !== userId) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const rows: OutputRow[] = Array.isArray(job.output_rows) ? job.output_rows : [];
  if (rows.length === 0) {
    return new Response(JSON.stringify({ error: "Job has no output rows" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Load Shopify connection
  const { data: conn, error: connErr } = await admin
    .from("shopify_connections")
    .select("store_url, access_token, api_version, product_status")
    .eq("user_id", userId)
    .maybeSingle();
  if (connErr || !conn) {
    return new Response(JSON.stringify({ error: "No Shopify store connected" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Group rows by handle (CRITICAL: avoid duplicate-product bug)
  const byHandle = new Map<string, OutputRow[]>();
  for (const r of rows) {
    if (!r?.handle) continue;
    const arr = byHandle.get(r.handle) ?? [];
    arr.push(r);
    byHandle.set(r.handle, arr);
  }

  let created = 0, updated = 0, failed = 0;
  const errors: Array<{ handle: string; message: string }> = [];

  // Sequential, rate-limited at 2 req/s (500ms between Shopify calls)
  for (const [handle, group] of byHandle.entries()) {
    try {
      const first = group[0];
      const opt1Name = first.option1Name || "Colour";
      const opt2Name = first.option2Name || "Size";
      const hasOpt2 = group.some(r => r.option2Value);

      // 1. Lookup by handle
      const lookup = await shopifyFetch(
        conn.store_url, conn.api_version, conn.access_token,
        `/products.json?handle=${encodeURIComponent(handle)}&fields=id,handle,variants,options`,
      );
      await sleep(500);
      if (!lookup.ok) {
        const t = await lookup.text();
        throw new Error(`Lookup failed (${lookup.status}): ${t.slice(0, 200)}`);
      }
      const lookupJson = await lookup.json();
      const existing = (lookupJson.products || []).find((p: any) => p.handle === handle);

      if (existing) {
        // Add only NEW variants (by option1+option2 key)
        const existingKeys = new Set<string>(
          (existing.variants || []).map((v: any) =>
            `${(v.option1 ?? "").trim().toLowerCase()}|${(v.option2 ?? "").trim().toLowerCase()}`,
          ),
        );
        const newVariants = group
          .filter(r => !existingKeys.has(variantKey(r)))
          .map(buildVariantPayload);

        if (newVariants.length === 0) {
          updated += 1; // nothing to add but considered processed
          continue;
        }

        const updateResp = await shopifyFetch(
          conn.store_url, conn.api_version, conn.access_token,
          `/products/${existing.id}.json`,
          {
            method: "PUT",
            body: JSON.stringify({
              product: {
                id: existing.id,
                variants: [...(existing.variants || []), ...newVariants],
              },
            }),
          },
        );
        await sleep(500);
        if (!updateResp.ok) {
          const t = await updateResp.text();
          throw new Error(`Update failed (${updateResp.status}): ${t.slice(0, 200)}`);
        }
        updated += 1;
      } else {
        // Create new product with all variants
        const product: Record<string, unknown> = {
          title: first.title,
          handle,
          vendor: first.vendor || job.supplier_name || undefined,
          product_type: first.type ?? undefined,
          tags: first.tags ?? undefined,
          status: conn.product_status || "draft",
          options: hasOpt2
            ? [{ name: opt1Name }, { name: opt2Name }]
            : [{ name: opt1Name }],
          variants: group.map(buildVariantPayload),
          metafields_global_title_tag: first.seoTitle ?? undefined,
          metafields_global_description_tag: first.seoDescription ?? undefined,
        };

        const createResp = await shopifyFetch(
          conn.store_url, conn.api_version, conn.access_token,
          `/products.json`,
          { method: "POST", body: JSON.stringify({ product }) },
        );
        await sleep(500);
        if (!createResp.ok) {
          const t = await createResp.text();
          throw new Error(`Create failed (${createResp.status}): ${t.slice(0, 200)}`);
        }
        created += 1;
      }
    } catch (err: any) {
      failed += 1;
      errors.push({ handle, message: err?.message ?? String(err) });
      console.error(`[shopify-import] handle=${handle}`, err);
    }
  }

  const result = { created, updated, failed, errors };
  const newStatus = failed > 0 && created + updated === 0 ? "import_failed" : "imported";
  await admin
    .from("parse_jobs")
    .update({ shopify_import_result: result, status: newStatus })
    .eq("id", jobId);

  return new Response(JSON.stringify({ jobId, ...result, status: newStatus }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
