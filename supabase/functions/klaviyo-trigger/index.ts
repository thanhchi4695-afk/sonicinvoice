// Klaviyo event trigger: posts events to Klaviyo's /api/events endpoint.
// Called server-to-server with service-role auth + user_id in body.
// Logs every attempt to public.klaviyo_event_log.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const KLAVIYO_API = "https://a.klaviyo.com/api/events/";
const KLAVIYO_REVISION = "2024-10-15";

interface TriggerBody {
  user_id: string;
  event_name: string; // e.g. "Sonic: Back In Stock", "Sonic: New Edit Live"
  profile: {
    email?: string;
    phone_number?: string;
    external_id?: string;
    first_name?: string;
    last_name?: string;
  };
  properties: Record<string, unknown>;
  unique_id?: string; // optional dedup key
  value?: number;
  value_currency?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const KLAVIYO_KEY = Deno.env.get("KLAVIYO_API_KEY");

  // Service-role auth only (internal callers).
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${SERVICE_KEY}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!KLAVIYO_KEY) {
    return new Response(JSON.stringify({ error: "KLAVIYO_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: TriggerBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body?.user_id || !body?.event_name || !body?.profile || !body?.properties) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const klaviyoPayload = {
    data: {
      type: "event",
      attributes: {
        properties: body.properties,
        ...(body.unique_id ? { unique_id: body.unique_id } : {}),
        ...(typeof body.value === "number" ? { value: body.value } : {}),
        ...(body.value_currency ? { value_currency: body.value_currency } : {}),
        metric: { data: { type: "metric", attributes: { name: body.event_name } } },
        profile: {
          data: {
            type: "profile",
            attributes: {
              ...(body.profile.email ? { email: body.profile.email } : {}),
              ...(body.profile.phone_number ? { phone_number: body.profile.phone_number } : {}),
              ...(body.profile.external_id ? { external_id: body.profile.external_id } : {}),
              ...(body.profile.first_name ? { first_name: body.profile.first_name } : {}),
              ...(body.profile.last_name ? { last_name: body.profile.last_name } : {}),
            },
          },
        },
      },
    },
  };

  let httpStatus = 0;
  let respText = "";
  let errMsg: string | null = null;

  try {
    const res = await fetch(KLAVIYO_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Revision: KLAVIYO_REVISION,
        Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
      },
      body: JSON.stringify(klaviyoPayload),
    });
    httpStatus = res.status;
    respText = await res.text().catch(() => "");
  } catch (e) {
    errMsg = String(e?.message ?? e);
  }

  const success = httpStatus >= 200 && httpStatus < 300;

  await admin.from("klaviyo_event_log").insert({
    user_id: body.user_id,
    event_name: body.event_name,
    profile_email: body.profile.email ?? null,
    payload: klaviyoPayload as unknown as Record<string, unknown>,
    status: success ? "sent" : "failed",
    http_status: httpStatus || null,
    response_body: respText?.slice(0, 4000) ?? null,
    error: errMsg,
  });

  return new Response(
    JSON.stringify({ ok: success, http_status: httpStatus, error: errMsg }),
    {
      status: success ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
