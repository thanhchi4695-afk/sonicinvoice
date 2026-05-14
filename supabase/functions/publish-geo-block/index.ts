// publish-geo-block
// Approves and/or publishes a collection_geo_block. On publish, splices the
// GEO HTML into the Shopify collection body_html inside <!-- GEO --> markers
// (replaces existing block on re-publish, never duplicates).

import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidShopifyToken } from "../_shared/shopify-token.ts";
import { renderGeoHtml, spliceGeoIntoBody, stripGeoFromBody } from "../_shared/geo-blocks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  geo_block_id: string;
  action: "approve" | "publish" | "unpublish";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing auth" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json() as Body;
    if (!body?.geo_block_id || !body?.action) return json({ error: "geo_block_id and action required" }, 400);

    const { data: block, error } = await admin
      .from("collection_geo_blocks")
      .select("*")
      .eq("id", body.geo_block_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !block) return json({ error: "GEO block not found" }, 404);

    if (body.action === "approve") {
      await admin.from("collection_geo_blocks").update({ status: "approved" }).eq("id", block.id);
      return json({ ok: true, status: "approved" });
    }

    if (body.action === "unpublish") {
      // Strip GEO from Shopify body_html, mark draft
      const { data: sug } = await admin
        .from("collection_suggestions")
        .select("shopify_collection_id")
        .eq("id", block.collection_suggestion_id)
        .maybeSingle();
      if (sug?.shopify_collection_id) {
        try {
          const { accessToken, storeUrl, apiVersion } = await getValidShopifyToken(admin, user.id);
          const cid = String(sug.shopify_collection_id).replace(/\D/g, "");
          const getR = await fetch(`https://${storeUrl}/admin/api/${apiVersion}/collections/${cid}.json`, {
            headers: { "X-Shopify-Access-Token": accessToken },
          });
          if (getR.ok) {
            const { collection } = await getR.json();
            const newBody = stripGeoFromBody(collection?.body_html ?? "");
            await fetch(`https://${storeUrl}/admin/api/${apiVersion}/collections/${cid}.json`, {
              method: "PUT",
              headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
              body: JSON.stringify({ collection: { id: Number(cid), body_html: newBody } }),
            });
          }
        } catch (e) {
          console.warn("unpublish GEO from Shopify failed", e);
        }
      }
      await admin.from("collection_geo_blocks").update({ status: "draft" }).eq("id", block.id);
      return json({ ok: true, status: "draft" });
    }

    // action === "publish"
    const { data: sug } = await admin
      .from("collection_suggestions")
      .select("shopify_collection_id, suggested_title")
      .eq("id", block.collection_suggestion_id)
      .maybeSingle();
    if (!sug?.shopify_collection_id) return json({ error: "Collection has no shopify_collection_id" }, 400);

    const geoHtml = renderGeoHtml({
      scenario_questions: (block.scenario_questions ?? []) as any,
      comparison_snippet: (block.comparison_snippet ?? null) as any,
      care_instructions: (block.care_instructions ?? null) as any,
      best_for_summary: block.best_for_summary ?? "",
      validation_errors: [],
    });

    let pushed = false;
    let pushReason: string | null = null;
    try {
      const { accessToken, storeUrl, apiVersion } = await getValidShopifyToken(admin, user.id);
      const cid = String(sug.shopify_collection_id).replace(/\D/g, "");
      const getR = await fetch(`https://${storeUrl}/admin/api/${apiVersion}/collections/${cid}.json`, {
        headers: { "X-Shopify-Access-Token": accessToken },
      });
      if (!getR.ok) throw new Error(`fetch collection ${getR.status}`);
      const { collection } = await getR.json();
      const newBody = spliceGeoIntoBody(collection?.body_html ?? "", geoHtml);
      const putR = await fetch(`https://${storeUrl}/admin/api/${apiVersion}/collections/${cid}.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
        body: JSON.stringify({ collection: { id: Number(cid), body_html: newBody } }),
      });
      if (!putR.ok) {
        const t = await putR.text();
        throw new Error(`put collection ${putR.status}: ${t.slice(0, 200)}`);
      }
      pushed = true;
    } catch (e) {
      pushReason = e instanceof Error ? e.message : String(e);
      return json({ error: `Shopify push failed: ${pushReason}` }, 502);
    }

    await admin.from("collection_geo_blocks").update({ status: "published" }).eq("id", block.id);
    return json({ ok: true, status: "published", pushed });
  } catch (e) {
    console.error("publish-geo-block error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
