// Deterministic SEO validators for the Universal SEO Collection Engine.
// Used by seo-collection-engine and seo-blog-writer to enforce hard rules
// regardless of what the model produces.

export const BANNED_PHRASES = [
  "wide range of",
  "great selection",
  "we have something for everyone",
  "high quality",
  "browse our collection",
  "shop now",
  "buy online",
  "curated",
  "vibrant",
  "tapestry",
  "delve",
  "elevate",
  "leverage",
  "synergy",
  "seamless",
];

export interface ValidationIssue {
  field: string;
  message: string;
}

export function stripHtml(html: string): string {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function wordCount(html: string): number {
  const t = stripHtml(html);
  return t ? t.split(/\s+/).length : 0;
}

export function validateTitle(title: string, issues: ValidationIssue[]) {
  const t = (title || "").trim();
  if (!t) issues.push({ field: "seo_title", message: "Empty title" });
  if (t.length > 60) issues.push({ field: "seo_title", message: `Title ${t.length} chars > 60` });
  if (/shop now|buy online/i.test(t)) {
    issues.push({ field: "seo_title", message: "Generic phrase in title" });
  }
}

export function validateMeta(meta: string, issues: ValidationIssue[]) {
  const m = (meta || "").trim();
  if (m.length < 150 || m.length > 160) {
    issues.push({ field: "meta_description", message: `Meta ${m.length} chars (need 150-160)` });
  }
}

export function validateBannedPhrases(html: string, issues: ValidationIssue[], field = "description_html") {
  const text = stripHtml(html).toLowerCase();
  for (const p of BANNED_PHRASES) {
    if (text.includes(p)) {
      issues.push({ field, message: `Banned phrase: "${p}"` });
    }
  }
}

export function validateKeywordInFirst12Words(
  html: string,
  primaryKeyword: string,
  issues: ValidationIssue[],
) {
  if (!primaryKeyword) return;
  const text = stripHtml(html).toLowerCase();
  const first12 = text.split(/\s+/).slice(0, 12).join(" ");
  const kw = primaryKeyword.toLowerCase();
  if (!first12.includes(kw) && !kw.split(/\s+/).every((w) => first12.includes(w))) {
    issues.push({
      field: "description_html",
      message: `Primary keyword "${primaryKeyword}" not in first 12 words`,
    });
  }
}

export function validateInternalLinks(
  html: string,
  expectedMin: number,
  expectedMax: number,
  validHandles: Set<string> | null,
  issues: ValidationIssue[],
) {
  const re = /<a\s+[^>]*href=["']\/collections\/([^"']+)["'][^>]*>/gi;
  const handles: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || "")) !== null) handles.push(m[1]);
  if (handles.length < expectedMin || handles.length > expectedMax) {
    issues.push({
      field: "description_html",
      message: `Expected ${expectedMin}-${expectedMax} internal /collections/ links, got ${handles.length}`,
    });
  }
  if (validHandles && validHandles.size > 0) {
    for (const h of handles) {
      if (!validHandles.has(h)) {
        issues.push({ field: "description_html", message: `Unknown collection handle: ${h}` });
      }
    }
  }
}

export function validateLocalSignal(text: string, city: string | null, issues: ValidationIssue[]) {
  if (!city) return;
  if (!new RegExp(`\\b${city}\\b`, "i").test(stripHtml(text))) {
    issues.push({ field: "description_html", message: `Missing local signal: ${city}` });
  }
}

export function validateFaq(
  faq: Array<{ q: string; a: string }> | undefined | null,
  issues: ValidationIssue[],
) {
  const items = Array.isArray(faq) ? faq : [];
  if (items.length < 4 || items.length > 6) {
    issues.push({ field: "faq", message: `FAQ has ${items.length} items (need 4-6)` });
    return;
  }
  items.forEach((it, i) => {
    const q = (it.q || "").trim();
    const a = (it.a || "").trim();
    if (!q.endsWith("?")) issues.push({ field: "faq", message: `FAQ ${i + 1} question missing "?"` });
    const wc = a ? a.split(/\s+/).length : 0;
    if (wc < 30 || wc > 80) {
      issues.push({ field: "faq", message: `FAQ ${i + 1} answer ${wc} words (need 30-80)` });
    }
  });
}

export interface FormulaParts {
  part1_opener?: string;
  part2_materials?: string;
  part3_brands?: string;
  part4_styling?: string;
  part5_links?: string;
  // brand-page variant uses these instead of 1+3
  brand_origin?: string;
  brand_seasonal?: string;
  brand_authority?: string;
  brand_sub_links?: string;
}

export interface SeoOutputV2 {
  seo_title: string;
  meta_description: string;
  formula_parts: FormulaParts;
  description_html: string; // stitched
  faq: Array<{ q: string; a: string }>;
  smart_rules_json: unknown;
}

export interface ValidationContextV2 {
  taxonomy_level: 2 | 3 | 4 | 5 | 6;
  primary_keyword: string;
  city?: string | null;
  is_brand_page: boolean;
  valid_handles: Set<string>;
}

