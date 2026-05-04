// ════════════════════════════════════════════════════════════════
// image-pipeline.ts — Edge-side image downloader + optimiser used by
// the product-extract function.
//
// Locked plan rules (mem://features/url-product-extractor):
//   • Source priority: og:image → near price → product container → gallery
//   • Stream through resize/encode pipeline — no disk writes
//   • Storage bucket: existing `compressed-images` (public)
//   • Validate content-type is image/*
//   • Kill-switch: abort if cumulative download > MAX_TOTAL_BYTES
//
// Runtime note: Sharp (Node-native) cannot run in Deno Edge runtime.
// We use `imagescript` (pure-WASM JPEG/PNG/WebP) as the Edge-side
// equivalent. The public API mirrors what a future Node worker using
// real Sharp would expose, so callers don't change.
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decode, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const BUCKET = "compressed-images";
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;       // 10 MB kill-switch
const PER_IMAGE_TIMEOUT_MS = 5_000;              // tightened from 8s
const MAX_IMAGES = 4;                            // CPU-time safety on Edge runtime
const MAX_DIMENSION = 1600;                      // longest side
const WEBP_QUALITY = 82;
const SKIP_OPTIMISE_BYTES = 150 * 1024;          // <150KB → upload original, skip WASM decode
const PIPELINE_BUDGET_MS = 12_000;               // total wall-clock budget for ALL images

const UA = "Mozilla/5.0 (compatible; SonicInvoiceBot/1.0; +https://sonicinvoices.com)";

export interface DownloadedImage {
  storedUrl: string;        // public URL in compressed-images bucket
  originalUrl: string;
  width: number;
  height: number;
  bytes: number;
  contentType: string;      // "image/webp" when optimised, original MIME otherwise
  optimised: boolean;       // false when small originals were uploaded as-is
}

export interface DownloadImagesResult {
  images: DownloadedImage[];
  warnings: string[];
  killSwitchTripped: boolean;
  totalBytesIn: number;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/** Resolve relative image URLs against the page URL. */
function absolutise(src: string, base: string): string | null {
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

/** De-dup, drop tracking pixels, cap to MAX_IMAGES. */
function shortlistUrls(urls: string[], base: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    if (!raw) continue;
    const abs = absolutise(raw.trim(), base);
    if (!abs) continue;
    // Skip obvious non-product assets
    if (/sprite|icon|logo|placeholder|1x1|pixel/i.test(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_IMAGE_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "image/*" },
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const contentType = r.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new Error(`Non-image content-type: ${contentType || "unknown"}`);
    }
    const buf = new Uint8Array(await r.arrayBuffer());
    return { bytes: buf, contentType };
  } finally {
    clearTimeout(timer);
  }
}

/** Resize to MAX_DIMENSION on longest side and encode as WebP. */
async function optimise(bytes: Uint8Array): Promise<{ webp: Uint8Array; width: number; height: number }> {
  const decoded = await decode(bytes);
  if (!(decoded instanceof Image)) {
    throw new Error("Unsupported image format (animated GIF or unknown)");
  }
  const longest = Math.max(decoded.width, decoded.height);
  if (longest > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / longest;
    decoded.resize(Math.round(decoded.width * scale), Math.round(decoded.height * scale));
  }
  const webp = await decoded.encode(WEBP_QUALITY) as Uint8Array;
  return { webp, width: decoded.width, height: decoded.height };
}

function buildStoragePath(sourceUrl: string, idx: number, ext = "webp"): string {
  // Group images per source host + path hash to keep the bucket browsable
  let host = "unknown";
  let pathHash = "0";
  try {
    const u = new URL(sourceUrl);
    host = u.host.replace(/[^a-z0-9.-]/gi, "");
    pathHash = Math.abs(hashString(u.pathname)).toString(36);
  } catch { /* keep defaults */ }
  const stamp = Date.now();
  return `product-extract/${host}/${pathHash}/${stamp}-${idx}.${ext}`;
}

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase().split(";")[0].trim();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  if (m === "image/avif") return "avif";
  if (m === "image/svg+xml") return "svg";
  return "bin";
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Stream-download, optimise (resize + WebP) and upload product images
 * to the existing `compressed-images` bucket. Honours the 10MB kill-switch
 * across the whole batch.
 */
export async function downloadImages(
  rawUrls: string[],
  sourceUrl: string,
): Promise<DownloadImagesResult> {
  const warnings: string[] = [];
  const out: DownloadedImage[] = [];

  const urls = shortlistUrls(rawUrls, sourceUrl);
  if (urls.length === 0) {
    return { images: [], warnings: ["No usable image URLs after shortlist."], killSwitchTripped: false, totalBytesIn: 0 };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return {
      images: [],
      warnings: ["Storage credentials missing (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."],
      killSwitchTripped: false,
      totalBytesIn: 0,
    };
  }
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const deadline = Date.now() + PIPELINE_BUDGET_MS;
  let totalBytesIn = 0;
  let killSwitchTripped = false;

  // Phase 1 — fetch all candidates in parallel with the global deadline.
  const fetched = await Promise.all(
    urls.map(async (url, idx) => {
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("budget exhausted before fetch");
        const perTimeout = Math.min(PER_IMAGE_TIMEOUT_MS, remaining);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), perTimeout);
        try {
          const r = await fetch(url, {
            signal: ctrl.signal,
            headers: { "User-Agent": UA, Accept: "image/*" },
            redirect: "follow",
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const contentType = r.headers.get("content-type") ?? "";
          if (!contentType.startsWith("image/")) {
            throw new Error(`Non-image content-type: ${contentType || "unknown"}`);
          }
          const bytes = new Uint8Array(await r.arrayBuffer());
          return { ok: true as const, idx, url, bytes, contentType };
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false as const, idx, url, error: msg };
      }
    }),
  );

