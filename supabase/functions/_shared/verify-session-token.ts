/**
 * Shared Shopify session token verification for edge functions.
 *
 * ═══ Where backend validation happens ═══
 * Every protected edge function imports this module and calls
 * verifyShopifySessionToken() to validate the Bearer token from
 * the Authorization header. Invalid tokens are rejected with 401.
 */

const SHOPIFY_API_KEY = Deno.env.get("SHOPIFY_API_KEY") || "";
const SHOPIFY_API_SECRET = Deno.env.get("SHOPIFY_API_SECRET") || "";

export interface SessionTokenPayload {
  iss: string;   // https://{shop}.myshopify.com/admin
  dest: string;  // https://{shop}.myshopify.com
  aud: string;   // API key (client ID)
  sub: string;   // Shopify user ID
  exp: number;
  iat: number;
  nbf: number;
  jti: string;
}

/**
 * Verify a Shopify session token (JWT signed with HS256 using API secret).
 * Returns the decoded payload on success, or null on failure.
 */
export async function verifyShopifySessionToken(
  token: string
): Promise<SessionTokenPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const encoder = new TextEncoder();

    // ═══ HMAC-SHA256 signature verification using SHOPIFY_API_SECRET ═══
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(SHOPIFY_API_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signatureInput = encoder.encode(`${parts[0]}.${parts[1]}`);
    const signature = Uint8Array.from(
      atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify("HMAC", key, signature, signatureInput);
    if (!valid) {
      console.warn("[session-token] Invalid HMAC signature");
      return null;
    }

    // Decode payload
    const payload: SessionTokenPayload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    );

    // Verify audience matches our API key
    if (payload.aud !== SHOPIFY_API_KEY) {
      console.warn("[session-token] Audience mismatch:", payload.aud, "!=", SHOPIFY_API_KEY);
      return null;
    }

    // Verify not expired (10s leeway)
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp + 10 < now) {
      console.warn("[session-token] Token expired");
      return null;
    }

    return payload;
  } catch (err) {
    console.error("[session-token] Verification error:", err);
    return null;
  }
}

/**
 * Extract shop domain from session token iss/dest field.
 */
export function extractShopDomain(issOrDest: string): string {
  try {
    return new URL(issOrDest).hostname;
  } catch {
    return issOrDest;
  }
}

/**
 * Middleware-style helper: extract and verify the Bearer token from a request.
 * Returns the payload and shop, or a 401 Response if invalid.
 */
export async function requireSessionToken(
  req: Request
): Promise<
  | { payload: SessionTokenPayload; shop: string }
  | { error: Response }
> {
  const authHeader = req.headers.get("Authorization") || "";

  // ═══ Backend validation: reject requests without valid session token ═══
  if (!authHeader.startsWith("Bearer ")) {
    return {
      error: new Response(
        JSON.stringify({ error: "Missing session token" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  const token = authHeader.replace("Bearer ", "");
  const payload = await verifyShopifySessionToken(token);

  if (!payload) {
    return {
      error: new Response(
        JSON.stringify({ error: "Invalid session token" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  const shop = extractShopDomain(payload.dest || payload.iss);
  return { payload, shop };
}
