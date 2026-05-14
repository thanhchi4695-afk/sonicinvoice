// seo-health-scan
// Weekly SEO degradation scan across published collections.
// Detects: thin (<5 products), drift (Shopify edits vs Sonic baseline),
// no internal links (0 in body), completeness drop (<60).
// Re-opens existing alerts if still failing; resolves alerts that are now passing.

import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidShopifyToken } from "../_shared/shopify-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Severity = "low" | "medium" | "high";
type AlertType = "thin_collection" | "content_drift" | "no_internal_links" | "completeness_drop";

interface Finding {
  alert_type: AlertType;
  severity: Severity;
  detail: Record<string, unknown>;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function countLinks(html: string | null | undefined): number {
  if (!html) return 0;
  const m = html.match(/<a\s[^>]*href=/gi);
  return m ? m.length : 0;
}

async function scanForUser(admin: ReturnType<typeof createClient>, userId: string, scanRunId: string) {
  let accessToken = "", storeUrl = "", apiVersion = "";
  try {
    const t = await getValidShopifyToken(admin, userId);
    accessToken = t.accessToken; storeUrl = t.storeUrl; apiVersion = t.apiVersion;
  } catch {
    return { user_id: userId, skipped: true, reason: "no shopify token" };
  }

  const { data: published } = await admin
    .from("collection_suggestions")
    .select("id, user_id, suggested_title, shopify_handle, shopify_collection_id, completeness_score, description_html")
    .eq("user_id", userId)
    .eq("status", "published")
    .not("shopify_collection_id", "is", null);

  const rows = published ?? [];
  const findingsByCollection: Record<string, Finding[]> = {};

  for (const c of rows as any[]) {
    const findings: Finding[] = [];
    const cid = c.shopify_collection_id as string;

    // Fetch live Shopify state (collection + product count)
    let live: any = null;
    try {
      const r = await fetch(`https://${storeUrl}/admin/api/${apiVersion}/collections/${cid}.json`, {
        headers: { "X-Shopify-Access-Token": accessToken },
      });
      if (r.ok) live = (await r.json()).collection;
    } catch { /* ignore */ }

    let productCount = 0;
    try {
      const r = await fetch(`https://${storeUrl}/admin/api/${apiVersion}/collections/${cid}/products/count.json`, {
        headers: { "X-Shopify-Access-Token": accessToken },
      });
      if (r.ok) productCount = (await r.json()).count ?? 0;
    } catch { /* ignore */ }

    // Rule: thin collection
    if (productCount < 5) {
      findings.push({
        alert_type: "thin_collection",
        severity: productCount === 0 ? "high" : productCount < 3 ? "medium" : "low",
        detail: { product_count: productCount },
      });
    }

    // Rule: no internal links
    const linkCount = countLinks(live?.body_html ?? c.description_html);
    if (linkCount === 0) {
      findings.push({
        alert_type: "no_internal_links",
        severity: "medium",
        detail: { link_count: 0 },
      });
    }

    // Rule: completeness drop
    if ((c.completeness_score ?? 0) < 60) {
      findings.push({
        alert_type: "completeness_drop",
        severity: (c.completeness_score ?? 0) < 30 ? "high" : "medium",
        detail: { completeness_score: c.completeness_score ?? 0 },
      });
    }

    // Rule: content drift vs Sonic baseline (snapshot)
    if (live) {
      const { data: snap } = await admin
        .from("collection_seo_snapshots")
        .select("snapshot_title, snapshot_meta_description, snapshot_body_html")
        .eq("suggestion_id", c.id)
        .maybeSingle();

      if (snap) {
        const driftedFields: string[] = [];
        // Title metafield lives separately; use collection.title as a fallback proxy
        if (norm(live.title) && norm(snap.snapshot_title) && norm(live.title) !== norm(snap.snapshot_title)) {
          driftedFields.push("title");
        }
        if (snap.snapshot_body_html && live.body_html &&
            norm(live.body_html) !== norm(snap.snapshot_body_html)) {
          driftedFields.push("body");
        }
        if (driftedFields.length > 0) {
          findings.push({
            alert_type: "content_drift",
            severity: driftedFields.includes("body") ? "high" : "medium",
            detail: { drifted_fields: driftedFields },
          });
        }
      }
    }

    findingsByCollection[c.id] = findings;

    // Insert / update alerts
    for (const f of findings) {
      // Try to find an open alert
      const { data: existing } = await admin
        .from("seo_health_alerts")
        .select("id")
        .eq("user_id", userId)
        .eq("suggestion_id", c.id)
        .eq("alert_type", f.alert_type)
        .is("resolved_at", null)
        .maybeSingle();

      if (existing) {
        await admin.from("seo_health_alerts").update({
          severity: f.severity, detail: f.detail, scan_run_id: scanRunId,
        }).eq("id", existing.id);
      } else {
        await admin.from("seo_health_alerts").insert({
          user_id: userId,
          suggestion_id: c.id,
          shopify_collection_id: cid,
          collection_handle: c.shopify_handle,
          collection_title: c.suggested_title,
          alert_type: f.alert_type,
          severity: f.severity,
          detail: f.detail,
          scan_run_id: scanRunId,
        });
      }
    }

    // Resolve alerts no longer present
    const stillFailingTypes = new Set(findings.map((f) => f.alert_type));
    const { data: openAlerts } = await admin
      .from("seo_health_alerts")
      .select("id, alert_type")
      .eq("user_id", userId)
      .eq("suggestion_id", c.id)
      .is("resolved_at", null);
    for (const a of (openAlerts ?? []) as any[]) {
      if (!stillFailingTypes.has(a.alert_type)) {
        await admin.from("seo_health_alerts").update({ resolved_at: new Date().toISOString() }).eq("id", a.id);
      }
    }
  }

  const totalAlerts = Object.values(findingsByCollection).reduce((s, f) => s + f.length, 0);
  const highCount = Object.values(findingsByCollection).reduce(
    (s, f) => s + f.filter((x) => x.severity === "high").length, 0,
  );

  // Weekly summary email if any HIGH severity
  if (highCount > 0) {
    try {
      const { data: userRow } = await admin.auth.admin.getUserById(userId);
      const email = userRow?.user?.email;
      if (email) {
        await admin.functions.invoke("send-transactional-email", {
          body: {
            templateName: "seo-health-summary",
            recipientEmail: email,
            idempotencyKey: `seo-health-${userId}-${scanRunId}`,
            templateData: {
              highCount,
              totalAlerts,
              collectionCount: rows.length,
            },
          },
        });
      }
    } catch (e) {
      console.warn("seo-health email send skipped:", e);
    }
  }

  return { user_id: userId, scanned: rows.length, alerts: totalAlerts, high: highCount };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const scanRunId = crypto.randomUUID();

    let userIds: string[] = [];
    try {
      const body = await req.json();
      if (body?.user_id) userIds = [body.user_id];
    } catch { /* no body = scan all */ }

    if (userIds.length === 0) {
      const { data } = await admin.from("shopify_connections").select("user_id");
      userIds = Array.from(new Set((data ?? []).map((r: any) => r.user_id))).filter(Boolean);
    }

    const results = [];
    for (const uid of userIds) {
      try {
        results.push(await scanForUser(admin, uid, scanRunId));
      } catch (e) {
        results.push({ user_id: uid, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(JSON.stringify({ scan_run_id: scanRunId, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("seo-health-scan error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
