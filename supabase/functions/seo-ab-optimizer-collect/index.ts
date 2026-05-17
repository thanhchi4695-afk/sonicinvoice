// seo-ab-optimizer-collect
// Daily: for every experiment that has ever been activated, pulls GSC daily
// rows for its variant window, upserts into seo_ab_gsc_daily, then rolls up
// totals onto the experiment row. Skips the most recent 3 days (GSC delay).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GSC_KEY = Deno.env.get("GOOGLE_SEARCH_CONSOLE_API_KEY")!;
const GATEWAY = "https://connector-gateway.lovable.dev/google_search_console";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Cutoff = today - 3 days
  const cutoff = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);

  // Pull all experiments in "active" or "measuring" with a URL & site
  const { data: exps } = await admin
    .from("seo_ab_experiments")
    .select("id, user_id, collection_url, start_date, end_date, variant_id")
    .in("status", ["active", "measuring"])
    .not("collection_url", "is", null);

  // Fetch each user's site URL
  const userIds = [...new Set((exps ?? []).map((e: any) => e.user_id))];
  const { data: settings } = await admin
    .from("seo_ab_settings")
    .select("user_id, gsc_site_url")
    .in("user_id", userIds);
  const siteByUser = new Map((settings ?? []).map((r: any) => [r.user_id, r.gsc_site_url]));

  const results: any[] = [];
  for (const e of exps ?? []) {
    const site = siteByUser.get(e.user_id);
    if (!site) continue;
    const endDate = e.end_date && e.end_date < cutoff ? e.end_date : cutoff;
    if (!e.start_date || e.start_date > endDate) continue;

    try {
      const rows = await fetchGsc(site, e.collection_url, e.start_date, endDate);
      let totalImp = 0, totalClicks = 0, posWeighted = 0;
      for (const r of rows) {
        const date = r.keys?.[0];
        if (!date) continue;
        const ctr = r.impressions > 0 ? r.clicks / r.impressions : 0;
        await admin.from("seo_ab_gsc_daily").upsert({
          user_id: e.user_id, experiment_id: e.id, variant_id: e.variant_id,
          metric_date: date, impressions: r.impressions, clicks: r.clicks,
          ctr, position: r.position,
        }, { onConflict: "experiment_id,metric_date" });
        totalImp += r.impressions;
        totalClicks += r.clicks;
        posWeighted += (r.position || 0) * r.impressions;
      }
      await admin.from("seo_ab_experiments").update({
        impressions: totalImp,
        clicks: totalClicks,
        ctr: totalImp > 0 ? totalClicks / totalImp : 0,
        position: totalImp > 0 ? posWeighted / totalImp : null,
      }).eq("id", e.id);
      results.push({ id: e.id, rows: rows.length });
    } catch (err) {
      results.push({ id: e.id, error: String(err) });
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

async function fetchGsc(site: string, page: string, startDate: string, endDate: string) {
  const url = `${GATEWAY}/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": GSC_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate, endDate, dimensions: ["date"],
      dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: page }] }],
      rowLimit: 5000,
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`gsc ${res.status}: ${JSON.stringify(j)}`);
  return (j.rows ?? []) as Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>;
}
