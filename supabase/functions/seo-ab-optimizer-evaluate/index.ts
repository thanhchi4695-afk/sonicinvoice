// seo-ab-optimizer-evaluate
// Daily: for each experiment group whose every variant window ended >=72h ago,
// compare variant CTR vs control. Mark winner; if auto_promote enabled and
// lift threshold met & ≤ manual_approval_lift, push winner's SEO to Shopify
// as the new default. Apply safety floor: kill mid-test variant <50% control.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidShopifyToken } from "../_shared/shopify-token.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = Date.now();
  const buffer = 3 * 86400_000; // 72h GSC delay buffer

  // Pull groups with experiments
  const { data: groups } = await admin
    .from("seo_ab_experiments")
    .select("parent_experiment_group, user_id")
    .not("parent_experiment_group", "is", null)
    .neq("status", "completed");

  const uniq = new Map<string, string>();
  for (const g of groups ?? []) uniq.set(String(g.parent_experiment_group), String(g.user_id));

  const summary: any[] = [];
  for (const [groupId, userId] of uniq) {
    try {
      const r = await evaluateGroup(admin, groupId, userId, now, buffer);
      summary.push({ groupId, ...r });
    } catch (e) {
      summary.push({ groupId, error: String(e) });
    }
  }

  await admin.from("seo_ab_experiment_log").insert({
    phase: "evaluate",
    run_started_at: new Date().toISOString(),
    run_completed_at: new Date().toISOString(),
    experiments_ran: summary.length,
    winners_promoted: summary.filter((s: any) => s.promoted).length,
    details: summary,
  });

  return new Response(JSON.stringify({ ok: true, summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

async function evaluateGroup(
  admin: ReturnType<typeof createClient>,
  groupId: string, userId: string, now: number, buffer: number,
) {
  const { data: exps } = await admin
    .from("seo_ab_experiments")
    .select("*")
    .eq("parent_experiment_group", groupId);

  if (!exps || exps.length < 2) return { skipped: "not_enough_variants" };

  // All variant windows must be ended + buffer
  const allDone = exps.every((e: any) => {
    if (!e.end_date) return false;
    return new Date(e.end_date).getTime() + 86400_000 + buffer < now;
  });
  if (!allDone) return { skipped: "windows_still_running_or_within_72h" };

  const { data: settings } = await admin.from("seo_ab_settings").select("*").eq("user_id", userId).single();
  const minImpr = settings?.min_impressions ?? 100;
  const minLift = settings?.min_ctr_lift ?? 0.10;
  const manualLift = settings?.manual_approval_lift ?? 0.25;
  const autoPromote = settings?.auto_promote ?? true;

  const control = exps.find((e: any) => e.is_control) ?? exps[0];
  const variants = exps.filter((e: any) => e.id !== control.id);

  // Safety floor — kill variants <50% control CTR (in case we re-eval mid run)
  for (const v of variants) {
    if (control.ctr > 0 && v.impressions >= minImpr && v.ctr < control.ctr * 0.5) {
      await admin.from("seo_ab_experiments").update({ status: "killed_low_ctr" }).eq("id", v.id);
    }
  }

  // Require minImpr per arm for valid comparison
  if (control.impressions < minImpr || variants.every((v: any) => v.impressions < minImpr)) {
    await admin.from("seo_ab_experiments").update({ status: "completed_no_data" })
      .in("id", exps.map((e: any) => e.id));
    return { skipped: "insufficient_impressions" };
  }

  // Pick best variant by CTR
  let winner = control;
  for (const v of variants) {
    if (v.impressions >= minImpr && v.ctr > winner.ctr) winner = v;
  }
  const liftPct = control.ctr > 0 ? (winner.ctr - control.ctr) / control.ctr : 0;

  await admin.from("seo_ab_experiments")
    .update({ is_winner: true, status: "winner" }).eq("id", winner.id);
  for (const e of exps.filter((x: any) => x.id !== winner.id)) {
    await admin.from("seo_ab_experiments").update({ status: "completed" }).eq("id", e.id);
  }

  let promoted = false;
  if (winner.id !== control.id && liftPct >= minLift && liftPct < manualLift && autoPromote) {
    try {
      const { accessToken, storeUrl, apiVersion } = await getValidShopifyToken(admin as any, userId);
      const gid = winner.collection_id.startsWith("gid://")
        ? winner.collection_id : `gid://shopify/Collection/${winner.collection_id}`;
      const m = `mutation($input:CollectionInput!){ collectionUpdate(input:$input){ userErrors{ field message } } }`;
      const res = await fetch(`https://${storeUrl}/admin/api/${apiVersion}/graphql.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: m,
          variables: { input: { id: gid, seo: { title: winner.seo_title, description: winner.meta_description } } },
        }),
      });
      const j = await res.json();
      const errs = j.data?.collectionUpdate?.userErrors;
      if (errs && errs.length) throw new Error(JSON.stringify(errs));
      promoted = true;
      await admin.from("seo_ab_experiments")
        .update({ status: "promoted" }).eq("id", winner.id);
    } catch (e) {
      return { winner: winner.variant_id, lift: liftPct, promoted: false, promote_error: String(e) };
    }
  }

  return {
    winner: winner.variant_id,
    lift: liftPct,
    promoted,
    needs_manual_approval: liftPct >= manualLift,
    control_ctr: control.ctr,
    winner_ctr: winner.ctr,
  };
}
