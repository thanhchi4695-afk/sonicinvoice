// Brand Crawl Queue Runner
// Picks pending brand_intelligence rows (crawl_status='not_crawled') and
// invokes brand-intelligence-crawler one-by-one with service-role auth.
// Auth: x-cron-secret header OR service-role bearer.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const ok = (CRON_SECRET && cronHeader === CRON_SECRET) || auth === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  if (!ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(50, Math.max(1, Number(body.limit ?? 10)));

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: pending, error } = await admin
    .from("brand_intelligence")
    .select("id, user_id, brand_name, brand_domain, industry_vertical")
    .eq("crawl_status", "not_crawled")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const results: Array<{ brand: string; user_id: string; status: string; http?: number; error?: string }> = [];
  for (const row of pending ?? []) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/brand-intelligence-crawler`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          user_id: row.user_id,
          brand_id: row.id,
          brand_name: row.brand_name,
          brand_domain: row.brand_domain ?? undefined,
          industry_vertical: row.industry_vertical ?? "UNKNOWN",
        }),
      });
      results.push({ brand: row.brand_name, user_id: row.user_id, status: res.ok ? "ok" : "error", http: res.status });
    } catch (e) {
      results.push({ brand: row.brand_name, user_id: row.user_id, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
    await new Promise((r) => setTimeout(r, 2000)); // 2s stagger between brand crawls
  }

  return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
