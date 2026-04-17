import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an invoice pattern analyst for Australian retail businesses.
Analyse the provided invoice headers and sample data. Return ONLY a JSON object (no markdown, no prose) with these fields:
{
  "column_map": object,            // header text -> field role mapping (e.g. { "Style No": "sku", "Description": "product_name" })
  "size_system": string,           // AU/US/EU/UK/own/unknown
  "price_column_cost": string,     // which header = wholesale cost
  "price_column_rrp": string,      // which header = RRP (null if absent)
  "gst_included_in_cost": boolean,
  "gst_included_in_rrp": boolean,
  "default_markup_multiplier": number, // inferred from cost vs RRP ratio
  "pack_notation_detected": boolean,
  "size_matrix_detected": boolean,
  "currency": string,              // must be AUD for Australian suppliers
  "sku_prefix_pattern": string,    // e.g. 'SF' for style codes starting SF
  "sku_format_regex": string,      // e.g. '^SF[0-9]{6}$'
  "colour_column_name": string,    // exact column name for colour
  "special_rules": object,         // any unusual patterns observed
  "confidence": number             // 0-100 how confident this mapping is
}`;

function calcConfidence(invoiceCount: number, correctionCount: number): number {
  let base = 20;
  if (invoiceCount >= 10) base = 90;
  else if (invoiceCount >= 5) base = 70;
  else if (invoiceCount >= 3) base = 50;
  else if (invoiceCount >= 1) base = 20;

  if (correctionCount === 0 && invoiceCount >= 1) base += 10;
  base -= correctionCount * 5;

  return Math.max(0, Math.min(100, base));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify user via JWT
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const {
      supplier_name,
      raw_headers = [],
      sample_rows = [],
      format_type = null,
      extracted_products = [],
      corrections_override = null,
      field_confidence = null,
    } = body || {};

    if (!supplier_name || typeof supplier_name !== "string") {
      return new Response(JSON.stringify({ error: "supplier_name required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === FAST PATH: corrections_override ===
    // Called when the user has corrected the same field 3+ times and clicks
    // "Update rule". We patch the existing invoice_pattern for that field
    // without re-running the AI analysis.
    if (corrections_override && typeof corrections_override === "object") {
      const { field, corrected_value, supplier_profile_id } = corrections_override as {
        field?: string; corrected_value?: string; supplier_profile_id?: string;
      };
      if (!field || !supplier_profile_id) {
        return new Response(JSON.stringify({ error: "corrections_override requires field and supplier_profile_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify ownership
      const { data: ownProfile } = await supabase
        .from("supplier_profiles")
        .select("id")
        .eq("id", supplier_profile_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!ownProfile) {
        return new Response(JSON.stringify({ error: "supplier_profile not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: existingPattern } = await supabase
        .from("invoice_patterns")
        .select("id, column_map")
        .eq("supplier_profile_id", supplier_profile_id)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingPattern) {
        const colMap = (existingPattern.column_map as Record<string, string>) || {};
        // Record that THIS column header should map to the corrected field role
        colMap[`__user_override_${field}`] = corrected_value || "";
        await supabase
          .from("invoice_patterns")
          .update({ column_map: colMap, updated_at: new Date().toISOString() })
          .eq("id", existingPattern.id);
      }

      // Recalculate confidence (correction count already includes the new ones).
      const { count: correctionCount } = await supabase
        .from("correction_log")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("supplier_profile_id", supplier_profile_id);

      const { data: profileRow } = await supabase
        .from("supplier_profiles")
        .select("invoice_count")
        .eq("id", supplier_profile_id)
        .single();

      const confidenceScore = calcConfidence(profileRow?.invoice_count || 1, correctionCount || 0);

      await supabase
        .from("supplier_profiles")
        .update({ confidence_score: confidenceScore })
        .eq("id", supplier_profile_id);

      return new Response(
        JSON.stringify({
          supplier_profile_id,
          confidence_score: confidenceScore,
          rule_updated: !!existingPattern,
          field,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Call AI to analyse pattern
    const userMsg = `Supplier: ${supplier_name}
Format type hint: ${format_type || "unknown"}

Raw headers from invoice:
${JSON.stringify(raw_headers, null, 2)}

Sample rows (first 3):
${JSON.stringify(sample_rows.slice(0, 3), null, 2)}

Total products extracted: ${extracted_products.length}
Sample extracted product: ${JSON.stringify(extracted_products[0] || {}, null, 2)}

