// Shared helpers for generating + rendering GEO answer blocks.
// Used by seo-collection-engine (generation) and publish-geo-block (publish).

import { callAI, getContent } from "./ai-gateway.ts";
import {
  validateGeoScenarioAnswer,
  validateGeoComparisonSnippet,
  validateGeoCareStep,
  validateGeoBestFor,
  type ValidationIssue,
  type GeoScenarioQA,
  type GeoComparison,
  type GeoCareStep,
} from "./seo-validators.ts";

const VERTICALS_WITH_CARE = new Set(["SWIMWEAR", "ACCESSORIES", "JEWELLERY"]);

export interface GeoGenInput {
  vertical: string;
  primary_keyword: string;
  collection_title: string;
  store_name: string;
  store_city: string | null;
  sample_titles: string[];
  brands: Array<{ name: string; tone?: string | null; differentiator?: string | null }>;
}

export interface GeoBlockData {
  scenario_questions: GeoScenarioQA[];
  comparison_snippet: GeoComparison | null;
  care_instructions: GeoCareStep[] | null;
  best_for_summary: string;
  validation_errors: ValidationIssue[];
}

function safeParseJson(raw: string): any {
  if (!raw) return null;
  const c = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try { return JSON.parse(c); } catch {/**/}
  const m = c.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {/**/} }
  return null;
}

export async function generateGeoBlock(input: GeoGenInput): Promise<GeoBlockData> {
  const vertical = (input.vertical || "").toUpperCase();
  const wantsCare = VERTICALS_WITH_CARE.has(vertical);
  const wantsComparison = (input.brands || []).filter((b) => b.name).length >= 2;
  const cityClause = input.store_city ? ` in ${input.store_city}` : "";

  const careHint = wantsCare
    ? vertical === "SWIMWEAR"
      ? "rinse → dry → storage (3 steps min)"
      : vertical === "JEWELLERY"
        ? "cleaning → storage → wear advice (3 steps min)"
        : "cleaning method → storage → avoid list (3 steps min)"
    : null;

  const brandLines = (input.brands || []).slice(0, 6).map((b) =>
    `- ${b.name}${b.differentiator ? ` (${b.differentiator})` : ""}${b.tone ? ` — tone: ${b.tone}` : ""}`
  ).join("\n");

  const sampleLines = (input.sample_titles || []).slice(0, 12).map((t) => `- ${t}`).join("\n");

  const system = `You generate GEO answer blocks for retail collection pages. GEO blocks are structured snippets optimised for AI engine retrieval (ChatGPT, Perplexity, Google AI Mode).

Rules:
- Use ONLY facts provided. Never invent prices, brands, materials, or city names.
- Reference specific product names from sample_titles when possible.
- Avoid banned phrases: wide range of, great selection, high quality, curated, vibrant, elevate, leverage, seamless.
- Output strict JSON, no commentary.`;

  const user = `Generate GEO answer blocks for the collection "${input.collection_title}".

CONTEXT
- Vertical: ${vertical}
- Primary keyword: ${input.primary_keyword}
- Store: ${input.store_name}${cityClause}
- Brands in collection (${input.brands.length}):
${brandLines || "  (none)"}
- Sample products:
${sampleLines || "  (none)"}

REQUIRED BLOCKS

1. scenario_questions: array of EXACTLY 2 items.
   Format: {"question": "What should I wear to [occasion] in ${input.store_city ?? "[city]"}?", "answer": "..."}
   - Each answer 40–80 words.
   - Each answer must name at least one specific product from sample_titles when available.
   - Use the primary keyword "${input.primary_keyword}" naturally.

2. comparison_snippet: ${wantsComparison ? `EXACTLY ONE object {"question": "How is ${input.brands[0]?.name} different from ${input.brands[1]?.name}?", "answer": "...", "brand_a": "${input.brands[0]?.name}", "brand_b": "${input.brands[1]?.name}"} — answer ≤60 words, must reference price point, style, or material differences (not generic copy), and must mention BOTH brand names.` : "set to null (fewer than 2 brands)"}

3. care_instructions: ${wantsCare ? `array of at least 3 steps {"step": "Rinse|Dry|Store|Clean|Avoid|...", "instruction": "..."} matching ${careHint}. Each instruction max 20 words.` : "set to null (vertical does not need care steps)"}

4. best_for_summary: ONE sentence ≤25 words. Format: "${input.collection_title} is best for [specific use case] — [key differentiator]. Available at ${input.store_name}${cityClause}."

OUTPUT JSON SHAPE:
{
  "scenario_questions": [{"question": "...", "answer": "..."}, {"question": "...", "answer": "..."}],
  "comparison_snippet": ${wantsComparison ? '{"question":"...","answer":"...","brand_a":"...","brand_b":"..."}' : "null"},
  "care_instructions": ${wantsCare ? '[{"step":"...","instruction":"..."}]' : "null"},
  "best_for_summary": "..."
}`;

  let lastIssues: ValidationIssue[] = [];
  let parsed: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ai = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: lastIssues.length
            ? user + "\n\nPREVIOUS ATTEMPT FAILED — fix:\n" + lastIssues.map((i) => "- [" + i.field + "] " + i.message).join("\n")
            : user },
      ],
      temperature: 0.3,
      timeoutMs: 60_000,
    });
    parsed = safeParseJson(getContent(ai));
    if (!parsed) {
      lastIssues = [{ field: "_parse", message: "Model did not return JSON" }];
      continue;
    }
    lastIssues = [];
    const scenarios: GeoScenarioQA[] = Array.isArray(parsed.scenario_questions) ? parsed.scenario_questions.slice(0, 2) : [];
    if (scenarios.length !== 2) {
      lastIssues.push({ field: "geo.scenario", message: `Need exactly 2 scenario questions, got ${scenarios.length}` });
    }
    scenarios.forEach((qa, i) => validateGeoScenarioAnswer(qa, i, lastIssues));

    const cmp: GeoComparison | null = parsed.comparison_snippet ?? null;
    if (wantsComparison && !cmp) {
      lastIssues.push({ field: "geo.comparison", message: "Expected a comparison snippet" });
    } else if (!wantsComparison && cmp) {
      parsed.comparison_snippet = null;
    } else {
      validateGeoComparisonSnippet(cmp, lastIssues);
    }

    const care: GeoCareStep[] | null = parsed.care_instructions ?? null;
    if (wantsCare) {
      if (!Array.isArray(care) || care.length < 3) {
        lastIssues.push({ field: "geo.care", message: `Need ≥3 care steps for ${vertical}` });
      } else {
        care.forEach((s, i) => validateGeoCareStep(s, i, lastIssues));
      }
    } else if (care) {
      parsed.care_instructions = null;
    }

    validateGeoBestFor(parsed.best_for_summary, input.store_city, lastIssues);

    if (lastIssues.length === 0) break;
  }

  return {
    scenario_questions: Array.isArray(parsed?.scenario_questions) ? parsed.scenario_questions.slice(0, 2) : [],
    comparison_snippet: parsed?.comparison_snippet ?? null,
    care_instructions: parsed?.care_instructions ?? null,
    best_for_summary: parsed?.best_for_summary ?? "",
    validation_errors: lastIssues,
  };
}

