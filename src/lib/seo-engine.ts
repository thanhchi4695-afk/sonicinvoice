// SEO Engine — dynamic title, description, feature detection, CTA rotation
import { getStoreConfig, getIndustryConfig, type StoreConfig } from './prompt-builder';

// ── Types ──────────────────────────────────────────────────
export interface SeoProduct {
  title: string;
  brand: string;
  type: string;
  category?: string;
  tags?: string[];
  description?: string;
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
const CTA_KEY = 'seo_cta_phrases_skupilot';

const INDUSTRY_CTA_DEFAULTS: Record<string, string[]> = {
  swimwear: [
    'Shop the full collection at {store}',
    'New arrivals at {store} {city}',
    'Free shipping over {threshold} at {store}',
  ],
  beauty: [
    'Shop {brand} at {store} — free delivery over {threshold}',
    'Discover your new favourite at {store}',
    'Authentic {brand} with fast shipping at {store}',
  ],
  fashion: [
    'Shop the latest from {brand} at {store}',
    'New season arrivals — shop now at {store}',
    'Style meets value at {store}',
  ],
  clothing: [
    'Shop the latest from {brand} at {store}',
    'New season arrivals — shop now at {store}',
    'Style meets value at {store}',
  ],
  jewellery: [
    'Beautiful {brand} jewellery at {store}',
    'Free gift wrapping at {store}',
    'Shop {brand} at {store} — perfect for gifting',
  ],
  electronics: [
    'Shop {brand} at {store} — fast delivery',
    'Latest tech at {store}',
    'Free shipping over {threshold} at {store}',
  ],
  health: [
    'Shop {brand} supplements at {store}',
    'Fast AU delivery from {store}',
    'Quality {brand} at {store}',
  ],
  home: [
    'Shop {brand} homewares at {store}',
    'Transform your space with {store}',
    'Free shipping over {threshold} at {store}',
  ],
  general: [
    'Shop now at {store}',
    'Free shipping over {threshold} at {store}',
    'New arrivals at {store}',
  ],
};

export function getCtaPhrases(industry?: string): string[] {
  try {
    const saved = localStorage.getItem(CTA_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return INDUSTRY_CTA_DEFAULTS[industry || 'general'] || INDUSTRY_CTA_DEFAULTS.general;
}

export function saveCtaPhrases(phrases: string[]) {
  localStorage.setItem(CTA_KEY, JSON.stringify(phrases));
}

// ── Feature Phrase Detection ───────────────────────────────
const INDUSTRY_FEATURES: Record<string, { pattern: RegExp; phrase: string }[]> = {
  swimwear: [
    { pattern: /underwire/i, phrase: 'With underwire support.' },
    { pattern: /chlorine\s*resist/i, phrase: 'Chlorine resistant fabric.' },
    { pattern: /plus\s*size|extended\s*siz/i, phrase: 'Available in extended sizing.' },
    { pattern: /[d-g]\s*cup|full\s*bust/i, phrase: 'Full bust support in D-G cup.' },
    { pattern: /upf|sun\s*protect/i, phrase: 'UPF 50+ sun protection.' },
  ],
  beauty: [
    { pattern: /cruelty[\s-]*free/i, phrase: 'Cruelty-free formula.' },
    { pattern: /\bvegan\b/i, phrase: '100% vegan.' },
    { pattern: /\bspf\b/i, phrase: 'With SPF sun protection.' },
    { pattern: /\bnatural\b/i, phrase: 'Made with natural ingredients.' },
    { pattern: /anti[\s-]*age?ing/i, phrase: 'Anti-ageing formula.' },
  ],
  fashion: [
    { pattern: /sustainab/i, phrase: 'Made from sustainable materials.' },
    { pattern: /organic\s*cotton/i, phrase: '100% organic cotton.' },
    { pattern: /plus\s*size|extended\s*siz/i, phrase: 'Available in extended sizes.' },
  ],
  clothing: [
    { pattern: /sustainab/i, phrase: 'Made from sustainable materials.' },
    { pattern: /organic\s*cotton/i, phrase: '100% organic cotton.' },
    { pattern: /plus\s*size|extended\s*siz/i, phrase: 'Available in extended sizes.' },
  ],
  jewellery: [
    { pattern: /sterling\s*silver/i, phrase: 'Sterling silver.' },
    { pattern: /gold\s*plated/i, phrase: 'Gold plated.' },
    { pattern: /hypoallergenic/i, phrase: 'Hypoallergenic.' },
  ],
  electronics: [
    { pattern: /\bwireless\b/i, phrase: 'Wireless connectivity.' },
    { pattern: /\busb[\s-]*c\b/i, phrase: 'USB-C compatible.' },
    { pattern: /\bbluetooth\b/i, phrase: 'Bluetooth enabled.' },
  ],
  health: [
    { pattern: /\bvegan\b/i, phrase: 'Vegan-friendly formula.' },
    { pattern: /gluten[\s-]*free/i, phrase: 'Gluten-free.' },
    { pattern: /dairy[\s-]*free/i, phrase: 'Dairy-free.' },
  ],
  home: [
    { pattern: /handmade/i, phrase: 'Handmade.' },
    { pattern: /sustainab/i, phrase: 'Made from sustainable materials.' },
  ],
  general: [],
};

export function detectFeatures(product: SeoProduct, industry: string): string {
  const rules = INDUSTRY_FEATURES[industry] || [];
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
  const template = s.seoTitleTemplate || '{product} | {brand} | {store}';

  const vars: Record<string, string> = {
    product: product.title,
    brand: product.brand,
    type: product.type,
    store: s.name,
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

// ── SEO Description Generator ──────────────────────────────
const DESC_TEMPLATES: Record<string, string> = {
  swimwear: 'Shop the {product} by {brand}. {features}New arrivals at {store} {city}.',
  beauty: 'Discover {product} by {brand}. {features}Shop now at {store} with free delivery.',
  fashion: '{brand} {product}. {features}Shop the latest at {store}.',
  clothing: '{brand} {product}. {features}Shop the latest at {store}.',
  jewellery: '{brand} {product}. {features}Beautiful jewellery at {store}.',
  electronics: '{product} by {brand}. {features}Shop at {store} — fast delivery.',
  health: '{product} by {brand}. {features}Shop at {store}.',
  home: '{product} by {brand}. {features}Shop homewares at {store}.',
  general: '{product} by {brand}. {features}{cta} at {store}.',
};

export function getDefaultDescTemplate(industry: string): string {
  return DESC_TEMPLATES[industry] || DESC_TEMPLATES.general;
}

export function generateSeoDescription(
  product: SeoProduct,
  store?: StoreConfig,
  ctaIndex?: number,
): string {
  const s = store || getStoreConfig();
  const industry = s.industry || 'general';
  const template = s.seoDescriptionTemplate || getDefaultDescTemplate(industry);

  const features = detectFeatures(product, industry);
  const phrases = getCtaPhrases(industry);
  const idx = ctaIndex ?? Math.floor(Math.random() * phrases.length);
  const rawCta = phrases[idx % phrases.length] || '';

  const ctaVars: Record<string, string> = {
    store: s.name,
    brand: product.brand,
    city: s.city || '',
    threshold: '$100',
  };
  const cta = replaceVars(rawCta, ctaVars);

  const vars: Record<string, string> = {
    product: product.title,
    brand: product.brand,
    type: product.type,
    store: s.name,
    city: s.city || '',
    features: features ? features + ' ' : '',
    cta,
    currency: s.currency,
    threshold: '$100',
    category: product.category || product.type,
  };

  let desc = replaceVars(template, vars);

  // Enforce 160-char limit — trim features first
  if (desc.length > SEO_DESC_MAX && features) {
    vars.features = '';
    desc = replaceVars(template, vars);
  }
  if (desc.length > SEO_DESC_MAX) {
    desc = desc.slice(0, SEO_DESC_MAX - 1) + '…';
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

export const SEO_DESC_PRESETS: Record<string, { label: string; template: string }[]> = {
  swimwear: [
    { label: 'Default', template: 'Shop the {product} by {brand}. {features}New arrivals at {store} {city}.' },
    { label: 'Simple', template: '{product} by {brand}. {features}Shop at {store}.' },
  ],
  beauty: [
    { label: 'Default', template: 'Discover {product} by {brand}. {features}Shop now at {store} with free delivery.' },
    { label: 'Simple', template: '{product} by {brand}. {features}Shop at {store}.' },
  ],
  general: [
    { label: 'Default', template: '{product} by {brand}. {features}{cta} at {store}.' },
    { label: 'With city', template: 'Shop {product} by {brand} at {store} {city}. {features}' },
  ],
};
