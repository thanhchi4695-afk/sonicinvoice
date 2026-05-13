
# Universal SEO Collection Engine

Build the four-layer SEO content engine on top of the existing brand intelligence + collection suggester, plus a new "SEO" navigation section grouping all collection/SEO tools.

## 1. Navigation — new "SEO" section

Add a grouped **SEO** section to the sidebar/menu (`src/components/AppSidebar.tsx` or equivalent). Items:

- **Collections** (existing `/collections`)
- **Brand Intelligence** (existing `/brands`)
- **SEO Engine** (new `/seo-engine`) — dashboard for the four-layer engine
- **Keyword Library** (new `/seo-keywords`) — view/edit `seo_keyword_library`
- **Blog Plans** (new `/seo-blog-plans`) — pending content plans awaiting approval
- **Organic SEO** (existing `/seo-organic` if present, else link to topic-map flow)

Move the existing Collection / Brand tiles on HomeScreen into a single "SEO" tile that opens this section.

## 2. Database (one migration)

```text
seo_keyword_library
  vertical (FOOTWEAR | SWIMWEAR | CLOTHING | ACCESSORIES | LIFESTYLE)
  bucket   (high_volume | type_specific | local | brand_long_tail |
            occasion | material | colour | feature)
  keyword  text
  region   text default 'AU'
  city     text null
  search_intent text
  notes    text

collection_seo_outputs           -- one row per (suggestion_id)
  suggestion_id  fk -> collection_suggestions
  layer          1..4
  seo_title      text  (<=60)
  meta_description text (150..160 enforced in app)
  description_html text
  smart_rules_json jsonb         -- Shopify ruleSet
  rules_validated_count int      -- product hit count from preview
  rules_status   ok|empty|needs_review
  status         draft|approved|published
  refreshed_at   timestamptz
  expires_at     timestamptz     -- Layer 4 = +6 months

collection_blog_plans
  suggestion_id fk
  blog_index    int
  title         text
  target_keywords text[]
  sections      jsonb
  faq           jsonb            -- [{q,a}]
  status        plan|approved|generated
  generated_html text null

brand_intelligence
  + competitor_reference_styletread jsonb
```

Pre-seed `seo_keyword_library` with the FOOTWEAR + SWIMWEAR keyword sets from the brief (one INSERT per bucket).

RLS: same pattern as existing collection tables (admin/buyer write, all auth read).

## 3. Edge functions

### `seo-collection-engine` (new)
Input: `{ suggestion_id }` or `{ store_id, layer }`.
- Loads suggestion + brand_intelligence + matching keywords from `seo_keyword_library` (filtered by vertical + layer bucket).
- If footwear & layer 2: pulls `competitor_reference_styletread` block.
- Calls Lovable AI (`google/gemini-2.5-pro`, fallback `gemini-2.5-flash`) with a strict prompt enforcing the 5 outputs (title ≤60, meta 150-160, 200-280-word HTML with banned-phrases filter, smart rules JSON, blog plan + 6 FAQ).
- Validates: char counts, banned phrase scan, primary keyword in first 12 words, exactly 2 internal `<a href="/collections/...">` links.
- Calls `shopify-collection-rule-preview` to count matching products. If <3 → `rules_status='empty'`.
- Persists to `collection_seo_outputs` + `collection_blog_plans`.

### `seo-blog-writer` (new)
Input: `{ plan_id }`. Generates full blog HTML from an approved plan (Aussie spelling, banned-phrase filter, internal links). Writes back to `collection_blog_plans.generated_html`, status=`generated`.

### `brand-intelligence-crawler` (extend)
Add **Step 7B — Styletread reference** when `industry_vertical = 'FOOTWEAR'`:
- Web search `site:styletread.com.au {brand_name}`.
- If hit, fetch via Firecrawl `scrape` (markdown + metadata).
- Extract H1, meta description, sub-categories, brand copy → `competitor_reference_styletread`.

### `seo-quarterly-refresh` (new, cron-ready)
Daily scan: any `collection_seo_outputs.layer=4` with `refreshed_at < now()-6 months` → set `rules_status='needs_review'`, surface in UI.

## 4. Frontend

### `/seo-engine` page (new)
- Header with vertical tabs (All / Footwear / Swimwear / Clothing / Accessories).
- Table of suggestions × 4 layer columns; each cell shows status pill (draft/approved/published, char counts, rule hit count).
- Bulk action: "Generate SEO for selected" → calls `seo-collection-engine` per row (sequential 500 ms delay per memory rule).
- Row drawer: live preview of title (with character counter), meta (with 150–160 highlight), description HTML preview, smart rule JSON editor, blog plans list with "Generate full post" button.
- Kill switch reused from `app_settings.brand_intelligence_enabled`.

### `/seo-keywords` page (new)
- Filterable table of `seo_keyword_library` (by vertical/bucket/region).
- Add/edit/delete (admin only).

### `/seo-blog-plans` page (new)
- Pending plans grouped by collection.
- Approve → triggers `seo-blog-writer`.
- Preview generated HTML with copy-to-Shopify button.

### Wiring
- Update `collection-content-generator` to defer to `seo-collection-engine` when a suggestion has `industry_vertical` set (back-compat: keep old path for unverticalised stores).
- HomeScreen: replace separate brand/collection tiles with one **SEO** tile linking to `/seo-engine`.

## 5. Validation rules enforced in code (not just the prompt)

`supabase/functions/_shared/seo-validators.ts` (new):
- `assertTitleLen`, `assertMetaLen` (150–160 strict).
- `assertBannedPhrases` — wide range of, great selection, we have something for everyone, high quality, browse our collection.
- `assertKeywordInFirst12Words(html, keyword)`.
- `assertInternalLinks(html, count=2)`.
- `assertLocalSignal(text, city)` for Layer 3.

Engine retries the model up to 2× with the validator's error feedback before returning `status='draft'` with `validation_errors` field.

## 6. Out of scope this phase

- Auto-publishing collections to Shopify (separate future phase — UI gives "Copy/push" once user is ready).
- Multi-language SEO.
- Schema.org JSON-LD generation (will be follow-up).

## Build order

1. Migration + keyword seed.
2. `_shared/seo-validators.ts` + `seo-collection-engine`.
3. Crawler Step 7B (Styletread).
4. `/seo-engine`, `/seo-keywords`, `/seo-blog-plans` pages.
5. Sidebar SEO group + HomeScreen tile cleanup.
6. `seo-blog-writer` + approval flow.
7. `seo-quarterly-refresh` cron.

Reply **"go"** to start with steps 1–2 (migration + engine), or name specific phases to reorder.
