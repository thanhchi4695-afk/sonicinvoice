// SEO completeness score helpers — shared across Collections, Sonic Rank, dashboard.
//
// The score (0-100) is computed by the `recompute_collection_completeness`
// trigger on `collection_suggestions`. Breakdown weights:
//   title 15 · meta 15 · body 20 · faq 15 · links 15 · rules 10 · blog 10
//
// We mirror those keys here for "what's missing" hints.

export type ScoreBucket = "zero" | "low" | "mid" | "high";

export interface BreakdownPart {
  key: string;
  label: string;
  earned: number;
  max: number;
}

export interface CompletenessBreakdown {
  title?: number;
  meta?: number;
  body?: number;
  faq?: number;
  links?: number;
  rules?: number;
  blog?: number;
}

const PART_DEFS: { key: keyof CompletenessBreakdown; label: string; max: number; shortMissing: string }[] = [
  { key: "title", label: "SEO title",       max: 15, shortMissing: "title" },
  { key: "meta",  label: "Meta description", max: 15, shortMissing: "meta" },
  { key: "body",  label: "Description",     max: 20, shortMissing: "description" },
  { key: "faq",   label: "FAQ",             max: 15, shortMissing: "FAQ" },
  { key: "links", label: "Internal links",  max: 15, shortMissing: "links" },
  { key: "rules", label: "Smart rules",     max: 10, shortMissing: "rules" },
  { key: "blog",  label: "Blog plan",       max: 10, shortMissing: "blog" },
];

export function getBucket(score: number): ScoreBucket {
  if (score <= 0) return "zero";
  if (score < 50) return "low";
  if (score < 85) return "mid";
  return "high";
}

/** Tailwind classes for the circular score ring. */
export function ringClasses(score: number) {
  const b = getBucket(score);
  switch (b) {
    case "zero": return { bg: "bg-red-500/15", text: "text-red-300", border: "border-red-500/50" };
    case "low":  return { bg: "bg-amber-500/15", text: "text-amber-300", border: "border-amber-500/50" };
    case "mid":  return { bg: "bg-lime-500/15",  text: "text-lime-300",  border: "border-lime-500/50" };
    case "high": return { bg: "bg-emerald-500/15", text: "text-emerald-300", border: "border-emerald-500/50" };
  }
}

/** Hex color for inline progress fills (used in mini bars and charts). */
export function fillColor(score: number) {
  const b = getBucket(score);
  return b === "zero" ? "hsl(0 70% 55%)"
       : b === "low"  ? "hsl(35 90% 55%)"
       : b === "mid"  ? "hsl(85 60% 50%)"
       :                "hsl(160 60% 40%)";
}

export function parseBreakdown(raw: unknown): CompletenessBreakdown {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: CompletenessBreakdown = {};
  for (const def of PART_DEFS) {
    const v = r[def.key];
    if (typeof v === "number") (out as any)[def.key] = v;
  }
  return out;
}

export function breakdownParts(raw: unknown): BreakdownPart[] {
  const b = parseBreakdown(raw);
  return PART_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    earned: b[d.key] ?? 0,
    max: d.max,
  }));
}

/** Short hint like "Missing meta, FAQ" — up to 3 missing parts. */
export function gapHint(score: number, raw: unknown): string {
  if (score <= 0) return "No content yet";
  const b = parseBreakdown(raw);
  const missing = PART_DEFS.filter((d) => (b[d.key] ?? 0) < d.max);
  if (missing.length === 0) return "All content present";
  const names = missing.slice(0, 3).map((d) => d.shortMissing);
  return `Missing ${names.join(", ")}${missing.length > 3 ? "…" : ""}`;
}

export function gapCount(raw: unknown): number {
  const b = parseBreakdown(raw);
  return PART_DEFS.filter((d) => (b[d.key] ?? 0) < d.max).length;
}

export type SeoActionKind = "generate" | "fix" | "complete";
export function actionKind(score: number): SeoActionKind {
  if (score <= 0) return "generate";
  if (score >= 100) return "complete";
  return "fix";
}
