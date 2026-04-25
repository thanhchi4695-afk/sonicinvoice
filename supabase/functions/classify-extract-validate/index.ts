// ───────────────────────────────────────────────────────────────
// Agent 2 — Orchestrator
// Runs Stage 1 (classify) → Stage 2 (parse-invoice) → Stage 3 (validate).
// Each stage degrades gracefully — never blocks extraction.
// Also reuses saved supplier_profiles classification when confidence > 70.
// ───────────────────────────────────────────────────────────────
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Classification {
  supplier_name: string | null;
  document_type: string;
  currency: string;
  gst_treatment: string;
  layout_pattern: string;
  has_rrp: boolean;
  column_headers: Array<{ label: string; maps_to: string }>;
  confidence: number;
  _source?: "fresh" | "saved";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") || `Bearer ${anonKey}`;

  try {
    const body = await req.json();
    const {
      fileContent,
      fileName,
      fileType,
      supplierName,
      // Forward-passthrough of every other parse-invoice option
      ...rest
    } = body ?? {};

    if (!fileContent || !fileName) {
      return json({ error: "fileContent and fileName are required" }, 400);
    }

    // Resolve user (best-effort) so we can read/write supplier_profiles
    let userId: string | null = null;
    const sidecarUser = req.headers.get("X-User-Id");
    if (sidecarUser && authHeader === `Bearer ${serviceKey}`) {
      userId = sidecarUser;
    } else {
      try {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data } = await userClient.auth.getUser();
        userId = data?.user?.id ?? null;
      } catch { /* anonymous */ }
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // ─────── STAGE 1 — orientation ───────
    let classification: Classification | null = null;
    let usedSavedProfile = false;
    const SAVED_PROFILE_MIN_CONFIDENCE = 20; // lowered from 70 — raise to 70 once 7+ invoices/supplier

    // First try: saved profile by supplier hint OR filename token match
    const hintSupplier = (supplierName || "").trim();
    if (userId) {
      try {
        // Pull all candidate profiles meeting the confidence floor (cap 50 to be safe)
        const { data: profiles } = await admin
          .from("supplier_profiles")
          .select("supplier_name, profile_data, confidence_score, currency")
          .eq("user_id", userId)
          .gte("confidence_score", SAVED_PROFILE_MIN_CONFIDENCE)
          .limit(50);

        const fileLower = (fileName || "").toLowerCase();
        const matched = (profiles || []).find((p) => {
          const sName = (p.supplier_name || "").toLowerCase().trim();
          if (!sName) return false;
          if (hintSupplier && sName === hintSupplier.toLowerCase()) return true;
          if (hintSupplier && (sName.includes(hintSupplier.toLowerCase()) || hintSupplier.toLowerCase().includes(sName))) return true;
          // Filename hint: e.g. "jantzen_classifier_test.csv" matches "Jantzen"
          if (fileLower.includes(sName)) return true;
          return false;
        });

        const saved = matched?.profile_data?.classification as Classification | undefined;
        if (matched && saved) {
          classification = { ...saved, _source: "saved", supplier_name: matched.supplier_name };
          usedSavedProfile = true;
          console.log(`[classify-extract-validate] Reusing saved classification for ${matched.supplier_name} (confidence ${matched.confidence_score})`);
        }
      } catch (e) {
        console.warn("[classify-extract-validate] saved-profile lookup failed:", e);
      }
    }

    // Otherwise call the orientation agent
    if (!classification) {
      try {
        const cls = await fetch(`${supabaseUrl}/functions/v1/classify-invoice`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ file_base64: fileContent, filename: fileName, fileType }),
        });
        if (cls.ok) {
          const j = await cls.json();
          classification = { ...j.classification, _source: "fresh" } as Classification;
        } else {
          console.warn("[classify-extract-validate] Stage 1 failed:", cls.status, await cls.text().catch(() => ""));
        }
      } catch (e) {
        console.warn("[classify-extract-validate] Stage 1 errored:", e);
      }
    }

    // ─────── STAGE 2 — extraction ───────
    const parseBody = {
      ...rest,
      fileContent,
      fileName,
      fileType,
      supplierName: supplierName || classification?.supplier_name || undefined,
      invoice_classification: classification ?? undefined,
    };

    const ext = await fetch(`${supabaseUrl}/functions/v1/parse-invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: anonKey },
      body: JSON.stringify(parseBody),
    });

    if (!ext.ok) {
      const errText = await ext.text();
      return json({ error: "Extraction failed", details: errText.slice(0, 500), classification }, ext.status);
    }
    const extraction = await ext.json();

    // ─────── STAGE 3 — validation ───────
    let validatedProducts = extraction?.products ?? [];
    let validationSummary: { total: number; flagged: number; flag_types: Record<string, number> } | null = null;

    try {
      const v = await fetch(`${supabaseUrl}/functions/v1/validate-extraction`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          products: validatedProducts,
          classification,
          supplier_name: classification?.supplier_name || supplierName || null,
        }),
      });
      if (v.ok) {
        const j = await v.json();
        validatedProducts = j.products;
        validationSummary = j.summary;
      } else {
        console.warn("[classify-extract-validate] Stage 3 failed:", v.status);
      }
    } catch (e) {
      console.warn("[classify-extract-validate] Stage 3 errored:", e);
    }

    // ─────── Persist classification to supplier_profiles ───────
    const supplierFinal = classification?.supplier_name || extraction?.supplier || supplierName || null;
    if (userId && classification && !usedSavedProfile && supplierFinal) {
      try {
        // Read existing profile_data so we don't clobber it
        const { data: existing } = await admin
          .from("supplier_profiles")
          .select("id, profile_data")
          .eq("user_id", userId)
          .ilike("supplier_name", supplierFinal)
          .maybeSingle();

        const mergedProfileData = {
          ...(existing?.profile_data ?? {}),
          classification: {
            supplier_name: supplierFinal,
            document_type: classification.document_type,
            currency: classification.currency,
            gst_treatment: classification.gst_treatment,
            layout_pattern: classification.layout_pattern,
            has_rrp: classification.has_rrp,
            column_headers: classification.column_headers,
            confidence: classification.confidence,
            updated_at: new Date().toISOString(),
          },
        };

        await admin.from("supplier_profiles").upsert({
          user_id: userId,
          supplier_name: supplierFinal,
          profile_data: mergedProfileData,
          currency: classification.currency,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,supplier_name" });
      } catch (e) {
        console.warn("[classify-extract-validate] supplier_profiles upsert failed:", e);
      }
    }

    return new Response(JSON.stringify({
      ...extraction,
      products: validatedProducts,
      classification,
      classification_source: classification?._source ?? "missing",
      validation_summary: validationSummary,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("classify-extract-validate error:", err);
    return json({ error: err instanceof Error ? err.message : "Pipeline failed" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
