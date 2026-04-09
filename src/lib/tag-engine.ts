// Tag Configuration Engine — 7-layer tag formula, store-agnostic
// Implements the complete tag generation system for swimwear/fashion retailers.

import { getStoreConfig } from './prompt-builder';
import { getIndustryDefinition } from './industry-config';

// ── Types ──────────────────────────────────────────────────
export interface ProductTypeEntry {
  name: string;
  tag: string;
  department?: string;
}

export type LayerType = 'single' | 'multiple' | 'auto' | 'fixed' | 'date';

export interface TagLayer {
  id: string;
  name: string;
  description: string;
  type: LayerType;
  values: string[];
  detectionRule?: string;
  fixedValue?: string;
  active: boolean;
  order: number;
}

export interface SpecialRule {
  id: string;
  keyword: string;
  tag: string;
  caseSensitive: boolean;
  matchType: 'contains' | 'exact' | 'starts_with';
  searchTitle: boolean;
  searchDescription: boolean;
  active: boolean;
}

export interface TagConfig {
  layers: TagLayer[];
  productTypes: ProductTypeEntry[];
  specialRules: SpecialRule[];
}

// ── Complete Type Options ──────────────────────────────────
export const TYPE_OPTIONS = [
  // ── WOMENS SWIMWEAR ──
  'One Pieces',
  'Bikini Tops',
  'Bikini Bottoms',
  'Bikini Set',
  'Tankini Tops',
  'Swimdress',
  'Rashies & Sunsuits',
  'Blouson',
  'Boyleg',
  'Swim Skirts',
  'Swim Leggings',
  'Swim Rompers',
  'Suit Saver',
  // ── WOMENS CLOTHING ──
  'Dresses',
  'Tops',
  'Pants',
  'Skirts',
  'Shorts',
  'Playsuits & Jumpsuits',
  'Kimonos',
  'Kaftans & Cover Ups',
  'Sarongs',
  'Belts',
  'Shirts',
  'Womens Boardshorts',
  // ── ACCESSORIES ──
  'Hats',
  'Sunnies',
  'Goggles',
  'Earplugs',
  'Swim Caps',
  'Bags',
  'Beach Towels',
  'Accessories',
  'Swim Accessories',
  'Water Shoes',
  'Jewellery',
  'Earrings',
  'Necklaces',
  'Bracelets',
  'Wallets',
  'Sunscreen & Lotions',
  'Floaties & Pool Toys',
  // ── HOME & LIVING ──
  'Candles',
  'Coasters',
  'Greeting Cards',
  'Christmas Decor',
  'Books',
  'Mixers & Alcohol',
  'Smelly Balls',
  'Perfume',
  'Hair Wraps',
  'Grooming & Toiletries',
  // ── MENS ──
  'Mens Swimwear',
  'Boardshorts',
  'Mens Briefs & Jammers',
  'Mens Rashies',
  'Mens Shorts',
  'Mens Shirts',
  'Mens Tees & Singlets',
  'Mens Accessories',
  'Mens Hats & Caps',
  'Mens Shoes & Thongs',
  // ── KIDS ──
  'Kids Swimwear',
  'Girls 00-7',
  'Girls 8-16',
  'Boys 00-7',
  'Boys 8-16',
  'Kids Accessories',
];

// ── Complete Specials List ─────────────────────────────────
export const SPECIALS_LIST = [
  { val: 'chlorine resist',      label: 'Chlorine Resistant' },
  { val: 'underwire',            label: 'Underwire' },
  { val: 'plus size',            label: 'Plus Size' },
  { val: 'tummy control',        label: 'Tummy Control' },
  { val: 'd-g',                  label: 'D–G Cup' },
  { val: 'a-dd',                 label: 'A–DD Cup' },
  { val: 'd-dd',                 label: 'D–DD Cup' },
  { val: 'mastectomy',           label: 'Mastectomy' },
  { val: 'sun protection',       label: 'Sun Protection' },
  { val: 'period swim',          label: 'Period Swim' },
  { val: 'maternity',            label: 'Maternity' },
  { val: 'boyleg',               label: 'Boyleg' },
  { val: 'tie side',             label: 'Tie Side' },
  { val: 'gifting',              label: 'Gifting' },
  { val: 'new swim',             label: 'New Swim' },
];

