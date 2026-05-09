#!/usr/bin/env node
/**
 * Batch import brand profile .md files into public.brand_profiles.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/import-brand-profiles.mjs <folder>
 *
 * Each .md file is upserted on supplier_key (filename minus .md).
 * Parses these fields out of the markdown:
 *   - supplier_name      ← `# SUPPLIER SKILL: <name>`
 *   - confidence         ← `Confidence: <n>%`
 *   - supplier_legal     ← `Legal entity: <value>`
 *   - shopify_vendor     ← first `Vendor: <value>` (Shopify Mapping section)
 *   - raw_md             ← full file content
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

export function parseProfile(filename, content) {
  const supplier_key = basename(filename, extname(filename))
    .toLowerCase()
    .trim();

  const pick = (re) => {
    const m = content.match(re);
    return m ? m[1].trim() : null;
  };

  const supplier_name =
    pick(/^#\s*SUPPLIER SKILL:\s*(.+?)\s*$/m) || supplier_key;
  const confRaw = pick(/^\s*Confidence:\s*(\d{1,3})\s*%/mi);
  const confidence = confRaw ? Math.max(0, Math.min(100, parseInt(confRaw, 10))) : 65;
  const strip = (s) => s == null ? null : s.replace(/^[`*\s]+|[`*\s]+$/g, "") || null;
  const supplier_legal = strip(pick(/Legal entity[^\n:]*:\s*(.+?)\s*$/mi));
  const shopify_vendor = strip(pick(/(?:^|\n)\s*[-*]?\s*Vendor\s*:\s*(.+?)\s*$/mi));

  return {
    supplier_key,
    supplier_name,
    supplier_legal,
    shopify_vendor,
    confidence,
    raw_md: content,
    updated_at: new Date().toISOString(),
  };
}

export function collectProfiles(folder) {
  const dir = resolve(folder);
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .filter((f) => !/profile-session-report/i.test(f))
    .filter((f) => statSync(join(dir, f)).isFile())
    .map((f) => parseProfile(f, readFileSync(join(dir, f), "utf8")));
}

export async function importBrandProfiles(folder, supabase) {
  const rows = collectProfiles(folder);
  if (!rows.length) return { count: 0, rows: [] };
  const { error } = await supabase
    .from("brand_profiles")
    .upsert(rows, { onConflict: "supplier_key" });
  if (error) throw error;
  return { count: rows.length, rows };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const folder = process.argv[2];
  if (!folder) {
    console.error("Usage: node scripts/import-brand-profiles.mjs <folder>");
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { count, rows } = await importBrandProfiles(folder, supabase);
  console.log(`Upserted ${count} brand profiles:`);
  for (const r of rows) {
    console.log(
      ` - ${r.supplier_key.padEnd(24)} | ${String(r.supplier_name).padEnd(30)} | conf=${r.confidence}% | vendor=${r.shopify_vendor ?? "-"}`,
    );
  }
}
