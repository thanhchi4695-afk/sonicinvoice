// Bulk Discount Cron — runs daily at 5:00 AM UTC.
//
// Responsibilities:
//   1. Find every `bulk_discount_schedules` row with status = 'active'
//      and ends_at <= now().
//   2. For each, call Shopify `productVariantsBulkUpdate` to revert each
//      variant back to its `originalPrice` from variants_snapshot.
//   3. Mark the schedule reverted (or failed with last_error).
//
// Notes:
//   - Operates per-user via the `shopify-proxy` edge function to reuse
//     each merchant's stored credentials.
//   - Chunked at 100 variants per call with a 500 ms delay between calls
//     to stay within Shopify GraphQL rate limits.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_VARIANTS_PER_CALL = 100;
const REQUEST_DELAY_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SnapshotVariant {
  productId: string;
  variantId: string;
  originalPrice: number;
  newPrice: number;
  sku?: string | null;
  title?: string | null;
  autoPricingMinPrice?: number | null;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const nowIso = new Date().toISOString();
  const { data: schedules, error } = await supabase
    .from("bulk_discount_schedules")
    .select("id, user_id, name, variants_snapshot, ends_at")
    .eq("status", "active")
    .not("ends_at", "is", null)
    .lte("ends_at", nowIso);

  if (error) {
    console.error("[bulk-discount-cron] load failed", error);
    return json({ ok: false, error: error.message }, 500);
  }

  if (!schedules || schedules.length === 0) {
    return json({ ok: true, processed: 0 });
  }

  const summary: Array<{
    id: string;
    name: string;
    ok: number;
    failed: number;
    error?: string;
  }> = [];

  for (const sched of schedules) {
    const snapshot = (sched.variants_snapshot as SnapshotVariant[]) ?? [];
    const grouped = new Map<string, SnapshotVariant[]>();
    for (const v of snapshot) {
      const arr = grouped.get(v.productId) ?? [];
      arr.push(v);
      grouped.set(v.productId, arr);
    }

    let okCount = 0;
    let failedCount = 0;
    let lastError: string | undefined;

    for (const [productId, variants] of grouped) {
      for (let i = 0; i < variants.length; i += MAX_VARIANTS_PER_CALL) {
        const chunk = variants.slice(i, i + MAX_VARIANTS_PER_CALL);
        const variantsInput = chunk.map((v) => ({
          id: v.variantId,
          price: v.originalPrice.toFixed(2),
        }));

        const mutation = `
          mutation BulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              userErrors { field message }
            }
          }
        `;

        try {
          const { data, error: invokeErr } = await supabase.functions.invoke(
            "shopify-proxy",
            {
              body: {
                action: "graphql",
                query: mutation,
                variables: { productId, variants: variantsInput },
                user_id: sched.user_id,
              },
            },
          );
          if (invokeErr) throw new Error(invokeErr.message);
          const errs = data?.productVariantsBulkUpdate?.userErrors ?? [];
          if (errs.length > 0) {
            failedCount += chunk.length;
            lastError = errs.map((e: { message: string }) => e.message).join("; ");
          } else {
            okCount += chunk.length;
          }
        } catch (e) {
          failedCount += chunk.length;
          lastError = e instanceof Error ? e.message : String(e);
        }

        await sleep(REQUEST_DELAY_MS);
      }
    }

    const newStatus = failedCount === 0 ? "reverted" : "failed";
    await supabase
      .from("bulk_discount_schedules")
      .update({
        status: newStatus,
        reverted_at: new Date().toISOString(),
        last_error: lastError ?? null,
      })
      .eq("id", sched.id);

    summary.push({
      id: sched.id,
      name: sched.name,
      ok: okCount,
      failed: failedCount,
      error: lastError,
    });
  }

  return json({ ok: true, processed: summary.length, results: summary });
});
