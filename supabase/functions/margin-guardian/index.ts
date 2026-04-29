// Margin Guardian — evaluate cart against active margin_rules and return a decision.
// Roadmap: Appendix E step 3. Endpoint: POST /functions/v1/margin-guardian
// Public for the Chrome extension; JWT verification disabled (validated in code).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sonic-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------- Types (mirror src/components/guardian/types.ts) ----------
type ConditionField =
  | "brand"
  | "vendor"
  | "sku"
  | "product_category"
  | "margin_pct"
  | "po_total"
  | "quantity"
  | "surface";

type Operator =
  | "is"
  | "is_not"
  | "contains"
  | "starts_with"
  | "in"
  | "not_in"
  | "is_below"
  | "is_above"
  | "is_between"
  | "equals";

interface RuleCondition {
  field: ConditionField;
  operator: Operator;
  value: unknown;
}

interface RuleAction {
  type:
    | "block_checkout"
    | "slack_approval"
    | "email_notify"
    | "price_correction"
    | "log_only";
  params?: Record<string, unknown>;
}

interface MarginRule {
  id: string;
  user_id: string;
  name: string;
  is_active: boolean;
  conditions: RuleCondition[];
  actions: RuleAction[];
  priority: number;
}

interface CartItem {
  sku: string;
  quantity: number;
  unitListPrice: number;
  brand?: string;
  vendor?: string;
  product_category?: string;
  // Optional client-supplied overrides (else looked up from variants)
  landedCost?: number;
  targetMargin?: number;
}

interface EvaluateRequest {
  cartItems: CartItem[];
  surface?: string;
  dryRun?: boolean;
}

// ---------- Helpers ----------
function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

function evalText(actual: string | undefined, op: Operator, value: unknown): boolean {
  const a = (actual ?? "").toString().toLowerCase();
  if (op === "in" || op === "not_in") {
    const list = Array.isArray(value)
      ? value.map((x) => String(x).toLowerCase())
      : String(value ?? "")
          .split(",")
          .map((x) => x.trim().toLowerCase());
    const hit = list.includes(a);
    return op === "in" ? hit : !hit;
  }
  const v = String(value ?? "").toLowerCase();
  switch (op) {
    case "is":
      return a === v;
    case "is_not":
      return a !== v;
    case "contains":
      return a.includes(v);
    case "starts_with":
      return a.startsWith(v);
    default:
      return false;
  }
}

function evalNumber(actual: number | null, op: Operator, value: unknown): boolean {
  if (actual === null) return false;
  if (op === "is_between") {
    if (!Array.isArray(value) || value.length !== 2) return false;
    const lo = num(value[0]);
    const hi = num(value[1]);
    return lo !== null && hi !== null && actual >= lo && actual <= hi;
  }
  const v = num(value);
  if (v === null) return false;
  switch (op) {
    case "is_below":
      return actual < v;
    case "is_above":
      return actual > v;
    case "equals":
      return actual === v;
    default:
      return false;
  }
}

interface EnrichedItem extends CartItem {
  marginPct: number | null;
  lineTotal: number;
}

function enrich(item: CartItem, costMap: Map<string, { cost: number; retail: number }>): EnrichedItem {
  const lookup = costMap.get(item.sku);
  const cost = item.landedCost ?? lookup?.cost ?? null;
  const price = item.unitListPrice;
  const marginPct =
    cost !== null && price > 0 ? ((price - cost) / price) * 100 : null;
  return {
    ...item,
    marginPct,
    lineTotal: (item.quantity ?? 0) * (price ?? 0),
  };
}

function evalCondition(
  c: RuleCondition,
  items: EnrichedItem[],
  poTotal: number,
  surface: string | undefined,
): { matched: boolean; matchingItems: EnrichedItem[] } {
  // Aggregate fields evaluate once.
  if (c.field === "po_total") {
    return { matched: evalNumber(poTotal, c.operator, c.value), matchingItems: items };
  }
  if (c.field === "surface") {
    return { matched: evalText(surface, c.operator, c.value), matchingItems: items };
  }
  // Per-item fields: ANY item satisfying the condition is a match.
  const matching = items.filter((it) => {
    switch (c.field) {
      case "brand":
        return evalText(it.brand, c.operator, c.value);
      case "vendor":
        return evalText(it.vendor, c.operator, c.value);
      case "sku":
        return evalText(it.sku, c.operator, c.value);
      case "product_category":
        return evalText(it.product_category, c.operator, c.value);
      case "margin_pct":
        return evalNumber(it.marginPct, c.operator, c.value);
      case "quantity":
        return evalNumber(it.quantity, c.operator, c.value);
      default:
        return false;
    }
  });
  return { matched: matching.length > 0, matchingItems: matching };
}

