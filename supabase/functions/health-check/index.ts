import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function base64UrlDecode(str: string): string {
  // Convert base64url to base64
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding
  while (base64.length % 4) base64 += "=";
  try {
    return atob(base64);
  } catch {
    return "";
  }
}

function decodeKeyRef(key: string): string {
  try {
    const payload = JSON.parse(base64UrlDecode(key.split(".")[1]));
    return payload?.ref ?? "unknown";
  } catch {
    return "invalid_jwt";
  }
}

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
  const keyRef = decodeKeyRef(SERVICE_ROLE);
  const matched = urlRef === keyRef && urlRef !== "unknown";

  let dbReachable = false;
  let dbError: string | null = null;
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });
    const { error } = await admin.from("shops").select("id").limit(1);
    dbReachable = !error;
    if (error) dbError = error.message;
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  const status = matched && dbReachable ? 200 : 503;

  return new Response(
    JSON.stringify({
      status: status === 200 ? "ok" : "degraded",
      supabase_url_ref: urlRef,
      key_ref: keyRef,
      matched,
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
