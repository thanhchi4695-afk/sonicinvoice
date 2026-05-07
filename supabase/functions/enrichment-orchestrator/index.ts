/**
 * enrichment-orchestrator
 *
 * Pulls products from product_enrichment_queue and enriches them:
 *   find-product-url → product-extract (or enrich-via-websearch)
 *   → sonic-product-description + sonic-seo-writer (parallel)
 *   → mark pending_review.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MAX_RUNTIME_MS = 50_000;
const PER_PRODUCT_DELAY_MS = 200;
const TIMEOUT_FIND_URL = 8_000;
const TIMEOUT_EXTRACT = 15_000;
const TIMEOUT_AI = 10_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ─── Helpers ────────────────────────────────────────────────

function deriveProductType(title: string): string {
  const t = (title ?? "").toLowerCase();
  if (t.includes("one piece") || t.includes("maillot")) return "One Piece";
  if (t.includes("bikini top") || t.includes("bandeau") || t.includes("bralette")) return "Bikini Top";
  if (t.includes("bikini bottom") || t.includes("brief") || t.includes("hipster")) return "Bikini Bottom";
  if (t.includes("rash") || t.includes("rashie")) return "Rashie";
  if (t.includes("boardshort") || t.includes("trunk")) return "Boardshort";
  if (t.includes("tankini")) return "Tankini";
  if (t.includes("dress")) return "Dress";
  if (t.includes("hat") || t.includes("cap")) return "Hat";
  if (t.includes("bag")) return "Bag";
  if (t.includes("towel")) return "Towel";
  return "Swimwear";
}

function extractFeaturesFromDescription(desc: string | null | undefined): string[] {
  if (!desc) return [];
  const features: string[] = [];
  const lower = desc.toLowerCase();
  if (lower.includes("chlorine")) features.push("Chlorine resistant");
  if (lower.includes("upf") || lower.includes("uv protect") || lower.includes("sun protect"))
    features.push("UPF sun protection");
  if (lower.includes("underwire")) features.push("Underwire support");
  if (lower.includes("tummy control") || lower.includes("tummy panel"))
    features.push("Tummy control panel");
  if (lower.includes("reversible")) features.push("Reversible");
  if (lower.includes("dd") || lower.includes("fuller bust") || lower.includes("d cup"))
    features.push("Fuller bust support");
  return features;
}

function buildSeoTitle(vendor: string, title: string, colour: string | null): string {
  const base = `${vendor || ""} ${title || ""}${colour ? ` - ${colour}` : ""}`.trim().replace(/\s+/g, " ");
  let out = base.slice(0, 65);
  if (out.length < 52) out = `${out} | Australia`;
  return out;
}

function buildAltText(vendor: string, title: string, colour: string | null): string {
  const base = `${vendor || ""} ${title || ""}${colour ? ` ${colour}` : ""} — Splash Swimwear Darwin`
    .replace(/\s+/g, " ")
    .trim();
  return base.slice(0, 125);
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

interface QueueRow {
  id: string;
  user_id: string;
  shopify_product_id: string;
  product_title: string | null;
  vendor: string | null;
  style_number: string | null;
  colour: string | null;
  supplier_url: string | null;
  product_page_url: string | null;
  status: string;
  retry_count: number;
  max_retries: number;
}

// ─── Per-product processing ─────────────────────────────────

async function processProduct(
  row: QueueRow,
  deps: { admin: ReturnType<typeof createClient>; baseUrl: string; serviceKey: string },
): Promise<"enriched" | "not_found" | "failed"> {
  const { admin, baseUrl, serviceKey } = deps;
  const fnHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
  };

  // STEP 2 — find product page URL
  let productPageUrl = row.product_page_url;
  let urlConfidence: string | null = null;

  if (!productPageUrl) {
    if (!row.supplier_url) {
      // No supplier site → cannot find. Treat as not_found (will retry).
      await admin.from("product_enrichment_queue").update({
        status: "not_found",
        retry_count: row.retry_count + 1,
        last_attempted: new Date().toISOString(),
        next_retry_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
      }).eq("id", row.id);
      return "not_found";
    }

    try {
      const res = await fetchWithTimeout(
        `${baseUrl}/functions/v1/find-product-url`,
        {
          method: "POST",
          headers: fnHeaders,
          body: JSON.stringify({
            brand_website: row.supplier_url,
            style_number: row.style_number,
            product_name: row.product_title,
            vendor: row.vendor,
          }),
        },
        TIMEOUT_FIND_URL,
      );
      const data = await res.json();
      if (data?.confidence === "not_found" || !data?.url) {
        await admin.from("product_enrichment_queue").update({
          status: "not_found",
          retry_count: row.retry_count + 1,
          last_attempted: new Date().toISOString(),
          next_retry_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
        }).eq("id", row.id);
        return "not_found";
      }
      productPageUrl = data.url;
      urlConfidence = data.confidence ?? null;
      await admin.from("product_enrichment_queue").update({
        product_page_url: productPageUrl,
        url_confidence: urlConfidence,
      }).eq("id", row.id);
    } catch (e) {
      console.warn(`[orchestrator] find-product-url failed for ${row.id}:`, e);
      await admin.from("product_enrichment_queue").update({
        status: "not_found",
        retry_count: row.retry_count + 1,
        last_attempted: new Date().toISOString(),
        next_retry_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
      }).eq("id", row.id);
      return "not_found";
    }
  }

  // STEP 3 — scrape supplier page
  await admin.from("product_enrichment_queue").update({ status: "scraping" }).eq("id", row.id);

  let scrapedImages: string[] = [];
  let scrapedDescription = "";
  let scrapeSource: string | null = null;

  try {
    const res = await fetchWithTimeout(
      `${baseUrl}/functions/v1/product-extract`,
      { method: "POST", headers: fnHeaders, body: JSON.stringify({ url: productPageUrl }) },
      TIMEOUT_EXTRACT,
    );
    if (res.ok) {
      const data = await res.json();
      const imgs: unknown = data?.images;
      if (Array.isArray(imgs)) {
        scrapedImages = imgs
          .map((i) => (typeof i === "string" ? i : i?.storedUrl ?? i?.url))
          .filter((v): v is string => typeof v === "string");
      }
      scrapedDescription = data?.description ?? "";
      scrapeSource = data?.extraction_strategy ?? "selectors";
    }
  } catch (e) {
    console.warn(`[orchestrator] product-extract failed for ${row.id}:`, e);
  }

  // Fallback to websearch
  if (scrapedImages.length === 0 && !scrapedDescription) {
    try {
      const res = await fetchWithTimeout(
        `${baseUrl}/functions/v1/enrich-via-websearch`,
        {
          method: "POST",
          headers: fnHeaders,
          body: JSON.stringify({
            brand_name: row.vendor,
            product_name: row.product_title,
            colour: row.colour,
            product_code: row.style_number,
            preferred_domain: row.supplier_url,
          }),
        },
        TIMEOUT_EXTRACT,
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.image_url) scrapedImages = [data.image_url];
        scrapedDescription = data?.description ?? "";
        scrapeSource = "websearch";
      }
    } catch (e) {
      console.warn(`[orchestrator] websearch failed for ${row.id}:`, e);
    }
  }

  if (scrapedImages.length === 0 && !scrapedDescription) {
    await admin.from("product_enrichment_queue").update({
      status: "not_found",
      retry_count: row.retry_count + 1,
      last_attempted: new Date().toISOString(),
      next_retry_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    }).eq("id", row.id);
    return "not_found";
  }

  // STEP 4 — AI enrichment (parallel description + SEO meta)
  const productType = deriveProductType(row.product_title ?? "");
  const features = extractFeaturesFromDescription(scrapedDescription);

  const descPromise = fetchWithTimeout(
    `${baseUrl}/functions/v1/sonic-product-description`,
    {
      method: "POST",
      headers: fnHeaders,
      body: JSON.stringify({
        brand_name: row.vendor,
        product_name: row.product_title,
        colour: row.colour,
        product_type: productType,
        features,
      }),
    },
    TIMEOUT_AI,
  ).then((r) => r.ok ? r.json() : null).catch((e) => { console.warn("desc err", e); return null; });

  const seoPromise = fetchWithTimeout(
    `${baseUrl}/functions/v1/sonic-seo-writer`,
    {
      method: "POST",
      headers: fnHeaders,
      body: JSON.stringify({
        brand: row.vendor,
        product_name: row.product_title,
        colour: row.colour,
        product_type: productType,
      }),
    },
    TIMEOUT_AI,
  ).then((r) => r.ok ? r.json() : null).catch((e) => { console.warn("seo err", e); return null; });

  const [descData, seoData] = await Promise.all([descPromise, seoPromise]);

  const aiDescription =
    descData?.description ?? descData?.content ?? descData?.html ?? scrapedDescription ?? "";
  const seoDescription =
    seoData?.meta_description ?? seoData?.description ?? seoData?.content ?? "";
  const seoTitle = buildSeoTitle(row.vendor ?? "", row.product_title ?? "", row.colour);
  const altText = buildAltText(row.vendor ?? "", row.product_title ?? "", row.colour);

  // STEP 5 — save (two updates so the updated_at trigger and any status hooks fire)
  const { error: upErr } = await admin.from("product_enrichment_queue").update({
    status: "enriched",
    scraped_images: scrapedImages,
    scraped_description: scrapedDescription,
    scrape_source: scrapeSource,
    ai_description: aiDescription,
    ai_seo_title: seoTitle,
    ai_seo_description: seoDescription,
    image_alt_text: altText,
    last_attempted: new Date().toISOString(),
  }).eq("id", row.id);

  if (upErr) {
    console.error(`[orchestrator] update enriched failed for ${row.id}:`, upErr);
    return "failed";
  }

  await admin.from("product_enrichment_queue")
    .update({ status: "pending_review" })
    .eq("id", row.id);

  return "enriched";
}

// ─── Handler ────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.max(1, Math.min(25, body?.batch_size ?? 10));
    const retryNotFound = !!body?.retry_not_found;

    // Identity:
    //   - x-cron-secret OR (body.scheduled && Bearer service_role) → scheduled multi-user mode
    //   - body.user_id with cron secret → single user
    //   - else require user JWT
    let userId: string | null = null;
    let isScheduled = false;
    const cronHeader = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const isServiceRoleCall = bearerToken && bearerToken === SUPABASE_SERVICE_ROLE_KEY;

    if (CRON_SECRET && cronHeader === CRON_SECRET) {
      if (body?.scheduled) {
        isScheduled = true;
      } else {
        userId = body?.user_id ?? null;
        if (!userId) return json({ error: "user_id required" }, 400);
      }
    } else if (isServiceRoleCall && body?.scheduled) {
      isScheduled = true;
    } else if (isServiceRoleCall && body?.user_id) {
      userId = body.user_id;
    } else {
      if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claims, error: claimsErr } = await userClient.auth.getClaims(bearerToken);
      if (claimsErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
      userId = claims.claims.sub as string;
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const deps = { admin, baseUrl: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_ROLE_KEY };
    const startedAt = Date.now();

    const runBatchForUser = async (uid: string) => {
      const nowIso = new Date().toISOString();
      let query = admin
        .from("product_enrichment_queue")
        .select("*")
        .eq("user_id", uid);

      if (retryNotFound) {
        query = query.in("status", ["pending", "not_found"])
          .or(`status.eq.pending,and(status.eq.not_found,next_retry_at.lte.${nowIso})`);
      } else {
        query = query.eq("status", "pending");
      }

      const { data: rows, error: qErr } = await query
        .order("status", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(batchSize);
      if (qErr) {
        console.error(`[orchestrator] query failed for ${uid}:`, qErr);
        return { user_id: uid, processed: 0, enriched: 0, not_found: 0, failed: 0, vendor_summary: "" };
      }

      const candidates = (rows ?? []).filter((r) =>
        r.status === "pending" ||
        (r.status === "not_found" && r.retry_count < r.max_retries),
      ) as QueueRow[];

      let enriched = 0, notFound = 0, failed = 0, processed = 0;
      const enrichedVendors: string[] = [];

      for (const row of candidates) {
        if (Date.now() - startedAt > MAX_RUNTIME_MS) {
          console.warn("[orchestrator] runtime limit reached, stopping");
          break;
        }
        processed++;
        try {
          const outcome = await processProduct(row, deps);
          if (outcome === "enriched") {
            enriched++;
            enrichedVendors.push(row.vendor ?? "Unknown");
          } else if (outcome === "not_found") notFound++;
          else failed++;
        } catch (e) {
          console.error(`[orchestrator] product ${row.id} threw:`, e);
          failed++;
          await admin.from("product_enrichment_queue").update({
            status: "failed",
            last_attempted: new Date().toISOString(),
          }).eq("id", row.id).then(() => {}, () => {});
        }
        await new Promise((r) => setTimeout(r, PER_PRODUCT_DELAY_MS));
      }

      const counts = new Map<string, number>();
      for (const v of enrichedVendors) counts.set(v, (counts.get(v) ?? 0) + 1);
      const vendorSummary = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([v, c]) => `${c} ${v}`)
        .join(", ");

      if (enriched > 0) {
        try {
          await admin.from("agent_tasks").insert({
            user_id: uid,
            task_type: "product_enrichment_review",
            trigger_source: "pipeline_handoff",
            status: "permission_requested",
            observation: `${enriched} products enriched and ready to review${vendorSummary ? ` — ${vendorSummary}` : ""}.`,
            permission_question: `I've enriched ${enriched} products with images and descriptions. Want to review them now?`,
            pipeline_id: null,
          });
        } catch (e) {
          console.warn("[orchestrator] agent_tasks insert failed:", e);
        }
      }

      return { user_id: uid, processed, enriched, not_found: notFound, failed, vendor_summary: vendorSummary };
    };

    if (isScheduled) {
      // Find users with active Shopify connection AND eligible queue rows
      const { data: conns } = await admin
        .from("shopify_connections")
        .select("user_id")
        .not("access_token", "is", null);
      const connUserIds = new Set((conns ?? []).map((c) => c.user_id as string));

      const nowIso = new Date().toISOString();
      const { data: pendingRows } = await admin
        .from("product_enrichment_queue")
        .select("user_id, status, next_retry_at")
        .in("status", ["pending", "not_found"]);

      const eligibleUsers = new Set<string>();
      for (const r of pendingRows ?? []) {
        if (!connUserIds.has(r.user_id as string)) continue;
        if (r.status === "pending") eligibleUsers.add(r.user_id as string);
        else if (r.status === "not_found" && (!r.next_retry_at || r.next_retry_at <= nowIso)) {
          eligibleUsers.add(r.user_id as string);
        }
      }

      const results: unknown[] = [];
      let totals = { processed: 0, enriched: 0, not_found: 0, failed: 0 };
      for (const uid of eligibleUsers) {
        if (Date.now() - startedAt > MAX_RUNTIME_MS) {
          console.warn("[orchestrator] runtime limit, stopping multi-user loop");
          break;
        }
        const r = await runBatchForUser(uid);
        results.push(r);
        totals.processed += r.processed;
        totals.enriched += r.enriched;
        totals.not_found += r.not_found;
        totals.failed += r.failed;
      }
      return json({ scheduled: true, users: results.length, ...totals, results });
    }

    // Manual single-user path
    const result = await runBatchForUser(userId!);
    return json(result);
  } catch (e) {
    console.error("[orchestrator] fatal:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
