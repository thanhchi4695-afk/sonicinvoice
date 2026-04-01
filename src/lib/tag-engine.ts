// Tag Configuration Engine — industry-aware, fully configurable

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

// ── Storage ────────────────────────────────────────────────
const TAG_CONFIG_KEY = 'tag_config_skupilot';

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

// DEFAULT_LAYERS removed — now derived from industry-config

const INDUSTRY_SPECIAL_RULES: Record<string, SpecialRule[]> = {
  swimwear: [
    { id: uid(), keyword: 'chlorine resist', tag: 'chlorine-resist', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'underwire', tag: 'underwire', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'plus size', tag: 'plus-size', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'UPF', tag: 'upf-protection', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
  ],
  beauty: [
    { id: uid(), keyword: 'cruelty-free', tag: 'cruelty-free', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'vegan', tag: 'vegan', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'SPF', tag: 'spf', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'natural', tag: 'natural', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
  ],
  fashion: [
    { id: uid(), keyword: 'sustainable', tag: 'sustainable', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'organic cotton', tag: 'organic-cotton', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'plus size', tag: 'plus-size', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
  ],
  clothing: [
    { id: uid(), keyword: 'sustainable', tag: 'sustainable', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'organic cotton', tag: 'organic-cotton', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
  ],
  electronics: [
    { id: uid(), keyword: 'wireless', tag: 'wireless', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'USB-C', tag: 'usb-c', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'Bluetooth', tag: 'bluetooth', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
  ],
  health: [
    { id: uid(), keyword: 'vegan', tag: 'vegan', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'gluten-free', tag: 'gluten-free', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'dairy-free', tag: 'dairy-free', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
  ],
  jewellery: [
    { id: uid(), keyword: 'sterling silver', tag: 'sterling-silver', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'gold plated', tag: 'gold-plated', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'hypoallergenic', tag: 'hypoallergenic', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
  ],
  home: [
    { id: uid(), keyword: 'handmade', tag: 'handmade', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
    { id: uid(), keyword: 'sustainable', tag: 'sustainable', caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true },
  ],
  general: [],
};

export function getIndustryTagDefaults(): TagConfig {
  const store = getStoreConfig();
  const industry = getIndustryConfig(store.industry);
  const types: ProductTypeEntry[] = industry.productTypes.map(t => ({
    name: t.name,
    tag: toTag(t.name),
    department: industry.displayName.split(' ')[0],
  }));
  return {
    layers: DEFAULT_LAYERS.map(l => ({ ...l, id: uid() })),
    productTypes: types,
    specialRules: (INDUSTRY_SPECIAL_RULES[store.industry] || []).map(r => ({ ...r, id: uid() })),
  };
}

// ── Tag Generation ─────────────────────────────────────────
export interface TagInput {
  title: string;
  brand: string;
  productType: string;
  arrivalMonth?: string;
  priceStatus: 'full_price' | 'sale';
  gender?: string;
  description?: string;
}

function matchesRule(text: string, rule: SpecialRule): boolean {
  const source = rule.caseSensitive ? text : text.toLowerCase();
  const kw = rule.caseSensitive ? rule.keyword : rule.keyword.toLowerCase();
  switch (rule.matchType) {
    case 'exact': return source === kw;
    case 'starts_with': return source.startsWith(kw);
    default: return source.includes(kw);
  }
}

export function generateTags(input: TagInput, config?: TagConfig): string[] {
  const cfg = config || getTagConfig();
  const tags: string[] = [];
  const activeLayers = cfg.layers.filter(l => l.active).sort((a, b) => a.order - b.order);

  for (const layer of activeLayers) {
    switch (layer.name) {
      case 'Gender':
        if (input.gender) tags.push(input.gender);
        else tags.push(layer.values[0] || 'Womens');
        break;
      case 'Department': {
        const pt = cfg.productTypes.find(t => t.name === input.productType);
        if (pt?.department) tags.push(pt.department);
        break;
      }
      case 'Product Type': {
        const pt = cfg.productTypes.find(t => t.name === input.productType);
        if (pt) tags.push(pt.tag);
        break;
      }
      case 'Brand':
        if (input.brand) tags.push(input.brand);
        break;
      case 'Arrival Month':
        if (input.arrivalMonth) tags.push(input.arrivalMonth);
        else {
          const now = new Date();
          tags.push(`${now.toLocaleString('en', { month: 'short' })}${now.getFullYear().toString().slice(-2)}`);
        }
        break;
      case 'Price Status':
        tags.push(input.priceStatus);
        break;
      case 'Special Properties': {
        const searchText = [
          input.title || '',
          input.description || '',
        ].join(' ');
        for (const rule of cfg.specialRules.filter(r => r.active)) {
          let text = '';
          if (rule.searchTitle) text += input.title + ' ';
          if (rule.searchDescription) text += input.description || '';
          if (matchesRule(text, rule)) tags.push(rule.tag);
        }
        break;
      }
      default:
        if (layer.type === 'fixed' && layer.fixedValue) tags.push(layer.fixedValue);
        break;
    }
  }

  return tags;
}

export function generateTagString(input: TagInput, config?: TagConfig): string {
  return generateTags(input, config).join(', ');
}

export { toTag };
