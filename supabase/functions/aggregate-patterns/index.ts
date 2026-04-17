// ══════════════════════════════════════════════════════════════
// aggregate-patterns
// Scheduled (daily) job that anonymises learned invoice_patterns
// from opted-in users and folds them into the public shared_patterns
// table, so first-time users benefit from collective learning.
// ══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── helpers ─────────────────────────────────────────────────
const norm = (s: string) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function fingerprintHeaders(headers: unknown): string {
  if (!Array.isArray(headers)) return "";
  return headers
    .map((h) => norm(String(h)))
    .filter(Boolean)
    .sort()
    .join("|");
}

/**
 * Strip header text from column_map — keep only the *roles* and
 * the count per role. So {"Style#":"sku","Wholesale":"cost"} becomes
 * {"sku":1,"cost":1}. No identifying header text leaks out.
 */
function anonymiseColumnMap(map: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!map || typeof map !== "object") return out;
  for (const role of Object.values(map as Record<string, string>)) {
    if (!role) continue;
    out[role] = (out[role] || 0) + 1;
  }
  return out;
}

interface AggBucket {
  format_type: string | null;
  header_fingerprint: string;
  size_system: string | null;
  gst_cost_votes: number;
  gst_cost_true: number;
  gst_rrp_votes: number;
  gst_rrp_true: number;
  markups: number[];
  pack_count: number;
  matrix_count: number;
  column_role_totals: Record<string, number>;
  contributors: Set<string>;
  total_invoices: number;
  confidences: number[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1. Find opted-in users
    const { data: optedIn, error: optErr } = await supabase
      .from("user_preferences")
      .select("user_id")
      .eq("contribute_to_shared_learning", true);

    if (optErr) throw optErr;

    const optedInIds = new Set((optedIn || []).map((r) => r.user_id));
    if (optedInIds.size === 0) {
      return new Response(
        JSON.stringify({ ok: true, message: "No opted-in users", patterns: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Pull eligible patterns (high-quality only)
    const { data: patterns, error: patErr } = await supabase
      .from("invoice_patterns")
      .select(`
        id, user_id, format_type, column_map, sample_headers,
        size_system, gst_included_in_cost, gst_included_in_rrp,
        default_markup_multiplier, pack_notation_detected,
        size_matrix_detected, invoice_count,
        supplier_profiles!inner(confidence_score)
      `)
      .gte("invoice_count", 5)
      .in("user_id", Array.from(optedInIds));

    if (patErr) throw patErr;

    const eligible = (patterns || []).filter((p: any) => {
      const conf = p.supplier_profiles?.confidence_score ?? 0;
      return conf >= 70;
    });

    // 3. Bucket by (format_type + header fingerprint)
    const buckets = new Map<string, AggBucket>();

    for (const p of eligible as any[]) {
      const fp = fingerprintHeaders(p.sample_headers);
      if (!fp) continue;

      const key = `${p.format_type || "unknown"}::${fp}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          format_type: p.format_type ?? null,
          header_fingerprint: fp,
          size_system: p.size_system ?? null,
          gst_cost_votes: 0,
          gst_cost_true: 0,
          gst_rrp_votes: 0,
          gst_rrp_true: 0,
          markups: [],
          pack_count: 0,
          matrix_count: 0,
          column_role_totals: {},
          contributors: new Set(),
          total_invoices: 0,
          confidences: [],
        };
        buckets.set(key, bucket);
      }

      bucket.contributors.add(p.user_id);
      bucket.total_invoices += p.invoice_count || 0;

      if (p.gst_included_in_cost !== null) {
        bucket.gst_cost_votes++;
        if (p.gst_included_in_cost) bucket.gst_cost_true++;
      }
      if (p.gst_included_in_rrp !== null) {
        bucket.gst_rrp_votes++;
        if (p.gst_included_in_rrp) bucket.gst_rrp_true++;
      }
      if (typeof p.default_markup_multiplier === "number") {
        bucket.markups.push(p.default_markup_multiplier);
      }
      if (p.pack_notation_detected) bucket.pack_count++;
      if (p.size_matrix_detected) bucket.matrix_count++;

      const conf = p.supplier_profiles?.confidence_score;
      if (typeof conf === "number") bucket.confidences.push(conf);

      const roles = anonymiseColumnMap(p.column_map);
      for (const [role, n] of Object.entries(roles)) {
        bucket.column_role_totals[role] =
          (bucket.column_role_totals[role] || 0) + n;
      }
    }

    // 4. Require >=2 contributors per pattern (k-anonymity floor)
    const rows = Array.from(buckets.values())
      .filter((b) => b.contributors.size >= 2)
      .map((b) => ({
        format_type: b.format_type,
        header_fingerprint: b.header_fingerprint,
        column_roles: b.column_role_totals,
        size_system: b.size_system,
        gst_included_in_cost:
          b.gst_cost_votes > 0
            ? b.gst_cost_true / b.gst_cost_votes >= 0.5
            : null,
        gst_included_in_rrp:
          b.gst_rrp_votes > 0
            ? b.gst_rrp_true / b.gst_rrp_votes >= 0.5
            : null,
        markup_min: b.markups.length ? Math.min(...b.markups) : null,
        markup_max: b.markups.length ? Math.max(...b.markups) : null,
        markup_avg: b.markups.length
          ? b.markups.reduce((s, n) => s + n, 0) / b.markups.length
          : null,
        pack_notation_detected: b.pack_count > b.contributors.size / 2,
        size_matrix_detected: b.matrix_count > b.contributors.size / 2,
        contributor_count: b.contributors.size,
        total_invoices: b.total_invoices,
        avg_confidence: b.confidences.length
          ? b.confidences.reduce((s, n) => s + n, 0) / b.confidences.length
          : null,
        last_aggregated_at: new Date().toISOString(),
      }));

    // 5. Replace shared_patterns wholesale (idempotent)
    if (rows.length > 0) {
      const { error: delErr } = await supabase
        .from("shared_patterns")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      if (delErr) throw delErr;

      const { error: insErr } = await supabase
        .from("shared_patterns")
        .insert(rows);
      if (insErr) throw insErr;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        opted_in_users: optedInIds.size,
        eligible_patterns: eligible.length,
        shared_patterns_written: rows.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("aggregate-patterns failed:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
