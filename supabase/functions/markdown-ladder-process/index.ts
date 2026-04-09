import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LadderStage {
  stageNumber: number;
  discountPercent: number;
  triggerDays: number;
}

async function syncPriceToShopify(
  supabase: any,
  userId: string,
  variantId: string,
  newPrice: number,
  originalPrice: number,
) {
  // Look up the Shopify variant ID from our variants table
  const { data: variant } = await supabase
    .from("variants")
    .select("shopify_variant_id")
    .eq("id", variantId)
    .eq("user_id", userId)
    .single();

  if (!variant?.shopify_variant_id) return { synced: false, reason: "no_shopify_variant" };

  // Get the user's Shopify connection
  const { data: conn } = await supabase
    .from("shopify_connections")
    .select("store_url, access_token, api_version")
    .eq("user_id", userId)
    .single();

  if (!conn) return { synced: false, reason: "no_shopify_connection" };

  const { store_url, access_token, api_version } = conn;
  const url = `https://${store_url}/admin/api/${api_version}/variants/${variant.shopify_variant_id}.json`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": access_token,
    },
    body: JSON.stringify({
      variant: {
        id: parseInt(variant.shopify_variant_id),
        price: newPrice.toFixed(2),
        compare_at_price: originalPrice.toFixed(2),
      },
    }),
  });

  if (resp.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    const retry = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": access_token,
      },
      body: JSON.stringify({
        variant: {
          id: parseInt(variant.shopify_variant_id),
          price: newPrice.toFixed(2),
          compare_at_price: originalPrice.toFixed(2),
        },
      }),
    });
    if (!retry.ok) return { synced: false, reason: `shopify_error_${retry.status}` };
    return { synced: true };
  }

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    console.error("Shopify price sync failed:", resp.status, err);
    return { synced: false, reason: `shopify_error_${resp.status}` };
  }

  return { synced: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get all active ladders
    const { data: ladders, error: lErr } = await supabase
      .from("markdown_ladders")
      .select("*")
      .eq("status", "active");

    if (lErr) throw lErr;
    if (!ladders || ladders.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "No active ladders" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalProcessed = 0;
    let totalAdvanced = 0;
    let totalBlocked = 0;
    let totalShopifySynced = 0;

    for (const ladder of ladders) {
      const stages = (Array.isArray(ladder.stages) ? ladder.stages : JSON.parse(ladder.stages)) as LadderStage[];
      const minMargin = Number(ladder.min_margin_pct) || 0;
      const syncToShopify = !!ladder.sync_to_shopify;

      // Get active items for this ladder that need checking
      const { data: items, error: iErr } = await supabase
        .from("markdown_ladder_items")
        .select("*")
        .eq("ladder_id", ladder.id)
        .eq("status", "active")
        .lte("next_check_at", new Date().toISOString());

      if (iErr || !items) continue;

      for (const item of items) {
        totalProcessed++;
        const currentStage = item.current_stage || 0;
        const nextStageNum = currentStage + 1;
        const nextStage = stages.find((s: LadderStage) => s.stageNumber === nextStageNum);

        if (!nextStage) {
          await supabase.from("markdown_ladder_items").update({ status: "completed" }).eq("id", item.id);
          continue;
        }

        // Check days since last sale
        const daysSinceLastSale = item.days_since_last_sale || 0;

        if (item.variant_id) {
          const { data: lastSale } = await supabase
            .from("sales_data")
            .select("sold_at")
            .eq("variant_id", item.variant_id)
            .order("sold_at", { ascending: false })
            .limit(1);

          if (lastSale && lastSale.length > 0) {
            const updatedDays = Math.floor(
              (Date.now() - new Date(lastSale[0].sold_at).getTime()) / 86400000
            );
            await supabase.from("markdown_ladder_items").update({
              days_since_last_sale: updatedDays,
              last_sale_at: lastSale[0].sold_at,
            }).eq("id", item.id);

            if (updatedDays < nextStage.triggerDays) {
              const nextCheck = new Date();
              nextCheck.setDate(nextCheck.getDate() + (ladder.check_frequency === "weekly" ? 7 : 1));
              await supabase.from("markdown_ladder_items").update({
                next_check_at: nextCheck.toISOString(),
              }).eq("id", item.id);
              continue;
            }
          }
        }

        if (daysSinceLastSale < nextStage.triggerDays && !item.variant_id) {
          const nextCheck = new Date();
          nextCheck.setDate(nextCheck.getDate() + (ladder.check_frequency === "weekly" ? 7 : 1));
          await supabase.from("markdown_ladder_items").update({
            next_check_at: nextCheck.toISOString(),
          }).eq("id", item.id);
          continue;
        }

        // Calculate new price
        const originalPrice = Number(item.original_price) || 0;
        const newPrice = +(originalPrice * (1 - nextStage.discountPercent / 100)).toFixed(2);
        const cost = Number(item.cost) || 0;

        // Margin protection
        if (cost > 0) {
          const marginAfter = ((newPrice - cost) / newPrice) * 100;
          if (marginAfter < minMargin) {
            totalBlocked++;
            const maxSafeDiscount = Math.floor((1 - cost / (originalPrice * (1 - minMargin / 100))) * 100);
            await supabase.from("markdown_ladder_items").update({
              status: "blocked",
              block_reason: `Stage ${nextStageNum} (-${nextStage.discountPercent}%) would drop margin to ${marginAfter.toFixed(0)}% (floor: ${minMargin}%). Max safe discount: ${Math.max(0, maxSafeDiscount)}%`,
            }).eq("id", item.id);
            continue;
          }
        }

        // Apply stage
        const isLast = nextStageNum >= stages.length;
        const marginPct = cost > 0 ? ((newPrice - cost) / newPrice) * 100 : null;
        const nextCheck = new Date();
        nextCheck.setDate(nextCheck.getDate() + (ladder.check_frequency === "weekly" ? 7 : 1));

        await supabase.from("markdown_ladder_items").update({
          current_price: newPrice,
          current_stage: nextStageNum,
          status: isLast ? "completed" : "active",
          margin_pct: marginPct,
          stage_applied_at: new Date().toISOString(),
          next_check_at: nextCheck.toISOString(),
          block_reason: null,
        }).eq("id", item.id);

        totalAdvanced++;

        // Sync to Shopify if enabled
        if (syncToShopify && item.variant_id) {
          try {
            const result = await syncPriceToShopify(
              supabase,
              ladder.user_id,
              item.variant_id,
              newPrice,
              originalPrice,
            );
            if (result.synced) {
              totalShopifySynced++;
              console.log(`Shopify price synced: variant ${item.variant_id} → $${newPrice} (was $${originalPrice})`);
            } else {
              console.warn(`Shopify sync skipped for variant ${item.variant_id}: ${result.reason}`);
            }
          } catch (syncErr) {
            console.error(`Shopify sync error for variant ${item.variant_id}:`, syncErr);
          }
        }
      }

      // Check if all items in ladder are completed/blocked
      const { data: remaining } = await supabase
        .from("markdown_ladder_items")
        .select("id")
        .eq("ladder_id", ladder.id)
        .eq("status", "active");

      if (!remaining || remaining.length === 0) {
        await supabase.from("markdown_ladders").update({ status: "completed" }).eq("id", ladder.id);
      }
    }

    return new Response(JSON.stringify({
      processed: totalProcessed,
      advanced: totalAdvanced,
      blocked: totalBlocked,
      shopify_synced: totalShopifySynced,
      ladders: ladders.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
