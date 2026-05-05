/**
 * Shared AI Gateway helper with model fallback and error handling.
 * Import from edge functions: import { callAI } from "../_shared/ai-gateway.ts";
 */

const AI_GATEWAY_URL = Deno.env.get("AI_GATEWAY_URL") || "https://ai.gateway.lovable.dev/v1/chat/completions";

// Model tiers with fallbacks
const MODEL_FALLBACKS: Record<string, string[]> = {
  // Fast / cheap tier
  "google/gemini-3-flash-preview": [
    "google/gemini-3-flash-preview",
    "google/gemini-2.5-flash",
    "google/gemini-2.5-flash-lite",
  ],
  // Mid tier (multimodal + reasoning)
  "google/gemini-2.5-flash": [
    "google/gemini-2.5-flash",
    "google/gemini-3-flash-preview",
    "google/gemini-2.5-flash-lite",
  ],
  // Pro tier (complex reasoning)
  "google/gemini-2.5-pro": [
    "google/gemini-2.5-pro",
    "google/gemini-3.1-pro-preview",
    "google/gemini-2.5-flash",
  ],
  // Anthropic Claude — primary for invoice extraction (highest accuracy on
  // structured tabular data). Falls back to Gemini if Anthropic is unreachable.
  "anthropic/claude-sonnet-4-5": [
    "anthropic/claude-sonnet-4-5",
    "anthropic/claude-haiku-4-5",
    "google/gemini-2.5-flash",
  ],
  "anthropic/claude-haiku-4-5": [
    "anthropic/claude-haiku-4-5",
    "google/gemini-2.5-flash",
  ],
};

function getFallbacks(model: string): string[] {
  return MODEL_FALLBACKS[model] || [model, "google/gemini-3-flash-preview", "google/gemini-2.5-flash"];
}

interface AIRequestOptions {
  model: string;
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
  temperature?: number;
  max_tokens?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  /** Per-call timeout in ms. Defaults to 60_000. Pass an AbortSignal for full control. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** Returns a signal that aborts when either the caller signal aborts or `ms` elapses. */
function buildSignal(ms: number, external?: AbortSignal): { signal: AbortSignal; cancel: () => void } {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error(`AI request timed out after ${ms}ms`)), ms);
  if (external) {
    if (external.aborted) ctl.abort(external.reason);
    else external.addEventListener("abort", () => ctl.abort(external.reason), { once: true });
  }
  return { signal: ctl.signal, cancel: () => clearTimeout(timer) };
}

interface AIResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        function: { name: string; arguments: string };
      }>;
    };
  }>;
}

export async function callAI(options: AIRequestOptions): Promise<AIResponse> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    throw new AIGatewayError("LOVABLE_API_KEY is not configured", 500);
  }

  const fallbacks = getFallbacks(options.model);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: Error | null = null;

  for (const model of fallbacks) {
    const { signal, cancel } = buildSignal(timeoutMs, options.signal);
    try {
      // Anthropic models go directly to api.anthropic.com (not the Lovable gateway).
      if (model.startsWith("anthropic/")) {
        const data = await callAnthropicAPI(model, options, signal);
        if (data.choices?.[0]) return data;
        lastError = new Error(`Anthropic model ${model} returned no choices`);
        continue;
      }

      const body: Record<string, unknown> = {
        model,
        messages: options.messages,
      };
      if (options.temperature !== undefined) body.temperature = options.temperature;
      if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
      if (options.tools) body.tools = options.tools;
      if (options.tool_choice) body.tool_choice = options.tool_choice;

      const response = await fetch(AI_GATEWAY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });

      // Retryable model errors — try next fallback
      if (response.status === 404 || response.status === 410) {
        console.warn(`Model ${model} unavailable (${response.status}), trying next fallback...`);
        lastError = new Error(`Model ${model} returned ${response.status}`);
        continue;
      }

      // Rate limit / payment — surface immediately
      if (response.status === 429) {
        throw new AIGatewayError("Rate limit exceeded. Please try again in a moment.", 429);
      }
      if (response.status === 402) {
        throw new AIGatewayError("AI credits exhausted. Please add funds in Settings → Workspace → Usage.", 402);
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error(`AI gateway error (${model}): ${response.status}`, errText);
        lastError = new Error(`AI gateway returned ${response.status}: ${errText}`);
        continue;
      }

      const data = await response.json() as AIResponse;

      if (!data.choices?.[0]) {
        console.warn(`Model ${model} returned empty choices, trying next...`);
        lastError = new Error(`Model ${model} returned no choices`);
        continue;
      }

      return data;
    } catch (err) {
      if (err instanceof AIGatewayError) throw err; // Don't retry user-facing errors
      const isAbort = (err as any)?.name === "AbortError" || /aborted|timed out/i.test(String((err as any)?.message ?? ""));
      console.warn(`Model ${model} failed${isAbort ? " (timeout/abort)" : ""}:`, err);
      lastError = err instanceof Error ? err : new Error(String(err));
    } finally {
      cancel();
    }
  }

  throw new AIGatewayError(
    "AI processing failed, please retry.",
    500,
    lastError?.message
  );
}

/** Extract text content from AI response */
export function getContent(response: AIResponse): string {
  return response.choices[0]?.message?.content || "";
}

/** Extract tool call arguments from AI response */
export function getToolArgs(response: AIResponse): string | null {
  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  return toolCall?.function?.arguments || null;
}

export class AIGatewayError extends Error {
  status: number;
  detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = "AIGatewayError";
    this.status = status;
    this.detail = detail;
  }
}

// ─── Anthropic direct path ────────────────────────────────────────────────
// Routes anthropic/* models to api.anthropic.com and normalises the response
// back into the OpenAI shape that the rest of our code expects.
async function callAnthropicAPI(model: string, options: AIRequestOptions): Promise<AIResponse> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new AIGatewayError("ANTHROPIC_API_KEY is not configured", 500);
  }

  const modelId = model.replace(/^anthropic\//, "");

  // Anthropic expects `system` as a top-level string and only user/assistant
  // turns in `messages`. Coerce content arrays to a flat string.
  const flatten = (c: unknown): string => {
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return c.map((part: any) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        return "";
      }).join("\n");
    }
    return String(c ?? "");
  };

  const systemMsg = options.messages.find((m) => m.role === "system");
  const turns = options.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: flatten(m.content),
    }));

  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: options.max_tokens ?? 4096,
    messages: turns,
  };
  if (systemMsg) body.system = flatten(systemMsg.content);
  if (options.temperature !== undefined) body.temperature = options.temperature;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (response.status === 429) {
    throw new AIGatewayError("Rate limit exceeded (Anthropic). Please try again in a moment.", 429);
  }
  if (response.status === 402) {
    throw new AIGatewayError("Anthropic credits exhausted.", 402);
  }
  if (!response.ok) {
    const errText = await response.text();
    console.error(`Anthropic API error (${modelId}): ${response.status}`, errText);
    throw new Error(`Anthropic returned ${response.status}: ${errText}`);
  }

  const data = await response.json() as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = (data.content || [])
    .filter((p) => p.type === "text")
    .map((p) => p.text || "")
    .join("");

  return {
    choices: [{
      message: { content: text || null },
    }],
  };
}
