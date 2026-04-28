// ───────────────────────────────────────────────────────────────
// Enrich — Orchestrator
// Coordinates Query Builder → (Supplier Agent ‖ Web Agent) → Verifier
// to enrich an invoice line item with product details.
//
// POST body:
//   { productId: string, invoiceProduct: { brand, product_name, sku, ... } }
//
// Response:
//   { success, enrichedProduct?, confidence?, source?, action, error? }
// ───────────────────────────────────────────────────────────────

import { buildProductQuery } from "./queryBuilder.ts";
import { searchSupplier, type SupplierAgentResult } from "./supplierAgent.ts";
import { searchWeb, type WebAgentResult } from "./webAgent.ts";
import { verifyMatch, type InvoiceProduct } from "./verifierAgent.ts";
import { AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AGENT_TIMEOUT_MS = 10_000;
const TOTAL_BUDGET_MS = 25_000;
const MAX_QUERIES_TO_TRY = 3;
const MAX_CANDIDATES_TO_VERIFY = 3;

interface EnrichRequest {
  productId?: string;
  invoiceProduct?: InvoiceProduct;
}

interface NormalizedCandidate {
  source: "supplier" | "web";
  rawConfidence: number;
  data: {
    title: string;
    description: string;
    imageUrl: string;
    price: string;
    url?: string;
  };
}

function log(productId: string | undefined, step: string, info: Record<string, unknown> = {}) {
  // Surfaced via Supabase Edge Function logs.
  console.log(JSON.stringify({ fn: "enrich", productId: productId ?? null, step, ...info }));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function pickCandidates(
  supplier: PromiseSettledResult<SupplierAgentResult>,
  web: PromiseSettledResult<WebAgentResult>,
): NormalizedCandidate[] {
  const out: NormalizedCandidate[] = [];

  if (supplier.status === "fulfilled" && supplier.value.success) {
    const v = supplier.value;
    out.push({
      source: "supplier",
      rawConfidence: v.data.confidence ?? 90,
      data: {
        title: v.data.title,
        description: v.data.description,
        imageUrl: v.data.imageUrl,
        price: v.data.price,
        url: v.url,
      },
    });
  }

  if (web.status === "fulfilled" && web.value.success) {
    const v = web.value;
    out.push({
      source: "web",
      rawConfidence: v.confidence ?? 75,
      data: {
        title: v.data.title,
        description: v.data.description,
        imageUrl: v.data.imageUrl,
        price: v.data.price,
        url: v.data.url,
      },
    });
  }

  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  let productId: string | undefined;

  try {
    if (req.method !== "POST") {
      return json({ success: false, error: "Method not allowed", action: "skip" }, 405);
    }

    let body: EnrichRequest;
    try {
      body = await req.json();
    } catch {
      return json({ success: false, error: "Invalid JSON body", action: "skip" }, 400);
    }

    productId = body.productId;
    const invoiceProduct = body.invoiceProduct;

    if (!invoiceProduct || typeof invoiceProduct !== "object") {
      return json({ success: false, error: "invoiceProduct is required", action: "skip" }, 400);
    }

    const queries = buildProductQuery(invoiceProduct as Record<string, unknown>);
    log(productId, "queries_built", { count: queries.length, queries });

    if (queries.length === 0) {
      return json({ success: false, error: "No searchable fields on invoice product", action: "skip" });
    }

    const brand = String(invoiceProduct.brand ?? (invoiceProduct as { vendor?: string }).vendor ?? "").trim();
    if (!brand) {
      log(productId, "warn_missing_brand");
    }

    const candidatePool: NormalizedCandidate[] = [];
    let triedQueries = 0;

    for (const q of queries.slice(0, MAX_QUERIES_TO_TRY)) {
      triedQueries++;
      const elapsed = Date.now() - startedAt;
      const remaining = TOTAL_BUDGET_MS - elapsed;
      if (remaining < 4_000) {
        log(productId, "budget_exhausted", { elapsed });
        break;
      }
      const perAgentTimeout = Math.min(AGENT_TIMEOUT_MS, Math.max(3_000, remaining - 3_000));

      log(productId, "query_attempt", { attempt: triedQueries, query: q, perAgentTimeout });

      const supplierP = withTimeout(
        searchSupplier({ searchQuery: q, brand }),
        perAgentTimeout,
        "supplierAgent",
      ).catch((err) => ({ success: false as const, error: String(err?.message || err) }));

      const webP = withTimeout(
        searchWeb({ searchQuery: q }),
        perAgentTimeout,
        "webAgent",
      ).catch((err) => ({ success: false as const, error: String(err?.message || err) }));

      const [supplierRes, webRes] = await Promise.allSettled([supplierP, webP]);

      log(productId, "agents_settled", {
        supplier: supplierRes.status === "fulfilled" ? (supplierRes.value as { success: boolean }).success : "rejected",
        web: webRes.status === "fulfilled" ? (webRes.value as { success: boolean }).success : "rejected",
      });

      const candidates = pickCandidates(
        supplierRes as PromiseSettledResult<SupplierAgentResult>,
        webRes as PromiseSettledResult<WebAgentResult>,
      );

      if (candidates.length > 0) {
        candidatePool.push(...candidates);
        log(productId, "candidates_collected", {
          count: candidates.length,
          total: candidatePool.length,
          sources: candidates.map((c) => c.source),
        });
      }
    }

    if (candidatePool.length === 0) {
      log(productId, "no_candidate", { triedQueries });
      return json({
        success: false,
        error: "Could not enrich",
        action: "skip",
        triedQueries,
      });
    }

    candidatePool.sort((a, b) => b.rawConfidence - a.rawConfidence);
    const candidatesToVerify = candidatePool.slice(0, MAX_CANDIDATES_TO_VERIFY);

    // ─── Verify ────────────────────────────────────────────────
    let verifierConfidence = bestCandidate.rawConfidence;
    let verifierMatch: string = "unknown";
    let verifierReasoning = "";

    try {
      const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
      if (remaining < 2_000) {
        log(productId, "verifier_skipped_budget", { remaining });
      } else {
        const verifyP = verifyMatch(invoiceProduct, {
          title: bestCandidate.data.title,
          description: bestCandidate.data.description,
          imageUrl: bestCandidate.data.imageUrl,
          price: bestCandidate.data.price,
          source: bestCandidate.source,
        });
        const v = await withTimeout(verifyP, Math.min(8_000, remaining - 1_000), "verifierAgent");
        verifierConfidence = v.confidence;
        verifierMatch = v.match;
        verifierReasoning = v.reasoning;
        log(productId, "verifier_done", {
          confidence: v.confidence,
          match: v.match,
          warnings: v.warnings,
        });
      }
    } catch (err) {
      if (err instanceof AIGatewayError && (err.status === 429 || err.status === 402)) {
        log(productId, "verifier_ai_limit", { status: err.status, message: err.message });
        // Fall back to raw confidence rather than failing the whole pipeline
      } else {
        log(productId, "verifier_error", { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ─── Decide action ─────────────────────────────────────────
    const enrichedProduct = {
      title: bestCandidate.data.title,
      description: bestCandidate.data.description,
      imageUrl: bestCandidate.data.imageUrl,
      price: bestCandidate.data.price,
      sourceUrl: bestCandidate.data.url,
      confidence: verifierConfidence,
    };

    const elapsedMs = Date.now() - startedAt;

    if (verifierConfidence >= 85) {
      log(productId, "result_auto_accept", { confidence: verifierConfidence, elapsedMs });
      return json({
        success: true,
        enrichedProduct,
        confidence: verifierConfidence,
        source: bestCandidate.source,
        match: verifierMatch,
        reasoning: verifierReasoning,
        action: "auto_accept",
        elapsedMs,
      });
    }

    if (verifierConfidence >= 50) {
      log(productId, "result_needs_review", { confidence: verifierConfidence, elapsedMs });
      return json({
        success: true,
        enrichedProduct,
        confidence: verifierConfidence,
        source: bestCandidate.source,
        match: verifierMatch,
        reasoning: verifierReasoning,
        action: "needs_review",
        elapsedMs,
      });
    }

    log(productId, "result_skip_low_confidence", { confidence: verifierConfidence, elapsedMs });
    return json({
      success: false,
      error: "Could not enrich",
      confidence: verifierConfidence,
      action: "skip",
      elapsedMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof AIGatewayError ? err.status : 500;
    log(productId, "fatal_error", { error: message, status });
    return json({ success: false, error: message, action: "skip" }, status);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
