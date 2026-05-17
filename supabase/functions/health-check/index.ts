import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function extractUrlRef(url: string): string {
  try {
    const m = url.match(/https:\/\/([^.]+)\.supabase\.co/);
    return m?.[1] ?? "unknown";
  } catch {
    return "invalid_url";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const urlRef = extractUrlRef(SUPABASE_URL);

  let dbReachable = false;
  let dbError: string | null = null;
  let projectRefFromDb: string | null = null;

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // Hit the REST API root to validate both URL and key together
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
    });

    if (resp.ok) {
      dbReachable = true;
      // If the URL ref matches the actual project, we're aligned
      // We infer alignment from the fact that the key works for this URL
      projectRefFromDb = urlRef;
    } else {
      dbError = `REST API returned ${resp.status}`;
    }
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const aligned = dbReachable; // If the key works against this URL, they're aligned
  const status = aligned ? 200 : 503;

  return new Response(
    JSON.stringify({
      status: status === 200 ? "ok" : "degraded",
      supabase_url_ref: urlRef,
      key_aligned: aligned,
      db_reachable: dbReachable,
      db_error: dbError,
      env_loaded: {
        url: !!SUPABASE_URL,
        service_role: !!SERVICE_ROLE,
      },
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