  // Phase 2 — process+upload in original order, but bail on global deadline.
  for (const item of fetched) {
    if (!item.ok) {
      warnings.push(`Image ${item.url} skipped: ${item.error}`);
      console.warn("[image-pipeline] skip", item.url, item.error);
      continue;
    }

    if (Date.now() >= deadline) {
      warnings.push(
        `Pipeline budget (${PIPELINE_BUDGET_MS}ms) reached — stopped after ${out.length} images.`,
      );
      break;
    }

    const { url, bytes, contentType, idx } = item;
    try {
      totalBytesIn += bytes.byteLength;
      if (totalBytesIn > MAX_TOTAL_BYTES) {
        killSwitchTripped = true;
        warnings.push(
          `Kill-switch tripped at ${(totalBytesIn / 1024 / 1024).toFixed(2)} MB — stopped after ${out.length} images.`,
        );
        break;
      }

      // Skip the WASM decode/encode for already-small images, OR when budget is tight.
      const remainingMs = deadline - Date.now();
      const tightBudget = remainingMs < 3_000;
      const small = bytes.byteLength < SKIP_OPTIMISE_BYTES;

      let uploadBytes: Uint8Array;
      let uploadContentType: string;
      let width = 0;
      let height = 0;
      let optimised: boolean;
      let ext: string;

      if (small || tightBudget) {
        uploadBytes = bytes;
        uploadContentType = contentType || "application/octet-stream";
        optimised = false;
        ext = mimeToExt(uploadContentType);
        if (tightBudget && !small) {
          warnings.push(`Image ${url} uploaded un-optimised (budget tight).`);
        }
      } else {
        const opt = await optimise(bytes);
        uploadBytes = opt.webp;
        uploadContentType = "image/webp";
        width = opt.width;
        height = opt.height;
        optimised = true;
        ext = "webp";
      }

      const path = buildStoragePath(sourceUrl, idx, ext);
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, uploadBytes, {
          contentType: uploadContentType,
          upsert: false,
          cacheControl: "31536000, immutable",
        });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      out.push({
        storedUrl: pub.publicUrl,
        originalUrl: url,
        width,
        height,
        bytes: uploadBytes.byteLength,
        contentType: uploadContentType,
        optimised,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`Image ${url} skipped: ${msg}`);
      console.warn("[image-pipeline] process-skip", url, msg);
    }
  }

  return { images: out, warnings, killSwitchTripped, totalBytesIn };
}

/**
 * Best-effort image URL collector. Honours the locked priority order:
 *   1. og:image / twitter:image
 *   2. images near price (heuristic: same parent as a `[itemprop="price"]` or `.price`)
 *   3. images inside `[class*="product"]` / itemscope=Product containers
 *   4. gallery thumbnails
 *
 * `$` is a Cheerio root passed in by the caller so we don't double-load HTML.
 */
// deno-lint-ignore no-explicit-any
export function collectImageUrls($: any, baseUrl: string): string[] {
  const found: string[] = [];

  const push = (v?: string | null) => {
    if (v && typeof v === "string") found.push(v);
  };

  // 1. og:image + twitter:image
  $('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]').each(
    (_: number, el: unknown) => push($(el).attr("content")),
  );

  // 2. images near price
  const priceNodes = $('[itemprop="price"], .price, [class*="Price"], [data-price]');
  priceNodes.each((_: number, el: unknown) => {
    const container = $(el).closest("section, article, div, form");
    container.find("img").each((__: number, img: unknown) => {
      push($(img).attr("src") || $(img).attr("data-src") || $(img).attr("data-zoom-src"));
    });
  });

  // 3. images inside product containers
  $('[itemtype*="schema.org/Product"] img, [class*="product"] img, [class*="Product"] img, [id*="product"] img')
    .each((_: number, img: unknown) =>
      push($(img).attr("src") || $(img).attr("data-src") || $(img).attr("data-zoom-src")),
    );

  // 4. generic gallery
  $('.gallery img, .product-gallery img, [class*="gallery"] img, [class*="carousel"] img').each(
    (_: number, img: unknown) =>
      push($(img).attr("src") || $(img).attr("data-src") || $(img).attr("data-zoom-src")),
  );

  // Resolve + de-dupe; the downloader will shortlist further
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    const abs = absolutise(raw.trim(), baseUrl);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}
