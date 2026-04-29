// image-seo-shopify-push — Replaces a product's image on Shopify with the optimized WebP
// and sets the new alt text. Sequential processing with 500ms delay per project rule.
//
// POST {
//   productId: "gid://shopify/Product/123",
//   replacements: [
//     { oldMediaId: "gid://shopify/MediaImage/...", newImageUrl: "https://...", altText: "...", filename: "..." }
//   ]
// }
//
// Strategy: productCreateMedia(productId, mediaSrc) → wait briefly → productDeleteMedia(oldMediaId).
// Alt text is set on the new MediaImage during create via `alt`.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidShopifyToken, ShopifyReauthRequiredError } from "../_shared/shopify-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SHOPIFY_DELAY_MS = 500;

const CREATE_MEDIA = `
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { ... on MediaImage { id alt image { url width height } } }
      mediaUserErrors { field message code }
    }
  }
`;

const DELETE_MEDIA = `
  mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors { field message code }
    }
  }
`;

const UPDATE_MEDIA_ALT = `
  mutation productUpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
    productUpdateMedia(productId: $productId, media: $media) {
      media { ... on MediaImage { id alt } }
      mediaUserErrors { field message code }
    }
  }
`;

interface ShopifyCreds { token: string; storeUrl: string; apiVersion: string }

async function shopifyGraphQL<T = unknown>(creds: ShopifyCreds, query: string, variables: Record<string, unknown>): Promise<T> {
  const resp = await fetch(`https://${creds.storeUrl}/admin/api/${creds.apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": creds.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await resp.json();
  if (!resp.ok || json.errors) {
    throw new Error(`Shopify GraphQL ${resp.status}: ${JSON.stringify(json.errors || json).slice(0, 400)}`);
  }
  return json.data as T;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
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

    let creds: ShopifyCreds;
    try {
      const r = await getValidShopifyToken(supabaseAdmin, user.id);
      creds = { token: r.accessToken, storeUrl: r.storeUrl, apiVersion: r.apiVersion || "2025-01" };
    } catch (err) {
      if (err instanceof ShopifyReauthRequiredError) {
        return new Response(JSON.stringify({ error: "Shopify reconnect required", needs_reauth: true }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw err;
    }

    const body = await req.json();
    const action = body.action as string;

    // ── Update alt text only (no image replacement) ───────────────
    if (action === "update_alt_only") {
      const { productId, mediaId, altText } = body as { productId: string; mediaId: string; altText: string };
      if (!productId || !mediaId) {
        return new Response(JSON.stringify({ error: "productId and mediaId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await shopifyGraphQL<{ productUpdateMedia: { mediaUserErrors: { message: string }[] } }>(
        creds,
        UPDATE_MEDIA_ALT,
        { productId, media: [{ id: mediaId, alt: altText }] },
      );
      const errs = data.productUpdateMedia?.mediaUserErrors || [];
      if (errs.length) {
        return new Response(JSON.stringify({ error: errs.map((e) => e.message).join("; ") }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Replace image (create new media + delete old) ─────────────
    if (action === "replace_image") {
      const { productId, replacements } = body as {
        productId: string;
        replacements: Array<{ oldMediaId?: string; newImageUrl: string; altText: string; filename?: string }>;
      };
      if (!productId || !Array.isArray(replacements) || replacements.length === 0) {
        return new Response(JSON.stringify({ error: "productId and replacements[] required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const results: Array<{ ok: boolean; oldMediaId?: string; newMediaId?: string; error?: string; filename?: string }> = [];

      for (const r of replacements) {
        try {
          // 1. Create new media (Shopify will fetch the WebP from our public bucket)
          const created = await shopifyGraphQL<{
            productCreateMedia: {
              media: Array<{ id: string; alt: string }>;
              mediaUserErrors: { message: string; field?: string[] }[];
            };
          }>(creds, CREATE_MEDIA, {
            productId,
            media: [{ originalSource: r.newImageUrl, mediaContentType: "IMAGE", alt: r.altText }],
          });

          const cErrs = created.productCreateMedia?.mediaUserErrors || [];
          if (cErrs.length) throw new Error(cErrs.map((e) => e.message).join("; "));
          const newMediaId = created.productCreateMedia?.media?.[0]?.id;
          if (!newMediaId) throw new Error("No media id returned by Shopify");

          // 2. Delete old media (best-effort)
          if (r.oldMediaId) {
            await sleep(SHOPIFY_DELAY_MS);
            try {
              await shopifyGraphQL(creds, DELETE_MEDIA, { productId, mediaIds: [r.oldMediaId] });
            } catch (delErr) {
              console.warn("Delete old media failed (non-fatal):", delErr);
            }
          }

          results.push({ ok: true, oldMediaId: r.oldMediaId, newMediaId, filename: r.filename });
        } catch (e) {
          results.push({ ok: false, oldMediaId: r.oldMediaId, error: e instanceof Error ? e.message : "Unknown error", filename: r.filename });
        }
        await sleep(SHOPIFY_DELAY_MS);
      }

      const successes = results.filter((r) => r.ok).length;
      return new Response(JSON.stringify({
        success: successes === results.length,
        partialSuccess: successes > 0 && successes < results.length,
        successes,
        failures: results.length - successes,
        results,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("image-seo-shopify-push error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
