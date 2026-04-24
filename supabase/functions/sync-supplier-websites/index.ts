// Sync supplier_websites from a published Google Sheet (CSV export).
// Conflict resolution: last-modified-wins by `updated_at` timestamp.
// Never deletes rows — only inserts and updates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SheetRow {
  brand_name: string;
  canonical_brand_name?: string;
  website_url?: string;
  is_shopify?: string;
  products_json_endpoint?: string;
  country_origin?: string;
  product_categories?: string;
  enrichment_enabled?: string;
  updated_at?: string;
  last_modified_by?: string;
  notes?: string;
  source_sheet_row_id?: string;
}

function toCsvExportUrl(shareUrl: string): string {
  const url = shareUrl.trim();
  // Already a published-to-web CSV URL — use as-is
  // e.g. https://docs.google.com/spreadsheets/d/e/{PUB_ID}/pub?output=csv
  if (/\/spreadsheets\/d\/e\/[^/]+\/pub/i.test(url) && /output=csv/i.test(url)) {
    return url;
  }
  // Standard share URL — convert to export?format=csv
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) throw new Error("Invalid Google Sheets URL");
  const gidMatch = url.match(/[?#&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

function normaliseBrand(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\+/g, "plus")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Minimal RFC4180-ish CSV parser supporting quoted fields with commas/newlines/escaped quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // flush
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function rowsToObjects(matrix: string[][]): SheetRow[] {
  if (matrix.length < 2) return [];
  const headers = matrix[0].map((h) => h.trim().toLowerCase());
  return matrix
    .slice(1)
    .filter((r) => r.some((c) => c && c.trim() !== ""))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        obj[h] = (r[idx] ?? "").trim();
      });
      return obj as unknown as SheetRow;
    });
}

