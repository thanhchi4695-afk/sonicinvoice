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

  // 2. AI image search via edge function — uses the `products` array contract
  // expected by supabase/functions/image-search. Brand goes FIRST in the query
  // so the AI anchors on the correct label (e.g. "Walnut Melbourne Marrakesh Dress Mosaique").
  try {
    const { data, error } = await supabase.functions.invoke("image-search", {
      body: {
        products: [{
          searchQuery: `${brand} ${styleName} ${colour}`.trim(),
          brand,
          styleName,
          colour,
        }],
      },
    });
    const hit = data?.results?.[0];
    if (!error && hit?.imageUrl) {
      return { url: hit.imageUrl, source: "web_search" };
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
