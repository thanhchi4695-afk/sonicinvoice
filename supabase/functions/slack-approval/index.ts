// slack-approval — two routes:
//   POST /slack-approval         → post Block Kit message + persist approval token
//   POST /slack-approval/actions → Slack interactivity webhook (approve/deny)
//
// Auth model:
//   /          : called server-to-server from `margin-guardian` using SUPABASE_SERVICE_ROLE_KEY
//                in the X-Internal-Key header. JWT is disabled at the gateway.
//   /actions   : called by Slack. Verified via HMAC-SHA256 with SLACK_SIGNING_SECRET.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-key, x-slack-signature, x-slack-request-timestamp",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN") ?? "";
const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Slack signature verification (v0 scheme) ----
async function verifySlackSignature(req: Request, rawBody: string): Promise<boolean> {
  if (!SLACK_SIGNING_SECRET) return false;
  const sig = req.headers.get("x-slack-signature");
  const ts = req.headers.get("x-slack-request-timestamp");
  if (!sig || !ts) return false;
  // Reject if older than 5 min (replay protection)
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 60 * 5) return false;

  const baseString = `v0:${ts}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SLACK_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
  const expected =
    "v0=" +
    Array.from(new Uint8Array(sigBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  // Constant-time compare
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}

// ---- Slack API with retry/backoff ----
// Slack errors that are NOT worth retrying — they will never succeed without
// a config change (wrong channel, missing scope, bad token, etc.).
const NON_RETRYABLE_SLACK_ERRORS = new Set([
  "channel_not_found",
  "not_in_channel",
  "is_archived",
  "msg_too_long",
  "invalid_blocks",
  "invalid_blocks_format",
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "account_inactive",
  "no_permission",
  "missing_scope",
  "restricted_action",
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function slackApiCall(
  endpoint: "chat.postMessage" | "chat.update",
  payload: Record<string, unknown>,
  opts: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<{ ok: boolean; error?: string; retryable?: boolean; data?: any; attempts: number }> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 400;
  let lastErr: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(`https://slack.com/api/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(payload),
      });

      // 429 — honour Retry-After
      if (resp.status === 429) {
        const retryAfter = Number(resp.headers.get("retry-after") ?? "1");
        lastErr = "ratelimited";
        if (attempt < maxAttempts) {
          await sleep(Math.max(retryAfter, 1) * 1000);
          continue;
        }
        return { ok: false, error: "ratelimited", retryable: true, attempts: attempt };
      }

      // 5xx — backoff
      if (resp.status >= 500) {
        lastErr = `http_${resp.status}`;
        if (attempt < maxAttempts) {
          await sleep(baseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        return { ok: false, error: lastErr, retryable: true, attempts: attempt };
      }

      const data = await resp.json();
      if (data.ok) return { ok: true, data, attempts: attempt };

      // Application-level error
      lastErr = String(data.error ?? "unknown_error");
      if (NON_RETRYABLE_SLACK_ERRORS.has(lastErr)) {
        return { ok: false, error: lastErr, retryable: false, attempts: attempt };
      }
      // Slack-side rate limit hint
      if (lastErr === "ratelimited") {
        const retryAfter = Number(resp.headers.get("retry-after") ?? "1");
        if (attempt < maxAttempts) {
          await sleep(Math.max(retryAfter, 1) * 1000);
          continue;
        }
      }
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      return { ok: false, error: lastErr, retryable: true, attempts: attempt };
    } catch (err) {
      // Network error — retry
      lastErr = err instanceof Error ? err.message : String(err);
      console.error(`Slack ${endpoint} network error (attempt ${attempt}):`, lastErr);
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      return { ok: false, error: lastErr, retryable: true, attempts: attempt };
    }
  }

  return { ok: false, error: lastErr ?? "unknown", retryable: true, attempts: maxAttempts };
}

async function slackPostMessage(channel: string, blocks: unknown[], text: string) {
  return await slackApiCall("chat.postMessage", { channel, blocks, text });
}

async function slackUpdateMessage(channel: string, ts: string, blocks: unknown[], text: string) {
  // Best-effort with limited retries — UI update should not block decision finalisation.
  return await slackApiCall("chat.update", { channel, ts, blocks, text }, { maxAttempts: 2 });
}

// ---- Block Kit builders ----
interface PostRequest {
  decisionId: string;
  channel: string;
  ruleName: string;
  message: string;
  cartItems: { sku: string; quantity: number; unitListPrice?: number }[];
  surface?: string;
}

