// Publish an approved collection_suggestion to Shopify as a draft smart collection.
// Optionally pushes its approved blog drafts to Shopify Blog as draft articles.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidShopifyToken } from "../_shared/shopify-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function rulesToArray(ruleSet: unknown): Array<{ column: string; relation: string; condition: string }> {
  if (Array.isArray(ruleSet)) return ruleSet as any;
  if (ruleSet && typeof ruleSet === "object" && Array.isArray((ruleSet as any).rules)) return (ruleSet as any).rules;
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { suggestion_id } = await req.json();
    if (!suggestion_id) return new Response(JSON.stringify({ error: "suggestion_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: s, error } = await admin.from("collection_suggestions").select("*").eq("id", suggestion_id).eq("user_id", userId).single();
    if (error || !s) throw new Error("suggestion not found");

    if (s.collection_type === "archive") {
      // Just mark approved — the merchant manually archives in Shopify.
      await admin.from("collection_suggestions").update({ status: "approved" }).eq("id", suggestion_id);
      return new Response(JSON.stringify({ success: true, archived_flag: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { accessToken, storeUrl, apiVersion } = await getValidShopifyToken(admin, userId);

    const rules = rulesToArray(s.rule_set);
    const disjunctive = (s.rule_set && typeof s.rule_set === "object" && (s.rule_set as any).applied_disjunctively) ?? false;

    const payload = {
      smart_collection: {
        title: s.suggested_title,
        handle: s.suggested_handle,
        body_html: s.description_html ?? "",
        published: false,
        disjunctive,
        rules,
      },
    };

    const res = await fetch(`https://${storeUrl}/admin/api/${apiVersion}/smart_collections.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = JSON.stringify(data);
      await admin.from("collection_suggestions").update({ status: "error", error_message: msg }).eq("id", suggestion_id);
      throw new Error(`Shopify create failed: ${msg}`);
    }

    const collectionId: number = data.smart_collection.id;

    // Set SEO via metafields (Shopify uses global.title_tag / global.description_tag)
    if (s.seo_title || s.seo_description) {
      const metafields: Array<Record<string, unknown>> = [];
      if (s.seo_title) metafields.push({ namespace: "global", key: "title_tag", type: "single_line_text_field", value: s.seo_title });
      if (s.seo_description) metafields.push({ namespace: "global", key: "description_tag", type: "multi_line_text_field", value: s.seo_description });
      for (const mf of metafields) {
        await fetch(`https://${storeUrl}/admin/api/${apiVersion}/collections/${collectionId}/metafields.json`, {
          method: "POST",
          headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
          body: JSON.stringify({ metafield: mf }),
        });
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    await admin.from("collection_suggestions").update({
      status: "published",
      shopify_collection_id: String(collectionId),
      error_message: null,
    }).eq("id", suggestion_id);

    return new Response(JSON.stringify({ success: true, shopify_collection_id: collectionId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("collection-publish error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