function asBool(v: string | undefined): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const s = v.toLowerCase();
  if (["yes", "y", "true", "1"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startMs = Date.now();
  let body: { source?: "manual" | "cron"; sheet_url_override?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const source = body.source === "cron" ? "cron" : "manual";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const logRun = async (payload: Record<string, unknown>) => {
    await supabase.from("supplier_websites_sync_log").insert({
      source,
      duration_ms: Date.now() - startMs,
      ...payload,
    });
  };

  // 1. Resolve sheet URL
  let sheetUrl = body.sheet_url_override;
  if (!sheetUrl) {
    const { data: settings } = await supabase
      .from("app_settings")
      .select("brand_sync_sheet_url")
      .eq("singleton", true)
      .maybeSingle();
    sheetUrl = settings?.brand_sync_sheet_url ?? undefined;
  }

  if (!sheetUrl) {
    await logRun({
      status: "error",
      error_text: "No sheet URL configured in app_settings",
    });
    return new Response(
      JSON.stringify({ error: "No sheet URL configured" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 2. Convert to CSV export URL
  let csvUrl: string;
  try {
    csvUrl = toCsvExportUrl(sheetUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logRun({ status: "error", sheet_url: sheetUrl, error_text: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Fetch CSV
  let csvText = "";
  let httpStatus = 0;
  try {
    const res = await fetch(csvUrl, { redirect: "follow" });
    httpStatus = res.status;
    if (!res.ok) {
      const detail =
        res.status === 401 || res.status === 403
          ? "Sheet is not published to web. In Google Sheets: File → Share → Publish to web → CSV → Publish."
          : `HTTP ${res.status}`;
      await logRun({
        status: "error",
        sheet_url: csvUrl,
        error_text: detail,
      });
      return new Response(
        JSON.stringify({ error: "Failed to fetch sheet", detail, http_status: res.status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    csvText = await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logRun({ status: "error", sheet_url: csvUrl, error_text: msg });
    return new Response(
      JSON.stringify({ error: "Failed to fetch sheet", detail: msg }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 4. Parse
  const matrix = parseCsv(csvText);
  const sheetRows = rowsToObjects(matrix);

  if (sheetRows.length === 0) {
    await logRun({
      status: "error",
      sheet_url: csvUrl,
      rows_in_sheet: 0,
      error_text: "Sheet contained no data rows (header-only or empty).",
    });
    return new Response(
      JSON.stringify({ error: "Sheet contained no data rows" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // 5. Upsert each row with last-modified-wins
  let upserted = 0;
  let skippedDbNewer = 0;
  let skippedNoChange = 0;
  let failed = 0;
  const failures: { brand: string; reason: string }[] = [];

  for (const r of sheetRows) {
    const brandName = (r.brand_name ?? "").trim();
    if (!brandName) {
      failed++;
      failures.push({ brand: "(blank)", reason: "missing brand_name" });
      continue;
    }
    try {
      const norm = normaliseBrand(brandName);
      const sheetTsRaw = r.updated_at?.trim();
      const sheetTs = sheetTsRaw ? new Date(sheetTsRaw).getTime() : NaN;
      if (!isFinite(sheetTs)) {
        failed++;
        failures.push({ brand: brandName, reason: "invalid updated_at" });
        continue;
      }

      const { data: existing } = await supabase
        .from("supplier_websites")
        .select("id, updated_at")
        .eq("brand_name_normalised", norm)
        .maybeSingle();

      const payload = {
        brand_name_display: r.canonical_brand_name?.trim() || brandName,
        canonical_brand_name: r.canonical_brand_name?.trim() || null,
        website_url: r.website_url?.trim() || null,
        is_shopify: asBool(r.is_shopify) ?? false,
        products_json_endpoint: r.products_json_endpoint?.trim() || null,
        country_origin: r.country_origin?.trim() || null,
        product_categories: r.product_categories?.trim() || null,
        enrichment_enabled: asBool(r.enrichment_enabled) ?? true,
        notes: r.notes?.trim() || null,
        updated_at: new Date(sheetTs).toISOString(),
        last_modified_by: "sheet" as const,
        source_sheet_row_id: r.source_sheet_row_id?.trim() || null,
      };

      if (existing) {
        const dbTs = new Date(existing.updated_at).getTime();
        if (dbTs > sheetTs) {
          skippedDbNewer++;
          continue;
        }
        if (dbTs === sheetTs) {
          skippedNoChange++;
          continue;
        }
        const { error } = await supabase
          .from("supplier_websites")
          .update(payload)
          .eq("id", existing.id);
        if (error) throw error;
        upserted++;
      } else {
        const { error } = await supabase
          .from("supplier_websites")
          .insert({ brand_name_normalised: norm, ...payload });
        if (error) throw error;
        upserted++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to sync brand "${brandName}":`, msg);
      failed++;
      failures.push({ brand: brandName, reason: msg });
    }
  }

  const status =
    failed > 0 ? "partial" : "success";

  // 6. Log run
  await logRun({
    status,
    sheet_url: csvUrl,
    rows_in_sheet: sheetRows.length,
    rows_upserted: upserted,
    rows_skipped_db_newer: skippedDbNewer,
    rows_skipped_no_change: skippedNoChange,
    rows_failed: failed,
    error_text: failures.length
      ? failures.slice(0, 10).map((f) => `${f.brand}: ${f.reason}`).join("; ")
      : null,
  });

  // 7. Update app_settings last-run metadata
  await supabase
    .from("app_settings")
    .update({
      brand_sync_last_run_at: new Date().toISOString(),
      brand_sync_last_status:
        failed > 0 ? `partial: ${failed} failed` : "success",
    })
    .eq("singleton", true);

  return new Response(
    JSON.stringify({
      ok: true,
      status,
      http_status: httpStatus,
      rows_in_sheet: sheetRows.length,
      upserted,
      skipped_db_newer: skippedDbNewer,
      skipped_no_change: skippedNoChange,
      failed,
      failures: failures.slice(0, 25),
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