function buildMessage(rule: MarginRule, matching: EnrichedItem[]): string {
  if (matching.length === 0) return `Rule "${rule.name}" matched.`;
  const sample = matching[0];
  const margin = sample.marginPct !== null ? `${sample.marginPct.toFixed(1)}%` : "n/a";
  return `Rule "${rule.name}" matched ${matching.length} item(s). Example: ${sample.sku} (${sample.brand ?? "—"}) at margin ${margin}.`;
}

// ---------- Handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as EvaluateRequest;
    const { cartItems, surface, dryRun } = body ?? {};

    if (!Array.isArray(cartItems)) {
      return new Response(
        JSON.stringify({ error: "Missing cartItems" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // -- Resolve userId from credentials. Two supported flows: --
    //   1. Dashboard: Authorization: Bearer <supabase JWT>
    //   2. Chrome extension: X-Sonic-Token: <raw extension token>
    let userId: string | null = null;
    const extToken = req.headers.get("x-sonic-token");
    const authHeader = req.headers.get("authorization");

    if (extToken) {
      const hash = await sha256Hex(extToken);
      const { data: tokenUser } = await supabase.rpc("verify_extension_token", {
        _token_hash: hash,
      });
      if (tokenUser) {
        userId = tokenUser as string;
        // Best-effort touch of last_used_at; ignore failure.
        await supabase
          .from("margin_guardian_extension_tokens")
          .update({ last_used_at: new Date().toISOString() })
          .eq("token_hash", hash);
      }
    } else if (authHeader?.startsWith("Bearer ")) {
      const jwt = authHeader.slice(7);
      const { data, error } = await supabase.auth.getClaims(jwt);
      if (!error && data?.claims?.sub) userId = data.claims.sub;
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch active rules ordered by priority (lowest number = highest priority).
    const { data: rules, error: rulesErr } = await supabase
      .from("margin_rules")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("priority", { ascending: true });

    if (rulesErr) throw rulesErr;

    // Fetch cost data for SKUs lacking client-supplied landedCost.
    const skusNeedingLookup = cartItems
      .filter((i) => i.landedCost === undefined && i.sku)
      .map((i) => i.sku);

    const costMap = new Map<string, { cost: number; retail: number }>();
    if (skusNeedingLookup.length > 0) {
      const { data: variants } = await supabase
        .from("variants")
        .select("sku, cost, retail_price")
        .eq("user_id", userId)
        .in("sku", skusNeedingLookup);
      for (const v of variants ?? []) {
        if (v.sku) costMap.set(v.sku, { cost: Number(v.cost), retail: Number(v.retail_price) });
      }
    }

    const enriched = cartItems.map((it) => enrich(it, costMap));
    const poTotal = enriched.reduce((sum, it) => sum + it.lineTotal, 0);
    const missingCost = enriched.filter((it) => it.marginPct === null).map((it) => it.sku);

    // Walk rules in priority order; first full-match wins.
    let decision: {
      allowed: boolean;
      ruleId?: string;
      ruleName?: string;
      actions: RuleAction[];
      message: string;
      matchingItems?: EnrichedItem[];
    } = {
      allowed: true,
      actions: [],
      message: missingCost.length
        ? `No rule matched. Note: missing cost data for ${missingCost.join(", ")}.`
        : "No rule matched. Cart approved.",
    };

    for (const rule of (rules ?? []) as MarginRule[]) {
      if (!rule.conditions || rule.conditions.length === 0) continue;
      let allMatch = true;
      let lastMatchingItems: EnrichedItem[] = enriched;
      for (const c of rule.conditions) {
        const { matched, matchingItems } = evalCondition(c, enriched, poTotal, surface);
        if (!matched) {
          allMatch = false;
          break;
        }
        lastMatchingItems = matchingItems;
      }
      if (allMatch) {
        const blocks = rule.actions.some((a) => a.type === "block_checkout");
        decision = {
          allowed: !blocks,
          ruleId: rule.id,
          ruleName: rule.name,
          actions: rule.actions,
          message: buildMessage(rule, lastMatchingItems),
          matchingItems: lastMatchingItems,
        };
        break;
      }
    }

    // Log decision unless this is a dry-run from TestRuleDialog.
    if (!dryRun) {
      const requiresApproval = decision.actions.some((a) => a.type === "slack_approval");
      const outcome = requiresApproval
        ? "pending_approval"
        : decision.allowed
          ? "allowed"
          : "blocked";
      await supabase.from("margin_agent_decisions").insert({
        user_id: userId,
        rule_id: decision.ruleId ?? null,
        decision_outcome: outcome,
        action_taken: decision.actions,
        cart_snapshot: {
          items: enriched,
          poTotal,
          surface: surface ?? null,
          rule_name: decision.ruleName ?? null,
          message: decision.message,
        },
      });
    }

    return new Response(JSON.stringify(decision), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("margin-guardian error", err);
    return new Response(
      JSON.stringify({
        allowed: true,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
