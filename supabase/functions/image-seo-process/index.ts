// image-seo-process — Downloads an image (or accepts base64), compresses + converts to WebP
// using imagescript (Deno-native pure-WASM), then either uploads to Supabase Storage
// (compressed-images bucket, public) or returns the bytes for the caller to forward.
//
// Three modes via `action`:
//   - "process_url"    { imageUrl, filename, options? }  → optimised WebP stored in bucket
//   - "process_upload" { base64, contentType, filename, options? } → same, for direct uploads
//   - "extract_from_page" { pageUrl } → fetches page HTML, returns image URLs + product info
//
// Auth: Supabase JWT required.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decode, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "compressed-images";

const DEFAULT_MAX_DIMENSION = 2048;
const DEFAULT_QUALITY = 82;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const UA = "Mozilla/5.0 (compatible; SonicInvoiceBot/1.0; +https://sonicinvoices.com)";

interface ProcessOptions {
  maxDimension?: number;
  quality?: number;
}

async function fetchWithTimeout(url: string, timeoutMs: number, opts: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function compressToWebP(
  inputBytes: Uint8Array,
  options: ProcessOptions = {},
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const maxDim = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = options.quality ?? DEFAULT_QUALITY;

  const decoded = await decode(inputBytes);
  if (!(decoded instanceof Image)) {
    throw new Error("Animated images (GIF) are not supported");
  }

  let img = decoded;
  if (img.width > maxDim || img.height > maxDim) {
    if (img.width >= img.height) {
      img = img.resize(maxDim, Image.RESIZE_AUTO);
    } else {
      img = img.resize(Image.RESIZE_AUTO, maxDim);
    }
  }

  const webp = await img.encode(quality);
  return { bytes: webp, width: img.width, height: img.height };
}

async function uploadToBucket(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<string> {
  const path = `${userId}/seo/${Date.now()}-${filename}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: "image/webp",
    upsert: true,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// ──────────────────────────────────────────────────────────────────────
// Page parser — extracts image URLs + lightweight product metadata
// (used by "Paste URL" mode in the new /image-seo flow)
// ──────────────────────────────────────────────────────────────────────
function parseProductPage(html: string, baseUrl: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return { productInfo: {}, imageUrls: [] };

  // Product info from JSON-LD first, then microdata, then DOM hints
  let productInfo: Record<string, unknown> = {};
  const ldNodes = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const node of ldNodes) {
    try {
      const parsed = JSON.parse(node.textContent || "{}");
      const items = Array.isArray(parsed) ? parsed : (parsed["@graph"] ?? [parsed]);
      for (const it of items) {
        const t = it?.["@type"];
        const isProduct = t === "Product" || (Array.isArray(t) && t.includes("Product"));
        if (isProduct) {
          productInfo = {
            title: it.name,
            sku: it.sku ?? it.mpn,
            gtin: it.gtin13 ?? it.gtin,
            vendor: it.brand?.name ?? it.brand,
            productType: it.category,
            description: typeof it.description === "string" ? it.description.slice(0, 400) : undefined,
            ldImage: it.image,
          };
          break;
        }
      }
    } catch {
      // ignore parse errors
    }
    if ((productInfo as { title?: string }).title) break;
  }

  // Fallback DOM hints
  productInfo.title ??= doc.querySelector("h1")?.textContent?.trim()
    || doc.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim();
  productInfo.vendor ??= doc.querySelector('[itemprop="brand"]')?.textContent?.trim()
    || doc.querySelector(".product-vendor, .vendor")?.textContent?.trim();

  // Image extraction priority: JSON-LD → og:image → product container imgs → all <img>
  const imageSet = new Set<string>();
  const pushAbs = (raw?: string | null) => {
    if (!raw) return;
    try {
      const abs = new URL(raw, baseUrl).toString();
      if (/sprite|favicon|logo|icon|placeholder|1x1|pixel|tracking/i.test(abs)) return;
      imageSet.add(abs);
    } catch { /* invalid url */ }
  };

  const ldImages = (productInfo as { ldImage?: unknown }).ldImage;
  if (ldImages) {
    const arr = Array.isArray(ldImages) ? ldImages : [ldImages];
    for (const im of arr) pushAbs(typeof im === "string" ? im : (im as { url?: string })?.url);
  }
  delete (productInfo as { ldImage?: unknown }).ldImage;

  pushAbs(doc.querySelector('meta[property="og:image"]')?.getAttribute("content"));

  const containerSelectors = [
    ".product-gallery img", ".product__media img", ".product-images img",
    "[data-product-images] img", "[itemtype*='Product'] img",
  ];
  for (const sel of containerSelectors) {
    doc.querySelectorAll(sel).forEach((img) => {
      const el = img as Element;
      pushAbs(el.getAttribute("src") || el.getAttribute("data-src") || el.getAttribute("data-srcset")?.split(" ")[0]);
    });
    if (imageSet.size >= 8) break;
  }

  if (imageSet.size === 0) {
    doc.querySelectorAll("img").forEach((img) => {
      const el = img as Element;
      pushAbs(el.getAttribute("src") || el.getAttribute("data-src"));
    });
  }

  // Last-ditch regex fallback (catches images embedded in JS)
  if (imageSet.size === 0) {
    const matches = html.match(/https?:\/\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^"'\s<>]*)?/gi);
    matches?.forEach(pushAbs);
  }

  return { productInfo, imageUrls: Array.from(imageSet).slice(0, 20) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const supabaseUser = createClient(SUPABASE_URL, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const action = body.action as string;

    // ── Action: extract_from_page ──────────────────────────────────
    if (action === "extract_from_page") {
      const { pageUrl } = body;
      if (!pageUrl) {
        return new Response(JSON.stringify({ error: "pageUrl required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        const resp = await fetchWithTimeout(pageUrl, FETCH_TIMEOUT_MS, {
          headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
        });
        if (!resp.ok) {
          return new Response(JSON.stringify({ error: `Fetch failed: ${resp.status}` }), {
            status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const html = await resp.text();
        const parsed = parseProductPage(html, pageUrl);
        return new Response(JSON.stringify({ ...parsed }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Fetch error" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Action: process_url ────────────────────────────────────────
    if (action === "process_url") {
      const { imageUrl, filename, options } = body as { imageUrl: string; filename: string; options?: ProcessOptions };
      if (!imageUrl || !filename) {
        return new Response(JSON.stringify({ error: "imageUrl and filename required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const resp = await fetchWithTimeout(imageUrl, FETCH_TIMEOUT_MS, {
        headers: { "User-Agent": UA },
      });
      if (!resp.ok) {
        return new Response(JSON.stringify({ error: `Image fetch failed: ${resp.status}` }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ct = resp.headers.get("content-type") || "image/jpeg";
      if (!ct.startsWith("image/")) {
        return new Response(JSON.stringify({ error: `Not an image: ${ct}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const inputBytes = new Uint8Array(await resp.arrayBuffer());
      if (inputBytes.byteLength > MAX_INPUT_BYTES) {
        return new Response(JSON.stringify({ error: `Image too large (${inputBytes.byteLength} bytes)` }), {
          status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const originalSize = inputBytes.byteLength;

      const { bytes: webp, width, height } = await compressToWebP(inputBytes, options);
      const publicUrl = await uploadToBucket(supabaseAdmin, user.id, filename, webp);

      return new Response(JSON.stringify({
        success: true,
        publicUrl,
        filename,
        originalSize,
        newSize: webp.byteLength,
        savingsPct: Math.round((1 - webp.byteLength / originalSize) * 100),
        width,
        height,
        contentType: "image/webp",
        originalContentType: ct,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Action: process_upload ─────────────────────────────────────
    if (action === "process_upload") {
      const { base64, contentType, filename, options, originalSize } = body as {
        base64: string; contentType?: string; filename: string; options?: ProcessOptions; originalSize?: number;
      };
      if (!base64 || !filename) {
        return new Response(JSON.stringify({ error: "base64 and filename required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const binaryStr = atob(base64);
      const inputBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) inputBytes[i] = binaryStr.charCodeAt(i);
      if (inputBytes.byteLength > MAX_INPUT_BYTES) {
        return new Response(JSON.stringify({ error: `Image too large (${inputBytes.byteLength} bytes)` }), {
          status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { bytes: webp, width, height } = await compressToWebP(inputBytes, options);
      const publicUrl = await uploadToBucket(supabaseAdmin, user.id, filename, webp);
      const origSize = originalSize ?? inputBytes.byteLength;

      return new Response(JSON.stringify({
        success: true,
        publicUrl,
        filename,
        originalSize: origSize,
        newSize: webp.byteLength,
        savingsPct: Math.round((1 - webp.byteLength / origSize) * 100),
        width,
        height,
        contentType: "image/webp",
        originalContentType: contentType || "unknown",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("image-seo-process error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
