// Dynamic AI Prompt Builder — replaces all hardcoded store/industry references

// ── Store Config ───────────────────────────────────────────
export interface StoreConfig {
  name: string;
  url: string;
  tagline?: string;
  city?: string;
  currency: string;
  currencySymbol: string;
  locale: string;
  industry: string;
  seoTitleTemplate: string;
  seoDescriptionTemplate: string;
  enrichmentSources: string[];
  excludedSources: string[];
  defaultInstructions?: string;
}

export interface IndustryConfig {
  displayName: string;
  descriptionLength: string;
  descriptionStyle: string;
  descriptionFeatures: string;
  productTypes: { name: string }[];
  defaultType: string;
  icon?: string;
}

export interface BrandEntry {
  name: string;
  aliases?: string[];
  website?: string;
  tier?: 'priority' | 'standard';
}

export interface TagConfig {
  layers: { name: string; description: string }[];
}

export interface EnrichProduct {
  title: string;
  vendor: string;
  sku?: string;
  colour?: string;
  typeHint?: string;
}

// ── Defaults ───────────────────────────────────────────────
const STORE_CONFIG_KEY = 'store_config_skupilot';

const DEFAULT_STORE: StoreConfig = {
  name: 'My Store',
  url: '',
  city: 'Australia',
  currency: 'AUD',
  currencySymbol: '$',
  locale: 'AU',
  industry: 'general',
  seoTitleTemplate: '{product} | {brand} | {store_name}',
  seoDescriptionTemplate: 'Shop {product} by {brand} at {store_name}. Free shipping on orders over $100.',
  enrichmentSources: [],
  excludedSources: ['Amazon', 'eBay', 'Wish', 'AliExpress', 'Temu'],
};

export function getStoreConfig(): StoreConfig {
  try {
    return { ...DEFAULT_STORE, ...JSON.parse(localStorage.getItem(STORE_CONFIG_KEY) || '{}') };
  } catch { return DEFAULT_STORE; }
}

export function saveStoreConfig(c: Partial<StoreConfig>) {
  const current = getStoreConfig();
  localStorage.setItem(STORE_CONFIG_KEY, JSON.stringify({ ...current, ...c }));
}

// ── Industry presets (delegated to industry-config) ───────
import { getIndustryDefinition, getIndustryList as getIndustryListFromConfig } from './industry-config';

function industryToConfig(id: string): IndustryConfig {
  const def = getIndustryDefinition(id);
  return {
    displayName: def.displayName,
    descriptionLength: def.descriptionLength,
    descriptionStyle: def.descriptionStyle,
    descriptionFeatures: def.descriptionFeatures,
    productTypes: def.productTypes.map(t => ({ name: t.name })),
    defaultType: def.defaultType,
    icon: def.icon,
  };
}

export function getIndustryConfig(industry: string): IndustryConfig {
  return industryToConfig(industry);
}

export function getIndustryList(): { id: string; name: string }[] {
  return getIndustryListFromConfig().map(i => ({ id: i.id, name: i.name }));
}

// ── Brand Directory ────────────────────────────────────────
const BRAND_DIR_KEY = 'brand_directory_skupilot';

export function getBrandDirectory(): BrandEntry[] {
  try { return JSON.parse(localStorage.getItem(BRAND_DIR_KEY) || '[]'); } catch { return []; }
}

export function saveBrandDirectory(brands: BrandEntry[]) {
  localStorage.setItem(BRAND_DIR_KEY, JSON.stringify(brands));
}

import { getLocaleEnglish, getEnrichmentInstruction } from './i18n';

function localeEnglish(locale: string): string {
  return getLocaleEnglish(locale);
}

function priceSourceInstruction(locale: string, currency: string): string {
  return getEnrichmentInstruction(locale, currency);
}

