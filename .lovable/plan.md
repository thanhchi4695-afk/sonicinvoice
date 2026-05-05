# Macaron's AI Business Scaling Strategy — Sonic Invoices

Status: PLAN ONLY — not yet implemented. Saved 2026-05-05.
Supersedes the previous Sola/Collections plan (archived in chat history).

The plan is structured as 4 parallel strategies delivered over a 12-week build
order. Each strategy maps to a Macaron-style growth lesson.

---

## Strategy 1 — Brand Intelligence Flywheel
**Lesson:** every user interaction trains a better model.

### Step 1 — Supabase tables
- `brand_patterns` — brand_name, supplier_sku_format, size_schema,
  price_band_min, price_band_max, invoice_layout_fingerprint, sample_count,
  accuracy_rate, updated_at
- `parsing_corrections` — invoice_id, original_value, corrected_value,
  field_name, brand_name, created_at
- `brand_stats` — brand_name, total_invoices_parsed, avg_accuracy, last_seen_at

### Step 2 — Auto-save patterns after every successful parse
Upsert brand into `brand_patterns` after user confirms output. Increment
`sample_count`, recalculate `avg_accuracy` from `parsing_corrections`, update
`last_seen_at` in `brand_stats`.

### Step 3 — Correction feedback UI
Inline edit mode on parsed invoice screen. On any field change, save
original + corrected values to `parsing_corrections`. Show "improvement saved"
toast.

### Step 4 — Use saved patterns to pre-fill future parses
On new invoice upload, detect brand → query `brand_patterns` → pass stored
`invoice_layout_fingerprint` and `size_schema` as additional context to the AI
parsing prompt (extends existing `parse-invoice` edge function).

---

## Strategy 2 — Open-Source Brand Guide (Credibility Play)
**Lesson:** give away something valuable to attract the customers you want.

### Step 1 — Public `/brand-guide` page
No login required. Searchable, filterable table:
Brand · Invoice format (PDF/Excel/Email) · Size schema (AU/US/EU/numeric) ·
SKU pattern example · Common categories. Seed with 20+ AU brands. Filter
chips: swimwear / footwear / clothing / accessories.

### Step 2 — SEO metadata
- Title: *Australian Wholesale Fashion Brand Invoice Guide — Sonic Invoices*
- Description: *Free reference guide covering invoice formats, size schemas,
  and SKU patterns for 40+ Australian fashion wholesale brands including
  Seafolly, Baku, Jantzen, and more.*

### Step 3 — "Suggest a brand" form
Form at bottom of brand guide → `brand_suggestions` table. Edge function
emails admin on new submission.

---

## Strategy 3 — Category Creation: "Stock Intake Automation"
**Lesson:** name a category before competitors do.

### Step 1 — Homepage hero rewrite
- Headline: *The stock intake layer your Shopify store is missing.*
- Subhead: *Sonic Invoices turns supplier invoices into Shopify-ready CSV in
  minutes — not hours. The first Stock Intake Automation tool built for
  Australian independent retail.*
- CTA: *See how it works*

### Step 2 — "The gap no tool was filling" comparison
3-column section: Selling tools (Shopify, Klaviyo, Google Ads) · Marketing
tools (Meta Ads, SEO, Email) · **Stock intake — the missing piece**
(highlighted teal border: Supplier invoices, Manual data entry, Hours of
re-keying).

### Step 3 — Consistent category language
Use "Stock Intake Automation" in footer, meta descriptions, about section.
Add a "What is Stock Intake Automation?" explainer block.

---

## Strategy 4 — Multi-Format Input
**Lesson:** each new input type widens the moat. (Email already partly built.)

### Step 1 — Email forwarding intake (highest impact)
Edge function as inbound webhook (Resend/Postmark). Extract PDF/image
attachments → Supabase storage → trigger `parse-invoice`. Each user gets a
unique address like `chi@parse.sonicinvoices.com`. Dashboard shows their
forwarding address with copy button.

### Step 2 — Mobile photo capture
Photo upload tab. Mobile uses `accept="image/*" capture="environment"`.
Desktop = drag-and-drop. Pass image to parse-invoice with packing-slip prompt.

### Step 3 — Excel / CSV price list upload
Accept .xlsx/.xls/.csv. Use SheetJS to convert client-side. Send first 5 rows
as sample to AI for column mapping (SKU, name, colour, size, RRP, wholesale).
Then parse all rows → Shopify CSV.

### Step 4 — Unified input selector UI
Four large tap cards as the first post-login screen:
📄 PDF Invoice · 📧 Email Forward · 📷 Photo / Packing slip · 📊 Excel / Price list.
Selected card highlights teal.

---

## Build Order (12 weeks)

| Week | Task | Strategy |
|------|------|----------|
| 1 | Supabase tables + auto-save brand patterns | Flywheel |
| 2 | Correction feedback UI on parse output | Flywheel |
| 3 | Public brand guide page + SEO | Open-source |
| 4 | Homepage category language redesign | Category creation |
| 5 | Email forwarding intake (edge function) | Multi-format |
| 6 | Mobile photo capture | Multi-format |
| 7 | Excel / CSV price list upload | Multi-format |
| 8 | Unified input selector UI | Multi-format |
| 9 | Flywheel dashboard (brand accuracy scores) | Flywheel |
| 10–12 | Splash case study page + retailer waitlist | Open-source + social proof |

---

## Notes / Reuse from Existing Codebase
- `parse-invoice` edge function already does Gemini → Claude → Perplexity;
  Strategy 1 Step 4 just adds brand-pattern context to its prompt.
- `gmail-fetch-attachment` + `scan-gmail-inbox` already cover Gmail-based
  intake; Strategy 4 Step 1 is the *generic* forwarding-address version
  (Resend/Postmark), not a replacement.
- `supplier_profiles` and `correction_log` tables already exist — reconcile
  vs new `brand_patterns` / `parsing_corrections` before migrating to avoid
  duplicate state.
- Existing `brand-directory.ts` and `sku-brand-prefix.ts` can seed the
  public `/brand-guide` table.

## Open Questions (resolve before Week 1 build)
1. Inbound email provider: Resend vs Postmark?
2. Reuse `supplier_profiles` or create fresh `brand_patterns`?
3. Brand guide — fully public or gated behind email capture?
4. Forwarding address format: `chi@parse.sonicinvoices.com` requires MX on
   `parse.sonicinvoices.com` — is the user prepared to add the DNS record?