// Render the GEO block as schema.org-friendly HTML wrapped in markers
// so we can locate + replace it on re-publish without duplicating.
export function renderGeoHtml(data: GeoBlockData): string {
  const esc = (s: string) => (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  const parts: string[] = [];
  parts.push(`<!-- GEO -->`);
  parts.push(`<section class="collection-geo" data-geo="answer-blocks">`);

  if (data.best_for_summary) {
    parts.push(`  <p class="geo-best-for"><strong>Best for:</strong> ${esc(data.best_for_summary)}</p>`);
  }

  if (data.scenario_questions?.length) {
    parts.push(`  <div class="geo-scenarios" itemscope itemtype="https://schema.org/FAQPage">`);
    for (const qa of data.scenario_questions) {
      parts.push([
        `    <div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">`,
        `      <h3 itemprop="name">${esc(qa.question)}</h3>`,
        `      <div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">`,
        `        <p itemprop="text">${esc(qa.answer)}</p>`,
        `      </div>`,
        `    </div>`,
      ].join("\n"));
    }
    parts.push(`  </div>`);
  }

  if (data.comparison_snippet) {
    const c = data.comparison_snippet;
    parts.push([
      `  <div class="geo-comparison" itemscope itemtype="https://schema.org/Question">`,
      `    <h3 itemprop="name">${esc(c.question)}</h3>`,
      `    <div itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">`,
      `      <p itemprop="text">${esc(c.answer)}</p>`,
      `    </div>`,
      `  </div>`,
    ].join("\n"));
  }

  if (data.care_instructions?.length) {
    parts.push(`  <div class="geo-care" itemscope itemtype="https://schema.org/HowTo">`);
    parts.push(`    <h3 itemprop="name">Care &amp; use</h3>`);
    parts.push(`    <ol>`);
    for (const s of data.care_instructions) {
      parts.push(`      <li itemprop="step" itemscope itemtype="https://schema.org/HowToStep"><strong itemprop="name">${esc(s.step)}:</strong> <span itemprop="text">${esc(s.instruction)}</span></li>`);
    }
    parts.push(`    </ol>`);
    parts.push(`  </div>`);
  }

  parts.push(`</section>`);
  parts.push(`<!-- /GEO -->`);
  return parts.join("\n");
}

export function spliceGeoIntoBody(existingBody: string, geoHtml: string): string {
  const body = existingBody || "";
  const re = /<!-- GEO -->[\s\S]*?<!-- \/GEO -->/;
  if (re.test(body)) return body.replace(re, geoHtml);
  return body.trimEnd() + "\n\n" + geoHtml;
}

export function stripGeoFromBody(existingBody: string): string {
  return (existingBody || "").replace(/<!-- GEO -->[\s\S]*?<!-- \/GEO -->\s*/g, "").trimEnd();
}
