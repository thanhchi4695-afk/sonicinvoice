/**
 * Sonic Invoices — Auto-Learn Brand Profile Generator
 *
 * After every successful invoice parse, this module:
 *   1. Checks if a brand profile already exists for this supplier
 *   2. If not → generates a new profile from the parsed data
 *   3. If yes → merges new learnings (new column names, sizes, etc.)
 *   4. Saves to the brand_profiles table in Supabase
 *   5. Next invoice from this supplier loads the saved profile automatically
 *
 * Wire into parse-invoice AFTER validateAndMaybeReExtract succeeds.
 *
 * ── HOW TO ADD TO LOVABLE ──────────────────────────────────────────────────
 * Tell Lovable:
 *   "Add this file as supabase/functions/_shared/auto-learn-brand-profile.ts
 *    and call autoLearnBrandProfile() at the end of the parse-invoice handler,
 *    after validation passes. Also create a brand_profiles table in Supabase
 *    using the SQL in the comment at the bottom of this file."
 * ──────────────────────────────────────────────────────────────────────────
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedRow {
  styleName: string;
  styleNumber: string;
  colour: string;
  size: string;
  quantity: number;
  costPrice: number | null;
  rrpPrice: number | null;
  vendor: string;
  material?: string;
  arrivalTag?: string;
  productType?: string;
  specialTags?: string[];
}

export interface InvoiceMeta {
  documentType: string;
  supplierName: string;
  supplierLegal?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  subtotalExGst?: number;
  layoutType?: string; // "A" | "B" | "C" | "D" | "Mixed"
  costColumnName?: string; // actual column name found, e.g. "SP", "Rate", "Wholesale"
  rrpOnInvoice?: boolean;
  gstInclusivePricing?: boolean;
  multipleVendors?: boolean;
}

export interface BrandProfile {
  id?: string;
  supplierKey: string;           // normalised key, e.g. "bond-eye"
  supplierName: string;          // display name, e.g. "Bond Eye"
  supplierLegal: string;         // legal entity on invoice
  shopifyVendor: string;         // correct Shopify vendor name
  confidence: number;            // 0–100, increases with each invoice processed
  invoicesProcessed: number;
  layoutType: string;
  costColumnName: string;
  gstInclusivePricing: boolean;
  rrpOnInvoice: boolean;
  knownSizes: string[];
  knownColours: string[];
  productTypes: string[];
  specialTagRules: string[];
  vendorMapping?: string;        // e.g. "Skye Group Pty Ltd → Jantzen"
  notes: string;
  rawMd: string;                 // the full .md profile text for injection into prompts
  createdAt?: string;
  updatedAt?: string;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Call this after a successful, validated parse.
 * It is non-blocking — errors are logged but never thrown.
 */
export async function autoLearnBrandProfile(
  meta: InvoiceMeta,
  rows: ParsedRow[],
  fileBase64: string,
  mimeType: string,
  anthropicApiKey: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
): Promise<{ action: "created" | "updated" | "skipped"; supplierKey: string }> {
  const supplierKey = normaliseKey(meta.supplierName);

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Load existing profile (if any)
    const { data: existing } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("supplier_key", supplierKey)
      .single();

    // 2. Generate a new or updated profile via Claude
    const profile = await generateProfile(
      meta,
      rows,
      fileBase64,
      mimeType,
      existing as BrandProfile | null,
      anthropicApiKey,
    );

    // 3. Upsert into Supabase
    const { error } = await supabase
      .from("brand_profiles")
      .upsert(
        {
          supplier_key: supplierKey,
          supplier_name: profile.supplierName,
          supplier_legal: profile.supplierLegal,
          shopify_vendor: profile.shopifyVendor,
          confidence: profile.confidence,
          invoices_processed: profile.invoicesProcessed,
          layout_type: profile.layoutType,
          cost_column_name: profile.costColumnName,
          gst_inclusive_pricing: profile.gstInclusivePricing,
          rrp_on_invoice: profile.rrpOnInvoice,
          known_sizes: profile.knownSizes,
          known_colours: profile.knownColours,
          product_types: profile.productTypes,
          special_tag_rules: profile.specialTagRules,
          vendor_mapping: profile.vendorMapping,
          notes: profile.notes,
          raw_md: profile.rawMd,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "supplier_key" },
      );

    if (error) {
      console.error("[auto-learn] Supabase upsert error:", error.message);
      return { action: "skipped", supplierKey };
    }

    const action = existing ? "updated" : "created";
    console.log(`[auto-learn] Profile ${action} for "${supplierKey}" (confidence: ${profile.confidence}%)`);
    return { action, supplierKey };

  } catch (e) {
    // Non-fatal — log and move on
    console.warn("[auto-learn] Failed silently:", (e as Error).message);
    return { action: "skipped", supplierKey };
  }
}