export function validateSeoOutputV2(out: SeoOutputV2, ctx: ValidationContextV2): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateTitle(out.seo_title, issues);
  validateMeta(out.meta_description, issues);
  validateBannedPhrases(out.description_html, issues);

  // word count
  const wc = wordCount(out.description_html);
  if (wc < 200) issues.push({ field: "description_html", message: `Body ${wc} words (need >=200)` });

  validateKeywordInFirst12Words(out.description_html, ctx.primary_keyword, issues);
  validateInternalLinks(out.description_html, 3, 5, ctx.valid_handles, issues);

  // formula parts presence
  const parts = out.formula_parts || {};
  if (ctx.is_brand_page) {
    for (const k of ["brand_origin", "brand_seasonal", "brand_authority", "brand_sub_links"] as const) {
      if (!parts[k] || stripHtml(parts[k]!).length < 20) {
        issues.push({ field: "formula_parts", message: `Missing brand-page part: ${k}` });
      }
    }
    // brand_origin should mention a year (founded YYYY)
    if (parts.brand_origin && !/\b(18|19|20)\d{2}\b/.test(parts.brand_origin)) {
      issues.push({ field: "formula_parts.brand_origin", message: "Brand origin missing founding year" });
    }
  } else {
    for (const k of ["part1_opener", "part2_materials", "part3_brands", "part4_styling", "part5_links"] as const) {
      if (!parts[k] || stripHtml(parts[k]!).length < 20) {
        issues.push({ field: "formula_parts", message: `Missing description part: ${k}` });
      }
    }
  }

  if ((ctx.taxonomy_level === 3 || ctx.taxonomy_level === 6) && ctx.city) {
    validateLocalSignal(out.description_html, ctx.city, issues);
  }

  validateFaq(out.faq, issues);
  out.faq?.forEach((f, i) => validateBannedPhrases(f.a, issues, `faq[${i}].a`));

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────
// GEO answer-block validators (used by collection_geo_blocks generator).
// ─────────────────────────────────────────────────────────────────────────

export interface GeoScenarioQA { question: string; answer: string }
export interface GeoComparison { question: string; answer: string; brand_a: string; brand_b: string }
export interface GeoCareStep { step: string; instruction: string }

export function validateGeoScenarioAnswer(
  qa: GeoScenarioQA,
  index: number,
  issues: ValidationIssue[],
) {
  const q = (qa?.question || "").trim();
  const a = (qa?.answer || "").trim();
  if (!q.endsWith("?")) {
    issues.push({ field: `geo.scenario[${index}].question`, message: "Question must end with ?" });
  }
  const wc = a ? a.split(/\s+/).length : 0;
  if (wc < 40 || wc > 80) {
    issues.push({ field: `geo.scenario[${index}].answer`, message: `Answer ${wc} words (need 40–80)` });
  }
  validateBannedPhrases(a, issues, `geo.scenario[${index}].answer`);
}

export function validateGeoComparisonSnippet(
  snip: GeoComparison | null | undefined,
  issues: ValidationIssue[],
) {
  if (!snip) return; // optional
  const a = (snip.answer || "").trim();
  const wc = a ? a.split(/\s+/).length : 0;
  if (wc > 60) {
    issues.push({ field: "geo.comparison.answer", message: `Answer ${wc} words (max 60)` });
  }
  const brandA = (snip.brand_a || "").trim();
  const brandB = (snip.brand_b || "").trim();
  if (!brandA || !brandB) {
    issues.push({ field: "geo.comparison", message: "Both brand_a and brand_b required" });
    return;
  }
  const lower = a.toLowerCase();
  if (!lower.includes(brandA.toLowerCase()) || !lower.includes(brandB.toLowerCase())) {
    issues.push({ field: "geo.comparison.answer", message: "Answer must reference both brand names" });
  }
  validateBannedPhrases(a, issues, "geo.comparison.answer");
}

export function validateGeoCareStep(
  step: GeoCareStep,
  index: number,
  issues: ValidationIssue[],
) {
  const inst = (step?.instruction || "").trim();
  const wc = inst ? inst.split(/\s+/).length : 0;
  if (wc === 0) {
    issues.push({ field: `geo.care[${index}].instruction`, message: "Empty instruction" });
  } else if (wc > 20) {
    issues.push({ field: `geo.care[${index}].instruction`, message: `Step ${wc} words (max 20)` });
  }
  if (!(step?.step || "").trim()) {
    issues.push({ field: `geo.care[${index}].step`, message: "Empty step label" });
  }
}

export function validateGeoBestFor(
  text: string | null | undefined,
  city: string | null | undefined,
  issues: ValidationIssue[],
) {
  const t = (text || "").trim();
  if (!t) {
    issues.push({ field: "geo.best_for_summary", message: "Empty summary" });
    return;
  }
  const wc = t.split(/\s+/).length;
  if (wc > 25) {
    issues.push({ field: "geo.best_for_summary", message: `Summary ${wc} words (max 25)` });
  }
  if (city && !new RegExp(`\\b${city}\\b`, "i").test(t)) {
    issues.push({ field: "geo.best_for_summary", message: `Missing store city: ${city}` });
  }
  validateBannedPhrases(t, issues, "geo.best_for_summary");
}

// Legacy V1 used by seo-blog-writer; keep for compatibility.
export interface SeoOutput {
  seo_title: string;
  meta_description: string;
  description_html: string;
  smart_rules_json: unknown;
  blog_plans?: Array<{
    title: string;
    target_keywords: string[];
    sections: unknown;
    faq: Array<{ q: string; a: string }>;
  }>;
}

export interface ValidationContext {
  layer: 1 | 2 | 3 | 4;
  primary_keyword: string;
  city?: string | null;
}

export function validateSeoOutput(out: SeoOutput, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateTitle(out.seo_title, issues);
  validateMeta(out.meta_description, issues);
  validateBannedPhrases(out.description_html, issues);
  validateKeywordInFirst12Words(out.description_html, ctx.primary_keyword, issues);
  // back-compat: previously expected exactly 2 links
  validateInternalLinks(out.description_html, 2, 2, null, issues);
  if (ctx.layer === 3) validateLocalSignal(out.description_html, ctx.city ?? null, issues);
  return issues;
}
