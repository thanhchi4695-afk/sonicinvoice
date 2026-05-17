// gsc-fetch-performance
// Internal helper: query Google Search Console searchanalytics for a URL.
// Called by other seo-ab-* edge functions. Not exposed to the client.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const GATEWAY_BASE = "https://connector-gateway.lovable.dev/google_search_console";

interface ReqBody {
  siteUrl: string;
  page: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  dimensions?: string[]; // default ["date"]
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const GSC_KEY = Deno.env.get("GOOGLE_SEARCH_CONSOLE_API_KEY");
  if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY missing" }, 500);
  if (!GSC_KEY) return json({ error: "GOOGLE_SEARCH_CONSOLE_API_KEY missing — connect Google Search Console" }, 500);

  let body: ReqBody;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  if (!body.siteUrl || !body.page || !body.startDate || !body.endDate) {
    return json({ error: "siteUrl, page, startDate, endDate required" }, 400);
  }

  const dims = body.dimensions ?? ["date"];
  const url = `${GATEWAY_BASE}/webmasters/v3/sites/${encodeURIComponent(body.siteUrl)}/searchAnalytics/query`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GSC_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: body.startDate,
        endDate: body.endDate,
        dimensions: dims,
        dimensionFilterGroups: [{
          filters: [{ dimension: "page", operator: "equals", expression: body.page }],
        }],
        rowLimit: 5000,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return json({ error: `gsc ${res.status}`, details: data }, res.status);
    }

    const rows = (data.rows ?? []) as Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>;
    const totals = rows.reduce(
      (acc, r) => {
        acc.impressions += r.impressions || 0;
        acc.clicks += r.clicks || 0;
        acc.positionSum += (r.position || 0) * (r.impressions || 0);
        return acc;
      },
      { impressions: 0, clicks: 0, positionSum: 0 },
    );
    const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
    const position = totals.impressions > 0 ? totals.positionSum / totals.impressions : null;

    return json({
      rows,
      totals: { impressions: totals.impressions, clicks: totals.clicks, ctr, position },
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
