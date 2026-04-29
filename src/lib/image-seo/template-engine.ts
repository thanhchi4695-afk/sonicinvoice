/**
 * Image SEO template engine
 *
 * Variables: {vendor} {title} {brand} {color} {sku} {business} {product_type} {variant_title} {index}
 *
 * - For filenames → slugified, joined with hyphens, empty vars collapse cleanly.
 * - For alt text → human-readable, empty vars and surrounding punctuation collapse cleanly.
 */

export type TemplateVariables = {
  vendor?: string | null;
  title?: string | null;
  brand?: string | null;
  color?: string | null;
  sku?: string | null;
  business?: string | null;
  product_type?: string | null;
  variant_title?: string | null;
  index?: number;
};

export const STANDARD_VARS = [
  "vendor", "title", "brand", "color", "sku", "business", "product_type", "variant_title", "index",
] as const;

export const DEFAULT_FILENAME_TEMPLATE =
  "{vendor}-{title}-{brand}-{color}-{sku}-{business}-{product_type}-{variant_title}-{index}";

export const DEFAULT_ALT_TEMPLATE =
  "Buy {brand} {color} {title} ({product_type}) online";

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getVar(vars: TemplateVariables, key: string): string {
  const raw = (vars as Record<string, unknown>)[key];
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

/**
 * Build a filename: slugifies each value, joins with `-`, collapses empties and double dashes.
 * Always ensures `.webp` extension. Always appends index if missing and >0.
 */
export function buildFilename(template: string, vars: TemplateVariables): string {
  const replaced = template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = getVar(vars, key);
    return v ? slugify(v) : "";
  });
  // collapse multiple dashes / leading-trailing dashes
  let cleaned = replaced.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) cleaned = "image";
  // ensure index is appended for uniqueness if template doesn't contain it
  if (!template.includes("{index}") && typeof vars.index === "number" && vars.index > 0) {
    cleaned += `-${vars.index}`;
  }
  // strip any extension supplied in template, then add .webp
  cleaned = cleaned.replace(/\.(webp|jpe?g|png|gif|bmp|tiff)$/i, "");
  return `${cleaned}.webp`;
}

/**
 * Build alt text: keeps natural language, removes empty placeholders and the punctuation that wraps them.
 * Examples for missing values:
 *   "Buy {brand} {color} {title} ({product_type}) online" with no product_type
 *     → "Buy Zimmermann blue Silk Midi Dress online"
 */
export function buildAltText(template: string, vars: TemplateVariables, maxChars = 125): string {
  // 1. Substitute, remembering which placeholders were empty
  const emptyKeys: string[] = [];
  let out = template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = getVar(vars, key);
    if (!v) {
      emptyKeys.push(key);
      return "\u0000"; // sentinel
    }
    return v;
  });

  // 2. Remove brackets/parentheses that now contain only sentinels or whitespace
  out = out
    .replace(/\(\s*\u0000+\s*\)/g, "") // empty parens
    .replace(/\[\s*\u0000+\s*\]/g, "") // empty brackets
    .replace(/—\s*\u0000+/g, "")        // dangling em-dash
    .replace(/-\s*\u0000+/g, "")        // dangling hyphen
    .replace(/\u0000+/g, "");          // remaining sentinels

  // 3. Collapse whitespace and stray punctuation
  out = out
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/^[\s,;:.\-—]+|[\s,;:\-—]+$/g, "")
    .trim();

  // 4. Cap length without splitting words
  if (out.length > maxChars) {
    out = out.slice(0, maxChars - 1).replace(/\s+\S*$/, "") + "…";
  }
  return out;
}

/** Cheap preview helper for the UI settings panel */
export function previewSample(template: string, kind: "filename" | "alt"): string {
  const sample: TemplateVariables = {
    vendor: "Zimmermann",
    title: "Silk Midi Dress",
    brand: "Zimmermann",
    color: "Blue",
    sku: "ZM-101",
    business: "Aria Boutique",
    product_type: "Dress",
    variant_title: "Small",
    index: 1,
  };
  return kind === "filename" ? buildFilename(template, sample) : buildAltText(template, sample);
}
