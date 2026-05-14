// ══════════════════════════════════════════════════════════
// Sonic Invoices — MCP Server (day-1 MVP, user-scoped)
//
// Auth:  Authorization: Bearer <raw_token>
//        token_hash = SHA-256(raw_token), validated via
//        verify_sonic_mcp_token RPC (returns user_id +
//        Shopify connection info in one round-trip).
//
// Tools (read-only v1):
//   - get_store_context  → Shopify store + brand list
//   - get_collections    → Suggested collections + score
//   - get_gap_results    → Latest competitor-gap cards
//
// Every tool call is logged to mcp_tool_calls.
// Deploys with verify_jwt = false (Claude can't send a JWT).
// ══════════════════════════════════════════════════════════
import { Hono } from "npm:hono@4";
import { McpServer, StreamableHttpTransport } from "npm:mcp-lite@^0.10.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, mcp-session-id",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface AuthCtx {
  userId: string;
  tokenId: string | null;
  storeUrl: string | null;
  accessToken: string | null;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function resolveAuth(req: Request): Promise<AuthCtx | null> {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const hash = await sha256Hex(m[1].trim());
  const { data, error } = await admin.rpc("verify_sonic_mcp_token", {
    _token_hash: hash,
  });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.user_id) return null;
  // fire-and-forget last_used_at bump
  admin.rpc("touch_sonic_mcp_token", { _token_hash: hash }).then(() => {});
  return {
    userId: row.user_id as string,
    tokenId: (row.token_id as string) ?? null,
    storeUrl: (row.store_url as string) ?? null,
    accessToken: (row.access_token as string) ?? null,
  };
}

async function logCall(
  auth: AuthCtx,
  tool: string,
  args: unknown,
  startedAt: number,
  status: "success" | "error",
  errorMessage?: string,
) {
  try {
    await admin.from("mcp_tool_calls").insert({
      user_id: auth.userId,
      token_id: auth.tokenId,
      tool_name: tool,
      arguments: (args ?? {}) as Record<string, unknown>,
      status,
      duration_ms: Date.now() - startedAt,
      error_message: errorMessage ?? null,
    });
  } catch (_e) { /* best-effort */ }
}

function getAuth(ctx: any): AuthCtx | null {
  const extra = ctx?.authInfo?.extra as { auth?: AuthCtx } | undefined;
  return extra?.auth ?? null;
}

// Helper to wrap a handler body with auth check + logging.
function wrap<TArgs>(
  name: string,
  fn: (args: TArgs, auth: AuthCtx) => Promise<unknown>,
) {
  return async (args: TArgs, ctx: any) => {
    const auth = getAuth(ctx);
    if (!auth) {
      return { content: [{ type: "text", text: "Unauthorized" }] };
    }
    const t0 = Date.now();
    try {
      const result = await fn(args, auth);
      logCall(auth, name, args, t0, "success");
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      logCall(auth, name, args, t0, "error", msg);
      return { content: [{ type: "text", text: `Error: ${msg}` }] };
    }
  };
}

// ── MCP server + tools ──────────────────────────────────────
const mcp = new McpServer({
  name: "sonic-invoices",
  version: "0.1.0",
});

mcp.tool("get_store_context", {
  description:
    "Returns the connected Shopify store (URL, shop name, voice style, default product status) and a list of brands the user has products from.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  handler: wrap<Record<string, never>>("get_store_context", async (_args, auth) => {
    // Shopify connection (already in auth context, but re-fetch full row for richer fields)
    const { data: shop } = await admin
      .from("shopify_connections")
      .select("store_url, shop_name, brand_voice_style, product_status")
      .eq("user_id", auth.userId)
      .maybeSingle();

    // Brands this user has actually seen, derived from competitor_gaps (user-scoped).
    const { data: brandRows } = await admin
      .from("competitor_gaps")
      .select("brand")
      .eq("user_id", auth.userId)
      .not("brand", "is", null)
      .limit(500);
    const brands = Array.from(
      new Set((brandRows ?? []).map((r: any) => r.brand).filter(Boolean)),
    ).slice(0, 50);

    return {
      shopify: shop ?? null,
      brands,
    };
  }),
});

mcp.tool("get_collections", {
  description:
    "Lists Sonic-suggested Shopify collections for the user with SEO completeness score. Filter by status (pending|approved|published) or min completeness.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "approved", "published"] },
      min_completeness: { type: "number", minimum: 0, maximum: 100 },
      limit: { type: "number", minimum: 1, maximum: 100, default: 25 },
    },
    additionalProperties: false,
  },
  handler: wrap<{ status?: string; min_completeness?: number; limit?: number }>(
    "get_collections",
    async (args, auth) => {
      let q = admin
        .from("collection_suggestions")
        .select(
          "id, suggested_title, shopify_handle, status, product_count, completeness_score, completeness_breakdown, collection_type",
        )
        .eq("user_id", auth.userId)
        .order("completeness_score", { ascending: true })
        .limit(Math.min(Number(args?.limit) || 25, 100));

      if (args?.status) q = q.eq("status", args.status);
      if (typeof args?.min_completeness === "number") {
        q = q.gte("completeness_score", args.min_completeness);
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  ),
});

mcp.tool("get_gap_results", {
  description:
    "Returns the most recent competitor gap-analysis cards (collections / brands this store is missing vs competitors).",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", minimum: 1, maximum: 50, default: 10 },
      gap_type: { type: "string", description: "Filter by gap_type (e.g. collection, brand)" },
    },
    additionalProperties: false,
  },
  handler: wrap<{ limit?: number; gap_type?: string }>(
    "get_gap_results",
    async (args, auth) => {
      let q = admin
        .from("competitor_gaps")
        .select(
          "id, competitor_name, competitor_url, gap_type, brand, product_count_in_store, suggested_handle, suggested_title, suggested_description, expected_impact, status, created_at",
        )
        .eq("user_id", auth.userId)
        .order("created_at", { ascending: false })
        .limit(Math.min(Number(args?.limit) || 10, 50));

      if (args?.gap_type) q = q.eq("gap_type", args.gap_type);

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  ),
});

// ── HTTP transport ─────────────────────────────────────────
const transport = new StreamableHttpTransport();
const handleMcp = transport.bind(mcp);
const app = new Hono();

app.options("*", () => new Response("ok", { headers: corsHeaders }));

app.all("*", async (c) => {
  const auth = await resolveAuth(c.req.raw);
  if (!auth) {
    return new Response(
      JSON.stringify({ error: "Unauthorized — missing or invalid bearer token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const authHeader = c.req.raw.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const res = await handleMcp(c.req.raw, {
    authInfo: { token, scopes: [], extra: { auth } },
  });
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
});

Deno.serve(app.fetch);
