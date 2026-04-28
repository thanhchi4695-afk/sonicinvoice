// ───────────────────────────────────────────────────────────────
// Enrich — Local Test Harness
//
// Simulates enrichment runs without needing the Edge Function HTTP
// layer or a UI. Imports the orchestrator agents directly and prints
// results to console.
//
// Usage (from project root):
//   deno run --allow-net --allow-env supabase/functions/enrich/testHarness.ts
//
// Run a single example by name:
//   deno run --allow-net --allow-env supabase/functions/enrich/testHarness.ts zimmermann
//
// Required env vars (export before running):
//   BRAVE_SEARCH_API_KEY=...   # Brave Search API key
//   LOVABLE_API_KEY=...        # AI Gateway key (used by verifierAgent)
//
// ⚠️  Only run in a secure environment — this hits real third-party
// APIs (Brave + AI Gateway) and consumes quota.
// ───────────────────────────────────────────────────────────────

import { buildProductQuery } from "./queryBuilder.ts";
import { searchSupplier } from "./supplierAgent.ts";
import { searchWeb } from "./webAgent.ts";
import { verifyMatch, type InvoiceProduct } from "./verifierAgent.ts";

interface HarnessResult {
  product: InvoiceProduct;
  queries: string[];
  supplier: unknown;
  web: unknown;
  verifier?: unknown;
  decision: "auto_accept" | "needs_review" | "skip";
  confidence: number;
  elapsedMs: number;
}

const EXAMPLES: Record<string, InvoiceProduct> = {
  zimmermann: {
    brand: "Zimmermann",
    product_name: "Linen Midi Dress",
    sku: "ZIM-1234-IVR",
    colour: "Ivory",
    size: "10",
    price: "850.00",
    cost: "395.00",
  },
  aje: {
    brand: "Aje",
    product_name: "Cropped Blazer",
    sku: "AJE-BLZ-CRP-BLK",
    colour: "Black",
    size: "8",
    price: "495.00",
    cost: "210.00",
  },
  camilla: {
    brand: "Camilla",
    product_name: "Silk Kaftan",
    sku: "CAM-KFT-001",
    colour: "Multi",
    size: "M",
    price: "699.00",
    cost: "320.00",
  },
};

/**
 * Run the full enrich pipeline against a single invoice product.
 * Prints structured progress to console and returns a summary.
 */
export async function runTest(invoiceProduct: InvoiceProduct): Promise<HarnessResult> {
  const startedAt = Date.now();
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("▶ runTest:", invoiceProduct.brand, "—", invoiceProduct.product_name);
  console.log("══════════════════════════════════════════════════════════════");

  const queries = buildProductQuery(invoiceProduct as Record<string, unknown>);
  console.log("• queries:", queries);

  if (queries.length === 0) {
    const result: HarnessResult = {
      product: invoiceProduct,
      queries,
      supplier: null,
      web: null,
      decision: "skip",
      confidence: 0,
      elapsedMs: Date.now() - startedAt,
    };
    console.log("✗ no searchable fields — skipping");
    return result;
  }

  const q = queries[0];
  const brand = String(invoiceProduct.brand ?? "").trim();

  console.log(`\n→ Running supplier + web agents in parallel for query: "${q}"`);
  const [supplierRes, webRes] = await Promise.allSettled([
    searchSupplier({ searchQuery: q, brand }),
    searchWeb({ searchQuery: q }),
  ]);

  const supplier = supplierRes.status === "fulfilled" ? supplierRes.value : { success: false, error: String(supplierRes.reason) };
  const web = webRes.status === "fulfilled" ? webRes.value : { success: false, error: String(webRes.reason) };

  console.log("• supplier:", JSON.stringify(supplier, null, 2));
  console.log("• web:     ", JSON.stringify(web, null, 2));

  // Pick the best candidate (supplier preferred when both succeed)
  let candidate: { source: "supplier" | "web"; data: { title: string; description: string; imageUrl: string; price: string } } | null = null;
  if ((supplier as { success?: boolean }).success) {
    const s = supplier as { data: { title: string; description: string; imageUrl: string; price: string } };
    candidate = { source: "supplier", data: s.data };
  } else if ((web as { success?: boolean }).success) {
    const w = web as { data: { title: string; description: string; imageUrl: string; price: string } };
    candidate = { source: "web", data: w.data };
  }

  if (!candidate) {
    const result: HarnessResult = {
      product: invoiceProduct,
      queries,
      supplier,
      web,
      decision: "skip",
      confidence: 0,
      elapsedMs: Date.now() - startedAt,
    };
    console.log("✗ no candidate found — skipping");
    return result;
  }

  console.log(`\n→ Verifying ${candidate.source} candidate via AI gateway…`);
  let confidence = candidate.source === "supplier" ? 90 : 75;
  let verifier: unknown = null;
  try {
    const v = await verifyMatch(invoiceProduct, {
      title: candidate.data.title,
      description: candidate.data.description,
      imageUrl: candidate.data.imageUrl,
      price: candidate.data.price,
      source: candidate.source,
    });
    verifier = v;
    confidence = v.confidence;
    console.log("• verifier:", JSON.stringify(v, null, 2));
  } catch (err) {
    console.warn("⚠ verifier failed, falling back to raw confidence:", err instanceof Error ? err.message : err);
  }

  const decision: HarnessResult["decision"] =
    confidence >= 85 ? "auto_accept" : confidence >= 50 ? "needs_review" : "skip";

  const elapsedMs = Date.now() - startedAt;
  console.log(`\n✓ decision: ${decision} (confidence ${confidence}, ${elapsedMs}ms)`);

  return {
    product: invoiceProduct,
    queries,
    supplier,
    web,
    verifier,
    decision,
    confidence,
    elapsedMs,
  };
}

// ───────────────────────────────────────────────────────────────
// CLI entrypoint
// ───────────────────────────────────────────────────────────────
if (import.meta.main) {
  const arg = (Deno.args[0] || "").toLowerCase();
  const targets = arg && EXAMPLES[arg] ? [EXAMPLES[arg]] : Object.values(EXAMPLES);

  // Sanity-check required env vars (warn rather than fail — agents will report cleanly)
  if (!Deno.env.get("BRAVE_SEARCH_API_KEY")) {
    console.warn("⚠ BRAVE_SEARCH_API_KEY not set — webAgent will fail.");
  }
  if (!Deno.env.get("LOVABLE_API_KEY")) {
    console.warn("⚠ LOVABLE_API_KEY not set — verifierAgent will fall back to raw confidence.");
  }

  const summary: Array<Pick<HarnessResult, "decision" | "confidence" | "elapsedMs"> & { product: string }> = [];
  for (const p of targets) {
    try {
      const r = await runTest(p);
      summary.push({
        product: `${p.brand} — ${p.product_name}`,
        decision: r.decision,
        confidence: r.confidence,
        elapsedMs: r.elapsedMs,
      });
    } catch (err) {
      console.error("✗ runTest threw:", err);
      summary.push({
        product: `${p.brand} — ${p.product_name}`,
        decision: "skip",
        confidence: 0,
        elapsedMs: 0,
      });
    }
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("Summary");
  console.log("══════════════════════════════════════════════════════════════");
  console.table(summary);
}
