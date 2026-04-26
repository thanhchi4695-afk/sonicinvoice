// Publishing Agent — Phase 3 of the Watchdog flow.
//
// Pushes the products from a completed agent_run to Shopify when the
// supplier is auto-publish eligible. Reuses Shopify creds stored in
// platform_connections (OAuth) or pos_connections (Custom App).
//
// Two auth modes:
//   (a) User JWT  → manual call from Review screen
//   (b) Service-role + X-User-Id header → trusted call from agent-watchdog

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-user-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API_VERSION = "2024-01";

interface ShopifyCreds {
  shop_domain: string;
  access_token: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    // Resolve caller (user JWT OR service-role + sidecar)
    let userId: string | null = null;
    const sidecar = req.headers.get("X-User-Id");
    if (sidecar && authHeader === `Bearer ${serviceKey}`) {
      userId = sidecar;
    } else {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data, error } = await userClient.auth.getUser();
      if (error || !data?.user) return json({ error: "Not authenticated" }, 401);
      userId = data.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const runId = body?.run_id as string | undefined;
    const explicitUserId = body?.user_id as string | undefined;
    if (!runId) return json({ error: "run_id is required" }, 400);
    if (explicitUserId && explicitUserId !== userId) {
      return json({ error: "user_id mismatch" }, 403);
    }

    // 1. Load run + supplier
    const { data: runRow, error: runErr } = await admin
      .from("agent_runs")
      .select("id, user_id, supplier_name, supplier_profile_id, products_flagged, status, started_at, completed_at, metadata")
      .eq("id", runId)
      .eq("user_id", userId)
      .maybeSingle();
    if (runErr || !runRow) return json({ error: "Run not found" }, 404);

    let auto_publish_eligible = false;
    let confidence_score: number | null = null;
    if (runRow.supplier_profile_id) {
      const { data: sp } = await admin
        .from("supplier_profiles")
        .select("auto_publish_eligible, confidence_score")
        .eq("id", runRow.supplier_profile_id)
        .eq("user_id", userId)
        .maybeSingle();
      auto_publish_eligible = !!sp?.auto_publish_eligible;
      confidence_score = sp?.confidence_score ?? null;
    } else if (runRow.supplier_name) {
      const { data: sp } = await admin
        .from("supplier_profiles")
        .select("auto_publish_eligible, confidence_score")
        .eq("user_id", userId)
        .ilike("supplier_name", runRow.supplier_name)
        .maybeSingle();
      auto_publish_eligible = !!sp?.auto_publish_eligible;
      confidence_score = sp?.confidence_score ?? null;
    }

    if (!auto_publish_eligible) {
      return json({
        error: `Supplier not eligible for auto-publish. Confidence score: ${confidence_score ?? 0}%. Minimum: 90%.`,
      }, 400);
    }
    if (runRow.products_flagged > 0) {
      return json({ error: `Run has ${runRow.products_flagged} flagged products. Resolve them in Review first.` }, 400);
    }

    // 2. Get Shopify creds (try OAuth first, fall back to Custom App)
    const creds = await loadShopifyCreds(admin, userId);
    if (!creds) return json({ error: "No Shopify connection" }, 400);

    // 3. Pull products from agent_run metadata
    const products: any[] = Array.isArray(runRow.metadata?.products)
      ? runRow.metadata.products
      : [];
    if (products.length === 0) {
      return json({ error: "Run has no products to publish" }, 400);
    }

    // 4. Build & push payloads
    const baseUrl = `https://${creds.shop_domain}/admin/api/${API_VERSION}`;
    const headers = {
      "X-Shopify-Access-Token": creds.access_token,
      "Content-Type": "application/json",
    };

    // Group variants by parent style/title so we create one Shopify product per style
    const groups = groupProducts(products);

    const published: any[] = [];
    const failed: any[] = [];
    for (const grp of groups) {
      const payload = {
        product: {
          title: grp.title,
          vendor: grp.vendor || runRow.supplier_name || undefined,
          status: "active",
          variants: grp.variants.map((v) => ({
            sku: v.sku ?? undefined,
            price: typeof v.retail_price === "number" ? v.retail_price.toFixed(2) : String(v.retail_price ?? "0"),
            barcode: v.barcode ?? undefined,
            option1: v.color ?? v.colour ?? undefined,
            option2: v.size ?? undefined,
            inventory_management: "shopify",
            inventory_quantity: 0,
          })),
          options: buildOptions(grp.variants),
        },
      };
      try {
        const resp = await fetch(`${baseUrl}/products.json`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          failed.push({ title: grp.title, status: resp.status, error: data?.errors ?? "Unknown" });
        } else {
          published.push({ title: grp.title, shopify_id: data?.product?.id });
        }
        // Rate-limit gently
        await new Promise((r) => setTimeout(r, 600));
      } catch (e) {
        failed.push({ title: grp.title, error: String((e as Error).message) });
      }
    }

    // 5. Update agent_runs
    await admin
      .from("agent_runs")
      .update({
        status: failed.length === 0 ? "published" : "awaiting_review",
        auto_published: failed.length === 0,
        completed_at: new Date().toISOString(),
        metadata: {
          ...(runRow.metadata ?? {}),
          publishing: {
            published_count: published.length,
            failed_count: failed.length,
            shopify_product_ids: published.map((p) => p.shopify_id).filter(Boolean),
            published_at: new Date().toISOString(),
          },
        },
      })
      .eq("id", runId)
      .eq("user_id", userId);

    return json({
      published: published.length,
      failed,
      skipped: 0,
      shopify_product_ids: published.map((p) => p.shopify_id).filter(Boolean),
    });
  } catch (err) {
    console.error("[publishing-agent] error", err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});

async function loadShopifyCreds(admin: any, userId: string): Promise<ShopifyCreds | null> {
  // Prefer platform_connections (OAuth)
  const { data: pc } = await admin
    .from("platform_connections")
    .select("shop_domain, access_token, is_active")
    .eq("user_id", userId)
    .eq("platform", "shopify")
    .eq("is_active", true)
    .maybeSingle();
  if (pc?.shop_domain && pc?.access_token) {
    return { shop_domain: pc.shop_domain, access_token: pc.access_token };
  }
  // Fallback: pos_connections (Custom App token)
  const { data: pos } = await admin
    .from("pos_connections")
    .select("shopify_domain, shopify_access_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (pos?.shopify_domain && pos?.shopify_access_token) {
    return { shop_domain: pos.shopify_domain, access_token: pos.shopify_access_token };
  }
  return null;
}

function groupProducts(products: any[]): Array<{
  title: string;
  vendor: string | null;
  variants: any[];
}> {
  const buckets = new Map<string, { title: string; vendor: string | null; variants: any[] }>();
  for (const p of products) {
    const title = String(p.title ?? p.product_title ?? p.name ?? "").trim() || "Untitled";
    const vendor = (p.vendor ?? p.brand ?? p.supplier ?? null) as string | null;
    const key = `${title}::${vendor ?? ""}`.toLowerCase();
    const bucket = buckets.get(key) ?? { title, vendor, variants: [] };
    bucket.variants.push(p);
    buckets.set(key, bucket);
  }
  return Array.from(buckets.values());
}

function buildOptions(variants: any[]) {
  const hasColor = variants.some((v) => v.color || v.colour);
  const hasSize = variants.some((v) => v.size);
  const opts: { name: string }[] = [];
  // Always Colour first, then Size (project memory)
  if (hasColor) opts.push({ name: "Colour" });
  if (hasSize) opts.push({ name: "Size" });
  return opts.length > 0 ? opts : [{ name: "Title" }];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
