// ══════════════════════════════════════════════════════════════
// sync-brand-database
//
// Per-user sync: fetches a published Google Sheet (or any
// HTTPS CSV URL) and upserts rows into `brand_database` for
// the authenticated user.
//
// Body: { csv_url?: string }   // falls back to user_settings.brand_sync_url
// Auth: requires JWT (per-user). For the monthly cron, the
//       caller passes { user_id, csv_url, triggered_by: 'cron' }
//       with the service role key.
//
// Returns: { inserted, updated, skipped, errored, errors[] }
// ══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SyncError {
  brand_name: string;
  reason: string;
}

// RFC4180-ish CSV parser. Handles quoted fields, escaped quotes,
// embedded commas, and \r\n / \n line endings.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      // swallow \r, expect \n next
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // flush trailing field
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}

function toBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "y";
}

function toDate(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  // Accept YYYY-MM-DD strictly; reject anything else as null
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function nullIfBlank(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  return s === "" ? null : s;
}

function isHttpsUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let body: { csv_url?: string; user_id?: string; triggered_by?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Resolve user: either from JWT (manual sync) or from body.user_id (cron)
  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization");
  const isCron = body.triggered_by === "cron" && body.user_id;

  if (isCron) {
    userId = body.user_id!;
  } else if (authHeader?.startsWith("Bearer ")) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data, error } = await userClient.auth.getClaims(token);
    if (error || !data?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    userId = data.claims.sub;
  } else {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Service-role client for the actual writes (bypass RLS, but we always
  // pass user_id explicitly so per-user scoping is preserved)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Resolve CSV URL: explicit body wins, else user_settings.brand_sync_url
  let csvUrl = body.csv_url?.trim() ?? "";
  if (!csvUrl) {
    const { data: settings } = await admin
      .from("user_settings")
      .select("brand_sync_url")
      .eq("user_id", userId)
      .maybeSingle();
    csvUrl = settings?.brand_sync_url ?? "";
  }

  if (!csvUrl || !isHttpsUrl(csvUrl)) {
    return new Response(
      JSON.stringify({
        error:
          "No valid HTTPS CSV URL configured. Save one in Account → Brand database sync.",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Fetch the CSV
  let csvText: string;
  try {
    const res = await fetch(csvUrl, { redirect: "follow" });
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? " — Sheet may not be Published to web. In Google Sheets: File → Share → Publish to web → CSV → Publish."
          : "";
      throw new Error(`HTTP ${res.status}${hint}`);
    }
    csvText = await res.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from("brand_sync_log").insert({
      user_id: userId,
      source_url: csvUrl,
      rows_errored: 1,
      error_details: [{ brand_name: "(fetch)", reason: message }],
      triggered_by: body.triggered_by ?? "manual",
    });
    return new Response(
      JSON.stringify({ error: "Failed to fetch CSV", detail: message }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Parse
  const rawRows = parseCsv(csvText);
  const records = rowsToObjects(rawRows);

  if (records.length === 0) {
    await admin.from("brand_sync_log").insert({
      user_id: userId,
      source_url: csvUrl,
      rows_errored: 1,
      error_details: [{ brand_name: "(parse)", reason: "Empty CSV" }],
      triggered_by: body.triggered_by ?? "manual",
    });
    return new Response(
      JSON.stringify({
        error: "CSV is empty or has no data rows",
        inserted: 0,
        updated: 0,
        skipped: 0,
        errored: 1,
        errors: [{ brand_name: "(parse)", reason: "Empty CSV" }],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errored = 0;
  const errors: SyncError[] = [];

  for (const r of records) {
    const brandName = (r["brand_name"] ?? "").trim();
    if (!brandName) {
      skipped++;
      continue;
    }

    const payload = {
      user_id: userId!,
      brand_name: brandName,
      canonical_brand_name: nullIfBlank(r["canonical_brand_name"]) ?? brandName,
      website_url: nullIfBlank(r["website_url"]),
      is_shopify: toBool(r["is_shopify"]),
      products_json_endpoint: nullIfBlank(r["products_json_endpoint"]),
      country_origin: nullIfBlank(r["country_origin"]),
      product_categories: nullIfBlank(r["product_categories"]),
      verified_date: toDate(r["verified_date"]),
      notes: nullIfBlank(r["notes"]),
      enrichment_enabled: r["enrichment_enabled"]
        ? toBool(r["enrichment_enabled"])
        : true,
    };

    try {
      const { data: existing } = await admin
        .from("brand_database")
        .select("id, canonical_brand_name, website_url, is_shopify, products_json_endpoint, country_origin, product_categories, verified_date, notes, enrichment_enabled")
        .eq("user_id", userId!)
        .eq("brand_name", brandName)
        .maybeSingle();

      if (existing) {
        // Compare — skip if nothing changed
        const changed =
          existing.canonical_brand_name !== payload.canonical_brand_name ||
          existing.website_url !== payload.website_url ||
          existing.is_shopify !== payload.is_shopify ||
          existing.products_json_endpoint !== payload.products_json_endpoint ||
          existing.country_origin !== payload.country_origin ||
          existing.product_categories !== payload.product_categories ||
          existing.verified_date !== payload.verified_date ||
          existing.notes !== payload.notes ||
          existing.enrichment_enabled !== payload.enrichment_enabled;

        if (!changed) {
          skipped++;
          continue;
        }

        const { error: updErr } = await admin
          .from("brand_database")
          .update(payload)
          .eq("id", existing.id);
        if (updErr) throw updErr;
        updated++;
      } else {
        const { error: insErr } = await admin
          .from("brand_database")
          .insert(payload);
        if (insErr) throw insErr;
        inserted++;
      }
    } catch (err) {
      errored++;
      errors.push({
        brand_name: brandName,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await admin.from("brand_sync_log").insert({
    user_id: userId,
    source_url: csvUrl,
    rows_inserted: inserted,
    rows_updated: updated,
    rows_skipped: skipped,
    rows_errored: errored,
    error_details: errors,
    triggered_by: body.triggered_by ?? "manual",
  });

  return new Response(
    JSON.stringify({
      ok: true,
      inserted,
      updated,
      skipped,
      errored,
      errors,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
