import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Shopify recommended max dimensions
const MAX_WIDTH = 2048;
const MAX_HEIGHT = 2048;
const JPEG_QUALITY = 0.82;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    const { action, images, max_width, max_height, quality } = await req.json();
    const targetWidth = max_width || MAX_WIDTH;
    const targetHeight = max_height || MAX_HEIGHT;
    const targetQuality = quality || JPEG_QUALITY;

    if (action === "compress_batch") {
      if (!images || !Array.isArray(images) || images.length === 0) {
        return new Response(JSON.stringify({ error: "images array required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const results: {
        product_id: string;
        status: string;
        original_size?: number;
        compressed_size?: number;
        savings_pct?: number;
        compressed_url?: string;
        error?: string;
      }[] = [];

      for (const img of images.slice(0, 20)) {
        try {
          if (!img.image_url) {
            results.push({ product_id: img.product_id, status: "error", error: "No image URL" });
            continue;
          }

          // Fetch original image
          const imgResp = await fetch(img.image_url, {
            headers: { "User-Agent": "SonicInvoice/1.0" },
          });
          if (!imgResp.ok) {
            results.push({ product_id: img.product_id, status: "error", error: `Fetch failed: ${imgResp.status}` });
            continue;
          }

          const originalBytes = await imgResp.arrayBuffer();
          const originalSize = originalBytes.byteLength;
          const contentType = imgResp.headers.get("content-type") || "image/jpeg";

          // For images we can't process server-side in Deno without native libs,
          // we store size metadata and let the client do Canvas-based compression.
          // However, we CAN strip metadata and re-encode using OffscreenCanvas if available,
          // or just pass through with size analysis.

          // Store original to bucket for reference + size tracking
          const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
          const filename = `${user.id}/${img.product_id}.${ext}`;

          // Upload original to storage (preserves it for comparison)
          const { error: uploadErr } = await supabaseAdmin.storage
            .from("compressed-images")
            .upload(filename, new Uint8Array(originalBytes), {
              contentType,
              upsert: true,
            });

          if (uploadErr) {
            results.push({ product_id: img.product_id, status: "error", error: uploadErr.message });
            continue;
          }

          const { data: urlData } = supabaseAdmin.storage
            .from("compressed-images")
            .getPublicUrl(filename);

          results.push({
            product_id: img.product_id,
            status: "success",
            original_size: originalSize,
            compressed_size: originalSize, // Same for now — client does Canvas compression
            savings_pct: 0,
            compressed_url: urlData.publicUrl,
          });
        } catch (e) {
          results.push({
            product_id: img.product_id,
            status: "error",
            error: e instanceof Error ? e.message : "Unknown error",
          });
        }
      }

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "analyse_sizes") {
      // Fetch headers only to get file sizes without downloading
      if (!images || !Array.isArray(images)) {
        return new Response(JSON.stringify({ error: "images array required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const results: {
        product_id: string;
        original_size: number;
        content_type: string;
        needs_compression: boolean;
        reason?: string;
      }[] = [];

      for (const img of images.slice(0, 50)) {
        try {
          if (!img.image_url) {
            results.push({ product_id: img.product_id, original_size: 0, content_type: "unknown", needs_compression: false, reason: "No image" });
            continue;
          }

          const headResp = await fetch(img.image_url, { method: "HEAD", headers: { "User-Agent": "SonicInvoice/1.0" } });
          const size = parseInt(headResp.headers.get("content-length") || "0", 10);
          const ct = headResp.headers.get("content-type") || "unknown";

          // Flag images over 500KB or non-WebP as needing compression
          const needsCompression = size > 500_000 || (!ct.includes("webp") && size > 200_000);
          const reasons: string[] = [];
          if (size > 1_000_000) reasons.push("Over 1MB");
          else if (size > 500_000) reasons.push("Over 500KB");
          if (!ct.includes("webp") && size > 200_000) reasons.push("Not WebP format");
          if (ct.includes("png") && size > 300_000) reasons.push("Large PNG — convert to JPEG");

          results.push({
            product_id: img.product_id,
            original_size: size,
            content_type: ct,
            needs_compression: needsCompression,
            reason: reasons.join("; ") || undefined,
          });
        } catch {
          results.push({ product_id: img.product_id, original_size: 0, content_type: "unknown", needs_compression: false });
        }
      }

      const totalSize = results.reduce((s, r) => s + r.original_size, 0);
      const needsWork = results.filter(r => r.needs_compression).length;

      return new Response(JSON.stringify({ results, summary: { total_size: totalSize, needs_compression: needsWork, total_images: results.length } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Upload compressed image (from client-side Canvas compression)
    if (action === "upload_compressed") {
      const { product_id, base64, content_type, original_size } = await req.json();
      if (!product_id || !base64) {
        return new Response(JSON.stringify({ error: "product_id and base64 required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

      const ext = (content_type || "image/jpeg").includes("webp") ? "webp" : "jpg";
      const filename = `${user.id}/${product_id}-compressed.${ext}`;

      const { error: uploadErr } = await supabaseAdmin.storage
        .from("compressed-images")
        .upload(filename, bytes, { contentType: content_type || "image/jpeg", upsert: true });

      if (uploadErr) {
        return new Response(JSON.stringify({ error: uploadErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: urlData } = supabaseAdmin.storage
        .from("compressed-images")
        .getPublicUrl(filename);

      return new Response(JSON.stringify({
        compressed_url: urlData.publicUrl,
        compressed_size: bytes.byteLength,
        original_size: original_size || 0,
        savings_pct: original_size ? Math.round((1 - bytes.byteLength / original_size) * 100) : 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("image-compress error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
