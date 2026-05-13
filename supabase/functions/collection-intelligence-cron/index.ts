// Nightly orchestrator — fans out collection-intelligence scans for every
// connected Shopify store. Triggered by pg_cron at 02:00 UTC.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: accept either CRON_SECRET (from pg_cron) or service-role key.
  const authHeader = req.headers.get("authorization") || "";
  const providedSecret = req.headers.get("x-cron-secret") || "";
  const isService = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  const isCron = !!CRON_SECRET && providedSecret === CRON_SECRET;
  if (!isService && !isCron) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: conns, error } = await admin
    .from("shopify_connections")
    .select("user_id, store_url, needs_reauth")
    .eq("needs_reauth", false);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<{ user_id: string; store: string; ok: boolean; error?: string }> = [];
  for (const c of conns ?? []) {
    try {
      // Skip if a scan ran for this user in the last 6 hours
      const sinceIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await admin
        .from("collection_scans")
        .select("id")
        .eq("user_id", c.user_id)
        .gte("created_at", sinceIso)
        .limit(1);
      if (recent && recent.length > 0) {
        results.push({ user_id: c.user_id, store: c.store_url, ok: true, error: "skipped-recent" });
        continue;
      }

      // Fire-and-forget invoke (don't await long scan)
      fetch(`${SUPABASE_URL}/functions/v1/collection-intelligence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ user_id: c.user_id, trigger: "nightly_cron" }),
      }).catch(() => {});

      results.push({ user_id: c.user_id, store: c.store_url, ok: true });
      // Stagger to avoid burst on Shopify
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      results.push({ user_id: c.user_id, store: c.store_url, ok: false, error: String(e) });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, dispatched: results.length, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
