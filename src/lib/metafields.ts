// Metafield configuration and helpers

export interface MetafieldDefinition {
  key: string;
  label: string;
  shopifyColumn: string;
  enabled: boolean;
  isCustom?: boolean;
}

const STORAGE_KEY = "metafield_config";

export const DEFAULT_METAFIELDS: MetafieldDefinition[] = [
  { key: "fabric_content", label: "Fabric content", shopifyColumn: "Metafield: custom.fabric_content [string]", enabled: true },
  { key: "care_instructions", label: "Care instructions", shopifyColumn: "Metafield: custom.care_instructions [string]", enabled: true },
  { key: "country_of_origin", label: "Country of origin", shopifyColumn: "Metafield: custom.country_of_origin [string]", enabled: true },
  { key: "cup_sizes", label: "Cup sizes", shopifyColumn: "Metafield: custom.cup_sizes [string]", enabled: true },
  { key: "uv_protection", label: "UV protection / UPF rating", shopifyColumn: "Metafield: custom.uv_protection [string]", enabled: true },
  { key: "size_guide", label: "Size guide", shopifyColumn: "Metafield: custom.size_guide [string]", enabled: false },
  { key: "lot_number", label: "Lot number (compliance)", shopifyColumn: "Metafield: custom.lot_number [string]", enabled: false },
  { key: "expiry_date", label: "Expiry date (compliance)", shopifyColumn: "Metafield: custom.expiry_date [string]", enabled: false },
];

export function getMetafieldConfig(): MetafieldDefinition[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_METAFIELDS;
}

export function saveMetafieldConfig(config: MetafieldDefinition[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function getEnabledMetafields(): MetafieldDefinition[] {
  return getMetafieldConfig().filter(m => m.enabled);
}

export type MetafieldValues = Record<string, string>;

// Sample metafield data for demo products
export const SAMPLE_METAFIELDS: Record<string, MetafieldValues> = {
  "Bond Eye": {
    fabric_content: "78% Nylon, 22% Lycra",
    care_instructions: "Hand wash cold, do not tumble dry",
    country_of_origin: "Australia",
    cup_sizes: "A-D",
    uv_protection: "UPF 50+",
  },
  "Seafolly": {
    fabric_content: "82% Nylon, 18% Elastane",
    care_instructions: "Hand wash cold, line dry in shade",
    country_of_origin: "China",
    cup_sizes: "",
    uv_protection: "UPF 50+",
  },
  "Baku": {
    fabric_content: "80% Nylon, 20% Elastane",
    care_instructions: "Hand wash cold",
    country_of_origin: "Indonesia",
    cup_sizes: "",
    uv_protection: "",
  },
  "Jantzen": {
    fabric_content: "77% Nylon, 23% Lycra",
    care_instructions: "Hand wash cold, do not bleach",
    country_of_origin: "Australia",
    cup_sizes: "A-DD",
    uv_protection: "UPF 50+",
  },
};
