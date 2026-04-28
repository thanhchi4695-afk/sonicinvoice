// ───────────────────────────────────────────────────────────────
// Verifier Agent
// Compares an invoice product against a candidate product found by
// the Supplier Agent or Web Agent and returns a calibrated
// confidence score (0–100) plus reasoning, using Lovable AI via
// the shared callAI gateway and tool-calling for structured output.
// ───────────────────────────────────────────────────────────────

import { callAI, getToolArgs, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

export interface InvoiceProduct {
  brand?: string | null;
  product_name?: string | null;
  sku?: string | null;
  colour?: string | null;
  size?: string | null;
  price?: number | string | null;
  cost?: number | string | null;
}

export interface CandidateProduct {
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  price?: number | string | null;
  source?: "supplier" | "web" | string | null;
}

export interface VerifierResult {
  confidence: number;          // 0–100
  match: "strong" | "partial" | "weak" | "none";
  reasoning: string;
  field_matches: {
    brand: boolean;
    product_name: boolean;
    colour: boolean;
    price: boolean;
  };
  warnings: string[];
}

const SYSTEM_PROMPT = `You are a product-match verifier for a retail invoice processing system.
Compare an INVOICE product against a CANDIDATE product found on a supplier's website or the open web,
and decide how confident you are that they refer to the same physical product.

Score on a 0–100 scale where:
  90–100 = strong match (brand + product name + (colour OR sku) all align)
  70–89  = partial match (brand + product name align, minor attribute drift)
  40–69  = weak match (overlapping keywords only)
  0–39   = different products

Be strict. Penalise:
  - brand mismatch (heavy penalty)
  - large price discrepancies (>40%) when both prices are present
  - colour/material contradictions
  - obviously different product types (e.g. dress vs pant)

Reward:
  - exact brand match
  - SKU/style code appearing in candidate title or description
  - colour and size present and aligned
  - candidate from "supplier" source slightly more than "web"

Return your answer ONLY via the verify_match tool call.`;

const VERIFY_TOOL = {
  type: "function",
  function: {
    name: "verify_match",
    description: "Return a structured product match verification.",
    parameters: {
      type: "object",
      properties: {
        confidence: {
          type: "number",
          description: "Confidence score from 0 to 100 that the two products are the same.",
          minimum: 0,
          maximum: 100,
        },
        match: {
          type: "string",
          enum: ["strong", "partial", "weak", "none"],
        },
        reasoning: {
          type: "string",
          description: "1–3 sentence explanation citing the specific fields that did or did not align.",
        },
        field_matches: {
          type: "object",
          properties: {
            brand: { type: "boolean" },
            product_name: { type: "boolean" },
            colour: { type: "boolean" },
            price: { type: "boolean" },
          },
          required: ["brand", "product_name", "colour", "price"],
          additionalProperties: false,
        },
        warnings: {
          type: "array",
          items: { type: "string" },
          description: "Notable risks (e.g. 'price differs by 60%', 'brand missing on candidate').",
        },
      },
      required: ["confidence", "match", "reasoning", "field_matches", "warnings"],
      additionalProperties: false,
    },
  },
} as const;

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function buildUserPrompt(invoiceProduct: InvoiceProduct, candidate: CandidateProduct): string {
  const fmt = (v: unknown) =>
    v === null || v === undefined || v === "" ? "—" : String(v);

  return `INVOICE PRODUCT:
  brand:        ${fmt(invoiceProduct.brand)}
  product_name: ${fmt(invoiceProduct.product_name)}
  sku:          ${fmt(invoiceProduct.sku)}
  colour:       ${fmt(invoiceProduct.colour)}
  size:         ${fmt(invoiceProduct.size)}
  price:        ${fmt(invoiceProduct.price)}
  cost:         ${fmt(invoiceProduct.cost)}

CANDIDATE PRODUCT (source: ${fmt(candidate.source)}):
  title:        ${fmt(candidate.title)}
  description:  ${fmt(candidate.description)}
  imageUrl:     ${fmt(candidate.imageUrl)}
  price:        ${fmt(candidate.price)}

Compare them and return your verdict via the verify_match tool.`;
}

/**
 * Verify whether a candidate product matches an invoice product.
 * Uses the shared AI gateway with tool-calling for reliable structured output.
 */
export async function verifyMatch(
  invoiceProduct: InvoiceProduct,
  candidate: CandidateProduct,
): Promise<VerifierResult> {
  if (!invoiceProduct || typeof invoiceProduct !== "object") {
    throw new Error("invoiceProduct is required");
  }
  if (!candidate || typeof candidate !== "object") {
    throw new Error("candidate is required");
  }

  try {
    const response = await callAI({
      model: "google/gemini-3-flash-preview",
      temperature: 0.1,
      max_tokens: 500,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(invoiceProduct, candidate) },
      ],
      tools: [VERIFY_TOOL],
      tool_choice: { type: "function", function: { name: "verify_match" } },
    });

    // Prefer tool-call output; fall back to parsing message content if needed.
    const toolArgs = getToolArgs(response);
    let parsed: Partial<VerifierResult> | null = null;

    if (toolArgs) {
      try { parsed = JSON.parse(toolArgs); } catch { /* fall through */ }
    }
    if (!parsed) {
      const raw = getContent(response).trim();
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch { /* fall through */ }
      }
    }

    if (!parsed) {
      return {
        confidence: 0,
        match: "none",
        reasoning: "Verifier returned no parseable response.",
        field_matches: { brand: false, product_name: false, colour: false, price: false },
        warnings: ["verifier_no_response"],
      };
    }

    return {
      confidence: clamp(Math.round(Number(parsed.confidence ?? 0)), 0, 100),
      match: (["strong", "partial", "weak", "none"].includes(String(parsed.match))
        ? parsed.match
        : "none") as VerifierResult["match"],
      reasoning: String(parsed.reasoning ?? "").trim(),
      field_matches: {
        brand: !!parsed.field_matches?.brand,
        product_name: !!parsed.field_matches?.product_name,
        colour: !!parsed.field_matches?.colour,
        price: !!parsed.field_matches?.price,
      },
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
    };
  } catch (err) {
    if (err instanceof AIGatewayError) throw err;
    console.error("[verifierAgent] verifyMatch failed:", err);
    return {
      confidence: 0,
      match: "none",
      reasoning: err instanceof Error ? err.message : "Verifier failed",
      field_matches: { brand: false, product_name: false, colour: false, price: false },
      warnings: ["verifier_error"],
    };
  }
}

export default verifyMatch;
