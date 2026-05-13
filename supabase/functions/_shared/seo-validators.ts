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
];

export interface ValidationIssue {
  field: string;
  message: string;
}

export function stripHtml(html: string): string {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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

export function validateBannedPhrases(html: string, issues: ValidationIssue[]) {
  const text = stripHtml(html).toLowerCase();
  for (const p of BANNED_PHRASES) {
    if (text.includes(p)) {
      issues.push({ field: "description_html", message: `Banned phrase: "${p}"` });
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
  // accept either exact phrase or each token of a 1-2 word keyword
  if (!first12.includes(kw) && !kw.split(/\s+/).every((w) => first12.includes(w))) {
    issues.push({
      field: "description_html",
      message: `Primary keyword "${primaryKeyword}" not in first 12 words`,
    });
  }
}

export function validateInternalLinks(html: string, expected: number, issues: ValidationIssue[]) {
  const matches = (html || "").match(/<a\s+[^>]*href=["']\/collections\/[^"']+["'][^>]*>/gi) || [];
  if (matches.length !== expected) {
    issues.push({
      field: "description_html",
      message: `Expected ${expected} internal /collections/ links, got ${matches.length}`,
    });
  }
}

export function validateLocalSignal(text: string, city: string | null, issues: ValidationIssue[]) {
  if (!city) return;
  if (!new RegExp(`\\b${city}\\b`, "i").test(stripHtml(text))) {
    issues.push({ field: "description_html", message: `Missing local signal: ${city}` });
  }
}

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
  validateInternalLinks(out.description_html, 2, issues);
  if (ctx.layer === 3) validateLocalSignal(out.description_html, ctx.city ?? null, issues);
  return issues;
}
