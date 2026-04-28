// ════════════════════════════════════════════════════════════════
// image-downloader.ts — Public, simple-signature wrapper around the
// streaming image pipeline used by product-extract.
//
// Why a wrapper?
//   The brief asks for `downloadAndStoreImages(urls): Promise<string[]>`
//   and mentions `npm:sharp` + R2. In Supabase Edge (Deno) Sharp is
//   not available — we use `imagescript` (pure-WASM) inside
//   image-pipeline.ts. Storage is the existing public
//   `compressed-images` bucket, not R2 (locked project rule —
//   mem://features/url-product-extractor).
//
// Behaviour matches the brief:
//   • realistic UA + 10s-class per-image timeout
//   • content-type must start with image/
//   • resize to ≤1200px longest side, encode WebP q≈80
//   • unique filename per image
//   • per-image failure is skipped, batch continues
//   • 10MB cumulative kill-switch — partial results returned
// ════════════════════════════════════════════════════════════════

import { downloadImages } from "./image-pipeline.ts";

/**
 * Download, optimise (WebP, max 1200px-ish longest side) and store
 * each image in the `compressed-images` bucket. Returns the public
 * stored URLs in the same order as successful downloads.
 *
 * Failed images are skipped silently in the return value (warnings
 * are logged by the underlying pipeline). The 10MB total-bytes
 * kill-switch may truncate the result.
 *
 * @param imageUrls   Absolute or page-relative image URLs.
 * @param sourceUrl   Page URL the images came from (used to resolve
 *                    relative URLs and to namespace storage paths).
 *                    Defaults to "" — callers should pass the real
 *                    source page when available.
 */
export async function downloadAndStoreImages(
  imageUrls: string[],
  sourceUrl = "",
): Promise<string[]> {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) return [];

  const result = await downloadImages(imageUrls, sourceUrl);

  if (result.warnings.length > 0) {
    console.warn("[image-downloader] warnings:", result.warnings);
  }
  if (result.killSwitchTripped) {
    console.warn(
      `[image-downloader] 10MB kill-switch tripped — returning ${result.images.length} image(s).`,
    );
  }

  return result.images.map((img) => img.storedUrl);
}
