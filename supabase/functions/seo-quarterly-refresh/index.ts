// Quarterly refresh — finds collection_seo_outputs rows past expires_at (or
// older than 90 days) and re-runs seo-collection-engine for each.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Allow cron-secret header OR an authenticated admin
    const sig = req.headers.get("x-cron-secret");
    if (CRON_SECRET && sig !== CRON_SECRET) {
      const auth = req.headers.get("Authorization");
      if (!auth) return json({ error: "unauthorized" }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: settings } = await supabase
      .from("app_settings")
      .select("brand_intelligence_enabled")
      .eq("singleton", true)
      .maybeSingle();
    if (settings && settings.brand_intelligence_enabled === false) {
      return json({ skipped: true, reason: "kill switch off" });
    }

    const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString();

    const { data: stale, error } = await supabase
      .from("collection_seo_outputs")
      .select("id, suggestion_id, layer, refreshed_at, expires_at")
      .or(`expires_at.lt.${new Date().toISOString()},refreshed_at.lt.${cutoff}`)
      .limit(50);
    if (error) return json({ error: error.message }, 500);

    const ids = stale ?? [];
    let triggered = 0;
    let failed = 0;

    for (const row of ids) {
      try {
        const { data: sug } = await supabase
          .from("collection_suggestions")
          .select("user_id")
          .eq("id", row.suggestion_id)
          .maybeSingle();
        const res = await fetch(`${SUPABASE_URL}/functions/v1/seo-collection-engine`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ suggestion_id: row.suggestion_id }),
        });
        if (res.ok) triggered++; else failed++;
        // light throttle
        await new Promise((r) => setTimeout(r, 800));
      } catch {
        failed++;
      }
    }

    return json({ ok: true, scanned: ids.length, triggered, failed });
  } catch (e) {
    console.error("seo-quarterly-refresh error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
