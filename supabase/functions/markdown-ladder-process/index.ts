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

    for (const ladder of ladders) {
      const stages = (Array.isArray(ladder.stages) ? ladder.stages : JSON.parse(ladder.stages)) as LadderStage[];
      const minMargin = Number(ladder.min_margin_pct) || 0;

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
          // All stages complete
          await supabase.from("markdown_ladder_items").update({ status: "completed" }).eq("id", item.id);
          continue;
        }

        // Check if enough days have passed since last sale
        const daysSinceLastSale = item.days_since_last_sale || 0;

        // Update days_since_last_sale from sales_data
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

            // If sold recently, don't advance
            if (updatedDays < nextStage.triggerDays) {
              // Schedule next check
              const nextCheck = new Date();
              nextCheck.setDate(nextCheck.getDate() + (ladder.check_frequency === "weekly" ? 7 : 1));
              await supabase.from("markdown_ladder_items").update({
                next_check_at: nextCheck.toISOString(),
              }).eq("id", item.id);
              continue;
            }
          }
        }

        // Check if trigger days met
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