function buildBlocks(req: PostRequest, token: string) {
  const itemsPreview =
    req.cartItems.slice(0, 8).map((i) => `• ${i.sku} ×${i.quantity}`).join("\n") +
    (req.cartItems.length > 8 ? `\n• …and ${req.cartItems.length - 8} more` : "");
  return [
    { type: "header", text: { type: "plain_text", text: "🛑 Margin approval required" } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Rule:*\n${req.ruleName}` },
        { type: "mrkdwn", text: `*Surface:*\n${req.surface ?? "—"}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: `*Why:* ${req.message}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Items:*\n${itemsPreview}` } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Approve" },
          style: "primary",
          value: token,
          action_id: `approve_${token}`,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❌ Deny" },
          style: "danger",
          value: token,
          action_id: `deny_${token}`,
        },
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Decision \`${req.decisionId}\` · expires in 10 min` },
      ],
    },
  ];
}

// ---- Route handlers ----
async function handlePost(req: Request) {
  // Internal-only — must be called from another edge function or trusted backend.
  const internalKey = req.headers.get("x-internal-key");
  if (!internalKey || internalKey !== SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const body = (await req.json()) as PostRequest;
  if (!body?.decisionId || !body?.channel || !body?.ruleName) {
    return jsonResponse({ error: "Missing required fields" }, 400);
  }
  if (!SLACK_BOT_TOKEN) return jsonResponse({ error: "SLACK_BOT_TOKEN not configured" }, 500);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // Stamp the decision row with the approval token + expiry.
  const { error: updErr } = await supabase
    .from("margin_agent_decisions")
    .update({ approval_token: token, approval_expires_at: expiresAt })
    .eq("id", body.decisionId);
  if (updErr) return jsonResponse({ error: updErr.message }, 500);

  // Channel name with leading "#" or raw ID both work for chat.postMessage.
  const slackResp = await slackPostMessage(
    body.channel.startsWith("#") || body.channel.startsWith("C") || body.channel.startsWith("G")
      ? body.channel
      : `#${body.channel}`,
    buildBlocks(body, token),
    `Margin approval needed: ${body.ruleName}`,
  );
  if (!slackResp.ok) {
    return jsonResponse({ error: `Slack error: ${slackResp.error}` }, 502);
  }

  return jsonResponse({ success: true, ts: slackResp.ts, channel: slackResp.channel, token });
}

async function handleActions(req: Request) {
  const rawBody = await req.text();
  if (!(await verifySlackSignature(req, rawBody))) {
    return new Response("Invalid signature", { status: 401 });
  }

  // Slack sends application/x-www-form-urlencoded with payload=<json>
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) return new Response("Missing payload", { status: 400 });
  const payload = JSON.parse(payloadStr);
  const action = payload?.actions?.[0];
  if (!action?.action_id) return new Response("ok");

  // action_id format: approve_<token> | deny_<token>
  const [verb, token] = String(action.action_id).split("_", 2);
  if (!verb || !token) return new Response("ok");

  const userName = payload?.user?.name ?? payload?.user?.username ?? "someone";
  const channel = payload?.channel?.id;
  const ts = payload?.message?.ts;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Find the pending decision by token.
  const { data: decision, error: findErr } = await supabase
    .from("margin_agent_decisions")
    .select("id, decision_outcome, approval_expires_at")
    .eq("approval_token", token)
    .maybeSingle();
  if (findErr || !decision) {
    if (channel && ts) {
      await slackUpdateMessage(channel, ts, [], "⚠️ Approval not found.");
    }
    return new Response("ok");
  }

  // Expired or already finalised
  if (
    decision.decision_outcome !== "pending_approval" ||
    (decision.approval_expires_at && new Date(decision.approval_expires_at) < new Date())
  ) {
    if (channel && ts) {
      await slackUpdateMessage(channel, ts, [], "⏰ This approval already resolved or expired.");
    }
    if (
      decision.approval_expires_at &&
      new Date(decision.approval_expires_at) < new Date() &&
      decision.decision_outcome === "pending_approval"
    ) {
      await supabase
        .from("margin_agent_decisions")
        .update({ decision_outcome: "expired" })
        .eq("id", decision.id);
    }
    return new Response("ok");
  }

  const outcome = verb === "approve" ? "approved" : "denied";
  await supabase
    .from("margin_agent_decisions")
    .update({ decision_outcome: outcome })
    .eq("id", decision.id);

  if (channel && ts) {
    await slackUpdateMessage(
      channel,
      ts,
      [],
      outcome === "approved" ? `✅ Approved by @${userName}` : `❌ Denied by @${userName}`,
    );
  }

  return new Response("ok");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
  // Path may be /slack-approval, /slack-approval/, /slack-approval/actions
  const last = url.pathname.replace(/\/+$/, "").split("/").pop() ?? "";

  try {
    if (last === "actions") return await handleActions(req);
    return await handlePost(req);
  } catch (err) {
    console.error("slack-approval error", err);
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
