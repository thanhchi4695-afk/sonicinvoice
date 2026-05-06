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

---

## Plan — Agentic Chat Command Centre (saved 2026-05-06)

Status: PLAN ONLY — not yet implemented.

Goal: a chat box inside Sonic Invoices that understands natural-language
keywords, answers questions, and (with permission) executes app actions
the way Claude's agentic tools do.

### Pattern
understand → plan → confirm → execute → report back

### Capabilities (3 layers)
1. **Intent recognition** — user types "parse new invoice" or "show Seafolly
   accuracy" and the app maps it to a known action.
2. **Action execution** — chat actually triggers the function (upload, parse,
   export CSV, navigate tab) instead of just describing it.
3. **Permission gating** — destructive / significant actions render a
   confirm/cancel pair before running.

### Intent map (initial)
**Invoice actions**
- "parse invoice / upload / new stock" → open file picker / email inbox
- "show last invoice / recent parses" → history tab
- "export CSV / download for Shopify" → CSV export of last parse
- "fix [brand] / correct [field]" → correction UI for that brand

**Flywheel / brand intelligence**
- "how accurate is [brand]" → query `brand_patterns`, render card
- "which brands have I trained / flywheel status" → flywheel dashboard
- "overall accuracy" → weighted avg from `brand_stats`

**Navigation**
- "go to settings / open history / show dashboard" → tab switch
- "show case study / brand guide" → open public pages

**Help / explainer**
- "how does email forwarding work" → inline FAQ
- "what is the flywheel" → contextual explanation

**Agentic (permission required)**
- "parse all pending emails" → list found, confirm each
- "export everything this month" → batch CSV, confirm before download
- "delete [brand] patterns" → destructive, explicit confirm

### Architecture
- **Layer 1 — Chat UI:** slide-out panel or floating bottom-right button,
  persistent across tabs. Supabase `chat_messages` table for history.
- **Layer 2 — Intent classifier:** every message → Lovable AI Gateway
  (default `google/gemini-3-flash-preview`) via edge function. System prompt
  contains: full intent list + action codes, current app state (active tab,
  last parsed brand, pending invoice count). Returns structured JSON via
  tool-calling: `{ intent, action, params, requires_permission, confirmation_message }`.
- **Layer 3 — Action executor:** client-side dispatcher mapping `action` →
  existing Sonic Invoices function. No new business logic; just wiring.
- **Layer 4 — Permission flow:** if `requires_permission` is true, render
  Confirm / Cancel pair inline in the chat. On confirm, run the action and
  post the result back into the thread.

### Build order (when picked up)
1. `chat_messages` table + RLS (user-scoped).
2. Edge function `chat-intent` calling AI Gateway with tool-calling schema.
3. Floating chat panel component, message list, input.
4. Action dispatcher + initial 5-10 intents (start with read-only / nav).
5. Permission UI for write actions; add agentic intents last.

### Open questions
- Persistent thread or per-session?
- Voice input later?
- Does the chat see the current screen's data context automatically, or
  only what the user types?

---

## Sonic Chat — Production System Prompt & Action Map (saved 2026-05-06)

Status: PLAN ONLY. Extends the "Agentic Chat Command Centre" plan above.

### Sprint plan
- **Sprint 1 — Chat shell:** floating teal speech-bubble button (bottom-right),
  380px slide-out panel, scrollable thread (alternating user/assistant
  bubbles), input + send. Supabase `chat_messages` table:
  `id, user_id, role, content, action_taken, action_data jsonb, created_at`.
- **Sprint 2 — Intent classification:** edge function calls Lovable AI Gateway
  (default `google/gemini-3-flash-preview`; user prompt referenced
  `claude-sonnet-4-20250514` — keep gateway path, model swap is config) with
  the system prompt below. Parse JSON, render `response_text`, log full JSON.
- **Sprint 3 — Action execution:** wire the 5 highest-value, lowest-risk
  actions first (navigate_tab, show_brand_accuracy, show_flywheel_summary,
  open_file_picker, show_last_invoice).
- **Sprint 4 — Permission flow + agentic actions:** confirm/cancel UI; then
  parse_pending_emails, export_batch_csv, delete_brand_patterns.

### System prompt (paste verbatim into the edge function)

