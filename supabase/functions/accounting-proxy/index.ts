import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const XERO_CLIENT_ID = Deno.env.get("XERO_CLIENT_ID") || "";
const XERO_CLIENT_SECRET = Deno.env.get("XERO_CLIENT_SECRET") || "";
const XERO_REDIRECT_URI = (Deno.env.get("APP_URL") || "") + "/auth/xero/callback";
const XERO_BASE = Deno.env.get("XERO_BASE_URL") || "https://api.xero.com/api.xro/2.0";
const XERO_CONNECTIONS_URL = Deno.env.get("XERO_CONNECTIONS_URL") || "https://api.xero.com/connections";
const XERO_TOKEN_URL = Deno.env.get("XERO_TOKEN_URL") || "https://identity.xero.com/connect/token";
const XERO_AUTH_URL = Deno.env.get("XERO_AUTH_URL") || "https://login.xero.com/identity/connect/authorize";

const MYOB_CLIENT_ID = Deno.env.get("MYOB_CLIENT_ID") || "";
const MYOB_CLIENT_SECRET = Deno.env.get("MYOB_CLIENT_SECRET") || "";
const MYOB_REDIRECT_URI = (Deno.env.get("APP_URL") || "") + "/auth/myob/callback";
const MYOB_BASE = Deno.env.get("MYOB_BASE_URL") || "https://api.myob.com/accountright";
const MYOB_TOKEN_URL = Deno.env.get("MYOB_TOKEN_URL") || "https://secure.myob.com/oauth2/v1/token";
const MYOB_AUTH_URL = Deno.env.get("MYOB_AUTH_URL") || "https://secure.myob.com/oauth2/account/authorize";

const respond = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function refreshToken(
  platform: string, conn: any, supabase: any, userId: string
): Promise<string> {
  const tokenUrl = platform === "xero" ? XERO_TOKEN_URL : MYOB_TOKEN_URL;
  const clientId = platform === "xero" ? XERO_CLIENT_ID : MYOB_CLIENT_ID;
  const clientSecret = platform === "xero" ? XERO_CLIENT_SECRET : MYOB_CLIENT_SECRET;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
    }),
  });
  const tokens = await res.json();
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString();

  await supabase.from("accounting_connections").update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || conn.refresh_token,
    token_expires_at: expiresAt,
  }).eq("user_id", userId).eq("platform", platform);

  return tokens.access_token;
}

function buildXeroLineItems(invoice: any, accountCode: string): unknown[] {
  const items = invoice.line_items || [];
  if (items.length > 0) {
    return items.map((item: any) => ({
      Description: String(item.description || item.product_name || ""),
      Quantity: Number(item.quantity) || 1,
      UnitAmount: Number(item.unit_price_inc_gst || item.unit_price) || 0,
      AccountCode: accountCode,
      TaxType: "INPUT",
    }));
  }
  return [{
    Description: `${invoice.supplier} — ${invoice.category || "Stock purchase"} — ${invoice.invoice_date}`,
    Quantity: 1,
    UnitAmount: Number(invoice.total) || 0,
    AccountCode: accountCode,
    TaxType: "INPUT",
  }];
}

function buildMYOBLineItems(invoice: any, accountUid: string, gstUid: string): unknown[] {
  const items = invoice.line_items || [];
  if (items.length > 0) {
    return items.map((item: any) => ({
      Type: "Transaction",
      Description: String(item.description || item.product_name || ""),
      Total: Number(item.total_inc_gst || item.unit_price_inc_gst) || 0,
      Account: { UID: accountUid },
      TaxCode: { UID: gstUid },
    }));
  }
  return [{
    Type: "Transaction",
    Description: `${invoice.supplier} — ${invoice.category || "Stock purchase"} — ${invoice.invoice_date}`,
    Total: Number(invoice.total) || 0,
    Account: { UID: accountUid },
    TaxCode: { UID: gstUid },
  }];
}

function formatXeroDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString().split("T")[0];
  return dateStr.split("T")[0];
}

function formatMYOBDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString().split(".")[0];
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date().toISOString().split(".")[0] : d.toISOString().split(".")[0];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json();
    const { action, platform } = body;

    // ── OAUTH: get_auth_url ──
    if (action === "get_auth_url") {
      if (platform === "xero") {
        const state = crypto.randomUUID();
        const url = `${XERO_AUTH_URL}?` + new URLSearchParams({
          response_type: "code",
          client_id: XERO_CLIENT_ID,
          redirect_uri: XERO_REDIRECT_URI,
          scope: "accounting.transactions accounting.contacts accounting.settings.read offline_access",
          state,
        });
        return respond({ url, state });
      }
      if (platform === "myob") {
        const state = crypto.randomUUID();
        const url = `${MYOB_AUTH_URL}?` + new URLSearchParams({
          client_id: MYOB_CLIENT_ID,
          redirect_uri: MYOB_REDIRECT_URI,
          response_type: "code",
          scope: "CompanyFile",
          state,
        });
        return respond({ url, state });
      }
    }

    // ── OAUTH: exchange_code ──
    if (action === "exchange_code") {
      const { code } = body;

      if (platform === "xero") {
        const tokenRes = await fetch(XERO_TOKEN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: "Basic " + btoa(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`),
          },
          body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: XERO_REDIRECT_URI }),
        });
        const tokens = await tokenRes.json();
        if (!tokens.access_token) return respond({ error: "Token exchange failed", detail: tokens }, 400);

        const tenantsRes = await fetch("https://api.xero.com/connections", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        const tenants = await tenantsRes.json();
        const tenant = tenants[0];
        const expiresAt = new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString();

        await supabase.from("accounting_connections").upsert({
          user_id: user.id,
          platform: "xero",
          xero_tenant_id: tenant?.tenantId,
          xero_tenant_name: tenant?.tenantName,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
        }, { onConflict: "user_id,platform" });

        return respond({ success: true, tenant_name: tenant?.tenantName });
      }

      if (platform === "myob") {
        const tokenRes = await fetch(MYOB_TOKEN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: "Basic " + btoa(`${MYOB_CLIENT_ID}:${MYOB_CLIENT_SECRET}`),
          },
          body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: MYOB_REDIRECT_URI }),
        });
        const tokens = await tokenRes.json();
        if (!tokens.access_token) return respond({ error: "Token exchange failed", detail: tokens }, 400);

        const filesRes = await fetch(MYOB_BASE, {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            "x-myobapi-key": MYOB_CLIENT_ID,
            "x-myobapi-version": "v2",
          },
        });
        const files = await filesRes.json();
        const file = files[0];
        const expiresAt = new Date(Date.now() + (tokens.expires_in || 1200) * 1000).toISOString();

        await supabase.from("accounting_connections").upsert({
          user_id: user.id,
          platform: "myob",
          myob_company_file_id: file?.Id,
          myob_company_file_name: file?.Name,
          myob_company_file_uri: file?.Uri,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
        }, { onConflict: "user_id,platform" });

        return respond({ success: true, company_name: file?.Name });
      }
    }

    // ── All other actions require saved connection ──
    const { data: conn } = await supabase
      .from("accounting_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("platform", platform)
      .single();

    if (!conn) return respond({ error: `No ${platform} connection found` }, 404);

    let accessToken = conn.access_token;
    const expiresAt = new Date(conn.token_expires_at).getTime();
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      accessToken = await refreshToken(platform, conn, supabase, user.id);
    }

    // ── XERO ACTIONS ──
    if (platform === "xero") {
      const xeroHeaders: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": conn.xero_tenant_id,
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      if (action === "get_accounts") {
        const res = await fetch(`${XERO_BASE}/Accounts?where=Status%3D%3D%22ACTIVE%22`, { headers: xeroHeaders });
        return respond({ accounts: (await res.json()).Accounts || [] });
      }

      if (action === "get_tax_rates") {
        const res = await fetch(`${XERO_BASE}/TaxRates`, { headers: xeroHeaders });
        return respond({ taxRates: (await res.json()).TaxRates || [] });
      }

      if (action === "get_contacts") {
        const res = await fetch(`${XERO_BASE}/Contacts?where=IsSupplier%3D%3Dtrue`, { headers: xeroHeaders });
        return respond({ contacts: (await res.json()).Contacts || [] });
      }

      if (action === "find_or_create_contact") {
        const { supplier_name, supplier_email } = body;
        const searchRes = await fetch(
          `${XERO_BASE}/Contacts?where=Name%3D%3D%22${encodeURIComponent(supplier_name)}%22`,
          { headers: xeroHeaders }
        );
        const searchData = await searchRes.json();
        if (searchData.Contacts?.length > 0) {
          return respond({ contactId: searchData.Contacts[0].ContactID });
        }
        const createRes = await fetch(`${XERO_BASE}/Contacts`, {
          method: "POST",
          headers: xeroHeaders,
          body: JSON.stringify({
            Contacts: [{ Name: supplier_name, EmailAddress: supplier_email || "", IsSupplier: true, IsCustomer: false }],
          }),
        });
        const created = await createRes.json();
        return respond({ contactId: created.Contacts?.[0]?.ContactID, isNew: true });
      }

      if (action === "push_bill") {
        const { invoice, contact_id, account_code } = body;
        const billPayload = {
          Invoices: [{
            Type: "ACCPAY",
            Contact: { ContactID: contact_id },
            InvoiceNumber: invoice.invoice_number || "",
            Reference: invoice.supplier || "",
            Date: formatXeroDate(invoice.invoice_date),
            DueDate: formatXeroDate(invoice.due_date || invoice.invoice_date),
            LineAmountTypes: "INCLUSIVE",
            LineItems: buildXeroLineItems(invoice, account_code),
            Status: "DRAFT",
          }],
        };

        const billRes = await fetch(`${XERO_BASE}/Invoices`, {
          method: "POST", headers: xeroHeaders, body: JSON.stringify(billPayload),
        });
        const billData = await billRes.json();

        if (billData.Invoices?.[0]?.InvoiceID) {
          const xeroInvoiceId = billData.Invoices[0].InvoiceID;
          await supabase.from("accounting_push_history").insert({
            user_id: user.id, platform: "xero", invoice_id: invoice.id,
            external_id: xeroInvoiceId,
            external_url: `https://go.xero.com/AccountsPayable/Edit.aspx?InvoiceID=${xeroInvoiceId}`,
            supplier_name: invoice.supplier, invoice_date: invoice.invoice_date,
            total_ex_gst: invoice.subtotal, gst_amount: invoice.gst, total_inc_gst: invoice.total,
            category: invoice.category, status: "pushed",
          });
          return respond({ success: true, external_id: xeroInvoiceId, external_url: `https://go.xero.com/AccountsPayable/Edit.aspx?InvoiceID=${xeroInvoiceId}` });
        }

        await supabase.from("accounting_push_history").insert({
          user_id: user.id, platform: "xero", invoice_id: invoice.id,
          supplier_name: invoice.supplier, status: "failed", error_message: JSON.stringify(billData),
        });
        return respond({ error: "Xero bill creation failed", detail: billData }, 400);
      }
    }

    // ── MYOB ACTIONS ──
    if (platform === "myob") {
      const myobHeaders: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "x-myobapi-key": MYOB_CLIENT_ID,
        "x-myobapi-version": "v2",
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      const fileBase = conn.myob_company_file_uri;

      if (action === "get_accounts") {
        const res = await fetch(`${fileBase}/GeneralLedger/Account?$orderby=DisplayID`, { headers: myobHeaders });
        return respond({ accounts: (await res.json()).Items || [] });
      }

      if (action === "get_tax_codes") {
        const res = await fetch(`${fileBase}/GeneralLedger/TaxCode`, { headers: myobHeaders });
        return respond({ taxCodes: (await res.json()).Items || [] });
      }

      if (action === "find_or_create_supplier") {
        const { supplier_name } = body;
        const searchRes = await fetch(
          `${fileBase}/Contact/Supplier?$filter=CompanyName eq '${encodeURIComponent(supplier_name)}'`,
          { headers: myobHeaders }
        );
        const searchData = await searchRes.json();
        if (searchData.Items?.length > 0) {
          return respond({ uid: searchData.Items[0].UID });
        }
        const createRes = await fetch(`${fileBase}/Contact/Supplier`, {
          method: "POST", headers: myobHeaders,
          body: JSON.stringify({ CompanyName: supplier_name, IsIndividual: false }),
        });
        const location = createRes.headers.get("Location") || "";
        return respond({ uid: location.split("/").pop() || "", isNew: true });
      }

      if (action === "push_bill") {
        const { invoice, supplier_uid, account_uid, gst_uid } = body;
        const billPayload = {
          Date: formatMYOBDate(invoice.invoice_date),
          SupplierInvoiceNumber: invoice.invoice_number || "",
          Supplier: { UID: supplier_uid },
          IsTaxInclusive: true,
          Lines: buildMYOBLineItems(invoice, account_uid, gst_uid),
          JournalMemo: `${invoice.supplier} — ${invoice.category || "Stock purchase"} — ${invoice.invoice_date}`,
          Status: "Open",
        };

        const billRes = await fetch(`${fileBase}/Purchase/Bill/Service`, {
          method: "POST", headers: myobHeaders, body: JSON.stringify(billPayload),
        });

        if (billRes.status === 201) {
          const location = billRes.headers.get("Location") || "";
          const myobBillId = location.split("/").pop() || "";
          await supabase.from("accounting_push_history").insert({
            user_id: user.id, platform: "myob", invoice_id: invoice.id,
            external_id: myobBillId, supplier_name: invoice.supplier,
            invoice_date: invoice.invoice_date, total_ex_gst: invoice.subtotal,
            gst_amount: invoice.gst, total_inc_gst: invoice.total,
            category: invoice.category, status: "pushed",
          });
          return respond({ success: true, external_id: myobBillId });
        }

        const errorText = await billRes.text();
        await supabase.from("accounting_push_history").insert({
          user_id: user.id, platform: "myob", invoice_id: invoice.id,
          supplier_name: invoice.supplier, status: "failed", error_message: errorText,
        });
        return respond({ error: "MYOB bill creation failed", detail: errorText }, 400);
      }
    }

    return respond({ error: "Unknown action" }, 400);
  } catch (err) {
    return respond({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
