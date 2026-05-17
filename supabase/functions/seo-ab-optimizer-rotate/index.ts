// seo-ab-optimizer-rotate
// Daily: activates schedules whose window opens today; closes ones whose
// window ended. On activation, snapshots current Shopify collection SEO into
// the schedule row, then pushes the variant's SEO to Shopify.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidShopifyToken } from "../_shared/shopify-token.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const today = new Date().toISOString().slice(0, 10);
  const results: any[] = [];

  // Close completed
  const { data: toClose } = await admin
    .from("seo_ab_schedule")
    .select("*")
    .eq("status", "active")
    .lt("scheduled_end_date", today);
  for (const s of toClose ?? []) {
    await admin.from("seo_ab_schedule").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", s.id);
    await admin.from("seo_ab_experiments").update({ status: "measuring" }).eq("id", s.experiment_id);
  }

  // Activate pending whose window starts today (or earlier)
  const { data: toActivate } = await admin
    .from("seo_ab_schedule")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_start_date", today);

  for (const s of toActivate ?? []) {
    try {
      const exp = await admin.from("seo_ab_experiments").select("*").eq("id", s.experiment_id).single();
      const e = exp.data!;
      const { accessToken, storeUrl, apiVersion } = await getValidShopifyToken(admin as any, s.user_id);

      // Read current Shopify collection SEO (snapshot for rollback)
      const cur = await shopifyGetCollection(storeUrl, apiVersion, accessToken, s.collection_id);
      // Write the variant
      await shopifyUpdateCollection(storeUrl, apiVersion, accessToken, s.collection_id, {
        seo_title: e.seo_title,
        meta_description: e.meta_description,
      });

      await admin.from("seo_ab_schedule").update({
        status: "active",
        activated_at: new Date().toISOString(),
        previous_seo_title: cur?.seo?.title ?? null,
        previous_meta_description: cur?.seo?.description ?? null,
        previous_h1_tag: cur?.title ?? null,
      }).eq("id", s.id);
      await admin.from("seo_ab_experiments").update({ status: "active" }).eq("id", s.experiment_id);
      results.push({ schedule_id: s.id, activated: true });
    } catch (err) {
      results.push({ schedule_id: s.id, error: String(err) });
    }
  }

  return new Response(JSON.stringify({ ok: true, closed: toClose?.length ?? 0, activated: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

async function shopifyGetCollection(store: string, ver: string, token: string, id: string) {
  const q = `query($id:ID!){ collection(id:$id){ id title seo{ title description } } }`;
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Collection/${id}`;
  const res = await fetch(`https://${store}/admin/api/${ver}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, variables: { id: gid } }),
  });
  const j = await res.json();
  return j.data?.collection;
}

async function shopifyUpdateCollection(store: string, ver: string, token: string, id: string, data: { seo_title: string; meta_description: string }) {
  const m = `mutation($input:CollectionInput!){ collectionUpdate(input:$input){ userErrors{ field message } } }`;
  const gid = id.startsWith("gid://") ? id : `gid://shopify/Collection/${id}`;
  const input = { id: gid, seo: { title: data.seo_title, description: data.meta_description } };
  const res = await fetch(`https://${store}/admin/api/${ver}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query: m, variables: { input } }),
  });
  const j = await res.json();
  const errs = j.data?.collectionUpdate?.userErrors;
  if (errs && errs.length) throw new Error(`shopify: ${JSON.stringify(errs)}`);
}
