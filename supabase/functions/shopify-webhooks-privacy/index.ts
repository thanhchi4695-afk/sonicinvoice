/**
 * Shopify Mandatory Compliance Webhooks
 * Required for Shopify App Store approval.
 *
 * Handles all three compliance topics via X-Shopify-Topic header:
 *   - customers/data_request
 *   - customers/redact
 *   - shop/redact
 *
 * HMAC is verified using RAW BYTES (ArrayBuffer) before any text/JSON parsing.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SHOPIFY_API_SECRET = Deno.env.get("SHOPIFY_API_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function verifyShopifyHmac(
  rawBytes: Uint8Array,
  hmacHeader: string | null
): Promise<boolean> {
  if (!hmacHeader || !SHOPIFY_API_SECRET) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SHOPIFY_API_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const computedSignature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, rawBytes)
  );

  let expectedSignature: Uint8Array;
  try {
    const binary = atob(hmacHeader);
    expectedSignature = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      expectedSignature[index] = binary.charCodeAt(index);
    }
  } catch {
    return false;
  }

  if (computedSignature.byteLength !== expectedSignature.byteLength) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < computedSignature.byteLength; index += 1) {
    mismatch |= computedSignature[index] ^ expectedSignature[index];
  }

  return mismatch === 0;
}

async function handleCustomerDataRequest(
  shop: string,
  payload: Record<string, unknown>
) {
  const customer = payload.customer as Record<string, unknown> | undefined;
  console.log("customers/data_request received", {
    shop,
    customerId: customer?.id,
  });
  console.log("customers/data_request: No customer PII stored for shop", {
    shop,
  });
}

async function handleCustomerRedact(
  shop: string,
  payload: Record<string, unknown>
) {
  const customer = payload.customer as Record<string, unknown> | undefined;
  console.log("customers/redact received", {
    shop,
    customerId: customer?.id,
  });
  console.log("customers/redact: No customer PII stored for shop", { shop });
}

async function handleShopRedact(
  shop: string,
  _payload: Record<string, unknown>
) {
  console.log("shop/redact received", { shop });

  const supabase = getAdminClient();
  const tables = [
    { name: "shopify_connections", column: "store_url" },
    { name: "shopify_push_history", column: "store_url" },
    { name: "shopify_subscriptions", column: "shop" },
    { name: "shopify_login_tokens", column: "shop" },
    { name: "shopify_oauth_states", column: "shop" },
  ] as const;

  const results = await Promise.all(
    tables.map(async ({ name, column }) => {
      const { error } = await supabase.from(name).delete().eq(column, shop);
      return { table: name, error: error?.message ?? null };
    })
  );

  const errors = results.filter((result) => result.error);
  if (errors.length > 0) {
    console.error("shop/redact partial failures", { shop, errors });
    return;
  }

  console.log("shop/redact: All data purged for shop", { shop });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname.endsWith("/health")) {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const topic = req.headers.get("x-shopify-topic") || "";
  const shop = req.headers.get("x-shopify-shop-domain") || "";

  if (!SHOPIFY_API_SECRET) {
    console.error("SHOPIFY_API_SECRET is not set", {
      topic,
      shop,
      verified: false,
    });
    return new Response("Server misconfigured", { status: 500 });
  }

  const rawBytes = new Uint8Array(await req.arrayBuffer());
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  const verified = await verifyShopifyHmac(rawBytes, hmacHeader);

  console.log("Privacy webhook verification", { topic, shop, verified });

  if (!verified) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    const rawText = new TextDecoder().decode(rawBytes);
    payload = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    console.warn("Valid Shopify webhook received with non-JSON payload", {
      topic,
      shop,
      verified: true,
    });
  }

  try {
    switch (topic) {
      case "customers/data_request":
        await handleCustomerDataRequest(shop, payload);
        break;
      case "customers/redact":
        await handleCustomerRedact(shop, payload);
        break;
      case "shop/redact":
        await handleShopRedact(shop, payload);
        break;
      default:
        console.warn("Unhandled privacy webhook topic", {
          topic,
          shop,
          verified: true,
        });
        break;
    }
  } catch (error) {
    console.error("Privacy webhook processing failed", {
      topic,
      shop,
      verified: true,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});