```
You are Sonic — the AI assistant embedded inside Sonic Invoices, a Shopify
stock intake automation tool built for Australian independent retail. You are
not a general chatbot. You are a task executor. Your job is to understand what
the user wants, map it to an available action, and either do it or ask
permission first.

---

AVAILABLE ACTIONS (these are the only things you can do):

NAVIGATION
- navigate_tab | params: { tab: "home" | "history" | "flywheel" | "analytics" | "settings" } | requires_permission: false
- open_case_study | params: {} | requires_permission: false
- open_brand_guide | params: {} | requires_permission: false

INVOICE ACTIONS
- open_file_picker | params: { mode: "pdf" | "photo" | "excel" | "email" } | requires_permission: false
- show_last_invoice | params: {} | requires_permission: false
- export_csv | params: { invoice_id: string | "last" } | requires_permission: true
- open_correction_ui | params: { brand_name: string } | requires_permission: false

FLYWHEEL / BRAND INTELLIGENCE
- show_brand_accuracy | params: { brand_name: string } | requires_permission: false
- show_flywheel_summary | params: {} | requires_permission: false
- list_trained_brands | params: { min_accuracy?: number } | requires_permission: false
- delete_brand_patterns | params: { brand_name: string } | requires_permission: true

EMAIL INBOX
- scan_email_inbox | params: {} | requires_permission: false
- parse_pending_emails | params: { invoice_ids: string[] | "all" } | requires_permission: true

BATCH ACTIONS
- export_batch_csv | params: { period: "today" | "this_week" | "this_month" | "all" } | requires_permission: true

HELP / EXPLAINER
- explain | params: { topic: "flywheel" | "email_forwarding" | "formats" | "shopify_import" | "brand_guide" | "pricing" } | requires_permission: false
- none | params: {} | requires_permission: false

---

CURRENT APP STATE (injected at runtime):
- current_tab: {currentTab}
- last_parsed_brand: {lastParsedBrand}
- last_invoice_id: {lastInvoiceId}
- pending_email_count: {pendingEmailCount}
- total_brands_trained: {totalBrandsTrained}
- user_first_name: {userFirstName}

---

RESPONSE FORMAT: single valid JSON object, no prose, no markdown.

{
  "intent": "...",
  "action": "action_key",
  "params": {},
  "requires_permission": false,
  "confirmation_message": null,
  "response_text": "..."
}

When requires_permission is true, confirmation_message must be a complete
plain-English sentence describing exactly what Sonic will do. response_text
in that case is the question asking the user to confirm.
When action is "none", response_text is a short helpful reply or clarifier.

---

BEHAVIOUR RULES:
1. Always pick the most specific action available.
2. Never invent actions outside the list. If unsupported, action = "none"
   and explain honestly what Sonic can/can't do.
3. requires_permission MUST be true for: file exports, deletes, multi-invoice
   parses, anything sent outside the app.
4. Be brief. One or two sentences. No greetings, no filler.
5. If ambiguous, pick the safer option and ask one clarifying question.
6. Use last_parsed_brand / last_invoice_id to resolve pronouns ("it",
   "that invoice", "the last one").
7. For explain actions, give the answer inline in 2–4 sentences.
8. Tone: direct, helpful, capable colleague — not a companion.

EXAMPLES: (see chat history dated 2026-05-06 for full worked examples
including Seafolly accuracy, this-month export, delete Baku, explain
flywheel, hello, unsupported "order more stock".)
```

### Action-to-function map (`executeChatAction(action, params)`)

| action | implementation |
|---|---|
| `navigate_tab` | `setActiveTab(params.tab)` |
| `open_case_study` | `navigate('/case-study')` |
| `open_brand_guide` | `navigate('/brand-guide')` |
| `open_file_picker` | `setActiveFlow(params.mode)` |
| `show_last_invoice` | `setActiveTab('history')` + scroll to top row |
| `export_csv` | existing CSV download for `params.invoice_id` ("last" → use `lastInvoiceId`) |
| `open_correction_ui` | open correction modal filtered to `params.brand_name` |
| `show_brand_accuracy` | `setActiveTab('flywheel')` + filter table to `params.brand_name` |
| `show_flywheel_summary` | `setActiveTab('flywheel')` |
| `list_trained_brands` | render inline list from `brand_patterns` (optional `min_accuracy`) |
| `delete_brand_patterns` | DELETE on `brand_patterns` where `brand_name = params.brand_name` |
| `scan_email_inbox` | call existing `scan-gmail-inbox` edge function |
| `parse_pending_emails` | loop `parse-invoice` over `params.invoice_ids` (or all pending) |
| `export_batch_csv` | aggregate parses for `params.period` → single CSV download |
| `explain` | render `response_text` inline only |
| `none` | render `response_text` inline only |

### Permission UX pattern
When `requires_permission: true`, render below the assistant bubble:
`[ ✓ Yes, do it ]  [ Let me choose ]  [ Cancel ]`
- Confirm → run action, post result back into thread.
- Let me choose → expand checklist (used for `parse_pending_emails`).
- Cancel → assistant posts "Got it, cancelled."
