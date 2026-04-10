// ── Colour Image Finder ──
// Attempts to find an image for a new colour variant.

import { supabase } from "@/integrations/supabase/client";

export type ImageSource = "invoice" | "lookbook" | "web_search" | "existing" | "none";

export interface ColourImageResult {
  url: string;
  source: ImageSource;
}

export async function findColourImage(
  brand: string,
  styleName: string,
  colour: string,
  invoiceImageUrl?: string,
  existingProductImageUrl?: string,
): Promise<ColourImageResult> {
  // 1. Invoice image URL (supplier included one)
  if (invoiceImageUrl) {
    return { url: invoiceImageUrl, source: "invoice" };
  }

  // 2. AI image search via edge function
  try {
    const query = `${brand} ${styleName} ${colour}`.trim();
    const { data, error } = await supabase.functions.invoke("image-search", {
      body: { query, limit: 1 },
    });
    if (!error && data?.results?.[0]?.url) {
      return { url: data.results[0].url, source: "web_search" };
    }
  } catch {
    // Fall through to next option
  }

  // 3. Existing product image as fallback
  if (existingProductImageUrl) {
    return { url: existingProductImageUrl, source: "existing" };
  }

  // 4. No image found
  return { url: "", source: "none" };
}
