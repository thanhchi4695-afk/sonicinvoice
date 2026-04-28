// ════════════════════════════════════════════════════════════════
// llm-extractor.ts — Strategy 3 of the URL Product Extractor cascade.
//
// Sends a truncated HTML snippet to the Lovable AI Gateway and asks
// it to return a strict JSON product object. Used only when JSON-LD
// (Strategy 1) and DOM selectors (Strategy 2) both miss.
// ════════════════════════════════════════════════════════════════

import { callAI, getContent } from "../_shared/ai-gateway.ts";
import type { ProductData } from "./jsonld-parser.ts";

const HTML_CHAR_BUDGET = 8_000;
const LLM_TIMEOUT_MS = 10_000;
const MODEL = "google/gemini-3-flash-preview";

const SYSTEM_PROMPT =
  "You are an e-commerce product data extractor. Return only valid JSON. No prose, no markdown fences.";

function buildUserPrompt(truncatedHtml: string, url: string): string {
  return [
    `Extract product information from the following HTML snippet (from ${url}).`,
    `Return JSON with fields: name, description, price (as number), currency (ISO code, e.g. USD, AUD, EUR), imageUrls (array of strings).`,
    `If a field is missing, use null. Do not include any extra text.`,
    ``,
    `HTML:`,
    truncatedHtml,
  ].join("\n");
}

/** Strip ```json fences if the model adds them despite instructions. */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function coerceImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function coercePrice(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const num = parseFloat(value.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(num) ? String(num) : null;
  }
  return null;
}

function coerceCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export async function extractWithLLM(html: string, url: string): Promise<ProductData | null> {
  if (!html || typeof html !== "string") return null;

  const truncated = html.length > HTML_CHAR_BUDGET ? html.slice(0, HTML_CHAR_BUDGET) : html;

  // Hard 10s timeout — race the gateway call against AbortSignal.timeout
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => {
      console.warn("[llm-extractor] aborted after", LLM_TIMEOUT_MS, "ms");
      resolve(null);
    }, LLM_TIMEOUT_MS),
  );

  let raw: string;
  try {
    const result = await Promise.race([
      callAI({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(truncated, url) },
        ],
        temperature: 0,
      }),
      timeout,
    ]);

    if (!result) return null; // timeout
    raw = getContent(result);
  } catch (err) {
    console.warn("[llm-extractor] gateway error:", (err as Error).message);
    return null;
  }

  if (!raw) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch (err) {
    console.warn("[llm-extractor] JSON parse failed:", (err as Error).message, "raw:", raw.slice(0, 200));
    return null;
  }

  const price = coercePrice(parsed.price);
  const currency = coerceCurrency(parsed.currency);
  const imageUrls = coerceImageUrls(parsed.imageUrls);
  const name = typeof parsed.name === "string" ? parsed.name.trim() : null;
  const description = typeof parsed.description === "string" ? parsed.description.trim() : null;

  // Need at least a name OR price+image to be considered useful
  if (!name && !price && imageUrls.length === 0) return null;

  return {
    name,
    description,
    price,
    currency,
    imageUrls,
    sku: null,
    brand: null,
  };
}
