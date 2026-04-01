// Hook for store mode (Shopify vs Lightspeed) awareness
import { getStoreConfig, type StoreType, type LightspeedVersion } from '@/lib/prompt-builder';

export interface StoreMode {
  storeType: StoreType;
  lightspeedVersion: LightspeedVersion;
  isLightspeed: boolean;
  isShopifyOnly: boolean;
  isLightspeedOnly: boolean;
  isLightspeedShopify: boolean;
  isRSeries: boolean;
  isXSeries: boolean;
  modeBadge: { label: string; emoji: string; color: string };
  targetPlatform: string;
  compareAtLabel: string;
  exportLabel: string;
}

export function getStoreMode(): StoreMode {
  const config = getStoreConfig();
  const st = config.storeType || 'shopify';
  const lsv = config.lightspeedVersion || 'x_series';

  const isLightspeed = st === 'lightspeed' || st === 'lightspeed_shopify';
  const isShopifyOnly = st === 'shopify' || st === 'other';
  const isLightspeedOnly = st === 'lightspeed';
  const isLightspeedShopify = st === 'lightspeed_shopify';
  const isRSeries = isLightspeed && lsv === 'r_series';
  const isXSeries = isLightspeed && lsv === 'x_series';

  const versionLabel = isRSeries ? ' (R-Series)' : isXSeries ? ' (X-Series)' : '';

  const modeBadge = isLightspeedShopify
    ? { label: `Lightspeed${versionLabel} + Shopify`, emoji: '🖥️', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' }
    : isLightspeedOnly
    ? { label: `Lightspeed POS${versionLabel}`, emoji: '🖥️', color: 'bg-muted text-muted-foreground border-border' }
    : { label: 'Shopify mode', emoji: '🛍️', color: 'bg-primary/15 text-primary border-primary/30' };

  return {
    storeType: st,
    lightspeedVersion: lsv,
    isLightspeed,
    isShopifyOnly,
    isLightspeedOnly,
    isLightspeedShopify,
    isRSeries,
    isXSeries,
    modeBadge,
    targetPlatform: isLightspeed ? 'Lightspeed' : 'Shopify',
    compareAtLabel: isLightspeed ? 'RRP / Retail price' : 'Compare-at price',
    exportLabel: isRSeries ? 'Lightspeed R-Series CSV' : isXSeries ? 'Lightspeed X-Series CSV' : isLightspeed ? 'Lightspeed CSV' : 'Shopify CSV',
  };
}

export function useStoreMode(): StoreMode {
  return getStoreMode();
}