Return ONLY the JSON pattern object.`;

    const aiResp = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      temperature: 0.1,
    });

    const content = getContent(aiResp);
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    const jsonStr = (jsonMatch[1] || content).trim();
    const pattern = JSON.parse(jsonStr);

    // 2. Find existing supplier profile (match name OR variants)
    const { data: existingProfiles } = await supabase
      .from("supplier_profiles")
      .select("id, supplier_name, supplier_name_variants, invoice_count")
      .eq("user_id", userId)
      .eq("is_active", true);

    const normalised = supplier_name.trim().toLowerCase();
    const existing = (existingProfiles || []).find((p: any) => {
      if (p.supplier_name?.trim().toLowerCase() === normalised) return true;
      const variants: string[] = p.supplier_name_variants || [];
      return variants.some((v) => v?.trim().toLowerCase() === normalised);
    });

    let supplierProfileId: string;
    let invoiceCount: number;
    let isNew = false;

    if (existing) {
      supplierProfileId = existing.id;
      invoiceCount = (existing.invoice_count || 0) + 1;

      // Add the name as a variant if it's a new spelling
      const variants: string[] = (existing as any).supplier_name_variants || [];
      const hasVariant = variants.some((v) => v?.trim().toLowerCase() === normalised) ||
        existing.supplier_name?.trim().toLowerCase() === normalised;
      const newVariants = hasVariant ? variants : [...variants, supplier_name];

      await supabase
        .from("supplier_profiles")
        .update({
          invoice_count: invoiceCount,
          supplier_name_variants: newVariants,
          updated_at: new Date().toISOString(),
        })
        .eq("id", supplierProfileId);

      // Update existing invoice_pattern (most recent) or insert new
      const { data: existingPattern } = await supabase
        .from("invoice_patterns")
        .select("id, invoice_count")
        .eq("supplier_profile_id", supplierProfileId)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingPattern) {
        await supabase
          .from("invoice_patterns")
          .update({
            format_type,
            column_map: pattern.column_map || {},
            size_system: pattern.size_system,
            price_column_cost: pattern.price_column_cost,
            price_column_rrp: pattern.price_column_rrp,
            gst_included_in_cost: pattern.gst_included_in_cost,
            gst_included_in_rrp: pattern.gst_included_in_rrp,
            default_markup_multiplier: pattern.default_markup_multiplier,
            pack_notation_detected: pattern.pack_notation_detected,
            size_matrix_detected: pattern.size_matrix_detected,
            sample_headers: raw_headers,
            invoice_count: (existingPattern.invoice_count || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingPattern.id);
      } else {
        await supabase.from("invoice_patterns").insert({
          user_id: userId,
          supplier_profile_id: supplierProfileId,
          format_type,
          column_map: pattern.column_map || {},
          size_system: pattern.size_system,
          price_column_cost: pattern.price_column_cost,
          price_column_rrp: pattern.price_column_rrp,
          gst_included_in_cost: pattern.gst_included_in_cost,
          gst_included_in_rrp: pattern.gst_included_in_rrp,
          default_markup_multiplier: pattern.default_markup_multiplier,
          pack_notation_detected: pattern.pack_notation_detected,
          size_matrix_detected: pattern.size_matrix_detected,
          sample_headers: raw_headers,
          invoice_count: 1,
        });
      }
    } else {
      isNew = true;
      invoiceCount = 1;
      const { data: newProfile, error: insertErr } = await supabase
        .from("supplier_profiles")
        .insert({
          user_id: userId,
          supplier_name,
          supplier_name_variants: [supplier_name],
          country: "AU",
          currency: pattern.currency || "AUD",
          invoice_count: 1,
          is_active: true,
          profile_data: pattern,
        })
        .select("id")
        .single();

      if (insertErr || !newProfile) throw new Error(insertErr?.message || "Failed to create profile");
      supplierProfileId = newProfile.id;

      await supabase.from("invoice_patterns").insert({
        user_id: userId,
        supplier_profile_id: supplierProfileId,
        format_type,
        column_map: pattern.column_map || {},
        size_system: pattern.size_system,
        price_column_cost: pattern.price_column_cost,
        price_column_rrp: pattern.price_column_rrp,
        gst_included_in_cost: pattern.gst_included_in_cost,
        gst_included_in_rrp: pattern.gst_included_in_rrp,
        default_markup_multiplier: pattern.default_markup_multiplier,
        pack_notation_detected: pattern.pack_notation_detected,
        size_matrix_detected: pattern.size_matrix_detected,
        sample_headers: raw_headers,
        invoice_count: 1,
      });
    }

    // Brand pattern (sku prefix / colour column / etc) — upsert per supplier
    if (pattern.sku_prefix_pattern || pattern.colour_column_name) {
      const { data: existingBrand } = await supabase
        .from("brand_patterns")
        .select("id")
        .eq("user_id", userId)
        .eq("supplier_profile_id", supplierProfileId)
        .maybeSingle();

      const brandRow = {
        user_id: userId,
        supplier_profile_id: supplierProfileId,
        brand_name: supplier_name,
        sku_prefix_pattern: pattern.sku_prefix_pattern || null,
        sku_format_regex: pattern.sku_format_regex || null,
        size_scale_examples: {},
        colour_column_name: pattern.colour_column_name || null,
        product_type_keywords: [],
        special_rules: pattern.special_rules || {},
      };

      if (existingBrand) {
        await supabase.from("brand_patterns").update(brandRow).eq("id", existingBrand.id);
      } else {
        await supabase.from("brand_patterns").insert(brandRow);
      }
    }

    // 3. Confidence score
    const { count: correctionCount } = await supabase
      .from("correction_log")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("supplier_profile_id", supplierProfileId);

    const confidenceScore = calcConfidence(invoiceCount, correctionCount || 0);

    await supabase
      .from("supplier_profiles")
      .update({ confidence_score: confidenceScore })
      .eq("id", supplierProfileId);

    return new Response(
      JSON.stringify({
        supplier_profile_id: supplierProfileId,
        confidence_score: confidenceScore,
        is_new_supplier: isNew,
        invoice_count: invoiceCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("extract-supplier-pattern error:", err);
    const status = err instanceof AIGatewayError ? err.status : 500;
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Pattern extraction failed" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