// ─── Profile generation via Claude ───────────────────────────────────────────

async function generateProfile(
  meta: InvoiceMeta,
  rows: ParsedRow[],
  fileBase64: string,
  mimeType: string,
  existing: BrandProfile | null,
  anthropicApiKey: string,
): Promise<BrandProfile> {

  // Derive facts directly from the parsed data (fast, no LLM needed)
  const knownSizes = [...new Set(rows.map(r => r.size).filter(Boolean))].sort();
  const knownColours = [...new Set(rows.map(r => r.colour).filter(Boolean))].sort();
  const productTypes = [...new Set(rows.map(r => r.productType).filter(Boolean))];
  const specialTagRules = [...new Set(rows.flatMap(r => r.specialTags ?? []))];
  const vendorNames = [...new Set(rows.map(r => r.vendor).filter(Boolean))];
  const shopifyVendor = vendorNames.length === 1
    ? vendorNames[0]
    : vendorNames.join(" / ");

  // Confidence score: starts at 65% for first invoice, increases with each new one
  const prevInvoices = existing?.invoicesProcessed ?? 0;
  const newInvoiceCount = prevInvoices + 1;
  const confidence = Math.min(95, 65 + (newInvoiceCount - 1) * 5);

  // Ask Claude to write the .md profile text (the part that gets injected into
  // future parse prompts). This is a lightweight call — cheap and fast.
  const rawMd = await generateMarkdownProfile(
    meta,
    rows,
    fileBase64,
    mimeType,
    existing?.rawMd ?? null,
    anthropicApiKey,
  );

  return {
    supplierKey: normaliseKey(meta.supplierName),
    supplierName: meta.supplierName,
    supplierLegal: meta.supplierLegal ?? meta.supplierName,
    shopifyVendor,
    confidence,
    invoicesProcessed: newInvoiceCount,
    layoutType: meta.layoutType ?? "A",
    costColumnName: meta.costColumnName ?? "unknown",
    gstInclusivePricing: meta.gstInclusivePricing ?? false,
    rrpOnInvoice: meta.rrpOnInvoice ?? false,
    knownSizes,
    knownColours,
    productTypes,
    specialTagRules,
    vendorMapping: meta.supplierLegal && meta.supplierLegal !== meta.supplierName
      ? `${meta.supplierLegal} → ${shopifyVendor}`
      : undefined,
    notes: buildNotes(meta, rows),
    rawMd,
  };
}

async function generateMarkdownProfile(
  meta: InvoiceMeta,
  rows: ParsedRow[],
  fileBase64: string,
  mimeType: string,
  existingMd: string | null,
  anthropicApiKey: string,
): Promise<string> {

  const systemPrompt = `You are writing a brand intelligence profile for Sonic Invoices — an AI-powered invoice parser for an Australian swimwear retailer.

Your job: write a concise .md file that captures everything a future AI invoice parser needs to know about this supplier. The profile will be injected into the system prompt when the next invoice from this supplier arrives.

Format the profile exactly like this example:

---
# SUPPLIER SKILL: [Brand Name]

Last updated: [YYYY-MM-DD]
Confidence: [N]% ([N] invoice(s) processed)

## SUPPLIER LEGAL DETAILS
- Trading name: ...
- Address: ...
- ABN: ...

## DOCUMENT STRUCTURE
- Layout type: Type [A/B/C/D]
- Multi-page: yes/no
- Text layer: yes/no (OCR needed: yes/no)

## LINE ITEM FORMAT
[Table of columns and what they contain]

## COST FIELDS
- Cost (Shopify Cost per item): [column name] = [ex GST / incl GST — divide by 1.1 if incl]
- RRP: [provided / not provided — markup formula if not provided]

## SKU FORMAT
[Explain the style number pattern]

## SIZING
[Explain the sizing system used]

## SHOPIFY MAPPING
- Vendor: [exact Shopify vendor name]
- Brand tag: [exact tag]
- Department tag: [tags]
- Type tag: [how to determine]
- Special tags: [rules]

## KNOWN NOISE ROWS (skip these)
[List rows that are not products]

## ARRIVAL MONTH TAG
[How to derive it and example]

## CORRECTIONS / GOTCHAS
[Any traps, mismatches, or edge cases]
---

Be factual and precise. Only write what you can confirm from the invoice. Do not guess. If something is unclear, note it with "(verify)" rather than stating it confidently.`;

  const userText = existingMd
    ? `A profile already exists for this supplier. Here is the current version:\n\n${existingMd}\n\n---\n\nA new invoice has just been processed. Update and improve the profile with any new information. Supplier hint: ${meta.supplierName}. Invoice date: ${meta.invoiceDate ?? "unknown"}. Layout type identified: ${meta.layoutType ?? "unknown"}. Cost column found: ${meta.costColumnName ?? "unknown"}. RRP on invoice: ${meta.rrpOnInvoice}. GST-inclusive pricing: ${meta.gstInclusivePricing}. Sizes seen: ${[...new Set(rows.map(r => r.size))].join(", ")}. Return only the updated .md content.`
    : `Write a brand intelligence profile for this supplier. Supplier hint: ${meta.supplierName}. Invoice date: ${meta.invoiceDate ?? "unknown"}. Layout type identified: ${meta.layoutType ?? "unknown"}. Cost column found: ${meta.costColumnName ?? "unknown"}. RRP on invoice: ${meta.rrpOnInvoice}. GST-inclusive pricing: ${meta.gstInclusivePricing}. Products extracted: ${rows.length} rows. Sizes seen: ${[...new Set(rows.map(r => r.size))].join(", ")}. Return only the .md content.`;

  const isPdf = mimeType === "application/pdf";
  const docBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } }
    : { type: "image", source: { type: "base64", media_type: mimeType, data: fileBase64 } };

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001", // cheap + fast — profile writing doesn't need Sonnet
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: [docBlock, { type: "text", text: userText }],
      }],
    }),
  });

  if (!resp.ok) {
    console.warn("[auto-learn] Profile generation call failed:", resp.status);
    // Return a minimal fallback profile rather than failing
    return buildFallbackMd(meta, rows);
  }

  const json = await resp.json();
  const text = (json.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");

  return text.trim() || buildFallbackMd(meta, rows);
}

