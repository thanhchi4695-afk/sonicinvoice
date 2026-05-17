// seo-ab-optimizer-run
// Admin-only manual trigger. Chains start -> rotate -> collect -> evaluate
// for the calling user only. Verifies caller has 'admin' role.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "missing auth" }, 401);

  const user = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const { data: { user: u } } = await user.auth.getUser();
  if (!u) return json({ error: "unauthenticated" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", u.id).maybeSingle();
  if (roleRow?.role !== "admin") return json({ error: "admin only" }, 403);

  const base = `${SUPABASE_URL}/functions/v1`;
  const call = async (path: string, qs = "") => {
    const r = await fetch(`${base}/${path}${qs}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  const out = {
    start: await call("seo-ab-optimizer-start", `?user_id=${u.id}`),
    rotate: await call("seo-ab-optimizer-rotate"),
    collect: await call("seo-ab-optimizer-collect"),
    evaluate: await call("seo-ab-optimizer-evaluate"),
  };
  return json({ ok: true, ...out });
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
