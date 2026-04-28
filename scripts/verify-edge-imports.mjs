#!/usr/bin/env node
/**
 * Pre-deploy verifier for Supabase Edge Function imports.
 *
 * Why this exists:
 *   Some upstream content filters mangle `name@version` strings into
 *   "[email protected]" (Cloudflare-style email obfuscation), which silently
 *   breaks `npm:` and `https://deno.land/x/...@vX.Y.Z` specifiers and only
 *   surfaces as an opaque "Module not found" at deploy time.
 *
 * What it does:
 *   1. Walks supabase/functions/** and extracts every import URL.
 *   2. Prints each URL RAW (with byte length + first 120 chars) so you can
 *      visually confirm there's no obfuscation in the on-disk file.
 *   3. Fails (exit 1) if any URL:
 *        - contains the literal "[email protected]" / "[email " mangle
 *        - uses deno.land/x without a pinned `@vX.Y.Z`
 *        - uses an `npm:` specifier without an `@version`
 *        - (optional) is unreachable over the network (HEAD/GET 200/302)
 *
 * Usage:
 *   node scripts/verify-edge-imports.mjs            # static checks only
 *   node scripts/verify-edge-imports.mjs --network  # also probe URLs
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = "supabase/functions";
const NETWORK = process.argv.includes("--network");

const IMPORT_RE = /(?:import\s+(?:[^"']+?\s+from\s+)?|export\s+[^"']+?\s+from\s+)["']([^"']+)["']/g;
const MANGLE_RE = /\[email[\s\u00A0\u200B-]protected\]|\[email\s/i;

/** Recursively list .ts/.js files under dir. */
async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      out.push(...(await walk(p)));
    } else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function classify(url) {
  const issues = [];

  if (MANGLE_RE.test(url)) {
    issues.push('MANGLED: contains "[email protected]" obfuscation — rewrite with python/sed, not the editor');
  }

  if (/^https?:\/\/deno\.land\/x\//.test(url)) {
    if (!/@v?\d+\.\d+\.\d+/.test(url)) {
      issues.push("UNPINNED deno.land/x URL — add @vX.Y.Z");
    }
  }

  if (/^npm:/.test(url)) {
    // strip leading "npm:" and any subpath; require @version on the package
    const spec = url.slice(4);
    const pkg = spec.startsWith("@")
      ? spec.split("/").slice(0, 2).join("/")
      : spec.split("/")[0];
    if (!/@\d/.test(pkg)) {
      issues.push("UNPINNED npm: specifier — add @version");
    }
  }

  return issues;
}

async function probe(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return `HTTP ${res.status}`;
    return null;
  } catch (e) {
    return `fetch failed: ${e?.message || e}`;
  }
}

async function main() {
  const exists = await stat(ROOT).catch(() => null);
  if (!exists) {
    console.error(`No ${ROOT} directory found.`);
    process.exit(0);
  }

  const files = await walk(ROOT);
  let total = 0;
  const failures = [];

  console.log(`\n🔍 Scanning ${files.length} edge function file(s) under ${ROOT}\n`);

  for (const file of files) {
    const src = await readFile(file, "utf8");
    const urls = new Set();
    for (const m of src.matchAll(IMPORT_RE)) {
      const u = m[1];
      // only care about remote / npm specifiers
      if (/^(https?:|npm:|jsr:|node:)/.test(u)) urls.add(u);
    }
    if (!urls.size) continue;

    console.log(`📄 ${relative(process.cwd(), file)}`);
    for (const url of urls) {
      total += 1;
      const bytes = Buffer.byteLength(url, "utf8");
      const preview = url.length > 120 ? url.slice(0, 117) + "..." : url;
      console.log(`   • [${bytes}B] ${preview}`);

      const issues = classify(url);
      for (const i of issues) {
        console.log(`     ❌ ${i}`);
        failures.push({ file, url, issue: i });
      }

      if (NETWORK && /^https?:/.test(url) && issues.length === 0) {
        const err = await probe(url);
        if (err) {
          console.log(`     ❌ UNREACHABLE: ${err}`);
          failures.push({ file, url, issue: `UNREACHABLE: ${err}` });
        } else {
          console.log(`     ✅ reachable`);
        }
      }
    }
    console.log("");
  }

  console.log(`Checked ${total} import URL(s) across ${files.length} file(s).`);
  if (failures.length) {
    console.log(`\n❌ ${failures.length} problem(s) found:`);
    for (const f of failures) {
      console.log(`   - ${relative(process.cwd(), f.file)}\n     ${f.url}\n     ${f.issue}`);
    }
    console.log(
      `\nTip: if a URL is mangled to "[email protected]", rewrite the import line with` +
      `\n     python3/sed (the editor pipeline applies an email-obfuscation filter).`,
    );
    process.exit(1);
  }
  console.log("\n✅ All edge function imports look clean.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
