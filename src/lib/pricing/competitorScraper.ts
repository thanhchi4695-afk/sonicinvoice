/**
 * Competitor Scraper — client wrapper.
 *
 * MVP: merchant pastes a single competitor product URL. We invoke the
 * `pricing-competitor-fetch` edge function which tries (in order):
 *   1. Shopify `/products/<handle>.json` shortcut
 *   2. JSON-LD Product schema
 *   3. OpenGraph price meta tags
 *   4. Gemini Flash extraction from cleaned HTML
 *
 * Future: bulk auto-discovery via Brave Search across known competitor list.
 */

import { supabase } from "@/integrations/supabase/client";

export interface CompetitorPriceResult {
  ok: boolean;
  price: number | null;
  currency: string | null;
  title: string | null;
  source: "json-ld" | "og-meta" | "shopify-json" | "ai" | "none";
  url: string;
  message?: string;
}

export async function fetchCompetitorPrice(url: string): Promise<CompetitorPriceResult> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return {
      ok: false,
      price: null,
      currency: null,
      title: null,
      source: "none",
      url: trimmed,
      message: "URL must start with http:// or https://",
    };
  }

  const { data, error } = await supabase.functions.invoke("pricing-competitor-fetch", {
    body: { url: trimmed },
  });

  if (error) {
    return {
      ok: false,
      price: null,
      currency: null,
      title: null,
      source: "none",
      url: trimmed,
      message: error.message,
    };
  }

  return data as CompetitorPriceResult;
}
