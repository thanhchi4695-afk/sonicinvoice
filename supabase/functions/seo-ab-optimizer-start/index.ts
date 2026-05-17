// seo-ab-optimizer-start
// Picks eligible collections, generates 2 SEO variants via Lovable AI Gateway,
// and creates an experiment group with a control + 2 variants. Schedules
// week 1 = control, week 2 = variant_a, week 3 = variant_b deployments.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const onlyUserId = url.searchParams.get("user_id"); // optional scope

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const logId = await startLog(admin, onlyUserId);
  const summary: Record<string, unknown>[] = [];

  try {
    // Find users with enabled settings (or single user)
    let usersQ = admin.from("seo_ab_settings").select("*").eq("enabled", true);
    if (onlyUserId) usersQ = admin.from("seo_ab_settings").select("*").eq("user_id", onlyUserId);
    const { data: settingsRows, error: sErr } = await usersQ;
    if (sErr) throw sErr;

    for (const s of settingsRows ?? []) {
      try {
        const out = await processUser(admin, s);
        summary.push({ user_id: s.user_id, ...out });
      } catch (e) {
        summary.push({ user_id: s.user_id, error: String(e) });
      }
    }

    await admin.from("seo_ab_experiment_log").update({
      run_completed_at: new Date().toISOString(),
      experiments_ran: summary.reduce((a, b: any) => a + (b.created ?? 0), 0),
      details: summary,
    }).eq("id", logId);

    return json({ ok: true, summary });
  } catch (e) {
    await admin.from("seo_ab_experiment_log").update({
      run_completed_at: new Date().toISOString(),
      error_message: String(e),
      details: summary,
    }).eq("id", logId);
    return json({ ok: false, error: String(e) }, 500);
  }
});

async function startLog(admin: ReturnType<typeof createClient>, user_id: string | null) {
  const { data } = await admin.from("seo_ab_experiment_log").insert({
    user_id, phase: "start", run_started_at: new Date().toISOString(),
  }).select("id").single();
  return data!.id as string;
}

async function processUser(admin: ReturnType<typeof createClient>, s: any) {
  const userId = s.user_id as string;
  const maxConcurrent = s.max_concurrent ?? 3;
  const testWindowDays = s.test_window_days ?? 7;
  const excluded: string[] = s.excluded_collections ?? [];

  // Count active concurrent tests
  const { count: activeCount } = await admin
    .from("seo_ab_schedule")
    .select("parent_experiment_group", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["pending", "active"]);

  const slots = Math.max(0, maxConcurrent - (activeCount ?? 0));
  if (slots === 0) return { created: 0, reason: "max_concurrent_reached" };

  // Eligible collections: have suggestion w/ approved status, not recently tested
  const since60 = new Date(Date.now() - 60 * 86400_000).toISOString();
  const { data: recentlyTested } = await admin
    .from("seo_ab_experiments")
    .select("collection_id")
    .eq("user_id", userId)
    .gt("created_at", since60);
  const recentSet = new Set((recentlyTested ?? []).map((r: any) => r.collection_id));

  const { data: candidates } = await admin
    .from("collection_suggestions")
    .select("id, shopify_collection_id, collection_handle, suggested_title, seo_description, status")
    .eq("user_id", userId)
    .eq("status", "approved")
    .order("updated_at", { ascending: false })
    .limit(50);

  const eligible = (candidates ?? []).filter((c: any) =>
    c.shopify_collection_id &&
    !recentSet.has(String(c.shopify_collection_id)) &&
    !excluded.includes(String(c.shopify_collection_id))
  ).slice(0, slots);

  let created = 0;
  for (const c of eligible) {
    try {
      await createExperimentForCollection(admin, userId, s, c, testWindowDays);
      created++;
    } catch (e) {
      console.error("createExperiment failed", String(e));
    }
  }
  return { created, examined: candidates?.length ?? 0, eligible: eligible.length };
}

async function createExperimentForCollection(
  admin: ReturnType<typeof createClient>,
  userId: string,
  settings: any,
  c: any,
  testWindowDays: number,
) {
  const groupId = crypto.randomUUID();
  const collectionId = String(c.shopify_collection_id);
  const handle = c.collection_handle ?? "";
  const siteUrl = settings.gsc_site_url ?? "";
  const collectionUrl = handle && siteUrl ? `${siteUrl.replace(/\/$/, "")}/collections/${handle}` : null;

  // Control = current SEO
  const control = {
    seo_title: c.suggested_title ?? "",
    meta_description: c.seo_description ?? "",
    h1_tag: c.suggested_title ?? "",
  };

  // Generate variants via Lovable AI Gateway
  const variants = await generateVariants(control, c);

  const today = new Date();
  const day = (offset: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  // Insert control + each variant; schedule sequential windows
  const insertRows = [
    { variant: "control", data: control, is_control: true, offset: 0 },
    ...variants.map((v, i) => ({
      variant: `variant_${String.fromCharCode(97 + i)}`,
      data: v,
      is_control: false,
      offset: testWindowDays * (i + 1),
    })),
  ];

  for (const r of insertRows) {
    const start = day(r.offset);
    const end = day(r.offset + testWindowDays - 1);
    const { data: exp, error: eErr } = await admin.from("seo_ab_experiments").insert({
      user_id: userId,
      collection_id: collectionId,
      collection_handle: handle,
      collection_title: c.suggested_title ?? handle,
      collection_url: collectionUrl,
      variant_id: r.variant,
      is_control: r.is_control,
      seo_title: r.data.seo_title,
      meta_description: r.data.meta_description,
      h1_tag: r.data.h1_tag,
      start_date: start,
      end_date: end,
      status: "scheduled",
      parent_experiment_group: groupId,
    }).select("id").single();
    if (eErr) throw eErr;

    await admin.from("seo_ab_schedule").insert({
      user_id: userId,
      experiment_id: exp!.id,
      parent_experiment_group: groupId,
      collection_id: collectionId,
      collection_handle: handle,
      variant_id: r.variant,
      scheduled_start_date: start,
      scheduled_end_date: end,
      status: "pending",
    });
  }
}

async function generateVariants(control: any, c: any) {
  const prompt = `You are an SEO expert for e-commerce. Generate exactly 2 variations of the SEO metadata below. Each variation must change keyword order, CTA phrasing, or emotional trigger.

Current SEO:
- Title: ${control.seo_title}
- Meta: ${control.meta_description}
- H1: ${control.h1_tag}
Collection: ${c.suggested_title ?? c.collection_handle}

Constraints: title ≤60 chars, meta ≤160 chars, h1 contains primary keyword.
Return JSON: {"variants":[{"seo_title":"...","meta_description":"...","h1_tag":"..."},{...}]}`;

  const tryModel = async (model: string) => {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`${model} ${res.status}`);
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content);
  };

  let parsed: any;
  try { parsed = await tryModel("google/gemini-2.5-pro"); }
  catch { parsed = await tryModel("google/gemini-2.5-flash"); }

  const variants = (parsed.variants ?? []).slice(0, 2).map((v: any) => ({
    seo_title: String(v.seo_title ?? "").slice(0, 60),
    meta_description: String(v.meta_description ?? "").slice(0, 160),
    h1_tag: String(v.h1_tag ?? "").slice(0, 100),
  }));
  if (variants.length < 1) throw new Error("AI returned no usable variants");
  return variants;
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
