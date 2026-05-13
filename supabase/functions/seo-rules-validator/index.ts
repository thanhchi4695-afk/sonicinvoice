// Smart-rule product-count validator.
// Reads collection_seo_outputs.smart_rules_json, builds a Shopify products
// search query, calls productsCount via Admin GraphQL, and flips rules_status:
//   validated   - count >= MIN_PRODUCTS (default 3)
//   insufficient- count <  MIN_PRODUCTS
//   error       - Shopify call failed
import { createClient } from "npm:@supabase/supabase-js@2";
import { getValidShopifyToken, ShopifyReauthRequiredError } from "../_shared/shopify-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_PRODUCTS = 3;

interface Rule {
  column: "TITLE" | "TAG" | "VENDOR" | "TYPE" | string;
  relation: "CONTAINS" | "EQUALS" | "NOT_CONTAINS" | string;
  condition: string;
}

interface RuleSet {
  appliedDisjunctively?: boolean;
  rules: Rule[];
}

function quote(v: string): string {
  // Shopify search: wrap in quotes if it has spaces or special chars
  const needs = /[\s:'"\\]/.test(v);
  const escaped = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return needs ? `"${escaped}"` : escaped;
}

function ruleToToken(r: Rule): string | null {
  const cond = (r.condition ?? "").trim();
  if (!cond) return null;
  const col = String(r.column || "").toUpperCase();
  const rel = String(r.relation || "").toUpperCase();
  let field = "";
  switch (col) {
    case "TITLE": field = "title"; break;
    case "TAG": field = "tag"; break;
    case "VENDOR": field = "vendor"; break;
    case "TYPE": field = "product_type"; break;
    default: return null;
  }
  let value: string;
  if (rel === "CONTAINS" || rel === "NOT_CONTAINS") {
    // wildcard
    value = field === "title" ? `*${cond}*` : cond;
  } else {
    value = cond;
  }
  const token = `${field}:${quote(value)}`;
  return rel === "NOT_CONTAINS" ? `-${token}` : token;
}

function buildQuery(ruleSet: RuleSet | null | undefined): string | null {
  if (!ruleSet || !Array.isArray(ruleSet.rules) || ruleSet.rules.length === 0) return null;
  const tokens = ruleSet.rules.map(ruleToToken).filter(Boolean) as string[];
  if (tokens.length === 0) return null;
  const joiner = ruleSet.appliedDisjunctively ? " OR " : " AND ";
  return tokens.join(joiner);
}

async function shopifyProductsCount(
  storeUrl: string,
  apiVersion: string,
  accessToken: string,
  query: string,
): Promise<number> {
  const url = `https://${storeUrl}/admin/api/${apiVersion || "2024-10"}/graphql.json`;
  const body = {
    query: `query($q: String){ productsCount(query: $q){ count } }`,
    variables: { q: query },
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Shopify ${resp.status}: ${t.slice(0, 200)}`);
  }
  const json = await resp.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 300));
  return Number(json?.data?.productsCount?.count ?? 0);
}

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { suggestion_ids, limit } = await req.json().catch(() => ({}));
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Authenticated user
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return jsonResp({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    // Token
    let token;
    try {
      token = await getValidShopifyToken(supabase, userId);
    } catch (e) {
      if (e instanceof ShopifyReauthRequiredError) return jsonResp({ error: "needs_reauth" }, 401);
      throw e;
    }

    // Pick rows to validate
    let q = supabase
      .from("collection_seo_outputs")
      .select("suggestion_id, smart_rules_json, rules_status");
    if (Array.isArray(suggestion_ids) && suggestion_ids.length) {
      q = q.in("suggestion_id", suggestion_ids);
    } else {
      q = q.eq("rules_status", "pending").limit(limit ?? 25);
    }
    const { data: rows, error: rErr } = await q;
    if (rErr) return jsonResp({ error: rErr.message }, 500);

    const results: Array<{ suggestion_id: string; count: number; status: string; error?: string }> = [];

    for (const row of rows ?? []) {
      const query = buildQuery(row.smart_rules_json as RuleSet | null);
      if (!query) {
        await supabase
          .from("collection_seo_outputs")
          .update({
            rules_validated_count: 0,
            rules_status: "error",
            validation_errors: [{ field: "smart_rules_json", message: "no usable rules" }],
          })
          .eq("suggestion_id", row.suggestion_id);
        results.push({ suggestion_id: row.suggestion_id, count: 0, status: "error", error: "no rules" });
        continue;
      }
      try {
        const count = await shopifyProductsCount(token.storeUrl, token.apiVersion, token.accessToken, query);
        const status = count >= MIN_PRODUCTS ? "validated" : "insufficient";
        await supabase
          .from("collection_seo_outputs")
          .update({
            rules_validated_count: count,
            rules_status: status,
            rules_validated_at: new Date().toISOString(),
          })
          .eq("suggestion_id", row.suggestion_id);
        results.push({ suggestion_id: row.suggestion_id, count, status });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase
          .from("collection_seo_outputs")
          .update({ rules_status: "error", validation_errors: [{ field: "shopify", message: msg }] })
          .eq("suggestion_id", row.suggestion_id);
        results.push({ suggestion_id: row.suggestion_id, count: 0, status: "error", error: msg });
      }
      // light throttle
      await new Promise((r) => setTimeout(r, 500));
    }

    return jsonResp({ ok: true, results });
  } catch (e) {
    console.error("seo-rules-validator error", e);
    return jsonResp({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});
