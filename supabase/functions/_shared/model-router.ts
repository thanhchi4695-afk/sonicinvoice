/**
 * Job → Model router.
 *
 * Single source of truth for which model handles which job in the Sonic
 * pipeline. Edge functions should call `callAIForJob(job, { messages, ... })`
 * instead of hard-coding a model id, so routing decisions live in one place
 * and can be tuned without touching every function.
 *
 * Built on top of `_shared/ai-gateway.ts` — keeps the 60s timeout, automatic
 * model fallback chain, Anthropic direct path, rate-limit / 402 handling and
 * cost tracking.
 */
import { callAI, type AIRequestOptions } from "./ai-gateway.ts";

export type AIJob =
  // ── Layer 1: parsing ────────────────────────────────────────────────
  | "invoice.parse"          // PDF / image → structured line items
  | "invoice.classify"       // Determine invoice type (A–F) + supplier
  | "packing-slip.parse"     // Packing slips (style/colour/size/qty only)
  | "image.ocr"              // Photo/scan OCR fallback

  // ── Layer 2: brand intelligence & tagging ───────────────────────────
  | "brand.tag"              // Apply 187-rule tag engine + size norm
  | "product.naming"         // "[Colour] + [Feature] + [Type]" titles
  | "product.enrich"         // Full Shopify-ready row from extracted data
  | "seo.description"        // Long-form SEO copy
  | "collection.architect"   // Collection structure / hierarchy

  // ── Layer 3: competitive enrichment ─────────────────────────────────
  | "price.lookup"           // Live AU RRP lookup (web-grounded)
  | "competitor.scan"        // Competitor pricing intelligence

  // ── Misc ────────────────────────────────────────────────────────────
  | "classify.simple"        // Cheap classification / routing
  | "chat.assistant";        // In-app conversational helper

/**
 * Default model per job. Anything matching `anthropic/*` goes direct to
 * Anthropic API (system prompt size, structured output reliability). Anything
 * else flows through the Lovable AI Gateway with the standard fallback chain
 * defined in `ai-gateway.ts`.
 */
const JOB_MODEL: Record<AIJob, string> = {
  // Parsing — Gemini 2.5 Pro primary (best on size matrices + handwriting).
  // Fallback chain in ai-gateway.ts already drops to Flash on Pro outage.
  "invoice.parse":        "google/gemini-2.5-pro",
  "invoice.classify":     "google/gemini-2.5-flash",
  "packing-slip.parse":   "google/gemini-2.5-flash",
  "image.ocr":            "google/gemini-2.5-flash",

  // Brand intelligence — Claude Sonnet 4.5 (large system prompts, rule
  // adherence, structured CSV output). Falls back to Gemini 2.5 Flash via
  // the ai-gateway fallback chain if Anthropic is unreachable.
  "brand.tag":            "anthropic/claude-sonnet-4-5",
  "product.naming":       "anthropic/claude-sonnet-4-5",
  "product.enrich":       "anthropic/claude-sonnet-4-5",
  "seo.description":      "anthropic/claude-sonnet-4-5",
  "collection.architect": "anthropic/claude-sonnet-4-5",

  // Web-grounded enrichment — keep on gateway Gemini for now. The cheaper
  // /products.json scrape path runs before this; only call when scrape miss.
  "price.lookup":         "google/gemini-2.5-flash",
  "competitor.scan":      "google/gemini-2.5-flash",

  // Misc
  "classify.simple":      "google/gemini-3-flash-preview",
  "chat.assistant":       "google/gemini-2.5-flash",
};

/** Per-job timeout overrides (ms). Defaults to 60s otherwise. */
const JOB_TIMEOUT_MS: Partial<Record<AIJob, number>> = {
  "invoice.parse":        90_000,  // multi-page PDFs
  "brand.tag":            75_000,  // large system prompt + many variants
  "product.enrich":       75_000,
  "collection.architect": 75_000,
  "price.lookup":         45_000,
};

export interface JobCallOptions extends Omit<AIRequestOptions, "model"> {
  /** Override the default model for this job (e.g. A/B testing). */
  modelOverride?: string;
}

// ── DB-backed overrides (cached) ─────────────────────────────────────────
// Admins can flip a job's model in the `ai_model_overrides` table without
// redeploying. Cached in-memory per worker for 60s to avoid hot-path DB hits.
const OVERRIDE_TTL_MS = 60_000;
let overrideCache: Record<string, string> = {};
let overrideCacheAt = 0;
let overrideInflight: Promise<void> | null = null;

async function refreshOverrides(): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  try {
    const res = await fetch(`${url}/rest/v1/ai_model_overrides?select=job,model`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return;
    const rows = await res.json() as Array<{ job: string; model: string }>;
    overrideCache = Object.fromEntries(rows.map((r) => [r.job, r.model]));
    overrideCacheAt = Date.now();
  } catch (e) {
    console.warn("[model-router] override fetch failed:", e);
  }
}

async function getOverride(job: AIJob): Promise<string | undefined> {
  if (Date.now() - overrideCacheAt > OVERRIDE_TTL_MS) {
    if (!overrideInflight) overrideInflight = refreshOverrides().finally(() => { overrideInflight = null; });
    await overrideInflight;
  }
  return overrideCache[job];
}

/**
 * Run an AI call for a named job. Looks up the configured model + timeout
 * (with optional admin DB override) and delegates to the shared gateway helper.
 */
export async function callAIForJob(job: AIJob, options: JobCallOptions) {
  const dbOverride = await getOverride(job);
  const model = options.modelOverride ?? dbOverride ?? JOB_MODEL[job];
  const timeoutMs = options.timeoutMs ?? JOB_TIMEOUT_MS[job] ?? 60_000;
  const { modelOverride: _omit, ...rest } = options;
  return callAI({ ...rest, model, timeoutMs });
}

/** Inspect the model currently configured for a job (for logging / UI). */
export function getModelForJob(job: AIJob): string {
  return JOB_MODEL[job];
}

/** Full job → model map, for admin UI / observability. */
export function getJobModelMap(): Readonly<Record<AIJob, string>> {
  return JOB_MODEL;
}