// ─── Profile loader (used at parse time) ─────────────────────────────────────

/**
 * Load a saved brand profile and inject it into the parse prompt.
 * Call this at the START of parse-invoice, before Stage 1.
 *
 * Returns the rawMd string to append to the system prompt,
 * or an empty string if no profile exists yet.
 */
export async function loadBrandProfile(
  supplierHint: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
): Promise<{ profileMd: string; confidence: number; found: boolean }> {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const supplierKey = normaliseKey(supplierHint);

    const { data } = await supabase
      .from("brand_profiles")
      .select("raw_md, confidence, supplier_name")
      .eq("supplier_key", supplierKey)
      .single();

    if (!data) {
      return { profileMd: "", confidence: 0, found: false };
    }

    const injected = `\n\n## BRAND-SPECIFIC PROFILE: ${data.supplier_name}\nConfidence: ${data.confidence}%\n\n${data.raw_md}\n\n---\n`;
    return { profileMd: injected, confidence: data.confidence, found: true };

  } catch {
    return { profileMd: "", confidence: 0, found: false };
  }
}

/**
 * Fuzzy supplier lookup — tries exact key first, then partial match.
 * Useful when the PDF header says "Bond-Eye Australia Pty Ltd" but the
 * profile is stored under "bond-eye".
 */
