import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PriceMatchLineItem } from "@/lib/price-match-utils";

export type DescriptionResult = {
  description: string | null;
  source_url: string;
  source_name: string;
  source_type: "supplier" | "retailer";
  word_count: number;
  raw_word_count: number;
  confidence: "high" | "medium" | "low";
  status: "found" | "not_found" | "error";
  fetched_at: string; // ISO timestamp
  edited: boolean;
  error_message?: string;
};

// 24h session cache keyed by style_number (or brand|style_name fallback)
const sessionCache = new Map<string, DescriptionResult>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(item: Pick<PriceMatchLineItem, "style_number" | "brand" | "style_name">) {
  return (item.style_number || `${item.brand}|${item.style_name}`).toLowerCase().trim();
}

function isFresh(ts: string): boolean {
  const t = new Date(ts).getTime();
  if (isNaN(t)) return false;
  return Date.now() - t < CACHE_TTL_MS;
}

export function useProductDescriptions() {
  const [results, setResults] = useState<Map<string, DescriptionResult>>(new Map());
  const [loading, setLoading] = useState<Map<string, boolean>>(new Map());

  const setLoad = useCallback((key: string, val: boolean) => {
    setLoading((prev) => {
      const next = new Map(prev);
      if (val) next.set(key, true);
      else next.delete(key);
      return next;
    });
  }, []);

  const setRes = useCallback((key: string, val: DescriptionResult) => {
    setResults((prev) => {
      const next = new Map(prev);
      next.set(key, val);
      return next;
    });
  }, []);

  const fetchDescription = useCallback(
    async (
      item: PriceMatchLineItem,
      opts: { forceRefresh?: boolean } = {},
    ): Promise<DescriptionResult> => {
      const key = cacheKey(item);

      // Cache hit
      if (!opts.forceRefresh) {
        const cached = sessionCache.get(key);
        if (cached && isFresh(cached.fetched_at)) {
          setRes(key, cached);
          return cached;
        }
      }

      setLoad(key, true);
      try {
        const { data, error } = await supabase.functions.invoke("fetch-product-description", {
          body: {
            style_name: item.style_name,
            style_number: item.style_number,
            brand: item.brand,
            product_type: item.product_type,
          },
        });

        if (error) throw new Error(error.message || "Edge function failed");

        const payload = data as Partial<DescriptionResult> | null;
        const description = payload?.description?.trim() || null;
        const result: DescriptionResult = {
          description,
          source_url: payload?.source_url || "",
          source_name: payload?.source_name || "",
          source_type: (payload?.source_type as "supplier" | "retailer") || "retailer",
          word_count: payload?.word_count || 0,
          raw_word_count: payload?.raw_word_count || 0,
          confidence: (payload?.confidence as "high" | "medium" | "low") || "low",
          status: description ? "found" : "not_found",
          fetched_at: new Date().toISOString(),
          edited: false,
        };
        sessionCache.set(key, result);
        setRes(key, result);
        return result;
      } catch (err) {
        const result: DescriptionResult = {
          description: null,
          source_url: "",
          source_name: "",
          source_type: "retailer",
          word_count: 0,
          raw_word_count: 0,
          confidence: "low",
          status: "error",
          fetched_at: new Date().toISOString(),
          edited: false,
          error_message: err instanceof Error ? err.message : "Fetch failed",
        };
        setRes(key, result);
        return result;
      } finally {
        setLoad(key, false);
      }
    },
    [setLoad, setRes],
  );

  const fetchAll = useCallback(
    async (items: PriceMatchLineItem[]) => {
      for (const item of items) {
        await fetchDescription(item);
        await new Promise((r) => setTimeout(r, 1500));
      }
    },
    [fetchDescription],
  );

  /** Manually edit a fetched description (or write one if not_found). */
  const updateDescription = useCallback(
    (key: string, newText: string) => {
      setResults((prev) => {
        const next = new Map(prev);
        const existing = next.get(key);
        const wordCount = newText.trim().split(/\s+/).filter(Boolean).length;
        if (existing) {
          next.set(key, {
            ...existing,
            description: newText.trim() ? newText : null,
            word_count: wordCount,
            edited: true,
            status: newText.trim() ? "found" : existing.status,
          });
        } else {
          next.set(key, {
            description: newText.trim() ? newText : null,
            source_url: "",
            source_name: "Manual entry",
            source_type: "retailer",
            word_count: wordCount,
            raw_word_count: wordCount,
            confidence: "low",
            status: newText.trim() ? "found" : "not_found",
            fetched_at: new Date().toISOString(),
            edited: true,
          });
        }
        // Also reflect into cache so it survives navigation
        const cur = sessionCache.get(key);
        if (cur) {
          sessionCache.set(key, {
            ...cur,
            description: newText.trim() ? newText : null,
            word_count: wordCount,
            edited: true,
            status: newText.trim() ? "found" : cur.status,
          });
        }
        return next;
      });
    },
    [],
  );

  return {
    results,
    loading,
    fetchDescription,
    fetchAll,
    updateDescription,
    cacheKey,
  };
}