// ── Enrichment Prompt Builder ──────────────────────────────
export function buildEnrichmentPrompt(
  product: EnrichProduct,
  store?: StoreConfig,
  brands?: BrandEntry[],
  customInstructions?: string,
): string {
  const s = store || getStoreConfig();
  const ind = getIndustryConfig(s.industry);
  const brandList = brands || getBrandDirectory();
  const lang = localeEnglish(s.locale);

  const taglinePart = s.tagline ? `, ${s.tagline}` : '';
  const typesStr = ind.productTypes.map(t => t.name).join(', ');

  // Source priority list
  const sources: string[] = [];
  if (s.url) sources.push(`${s.url} (your store — search first)`);
  sources.push('Official brand website');
  for (const src of s.enrichmentSources) sources.push(src);
  const sourcePriority = sources.map((src, i) => `${i + 1}. ${src}`).join('\n  ');

  const excluded = [...new Set([...s.excludedSources, 'Amazon', 'eBay', 'Wish', 'AliExpress', 'Temu'])].join(', ');

  const imageColour = product.colour
    ? `Find the image for colour: ${product.colour}.`
    : 'Find the main product image.';

  // SEO templates with store name injected
  const seoTitle = s.seoTitleTemplate
    .replace('{store_name}', s.name)
    .replace('{product}', '{product_name}')
    .replace('{brand}', '{vendor}');
  const seoDesc = s.seoDescriptionTemplate
    .replace('{store_name}', s.name)
    .replace('{product}', '{product_name}')
    .replace('{brand}', '{vendor}');

  // Custom instructions section
  const customSection = customInstructions?.trim()
    ? `\n  CUSTOM INSTRUCTIONS (HIGHEST PRIORITY — follow exactly):\n  ${customInstructions.trim()}\n  Apply these instructions to EVERY product. They override defaults below.\n`
    : '';

  return `You are a product data enrichment assistant for ${s.name} (${s.url || 'online store'})${taglinePart}.

  STORE CONTEXT:
    Store name:    ${s.name}
    Store URL:     ${s.url || 'N/A'}
    Industry:      ${ind.displayName}
    Location:      ${s.city || 'Australia'}
    Currency:      ${s.currency} (${s.currencySymbol})
    Language:      ${lang}
${customSection}
  TASK:
  For the product below, find and return ALL of the following as a JSON object:

  1. DESCRIPTION:
     Write ${ind.descriptionLength} sentences describing this product.
     ${ind.descriptionStyle}
     ${ind.descriptionFeatures}
     Do NOT mention price. Do NOT copy brand text verbatim.
     Use ${lang} spelling throughout.

  2. IMAGE URL:
     ${imageColour}
     Must be a direct .jpg, .jpeg, .png, or .webp URL.
     Must be publicly accessible.
     Prefer images at least 800×800 pixels.

  3. RETAIL PRICE (RRP):
     Find the recommended retail price in ${s.currency}.
     ${priceSourceInstruction(s.locale, s.currency)}
     If the product is on sale, use the ORIGINAL full price, not the discounted sale price.
     Return as a number only — no currency symbol.
     If not found: return null.

  4. PRODUCT TYPE:
     Determine the product type from this list: ${typesStr}
     Return the EXACT type name from the list above.
     If none match: return "${ind.defaultType}".

  5. TAGS:
     Generate Shopify tags using the 7-layer formula:
     Gender, Department, Product Type, Brand, Arrival Month, Price Status (full_price/sale), Special Properties.
     Return as a comma-separated string.

  6. SEO TITLE (max 70 characters):
     Use this format: ${seoTitle}

  7. SEO META DESCRIPTION (max 160 characters):
     Use this format: ${seoDesc}

  SOURCE PRIORITY FOR WEB SEARCH:
  ${sourcePriority}

  NEVER use these sources: ${excluded}

  PRODUCT TO ENRICH:
  Title:    ${product.title}
  Vendor:   ${product.vendor}
  SKU:      ${product.sku || 'N/A'}
  Colour:   ${product.colour || 'N/A'}
  Type:     ${product.typeHint || 'Unknown'}

  Return ONLY valid JSON: { "description": string, "image_url": string|null, "rrp": number|null, "product_type": string, "tags": string, "seo_title": string, "seo_description": string }`;
}

// ── Invoice Parsing Prompt Builder ─────────────────────────
export function buildParsingPrompt(
  store?: StoreConfig,
  brands?: BrandEntry[],
  customInstructions?: string,
): string {
  const s = store || getStoreConfig();
  const brandList = brands || getBrandDirectory();
  const lang = localeEnglish(s.locale);

  // Top 30 brands
  const topBrands = brandList.slice(0, 30).map(b => b.name).join(', ') || 'No brands configured';

  // Vendor alias mapping
  const aliases = brandList
    .filter(b => b.aliases && b.aliases.length > 0)
    .flatMap(b => (b.aliases || []).map(a => `${a} → ${b.name}`));
  const aliasBlock = aliases.length > 0
    ? `\n  VENDOR ALIAS MAPPING:\n  ${aliases.join('\n  ')}`
    : '';

  const customSection = customInstructions?.trim()
    ? `\n  CUSTOM INSTRUCTIONS (HIGHEST PRIORITY — follow exactly):\n  ${customInstructions.trim()}\n  Apply these to EVERY product line. They override defaults.\n`
    : '';

  return `You are an invoice parsing assistant for ${s.name}.
  Extract structured product data from the uploaded invoice.
  Use ${lang} spelling throughout. Currency: ${s.currency}.
${customSection}
  KNOWN BRANDS for ${s.name}: ${topBrands}
  Match vendor to the closest known ${s.name} brand using exact name matching.${aliasBlock}

  For each product line, extract:
  - title (product name)
  - vendor (brand)
  - sku (product code)
  - quantity
  - cost_price (what the store pays)
  - retail_price (RRP / compare-at price)
  - colour (if present)
  - size (if present)
  - barcode (if present)

  COLUMN DETECTION (fallback if no custom instructions):
  - Product name: usually the longest text column
  - SKU/code: alphanumeric identifier column
  - Quantity: numeric column with small integers
  - Cost price: first price column (usually lower value)
  - Retail price: second price column (usually higher)
  - Barcode: 8-13 digit numeric column

  Skip rows that are totals, subtotals, headers, or summary lines.
  Return as a JSON array of objects.`;
}
