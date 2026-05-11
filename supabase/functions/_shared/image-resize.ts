// Shared image-safety utility for any AI call that ships images as base64.
//
// Why: Claude rejects multi-image requests when ANY image dimension exceeds
// 2000px ("max allowed size for many-image requests: 2000 pixels"). We use
// 1568px as a safe ceiling (Claude's documented optimal max edge), only
// downscale, and never upscale. Each image is logged before/after so the
// behaviour is visible in edge function logs.
//
// Also exposes `chunkForClaude(items, MAX_IMAGES_PER_CLAUDE_CALL)` so callers
// that batch many images split into ≤20-image messages.

import { decode, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

export const MAX_AI_IMAGE_DIMENSION = 1568; // safe ceiling, well under 2000
export const MAX_IMAGES_PER_CLAUDE_CALL = 20;

export interface ProcessedImage {
  ok: boolean;
  base64: string | null;
  mediaType: string;
  originalWidth: number;
  originalHeight: number;
  finalWidth: number;
  finalHeight: number;
  resized: boolean;
  skipped: boolean;
  error?: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(bin);
}

function detectMediaType(buf: ArrayBuffer, fallback = "image/jpeg"): string {
  const v = new Uint8Array(buf.slice(0, 12));
  if (v[0] === 0xff && v[1] === 0xd8) return "image/jpeg";
  if (v[0] === 0x89 && v[1] === 0x50 && v[2] === 0x4e && v[3] === 0x47) return "image/png";
  if (v[8] === 0x57 && v[9] === 0x45 && v[10] === 0x42 && v[11] === 0x50) return "image/webp";
  if (v[0] === 0x47 && v[1] === 0x49 && v[2] === 0x46) return "image/gif";
  return fallback;
}

/**
 * Fetch a remote image, decode it, and downscale if any dimension > 1568px.
 * Returns a base64 payload that's safe to pass into a Claude image block.
 *
 * Always best-effort: never throws. If anything fails we return ok:false and
 * the caller is expected to skip this image (FIX 4 — graceful fallback).
 */
export async function processImageForAI(
  imageUrl: string,
  filenameHint = "image",
): Promise<ProcessedImage> {
  const blank: ProcessedImage = {
    ok: false,
    base64: null,
    mediaType: "image/jpeg",
    originalWidth: 0,
    originalHeight: 0,
    finalWidth: 0,
    finalHeight: 0,
    resized: false,
    skipped: true,
  };

  try {
    const res = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0 SonicInvoice/1.0" },
    });
    if (!res.ok) {
      console.warn(`[image] Failed to fetch: ${imageUrl} — Status: ${res.status}`);
      return { ...blank, error: `fetch ${res.status}` };
    }
    const buf = await res.arrayBuffer();
    const mediaType = detectMediaType(buf, res.headers.get("content-type") ?? "image/jpeg");
    const bytes = new Uint8Array(buf);

    let img: Image;
    try {
      const decoded = await decode(bytes);
      img = decoded as Image;
    } catch (e) {
      console.warn(`[image] decode failed for ${imageUrl}:`, (e as Error).message);
      return { ...blank, mediaType, error: `decode failed: ${(e as Error).message}` };
    }

    const originalWidth = img.width;
    const originalHeight = img.height;
    console.log(`[image] Original size: ${originalWidth}x${originalHeight}px — ${filenameHint}`);

    if (originalWidth <= MAX_AI_IMAGE_DIMENSION && originalHeight <= MAX_AI_IMAGE_DIMENSION) {
      console.log(`[image] Within limits: ${originalWidth}x${originalHeight}px — no resize`);
      return {
        ok: true,
        base64: bytesToBase64(bytes),
        mediaType,
        originalWidth,
        originalHeight,
        finalWidth: originalWidth,
        finalHeight: originalHeight,
        resized: false,
        skipped: false,
      };
    }

    // Downscale longest edge to MAX_AI_IMAGE_DIMENSION, preserve aspect ratio.
    const scale = MAX_AI_IMAGE_DIMENSION / Math.max(originalWidth, originalHeight);
    const newW = Math.max(1, Math.round(originalWidth * scale));
    const newH = Math.max(1, Math.round(originalHeight * scale));

    try {
      img.resize(newW, newH);
      // Re-encode as JPEG (smallest, broadly supported).
      const reEncoded = await img.encodeJPEG(85);
      console.log(`[image] Resized to: ${newW}x${newH}px`);
      return {
        ok: true,
        base64: bytesToBase64(reEncoded),
        mediaType: "image/jpeg",
        originalWidth,
        originalHeight,
        finalWidth: newW,
        finalHeight: newH,
        resized: true,
        skipped: false,
      };
    } catch (e) {
      console.warn(`[image] resize/encode failed for ${imageUrl}:`, (e as Error).message);
      return {
        ...blank,
        mediaType,
        originalWidth,
        originalHeight,
        error: `resize failed: ${(e as Error).message}`,
      };
    }
  } catch (e) {
    console.warn(`[image] Error processing ${imageUrl}:`, (e as Error).message);
    return { ...blank, error: (e as Error).message };
  }
}

/** Process a list of image URLs in parallel and return per-URL results + stats. */
export async function processImagesForAI(
  urls: string[],
): Promise<{
  results: Array<{ url: string; processed: ProcessedImage }>;
  stats: { processed: number; resized: number; skipped: number };
}> {
  const results = await Promise.all(
    urls.map(async (url, i) => ({
      url,
      processed: await processImageForAI(url, `image_${i}`),
    })),
  );
  const stats = {
    processed: results.filter((r) => r.processed.ok).length,
    resized: results.filter((r) => r.processed.resized).length,
    skipped: results.filter((r) => !r.processed.ok).length,
  };
  return { results, stats };
}

/** Split an array into chunks of at most `size` items (default 20). */
export function chunkForClaude<T>(items: T[], size: number = MAX_IMAGES_PER_CLAUDE_CALL): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Build a Claude image content block from a successfully-processed image. */
export function toClaudeImageBlock(p: ProcessedImage) {
  if (!p.ok || !p.base64) return null;
  return {
    type: "image" as const,
    source: { type: "base64" as const, media_type: p.mediaType, data: p.base64 },
  };
}
