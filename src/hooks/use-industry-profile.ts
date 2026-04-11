import { useMemo } from "react";
import { getStoreConfig } from "@/lib/prompt-builder";
import {
  getIndustryDefinition,
  getFieldLabels,
  getGoogleShoppingMapping,
  industryHasSizeHoles,
  type IndustryFieldLabels,
  type GoogleShoppingMapping,
} from "@/lib/industry-config";

export interface IndustryProfile {
  industryId: string;
  displayName: string;
  icon: string;
  fieldLabels: IndustryFieldLabels;
  googleShopping: GoogleShoppingMapping;
  hasSizeHoles: boolean;
}

/** Returns the active industry profile based on store config (defaults to fashion/clothing). */
export function useIndustryProfile(): IndustryProfile {
  return useMemo(() => {
    const cfg = getStoreConfig();
    const id = cfg.industry || "clothing";
    const def = getIndustryDefinition(id);
    return {
      industryId: id,
      displayName: def.displayName,
      icon: def.icon,
      fieldLabels: getFieldLabels(id),
      googleShopping: getGoogleShoppingMapping(id),
      hasSizeHoles: industryHasSizeHoles(id),
    };
  }, []);
}

/** Non-hook version for use outside React components */
export function getIndustryProfile(): IndustryProfile {
  const cfg = getStoreConfig();
  const id = cfg.industry || "clothing";
  const def = getIndustryDefinition(id);
  return {
    industryId: id,
    displayName: def.displayName,
    icon: def.icon,
    fieldLabels: getFieldLabels(id),
    googleShopping: getGoogleShoppingMapping(id),
    hasSizeHoles: industryHasSizeHoles(id),
  };
}
