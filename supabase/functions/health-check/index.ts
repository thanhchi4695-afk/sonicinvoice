import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  try {
    const binStr = atob(base64);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
    const decoder = new TextDecoder("utf-8");
    return decoder.decode(bytes);
  } catch {
    return "";
  }
}

function decodeKeyRef(key: string): { ref: string; error?: string } {
  try {
    const parts = key.split(".");
    if (parts.length !== 3) return { ref: "not_a_jwt", error: "wrong_part_count" };
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return { ref: payload?.ref ?? "no_ref_claim" };
  } catch (e) {
    return { ref: "invalid_jwt", error: e instanceof Error ? e.message : String(e) };
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
  const keyDecode = decodeKeyRef(SERVICE_ROLE);
  const keyRef = keyDecode.ref;
  const matched = urlRef === keyRef && urlRef !== "unknown" && !keyRef.startsWith("not_a") && !keyRef.startsWith("invalid") && !keyRef.startsWith("no_");

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
      key_decode_error: keyDecode.error ?? null,
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
