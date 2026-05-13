# AI Collection Automation Engine

Build an end-to-end engine that scans Shopify products, detects collection gaps using a decision tree, generates SEO content + blog drafts via AI, and pushes them as drafts to Shopify for human review.

Note on existing code: the project already has `collection-agent-orchestrator`, `collection-seo`, and `collection_workflows` / `collection_approval_queue` tables. This plan **extends** that foundation rather than duplicating it — new tables and functions are additive and reuse the existing AI gateway + Shopify auth helpers.

---

## 1. Database (new tables)

```sql
collection_suggestions(
  id, user_id, store_domain,
  collection_type,        -- brand | brand_category | type | niche | print | archive
  suggested_title, suggested_handle,
  rule_set jsonb,         -- Shopify smart-collection ruleSet
  product_count int, confidence_score numeric,
  sample_product_ids text[], sample_titles text[],
  seo_title, seo_description, description_html,
  status,                 -- pending | approved | rejected | published | content_generating
  shopify_collection_id, error_message,
  created_at, updated_at,
  unique(user_id, suggested_handle)
)

collection_blogs(
  id, suggestion_id fk, user_id,
  blog_type,              -- sizing | care | features | faq
  title, content_html,
  status, shopify_blog_id, shopify_article_id,
  created_at, updated_at
)

collection_scans(
  id, user_id, store_domain,
  triggered_by,           -- product_push | manual | cron
  products_scanned int, suggestions_created int,
  archive_candidates int, started_at, completed_at, error
)
```

RLS: each table scoped to `auth.uid() = user_id`. Standard `update_updated_at_column` triggers.

---

## 2. Edge functions

### `collection-intelligence`
Inputs: `{ user_id, triggered_by, store_domain? }`.

Steps:
1. Resolve Shopify creds from existing `shopify_stores` table.
2. Paginate `products.json` (GraphQL preferred) + `custom_collections` + `smart_collections`.
3. Run decision tree in TS:
   - vendor count ≥ 3 → brand collection candidate
   - vendor + product_type ≥ 5 → brand_category candidate
   - product_type ≥ 3 → type candidate
   - niche tag list (`tummy control, d-g, d-dd, mastectomy, chlorine resist, sun protection, eco, reduced-impact, high-waist, tie side bikini bottom, arriving-*`) ≥ 3 → niche candidate
   - print/colour signal (`Black, White, Navy, Floral, Animal, Leopard, Stripe, Tropical, Abstract, Snake, Zebra`) in title/variant ≥ 3 → print candidate
   - existing collection product_count = 0 → archive candidate
4. Compute `confidence_score` per spec (drop < 0.5).
5. Skip if `suggested_handle` already exists in `collection_suggestions` (any non-rejected status) or matches an existing Shopify handle.
6. Insert rows, write a `collection_scans` record.

Triggered by:
- Manual: client invoke from `/collections` Scan button.
- Product push: hook into existing Shopify push success path (single line `supabase.functions.invoke('collection-intelligence', { body: { triggered_by: 'product_push' }})`).
- Cron: pg_cron at `0 16 * * *` UTC (≈ 2 AM ACST).

### `collection-content-generator`
Inputs: `{ suggestion_id }`.

1. Load suggestion + sample products + related collections.
2. Use existing `_shared/ai-gateway.ts` with `google/gemini-2.5-pro` (Anthropic via existing `sonic-seo-writer` is also available; gateway preferred for fallback).
3. Optional competitor research: skip live web search in MVP (rate/cost). Use the prompt block from spec but mark search as "internal knowledge only" to keep deterministic. (We can wire `websearch` later.)
4. Prompt outputs JSON: `seo_title`, `seo_description`, `description_html`, `smart_collection_rules`, `blogs: [{type,title,content_html} x3]`.
5. Update suggestion row + insert 3 `collection_blogs` rows (status=pending).
6. Concurrency: in-process queue, max **5/min** — implement with a small token bucket using a `processed_at` row in a tiny `collection_content_throttle` table OR delay-then-process. Simplest: orchestrator function loops with `await sleep(12000)` between calls.

### `collection-publish`
Inputs: `{ suggestion_id }`.

1. Approve path: create Shopify smart collection via Admin GraphQL with generated rules, title, descriptionHtml, seo, `published: false`.
2. Store `shopify_collection_id`, set status=published.
3. Push approved blog drafts to Shopify Blog API as drafts.

---

## 3. Frontend

### New page `src/pages/Collections.tsx` route `/collections`
Three tabs (`Tabs` from shadcn):

**Tab 1 — Suggestions**
- Filter chips: All / Brand / Brand+Category / Type / Niche / Print / Archive
- Card grid: title, type badge, product count, confidence bar, 3 sample thumbnails
- Expand → SEO title, meta description, description HTML preview, rule preview
- Actions: Approve (calls `collection-publish`), Edit (inline), Reject (status=rejected)

**Tab 2 — Active collections**
- List Shopify collections + product counts; flag empty ones red
- "Regenerate SEO" + "Generate blogs" buttons per row

**Tab 3 — Blog drafts**
- List `collection_blogs` where status=pending; preview/edit/approve; bulk approve

### Dashboard scan button
Add card to `Dashboard` showing last scan + button → invoke `collection-intelligence` and toast results.

---

## 4. Initial Splash Swimwear run
After deploy, manually click Scan once. Expected output matches spec list (Seafolly subcollections, niche collections, print collections, archive flags). No special seeding code needed — the engine produces them.

---

## Technical details

- Reuse `_shared/ai-gateway.ts` (`callAI`, `getToolArgs`) with `google/gemini-2.5-pro` and Gemini Flash fallback.
- Reuse Shopify admin token resolution from existing `collection-agent-orchestrator` / `shopify-*` functions.
- Throttle: serial loop with 12s spacing for content generation triggered after batch approval. Single approve-one is unthrottled.
- Smart collection rule shapes:
  - brand: `[{column:'vendor', relation:'equals', condition:vendor}]`
  - brand_category: `[{vendor=...},{type=...}]` AND
  - type: `[{type=...}]`
  - niche: `[{tag=tagname}]`
  - print: `[{title contains 'Black'}]` etc.
- Niche tag matching is case-insensitive substring on normalized tag list.
- Print detection scans `product.title` + each `variant.title` lowercased.
- Confidence formula:
  - brand/type with N≥10 → 0.95
  - brand_category/niche with N≥5 → 0.8
  - print/niche with 3≤N<5 → 0.6
  - else dropped.
- Cron via `cron.schedule` + `net.http_post` per the schedule-jobs guidance, using the project anon key (inserted via `supabase--insert`, not migration, to keep user-specific data out of migrations).

## Files to create
- `supabase/migrations/<ts>_collection_engine.sql` — 3 tables + RLS + triggers.
- `supabase/functions/collection-intelligence/index.ts`
- `supabase/functions/collection-content-generator/index.ts`
- `supabase/functions/collection-publish/index.ts`
- `src/pages/Collections.tsx` + small components (`SuggestionCard`, `BlogDraftCard`).
- Add route in `src/App.tsx`, nav entry, dashboard scan widget.
- Hook one-line invoke into existing post-Shopify-push success path.

## Out of scope (MVP)
- Live competitor web scraping (deferred — can add via `websearch` later).
- Auto-publishing without human review (always drafts).
- Multi-store fanout (uses currently selected store only).

Confirm and I'll build it. Given the size I'll ship in two passes: (1) DB + intelligence function + Suggestions tab + scan button; (2) content generator + publish + blogs tab + active collections tab.
