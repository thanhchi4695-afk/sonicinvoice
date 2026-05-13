// product-seo-audit
// Audits a single product's SEO content using the SAME validators as the
// collection engine retry loop — single source of truth for "passing".
// Thresholds: title <=60, meta 150-160, body >=200 words, FAQ 30-80 words,
// no banned phrases, primary keyword in first 12 words of body.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  validateTitle,
  validateMeta,
  validateBannedPhrases,
  validateKeywordInFirst12Words,
  validateLocalSignal,
  validateFaq,
  wordCount,
  stripHtml,
  type ValidationIssue,
} from "../_shared/seo-validators.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AuditInput {
  product_id?: string;             // optional: pull from Shopify product cache
  title?: string;                  // SEO title
  meta_description?: string;
  body_html?: string;              // product description body
  faq?: Array<{ q: string; a: string }>;
  primary_keyword?: string;
  city?: string | null;
  store_name?: string | null;
}

interface RuleResult {
  id: string;
  label: string;
  threshold: string;
  status: "pass" | "fail" | "warn" | "skipped";
  detail: string;
}

function rule(id: string, label: string, threshold: string, status: RuleResult["status"], detail: string): RuleResult {
  return { id, label, threshold, status, detail };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const input = await req.json() as AuditInput;
    let { title, meta_description, body_html, faq, primary_keyword, city, store_name, product_id } = input;

    // Optional Shopify lookup — falls back gracefully if cache table absent
    if (product_id && (!title || !body_html)) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data } = await supabase
          .from("shopify_products")
          .select("title,body_html,seo_title,seo_description")
          .eq("id", product_id)
          .maybeSingle();
        if (data) {
          title = title || (data as any).seo_title || (data as any).title;
          body_html = body_html || (data as any).body_html;
          meta_description = meta_description || (data as any).seo_description;
        }
      } catch (_) { /* ignore */ }
    }

    title = (title || "").trim();
    meta_description = (meta_description || "").trim();
    body_html = body_html || "";
    faq = Array.isArray(faq) ? faq : [];
    primary_keyword = (primary_keyword || "").trim();

    const issues: ValidationIssue[] = [];
    const rules: RuleResult[] = [];

    // ── Title ≤60 ────────────────────────────────
    {
      const before = issues.length;
      validateTitle(title, issues);
      const new_ = issues.slice(before);
      rules.push(rule(
        "title_length",
        "SEO title",
        "≤ 60 chars",
        title ? (new_.length ? "fail" : "pass") : "fail",
        title ? `${title.length} chars` : "missing",
      ));
    }

    // ── Meta 150–160 ─────────────────────────────
    {
      const before = issues.length;
      validateMeta(meta_description, issues);
      const new_ = issues.slice(before);
      rules.push(rule(
        "meta_length",
        "Meta description",
        "150–160 chars",
        meta_description ? (new_.length ? "fail" : "pass") : "fail",
        meta_description ? `${meta_description.length} chars` : "missing",
      ));
    }

    // ── Body ≥200 words ──────────────────────────
    const wc = wordCount(body_html);
    rules.push(rule(
      "body_length",
      "Body copy",
      "≥ 200 words",
      body_html ? (wc >= 200 ? "pass" : "fail") : "fail",
      body_html ? `${wc} words` : "missing",
    ));
    if (body_html && wc < 200) {
      issues.push({ field: "body_html", message: `Body ${wc} words (need >=200)` });
    }

    // ── Banned phrases (body + faq) ──────────────
    {
      const before = issues.length;
      validateBannedPhrases(body_html, issues, "body_html");
      faq.forEach((f, i) => validateBannedPhrases(f.a || "", issues, `faq[${i}].a`));
      const found = issues.slice(before);
      rules.push(rule(
        "banned_phrases",
        "No banned phrases",
        "0 hits in body + FAQ",
        found.length === 0 ? "pass" : "fail",
        found.length === 0 ? "clean" : found.map((i) => i.message).join("; "),
      ));
    }

    // ── Primary keyword in first 12 words ────────
    if (primary_keyword) {
      const before = issues.length;
      validateKeywordInFirst12Words(body_html, primary_keyword, issues);
      const new_ = issues.slice(before);
      rules.push(rule(
        "keyword_position",
        "Primary keyword early",
        "in first 12 words",
        new_.length ? "fail" : "pass",
        new_.length ? new_[0].message : `"${primary_keyword}" found`,
      ));
    } else {
      rules.push(rule("keyword_position", "Primary keyword early", "in first 12 words", "skipped", "no keyword supplied"));
    }

    // ── Local signal ─────────────────────────────
    if (city) {
      const before = issues.length;
      validateLocalSignal(body_html, city, issues);
      const new_ = issues.slice(before);
      rules.push(rule(
        "local_signal",
        "Local signal",
        `mentions "${city}"`,
        new_.length ? "warn" : "pass",
        new_.length ? new_[0].message : `${city} present`,
      ));
    } else {
      rules.push(rule("local_signal", "Local signal", "city mention", "skipped", "no city supplied"));
    }

    // ── FAQ structure + answer length ────────────
    {
      const before = issues.length;
      validateFaq(faq, issues);
      const new_ = issues.slice(before);
      rules.push(rule(
        "faq",
        "FAQ block",
        "4–6 items, answers 30–80 words, ends with ?",
        faq.length === 0 ? "fail" : (new_.length ? "fail" : "pass"),
        faq.length === 0
          ? "no FAQ"
          : new_.length
            ? new_.map((i) => i.message).join("; ")
            : `${faq.length} items, lengths OK`,
      ));
    }

    const failCount = rules.filter((r) => r.status === "fail").length;
    const warnCount = rules.filter((r) => r.status === "warn").length;
    const passCount = rules.filter((r) => r.status === "pass").length;
    const total = rules.filter((r) => r.status !== "skipped").length || 1;
    const score = Math.round((passCount / total) * 100);

    return new Response(JSON.stringify({
      score,
      summary: { pass: passCount, fail: failCount, warn: warnCount, skipped: rules.length - passCount - failCount - warnCount },
      rules,
      issues,
      input_used: {
        title_length: title.length,
        meta_length: meta_description.length,
        body_words: wc,
        faq_count: faq.length,
        primary_keyword,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("product-seo-audit error:", err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
