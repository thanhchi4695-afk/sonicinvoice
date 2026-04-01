// Confidence scoring system for invoice product lines

export type ConfidenceLevel = "high" | "medium" | "low" | "pending";

export interface ConfidenceBreakdown {
  title: boolean;
  type: boolean;
  description: boolean;
  image: boolean;
  compareAtPrice: boolean;
  seoTitle: boolean;
  tags: boolean;
  matchSource: "barcode" | "sku" | "name" | "none";
  score: number;
  level: ConfidenceLevel;
}

export interface ProductFields {
  name?: string;
  type?: string;
  description?: string;
  hasImage?: boolean;
  rrp?: number;
  seoTitle?: string;
  hasTags?: boolean;
  matchSource?: "barcode" | "sku" | "name" | "none";
  isPending?: boolean;
}

export function calculateConfidence(fields: ProductFields): ConfidenceBreakdown {
  if (fields.isPending) {
    return {
      title: false, type: false, description: false, image: false,
      compareAtPrice: false, seoTitle: false, tags: false,
      matchSource: "none", score: 0, level: "pending",
    };
  }

  const title = !!fields.name?.trim();
  const type = !!fields.type?.trim();
  const description = !!fields.description?.trim();
  const image = !!fields.hasImage;
  const compareAtPrice = (fields.rrp ?? 0) > 0;
  const seoTitle = !!fields.seoTitle?.trim();
  const tags = !!fields.hasTags;
  const matchSource = fields.matchSource || "none";

  // If no title at all, score is 0 → LOW
  if (!title) {
    return { title, type, description, image, compareAtPrice, seoTitle, tags, matchSource, score: 0, level: "low" };
  }

  let score = 0;
  if (type) score += 20;
  if (description) score += 20;
  if (image) score += 15;
  if (compareAtPrice) score += 15;
  if (seoTitle) score += 15;
  if (tags) score += 15;

  // Match source modifier
  if (matchSource === "barcode") score += 10;
  else if (matchSource === "sku") score += 5;
  else if (matchSource === "name") score -= 10;

  score = Math.max(0, Math.min(100, score));

  let level: ConfidenceLevel = "low";
  if (score >= 90) level = "high";
  else if (score >= 60) level = "medium";

  return { title, type, description, image, compareAtPrice, seoTitle, tags, matchSource, score, level };
}

export function getConfidenceColor(level: ConfidenceLevel): string {
  switch (level) {
    case "high": return "text-success";
    case "medium": return "text-warning";
    case "low": return "text-destructive";
    case "pending": return "text-muted-foreground";
  }
}

export function getConfidenceBgColor(level: ConfidenceLevel): string {
  switch (level) {
    case "high": return "bg-success/15 text-success border-success/20";
    case "medium": return "bg-warning/15 text-warning border-warning/20";
    case "low": return "bg-destructive/15 text-destructive border-destructive/20";
    case "pending": return "bg-muted text-muted-foreground border-border";
  }
}

export function getConfidenceLabel(level: ConfidenceLevel): string {
  switch (level) {
    case "high": return "✓ Ready";
    case "medium": return "⚠ Review";
    case "low": return "✗ Fix needed";
    case "pending": return "○ Pending";
  }
}
