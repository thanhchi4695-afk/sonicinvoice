// User-facing endpoint: approve/reject an approval_queue item.
// POST /sonic-approval-decide/:approval_id  body: { decision, reason? }
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const Body = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(2000).nullish(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const approvalId = parts[parts.length - 1];
  if (!approvalId || approvalId === "sonic-approval-decide") {
    return json({ error: "approval_id required in URL" }, 400);
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
  const { decision, reason } = parsed.data;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Load approval and verify shop membership
  const { data: approval, error: loadErr } = await admin
    .from("sonic_approval_queue")
    .select("id, shop_id, status, run_id, expires_at")
    .eq("id", approvalId)
    .maybeSingle();
  if (loadErr) return json({ error: loadErr.message }, 500);
  if (!approval) return json({ error: "approval not found" }, 404);

  const { data: membership } = await admin
    .from("shop_users")
    .select("user_id")
    .eq("shop_id", approval.shop_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return json({ error: "Forbidden" }, 403);

  if (approval.status !== "pending") {
    return json({ error: `Already ${approval.status}` }, 409);
  }
  if (approval.expires_at && new Date(approval.expires_at) < new Date()) {
    return json({ error: "Expired" }, 410);
  }

  const newStatus = decision === "approve" ? "approved" : "rejected";
  const { error: updErr } = await admin
    .from("sonic_approval_queue")
    .update({
      status: newStatus,
      approved_at: new Date().toISOString(),
      approved_by: userId,
      rejection_reason: decision === "reject" ? reason ?? null : null,
    })
    .eq("id", approvalId);
  if (updErr) return json({ error: updErr.message }, 500);

  await admin.from("sonic_audit_log").insert({
    run_id: approval.run_id,
    shop_id: approval.shop_id,
    event_type: decision === "approve" ? "approval_granted" : "approval_rejected",
    actor: userId,
    payload: { approval_id: approvalId, reason: reason ?? null },
  });

  return json({ ok: true, status: newStatus });
});
