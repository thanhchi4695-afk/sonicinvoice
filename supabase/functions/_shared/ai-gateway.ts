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
  let lastError: Error | null = null;

  for (const model of fallbacks) {
    try {
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
      console.warn(`Model ${model} failed:`, err);
      lastError = err instanceof Error ? err : new Error(String(err));
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
