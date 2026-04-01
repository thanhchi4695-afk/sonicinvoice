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

// DEFAULT_LAYERS removed — now derived from industry-config

// INDUSTRY_SPECIAL_RULES removed — now derived from industry-config

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