export async function findBrandProfile(
  supplierNameFromInvoice: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
): Promise<{ profileMd: string; confidence: number; found: boolean }> {
  // Try exact normalised key first
  const exact = await loadBrandProfile(supplierNameFromInvoice, supabaseUrl, supabaseServiceKey);
  if (exact.found) return exact;

  // Try partial match — useful for legal names vs trading names
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const searchTerm = supplierNameFromInvoice.toLowerCase().replace(/pty ltd|pty\.|ltd|limited/g, "").trim().slice(0, 20);

    const { data } = await supabase
      .from("brand_profiles")
      .select("raw_md, confidence, supplier_name, supplier_legal")
      .or(`supplier_key.ilike.%${searchTerm}%,supplier_legal.ilike.%${searchTerm}%`)
      .order("confidence", { ascending: false })
      .limit(1)
      .single();

    if (!data) return { profileMd: "", confidence: 0, found: false };

    const injected = `\n\n## BRAND-SPECIFIC PROFILE: ${data.supplier_name}\nConfidence: ${data.confidence}%\n\n${data.raw_md}\n\n---\n`;
    return { profileMd: injected, confidence: data.confidence, found: true };

  } catch {
    return { profileMd: "", confidence: 0, found: false };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normaliseKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/pty\.?\s*ltd\.?|limited|pty\.|inc\.|corp\./gi, "")
    .replace(/australia|aust\./gi, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

function buildNotes(meta: InvoiceMeta, rows: ParsedRow[]): string {
  const notes: string[] = [];
  if (meta.gstInclusivePricing) notes.push("Prices are GST-inclusive — divide by 1.1 for cost.");
  if (!meta.rrpOnInvoice) notes.push("RRP not on invoice — markup formula required.");
  if (meta.multipleVendors) notes.push("Invoice contains multiple Shopify vendors.");
  if (meta.supplierLegal && meta.supplierLegal !== meta.supplierName) {
    notes.push(`Legal entity "${meta.supplierLegal}" → Shopify vendor "${rows[0]?.vendor ?? meta.supplierName}".`);
  }
  return notes.join(" ");
}

function buildFallbackMd(meta: InvoiceMeta, rows: ParsedRow[]): string {
  const vendors = [...new Set(rows.map(r => r.vendor).filter(Boolean))];
  return `# SUPPLIER SKILL: ${meta.supplierName}

Auto-generated fallback profile (profile generation call failed).

## SUPPLIER DETAILS
- Trading name: ${meta.supplierName}
- Legal entity: ${meta.supplierLegal ?? "unknown"}

## WHAT WAS LEARNED
- Layout type: ${meta.layoutType ?? "unknown"}
- Cost column: ${meta.costColumnName ?? "unknown"}
- GST-inclusive pricing: ${meta.gstInclusivePricing ?? false}
- RRP on invoice: ${meta.rrpOnInvoice ?? false}
- Shopify vendor(s): ${vendors.join(", ") || "unknown"}
- Rows extracted: ${rows.length}

## NOTE
This is a minimal auto-generated profile. Process another invoice from this
supplier to build a richer profile.
`;
}

// ─── Updated parse-invoice handler integration ───────────────────────────────
//
// HOW TO WIRE THIS INTO YOUR EXISTING parse-invoice EDGE FUNCTION:
//
// BEFORE Stage 1 (add profile lookup):
// ──────────────────────────────────────
//   import { findBrandProfile } from "./_shared/auto-learn-brand-profile.ts";
//
//   const { profileMd, found: profileFound } = await findBrandProfile(
//     supplierHint,
//     Deno.env.get("SUPABASE_URL")!,
//     Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
//   );
//
//   // Append the saved profile to the system prompt for this parse
//   const systemPromptForThisInvoice = SONIC_MASTER_PROMPT_V2 + profileMd +
//     `\n\n## RUNTIME OUTPUT CONTRACT\nCall the return_invoice tool exactly once.`;
//
//   console.log(`[parse] Profile ${profileFound ? "loaded" : "not found"} for "${supplierHint}"`);
//
//
// AFTER validation passes (add auto-learn):
// ──────────────────────────────────────────
//   import { autoLearnBrandProfile } from "./_shared/auto-learn-brand-profile.ts";
//
//   // Fire-and-forget — doesn't block the response to the client
//   autoLearnBrandProfile(
//     meta,
//     validatedRows,
//     fileBase64,
//     mimeType,
//     Deno.env.get("ANTHROPIC_API_KEY")!,
//     Deno.env.get("SUPABASE_URL")!,
//     Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
//   ).then(result => {
//     console.log(`[auto-learn] ${result.action} profile for "${result.supplierKey}"`);
//   });
//
//   // Return the response to client immediately — don't await auto-learn
//   return new Response(JSON.stringify({ rows: validatedRows, meta, validation, extractor: "claude-pdf" }));
//
// ─────────────────────────────────────────────────────────────────────────────


// ─── Supabase table SQL ───────────────────────────────────────────────────────
//
// Run this in your Supabase SQL editor to create the brand_profiles table:
//
// CREATE TABLE IF NOT EXISTS brand_profiles (
//   id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   supplier_key          TEXT UNIQUE NOT NULL,
//   supplier_name         TEXT NOT NULL,
//   supplier_legal        TEXT,
//   shopify_vendor        TEXT,
//   confidence            INTEGER DEFAULT 65,
//   invoices_processed    INTEGER DEFAULT 1,
//   layout_type           TEXT,
//   cost_column_name      TEXT,
//   gst_inclusive_pricing BOOLEAN DEFAULT FALSE,
//   rrp_on_invoice        BOOLEAN DEFAULT FALSE,
//   known_sizes           TEXT[],
//   known_colours         TEXT[],
//   product_types         TEXT[],
//   special_tag_rules     TEXT[],
//   vendor_mapping        TEXT,
//   notes                 TEXT,
//   raw_md                TEXT,
//   created_at            TIMESTAMPTZ DEFAULT NOW(),
//   updated_at            TIMESTAMPTZ DEFAULT NOW()
// );
//
// -- Enable RLS (service role key bypasses this for server-side calls)
// ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;
//
// -- Index for fast lookup
// CREATE INDEX idx_brand_profiles_supplier_key ON brand_profiles(supplier_key);
// CREATE INDEX idx_brand_profiles_supplier_legal ON brand_profiles(supplier_legal);
//
// -- Optional: seed with your 63 existing .md profiles
// -- Use the seed script below or import them manually via Supabase dashboard
//
// ─────────────────────────────────────────────────────────────────────────────
