// SEO Engine — dynamic title, description, feature detection, CTA rotation
// Store-agnostic: reads store name, city, and shipping threshold from settings
import { getStoreConfig, type StoreConfig } from './prompt-builder';
import { getIndustryDefinition } from './industry-config';

// ── Types ──────────────────────────────────────────────────
export interface SeoProduct {
  title: string;
  brand: string;
  type: string;
  category?: string;
  tags?: string[];
  description?: string;
  specials?: string[];
}

export interface SeoResult {
  seoTitle: string;
  seoDescription: string;
  titleLength: number;
  descLength: number;
  titleOver: boolean;
  descOver: boolean;
}

// ── CTA Storage ────────────────────────────────────────────
const CTA_KEY = 'seo_cta_phrases_sonic_invoice';

function getIndustryCtas(industry: string): string[] {
  return getIndustryDefinition(industry).seoCtas;
}

export function getCtaPhrases(industry?: string): string[] {
  try {
    const saved = localStorage.getItem(CTA_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return getIndustryCtas(industry || 'general');
}

export function saveCtaPhrases(phrases: string[]) {
  localStorage.setItem(CTA_KEY, JSON.stringify(phrases));
}

// ── Feature Phrase Detection ───────────────────────────────
function getIndustryFeatures(industry: string): { pattern: RegExp; phrase: string }[] {
  return getIndustryDefinition(industry).featureRules;
}

export function detectFeatures(product: SeoProduct, industry: string): string {
  const rules = getIndustryFeatures(industry);
  const searchText = `${product.title} ${product.description || ''} ${(product.tags || []).join(' ')}`;
  const found: string[] = [];
  for (const rule of rules) {
    if (rule.pattern.test(searchText)) {
      found.push(rule.phrase);
    }
  }
  return found.join(' ');
}

// ── Template Variable Replacement ──────────────────────────
function replaceVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  // Remove unfilled vars
  result = result.replace(/\{[^}]+\}/g, '').replace(/\s{2,}/g, ' ').trim();
  return result;
}

// ── SEO Title Generator ────────────────────────────────────
const SEO_TITLE_MAX = 70;
const SEO_DESC_MAX = 160;

export function generateSeoTitle(
  product: SeoProduct,
  store?: StoreConfig,
): string {
  const s = store || getStoreConfig();
  const storeName = s.name || 'My Store';
  const template = s.seoTitleTemplate || '{product} | {brand} | {store}';

  const vars: Record<string, string> = {
    product: product.title,
    brand: product.brand,
    type: product.type,
    store: storeName,
    city: s.city || '',
    category: product.category || product.type,
  };

  let title = replaceVars(template, vars);

  // Enforce 70-char limit — truncate product first, then brand
  if (title.length > SEO_TITLE_MAX) {
    const withoutProduct = replaceVars(template, { ...vars, product: '' });
    const available = SEO_TITLE_MAX - withoutProduct.length;
    if (available > 3) {
      vars.product = product.title.slice(0, available - 1) + '…';
      title = replaceVars(template, vars);
    }
    if (title.length > SEO_TITLE_MAX) {
      title = title.slice(0, SEO_TITLE_MAX - 1) + '…';
    }
  }

  return title;
}

// ── SEO Meta Description Generator ─────────────────────────
// Type-specific phrasing for meta descriptions
const TYPE_PHRASE_MAP: Record<string, string> = {
  'One Pieces': 'one-piece swimsuit',
  'Swimdress': 'swim dress',
  'Bikini Tops': 'bikini top',
  'Bikini Bottoms': 'bikini bottom',
  'Bikini Set': 'bikini set',
  'Tankini Tops': 'tankini top',
  'Rashies & Sunsuits': 'rashguard',
  'Blouson': 'blouson swimsuit',
  'Boardshorts': "men's boardshorts",
  'Mens Swimwear': "men's swimwear",
  'Mens Shorts': "men's shorts",
  'Mens Shirt': "men's shirt",
  'Dresses': 'resort dress',
  'Tops': 'top',
  'Skirts': 'skirt',
  'Shorts': 'shorts',
  'Kaftans & Cover Ups': 'kaftan',
  'Sarongs': 'sarong',
  'Hats': 'sun hat',
  'Sunnies': 'sunglasses',
  'Girls 00-7': "girls' swimwear",
  'Girls 8-16': "girls' swimwear",
  'Boys 00-7': "boys' swimwear",
  'Boys 8-16': "boys' swimwear",
  'Jewellery': 'jewellery piece',
  'Earrings': 'earrings',
  'Necklaces': 'necklace',
  'Bracelets': 'bracelet',
  'Accessories': 'beach accessory',
};

export function getDefaultDescTemplate(industry: string): string {
  return getIndustryDefinition(industry).seoDescTemplate;
}

export function generateSeoDescription(
  product: SeoProduct,
  store?: StoreConfig,
  ctaIndex?: number,
): string {
  const s = store || getStoreConfig();
  const storeName = s.name || 'My Store';
  const storeCity = s.city || '';
  const freeShipping = s.freeShippingThreshold || '';
  const industry = s.industry || 'general';

  // Use type-specific phrasing
  const typePhrase = TYPE_PHRASE_MAP[product.type] || 'swimwear';

  // Feature text from specials
  const feats = product.specials && product.specials.length > 0
    ? product.specials.slice(0, 2).join(', ') + '. '
    : '';

  const locationStr = storeCity ? ` ${storeCity}` : '';
  const shippingStr = freeShipping
    ? ` Free shipping over $${freeShipping} AU.`
    : '';

  let desc = `${product.title} — ${typePhrase} by ${product.brand}. `
    + `${feats}Shop at ${storeName}${locationStr}.`
    + `${shippingStr}`;

  if (desc.length > SEO_DESC_MAX) {
    desc = desc.slice(0, SEO_DESC_MAX - 3) + '...';
  }

  return desc;
}

// ── Full SEO Generation ────────────────────────────────────
export function generateSeo(product: SeoProduct, store?: StoreConfig, ctaIndex?: number): SeoResult {
  const title = generateSeoTitle(product, store);
  const description = generateSeoDescription(product, store, ctaIndex);
  return {
    seoTitle: title,
    seoDescription: description,
    titleLength: title.length,
    descLength: description.length,
    titleOver: title.length > SEO_TITLE_MAX,
    descOver: description.length > SEO_DESC_MAX,
  };
}

// ── Template presets ───────────────────────────────────────
export const SEO_TITLE_PRESETS = [
  { label: 'Standard', template: '{product} | {brand} | {store}' },
  { label: 'Short', template: '{product} | {store}' },
  { label: 'Brand-first', template: '{brand} {product} | {store}' },
  { label: 'With type', template: '{product} | {type} | {store}' },
  { label: 'Dash style', template: '{product} — {brand} at {store}' },
];

export function getSeoDescPresets(industry: string): { label: string; template: string }[] {
  const def = getIndustryDefinition(industry);
  return [
    { label: 'Default', template: def.seoDescTemplate },
    { label: 'Simple', template: '{product} by {brand}. {features}Shop at {store}.' },
    { label: 'With city', template: 'Shop {product} by {brand} at {store} {city}. {features}' },
  ];
}
