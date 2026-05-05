// Decompose products into Shopify collection topics (brand, brand-story,
// category, sub-category, modified, feature, cross-reference) using Lovable AI.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InProduct {
  title: string;
  vendor: string;
  product_type: string;
  tags: string;
  handle: string;
  product_id: string;
}

interface MethodPreferences {
  category?: "type" | "tag" | "tag_or_type";
  brand_category?: "vendor_tag" | "vendor_type" | "title_prefix";
  sub_category?: "title" | "tag";
}

interface ReqBody {
  products: InProduct[];
  store_name?: string;
  store_city?: string;
  existing_collection_handles?: string[];
  method_preferences?: MethodPreferences;
}

const SYSTEM = `You are a Shopify collection architect for an Australian swimwear retail store.
For each product, decompose it into every collection topic it belongs to across these levels:

LEVEL 1 — Brand: one per vendor. Handle = vendor slug.
LEVEL 2 — Brand Story: brand + STYLE NAME (1–2 words after brand, before any descriptor).
  Descriptor words to SKIP: Twist, Band, Mini, Micro, High, Low, Classic, Deluxe, Premium,
  Active, Essential, Basic, Side, Front, Back, Tie, Ring, Ruffle, Frill, Print, Stripe.
  Skip if style is a descriptor or a colour.
LEVEL 3 — Category: from product_type. Use AU swim category names exactly:
  One Pieces, Bikini Tops, Bikini Bottoms, Tankini Tops, Rashies & Sunsuits,
  Boardshorts, Kaftans & Cover Ups, Dresses, Tops, Pants.
LEVEL 4 — Sub-category (cut/silhouette) from title:
  Hipster, Brief, Bikini, Boyleg, Bandeau, Halter, Triangle, Crop Top, Longline,
  High Waist, Low Rise, One Shoulder, Multifit, Blouson, Singlet.
  Title example "{cut} {category}" e.g. "Hipster Bikini Bottoms".
LEVEL 5 — Modified sub-category: modifier + cut + category, e.g. "Mini Hipster Bikini Bottoms".
  Modifiers: Mini, Micro, High, Low, Classic, Ruched, Twist. Only emit if the
  modifier+cut combo appears across more than one product in the input batch.
LEVEL 6 — Feature collections from title keywords:
  chlorine resistant / Xtralife → "Chlorine Resistant Swimwear"
  underwire → "Underwire Swimwear"
  D/E or DD → "D Cup & Above Swimwear"
  plus size / 18+ → "Plus Size Swimwear"
  tummy control / powermesh → "Tummy Control Swimwear"
  UPF / sun protection → "UV Protection Swimwear"
  maternity → "Maternity Swimwear"
  kids → appropriate kids collection.

CROSS-REFERENCE: also emit "{Brand} {Category}" e.g. "Seafolly Bikini Bottoms".

Output: a SINGLE JSON object via the emit_collections tool. Group shared
collections so a collection appears once with all matching product_ids.
Use the existing_collection_handles array to set is_new=false when the handle is in it.
Brand casing must match the vendor field exactly. Generate seo_title (≤60 chars)
and meta_description (≤155 chars) per collection.`;

const TOOL = {
  type: "function" as const,
  function: {
    name: "emit_collections",
    description: "Return decomposed collections grouped across the input batch.",
    parameters: {
      type: "object",
      properties: {
        collections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              handle: { type: "string" },
              level: { type: "integer", enum: [1, 2, 3, 4, 5, 6] },
              level_label: {
                type: "string",
                enum: [
                  "brand",
                  "brand_story",
                  "category",
                  "sub_category",
                  "modified_sub_category",
                  "feature",
                  "cross_reference",
                ],
              },
              rule_column: {
                type: "string",
                enum: ["tag", "title", "vendor", "product_type"],
              },
              rule_relation: {
                type: "string",
                enum: ["equals", "contains", "starts_with"],
              },
              rule_condition: { type: "string" },
              is_new: { type: "boolean" },
              seo_title: { type: "string" },
              meta_description: { type: "string" },
              rationale: { type: "string" },
              product_ids: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: [
              "title",
              "handle",
              "level",
              "level_label",
              "rule_column",
              "rule_relation",
              "rule_condition",
              "is_new",
              "seo_title",
              "meta_description",
              "rationale",
              "product_ids",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["collections"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as ReqBody;
    if (!Array.isArray(body.products) || body.products.length === 0) {
      return new Response(JSON.stringify({ error: "products[] required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth (optional, used for memory lookup if no handles passed)
    let userId: string | null = null;
    const auth = req.headers.get("Authorization");
    if (auth?.startsWith("Bearer ")) {
      try {
        const sb = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: auth } } },
        );
        const { data } = await sb.auth.getUser();
        userId = data.user?.id ?? null;
      } catch { /* ignore */ }
    }

    let existingHandles = body.existing_collection_handles ?? [];
    if (existingHandles.length === 0 && userId) {
      try {
        const admin = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data } = await admin
          .from("collection_memory")
          .select("collection_handle")
          .eq("user_id", userId)
          .limit(1000);
        existingHandles = ((data ?? []) as { collection_handle: string }[])
          .map((r) => r.collection_handle);
      } catch { /* ignore */ }
    }

    const userPrompt = `Store: ${body.store_name ?? "Splash Swimwear"} (${body.store_city ?? "Darwin"})
Existing collection handles (mark is_new=false for these): ${JSON.stringify(existingHandles)}

Products (${body.products.length}):
${JSON.stringify(body.products, null, 2)}

Decompose all products and return collections via the emit_collections tool.`;

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "emit_collections" } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      const status = aiResp.status === 429 || aiResp.status === 402 ? aiResp.status : 500;
      const message = aiResp.status === 429
        ? "Rate limit exceeded, please try again shortly."
        : aiResp.status === 402
          ? "AI credits exhausted. Add credits in Settings → Workspace → Usage."
          : `AI gateway error: ${t}`;
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const call = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    let collections: any[] = [];
    try {
      const args = call?.function?.arguments;
      const parsed = typeof args === "string" ? JSON.parse(args) : args;
      collections = Array.isArray(parsed?.collections) ? parsed.collections : [];
    } catch (e) {
      console.error("Failed to parse tool args", e);
    }

    // Defensive normalisation
    const handleSet = new Set(existingHandles.map((h) => h.toLowerCase()));
    collections = collections.map((c) => ({
      ...c,
      handle: String(c.handle || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      is_new: !handleSet.has(String(c.handle || "").toLowerCase()),
      product_ids: Array.isArray(c.product_ids) ? c.product_ids : [],
    }));

    return new Response(JSON.stringify({ collections }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("decompose error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