// ── Storage ────────────────────────────────────────────────
const TAG_CONFIG_KEY = 'tag_config_sonic_invoice';

export function getTagConfig(): TagConfig {
  try {
    const saved = localStorage.getItem(TAG_CONFIG_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.layers && parsed.productTypes) return parsed;
    }
  } catch {}
  return getIndustryTagDefaults();
}

export function saveTagConfig(config: TagConfig) {
  localStorage.setItem(TAG_CONFIG_KEY, JSON.stringify(config));
}

export function resetTagConfig() {
  localStorage.removeItem(TAG_CONFIG_KEY);
}

// ── Industry Defaults ──────────────────────────────────────
function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function toTag(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export function getIndustryTagDefaults(): TagConfig {
  const store = getStoreConfig();
  const def = getIndustryDefinition(store.industry);

  const types: ProductTypeEntry[] = def.productTypes.map(t => ({
    name: t.name,
    tag: t.tag || toTag(t.name),
    department: t.department || def.displayName.split(' ')[0],
  }));

  const layers: TagLayer[] = def.tagLayers.map(l => ({
    id: uid(),
    name: l.name,
    description: l.description,
    type: l.type,
    values: l.values,
    active: true,
    order: l.order,
  }));

  const specialRules: SpecialRule[] = def.specialRules.map(r => ({
    id: uid(),
    keyword: r.keyword,
    tag: r.tag,
    caseSensitive: r.caseSensitive,
    matchType: r.matchType,
    searchTitle: true,
    searchDescription: true,
    active: true,
  }));

  return { layers, productTypes: types, specialRules };
}

// ── Brand Lists ────────────────────────────────────────────
const MENS_BRANDS = [
  'Rhythm Mens', 'Funky Trunks', 'Skwosh', 'Budgy Smuggler',
  'Rusty', 'Dukies', 'Suen Noaj', 'Reef',
];

const KIDS_BRANDS = [
  'Funkita Girls', 'Seafolly Girls', 'Salty Ink Kids', 'Bling2o',
];

// ── Type Lists ─────────────────────────────────────────────
const KIDS_TYPES = [
  'Kids Swimwear', 'Girls 00-7', 'Girls 8-16',
  'Boys 00-7', 'Boys 8-16', 'Kids Accessories',
];

const MENS_TYPES = [
  'Mens Swimwear', 'Boardshorts', 'Mens Briefs & Jammers',
  'Mens Rashies', 'Mens Shorts', 'Mens Shirts',
  'Mens Tees & Singlets', 'Mens Accessories',
  'Mens Hats & Caps', 'Mens Shoes & Thongs',
];

const WOMENS_SWIM_TYPES = [
  'One Pieces', 'Bikini Tops', 'Bikini Bottoms', 'Bikini Set',
  'Tankini Tops', 'Rashies & Sunsuits', 'Swimdress',
  'Blouson', 'Swim Skirts', 'Swim Leggings', 'Boyleg',
  'Swim Rompers', 'Suit Saver',
];

const CLOTHING_TYPES = [
  'Dresses', 'Tops', 'Pants', 'Skirts', 'Shorts',
  'Playsuits & Jumpsuits', 'Kimonos',
  'Kaftans & Cover Ups', 'Sarongs', 'Belts', 'Shirts',
  'Womens Boardshorts', 'Womens Clothing',
];

const ACC_TYPES = [
  'Hats', 'Sunnies', 'Accessories', 'Swim Accessories',
  'Bags', 'Beach Towels', 'Goggles', 'Earplugs', 'Swim Caps',
  'Water Shoes', 'Swimwear Accessories', 'Wallets',
  'Sunscreen & Lotions', 'Floaties & Pool Toys',
];

const HOME_TYPES = [
  'Candles', 'Coasters', 'Greeting Cards', 'Christmas Decor',
  'Books', 'Mixers & Alcohol', 'Smelly Balls', 'Perfume',
  'Hair Wraps', 'Grooming & Toiletries',
];

const JEWELLERY_TYPES = [
  'Jewellery', 'Earrings', 'Necklaces', 'Bracelets',
];

// ── Type Tag Map ───────────────────────────────────────────
const TYPE_TAG_MAP: Record<string, string> = {
  // Womens Swimwear — tags exactly as written in notebook
  'One Pieces':          'One Pieces',
  'Bikini Tops':         'Bikini Tops',
  'Bikini Bottoms':      'bikini bottoms',
  'Bikini Set':          'Bikini Set',
  'Tankini Tops':        'tankini tops',
  'Swimdress':           'One Pieces',       // maps to One Pieces + swimdress (see Layer 3)
  'Rashies & Sunsuits':  'rashies & sunsuits',
  'Blouson':             'Blouson',
  'Boyleg':              'boyleg',
  'Swim Skirts':         'swim skirts',
  'Swim Leggings':       'swim leggings',
  'Swim Rompers':        'swim rompers',
  'Suit Saver':          'suit saver',

  // Womens Clothing
  'Dresses':             'Dresses',
  'Tops':                'tops',
  'Pants':               'pants',
  'Skirts':              'skirts',
  'Shorts':              'shorts',
  'Playsuits & Jumpsuits': 'playsuits & jumpsuits',
  'Kimonos':             'kimonos',
  'Kaftans & Cover Ups': 'kaftans & cover ups',
  'Sarongs':             'Sarongs',
  'Belts':               'belts',
  'Shirts':              'shirts',
  'Womens Boardshorts':  'womens boardshorts',

  // Accessories
  'Hats':                'hats',
  'Goggles':             'goggles',
  'Earplugs':            'earplug',
  'Swim Caps':           'swim caps',
  'Water Shoes':         'water shoes',
  'Swim Accessories':    'swim accessories',
  'Swimwear Accessories':'swim accessories',
  'Wallets':             'wallets',
  'Sunscreen & Lotions': 'sunscreen & lotions',
  'Floaties & Pool Toys':'floaties & pool toys',

  // Jewellery
  'Jewellery':           'JEWELLERY',
  'Earrings':            'JEWELLERY',
  'Necklaces':           'JEWELLERY',
  'Bracelets':           'JEWELLERY',

  // Home & Living
  'Candles':             'home & living',
  'Coasters':            'home & living',
  'Greeting Cards':      'home & living',
  'Christmas Decor':     'home & living',
  'Books':               'home & living',
  'Mixers & Alcohol':    'home & living',
  'Smelly Balls':        'home & living',
  'Perfume':             'home & living',
  'Hair Wraps':          'home & living',
  'Grooming & Toiletries': 'home & living',

  // Mens
  'Boardshorts':           'boardshorts',
  'Mens Swimwear':         'mens swim',
  'Mens Briefs & Jammers': 'mens briefs',
  'Mens Rashies':          'mens rashies',
  'Mens Shorts':           'mens shorts',
  'Mens Shirts':           'mens shirts',
  'Mens Tees & Singlets':  'mens tees',
  'Mens Accessories':      'accessories',
  'Mens Hats & Caps':      'hats',
  'Mens Shoes & Thongs':   'footwear',

  // Kids
  'Kids Swimwear':       'Girls swimwear',
  'Girls 00-7':          'Girls swimwear',
  'Girls 8-16':          'Girls swimwear',
  'Boys 00-7':           'boys swim',
  'Boys 8-16':           'boys swim',
};

// ── Tag Generation (7-Layer Formula) ───────────────────────
export interface TagInput {
  title: string;
  brand: string;
  productType: string;
  arrivalMonth?: string;
  priceStatus: 'full_price' | 'sale';
  gender?: string;
  description?: string;
  isNew?: boolean;
  specials?: string[];
}

/**
 * Generate tags using the complete 7-layer formula.
 * Layer 1: Gender
 * Layer 2: Department
 * Layer 3: Product Type Tag
 * Layer 4: Brand
 * Layer 5: Arrival Month
 * Layer 6: Price Status
 * Layer 7: New Arrivals + Special Properties
 */
export function generateTags(input: TagInput, config?: TagConfig): string[] {
  const tags: string[] = [];
  const vendor = input.brand;
  const type = input.productType;
  const month = input.arrivalMonth;
  const isFullPrice = input.priceStatus === 'full_price';
  const isNew = input.isNew ?? false;
  const specials = input.specials || [];

  // ── LAYER 1 — GENDER ─────────────────────────────
  // Kids brand always wins. Mens brand wins unless type is kids.
  let gender = 'Womens';
  if (KIDS_BRANDS.includes(vendor) || KIDS_TYPES.includes(type)) {
    gender = 'kids';
  } else if (MENS_BRANDS.includes(vendor) || MENS_TYPES.includes(type)) {
    gender = 'mens';
  }

  // For jewellery: NO gender tag
  if (!JEWELLERY_TYPES.includes(type)) {
    tags.push(gender);
  }

  // ── LAYER 2 — DEPARTMENT ─────────────────────────
  if (gender === 'Womens' && WOMENS_SWIM_TYPES.includes(type)) {
    tags.push('Swimwear');
    tags.push('womens swim');
  } else if (gender === 'kids') {
    if (['Kids Swimwear','Girls 00-7','Girls 8-16','Boys 00-7','Boys 8-16'].includes(type)) {
      tags.push('Swimwear');
    } else {
      tags.push('accessories');
      tags.push('kids accessories');
    }
  } else if (gender === 'mens') {
    if (['Mens Swimwear', 'Boardshorts'].includes(type)) {
      tags.push('mens swim');
    } else if (['Mens Shorts', 'Mens Shirt'].includes(type)) {
      tags.push('mens clothing');
    } else {
      tags.push('accessories');
    }
  } else if (CLOTHING_TYPES.includes(type)) {
    tags.push('clothing');
    tags.push('womens clothing');
  } else if (HOME_TYPES.includes(type)) {
    tags.push('home & living');
  } else if (ACC_TYPES.includes(type)) {
    tags.push('accessories');
  } else if (JEWELLERY_TYPES.includes(type)) {
    // Jewellery: NO gender, NO accessories — handled in Layer 3
  }

  // ── LAYER 3 — PRODUCT TYPE TAG ───────────────────
  const primaryTypeTag = TYPE_TAG_MAP[type];
  if (primaryTypeTag && !tags.includes(primaryTypeTag)) {
    tags.push(primaryTypeTag);
  }

  // Types that emit a SECOND type tag
  if (type === 'Swimdress') tags.push('swimdress');
  if (type === 'Sunnies') {
    tags.push('Sunnies');
    tags.push('sunglasses');
  }
  if (type === 'Sarongs') tags.push('sarong');
  if (type === 'Kaftans & Cover Ups') tags.push('cover ups');
  if (type === 'Boardshorts' && gender === 'mens') tags.push('mens boardies');

  // Swim Skirts and Swim Leggings also get "bikini bottoms" tag
  // per manager's handwritten notes (right column of notebook page 3)
  if (type === 'Swim Skirts') tags.push('bikini bottoms');
  if (type === 'Swim Leggings') tags.push('bikini bottoms');
  // Boyleg also gets "bikini bottoms" tag
  if (type === 'Boyleg') tags.push('bikini bottoms');

  // Home & Living types each get their own specific tag too
  if (HOME_TYPES.includes(type)) {
    const specificTag = type.toLowerCase();
    if (!tags.includes(specificTag)) tags.push(specificTag);
  }

  // Womens Boardshorts
  if (type === 'Womens Boardshorts') tags.push('boardshorts');

  // Jewellery sub-types
  if (type === 'Earrings') tags.push('earrings');
  if (type === 'Necklaces') tags.push('necklace');
  if (type === 'Bracelets') tags.push('bracelet');

  // Kids sub-types
  if (['Girls 00-7', 'Girls 8-16'].includes(type)) {
    tags.push(type === 'Girls 00-7' ? 'girls 00-7' : 'girls 8-16');
  }
  if (['Boys 00-7', 'Boys 8-16'].includes(type)) {
    tags.push(type === 'Boys 00-7' ? 'boys 00-7' : 'boys 8-16');
  }

  // ── LAYER 4 — BRAND TAG ──────────────────────────
  const brandTag = vendor.toLowerCase();
  if (brandTag && !tags.includes(brandTag) && !tags.includes(vendor)) {
    // Use vendor as-is if it's already in the tags, otherwise lowercase
    tags.push(brandTag);
  }

  // ── LAYER 5 — ARRIVAL MONTH ──────────────────────
  if (month) tags.push(month);

  // ── LAYER 6 — PRICE STATUS ───────────────────────
  // full_price only when isFullPrice is true. Omit when on sale.
  if (isFullPrice) tags.push('full_price');

  // ── LAYER 7 — NEW ARRIVALS ───────────────────────
  if (isNew) {
    tags.push('new');
    tags.push('new arrivals');
    if (WOMENS_SWIM_TYPES.includes(type) && gender === 'Womens') {
      tags.push('new swim');
    } else if (CLOTHING_TYPES.includes(type) && gender === 'Womens') {
      tags.push('new clothing');
      tags.push('new womens');
    } else if (gender === 'mens') {
      tags.push('new mens');
    } else if (gender === 'kids') {
      tags.push('new kids');
    }
  }

  // ── LAYER 7 — SPECIAL PROPERTIES ─────────────────
  // Funkita uses "Chlorine Resistant" (capital). All others use lowercase.
  for (const s of specials) {
    if (s === 'chlorine resist') {
      const chlorineTag = vendor.includes('Funkita')
        ? 'Chlorine Resistant'
        : 'chlorine resist';
      if (!tags.includes(chlorineTag)) tags.push(chlorineTag);
    } else if (s === 'd-g') {
      if (!tags.includes('d-g')) tags.push('d-g');
      if (!tags.includes('larger cup')) tags.push('larger cup');
    } else if (s === 'a-dd') {
      if (!tags.includes('a-dd')) tags.push('a-dd');
    } else if (s === 'd-dd') {
      if (!tags.includes('d-dd')) tags.push('d-dd');
      if (!tags.includes('larger cup')) tags.push('larger cup');
    } else if (s === 'boyleg') {
      if (!tags.includes('boyleg')) tags.push('boyleg');
    } else if (s === 'period swim') {
      if (!tags.includes('period swim')) tags.push('period swim');
    } else {
      if (!tags.includes(s)) tags.push(s);
    }
  }

  // Deduplicate preserving order
  return [...new Set(tags)];
}

export function generateTagString(input: TagInput, config?: TagConfig): string {
  return generateTags(input, config).join(', ');
}

export { toTag };

// Legacy compatibility — matchesRule for special rules
function matchesRule(text: string, rule: SpecialRule): boolean {
  const source = rule.caseSensitive ? text : text.toLowerCase();
  const kw = rule.caseSensitive ? rule.keyword : rule.keyword.toLowerCase();
  switch (rule.matchType) {
    case 'exact': return source === kw;
    case 'starts_with': return source.startsWith(kw);
    default: return source.includes(kw);
  }
}
