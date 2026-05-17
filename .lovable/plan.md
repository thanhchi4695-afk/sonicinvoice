## Brand Intelligence Crawler — Completion Plan

Four sections, executed in order. Each section is independently shippable.

---

### Section 1 — Schema additions (migration, one-time)

Add to `public.brand_intelligence`:

- `priority smallint` — 1, 2, or NULL (custom brands)
- `needs_manual_review boolean default false`
- `size_range text`
- `key_fabric_technologies jsonb` (string[])
- `price_range_aud jsonb` (`{ min, max }`)
- `collections_created integer default 0` — counter, populated by collection engine
- Allowed `crawl_status` values: `not_crawled | crawling | completed | failed` (replacing `'crawled'` with `'completed'` per spec)

One-time data migration: `UPDATE brand_intelligence SET crawl_status='completed' WHERE crawl_status='crawled'`.

---

### Section 2 — Crawler edge function rewrite (`brand-intelligence-crawler/index.ts`)

Per brand:

1. Firecrawl `POST /v2/scrape` on homepage (`markdown`, `onlyMainContent: true`)
2. Discover and scrape, max **10 pages total**, 500ms between fetches:
   - `/collections` (and 1st 3 collection links from homepage)
   - `/blogs` or `/blog` (and 1st 2 article links)
   - `/about`
3. Concatenate markdown → single Gemini 2.5 Pro extraction call via Lovable AI Gateway (matches existing AI Gateway pattern in this repo; Anthropic isn't currently wired into the gateway here).
4. Extraction JSON schema exactly per spec: `category_vocabulary`, `collection_structure_type`, `brand_tone_sample`, `detected_print_story_names`, `detected_blog_topics`, `seo_keywords_detected`, `size_range`, `key_fabric_technologies`, `price_range_aud`.
5. Confidence scoring exactly per spec (0.3 / 0.2 / 0.2 / 0.2 / 0.1 = 1.0).
6. Upsert with `crawl_status='completed'`, `last_crawled_at=now()`, `needs_manual_review = (confidence < 0.6)`. On thrown error → `crawl_status='failed'`, `crawl_error=msg`.
7. `console.log('[firecrawl-credits]', pages_fetched)` for budget tracking.

Existing ICONIC / White Fox / Styletread reference scraping stays (separate edge functions, untouched).

---

### Section 3 — Seed 13 Splash brands

Approach: **per-user, automatic on first `/brands` visit** (not a global DB seed — RLS requires `user_id`).

On `/brands` mount, if the signed-in user has fewer than the 13 Splash brands by name, insert any missing ones with `crawl_status='not_crawled'` and the specified priority. The existing `PRIORITY_BRANDS` constant already has the right list; we just auto-run it instead of waiting for per-brand click.

---

### Section 4 — `/brands` UI updates

Column order: **Brand | Domain | Vertical | Status | Confidence | Collections | Last crawled | Actions**

Status badges: `Not crawled` (grey) · `Crawling…` (amber + spinner) · `Completed (85%)` (green w/ score) · `Failed` (red + retry) · `Needs review` (orange when `needs_manual_review=true`).

Actions per row: **Crawl now**, **View profile**, **Mark verified** toggle.

Top of page: **Crawl all Priority 1** (skips already-completed) + **Crawl all** (confirm dialog quoting ~credit cost). Sequential, 1.5s between brands. Global progress bar with last-3-completed checkmarks.

Side drawer (View profile):
- Category vocab table (their_name → sonic_equivalent)
- Collection structure type + plain-English explanation
- Brand tone in a quote block
- Print story names / blog topics / SEO keywords as pill tags
- **Confidence breakdown** — list all 5 components with ✓/✗
- Size range, fabric techs, price range AUD
- Re-crawl / Edit manually / Mark verified

Edit-manually mode: each field becomes an editable input; Save writes directly to `brand_intelligence`.

---

### Section 5 — Wire into generation engines

- **`collection-intelligence`** edge function: fetch `brand_intelligence` row by brand name, inject prompt block (collection structure / their vocab / detected prints / tone) into the suggestion prompt.
- **`seo-collection-engine`** edge function: inject `brand_tone_sample` + `seo_keywords_detected` into the SEO content generation prompt.

Both are read-only injections — they degrade gracefully if no row exists.

---

### Verification step

After deploy, I'll invoke the crawler for **Sea Level (sealevelswim.com.au)** via `curl_edge_functions`, paste the raw extracted JSON + computed confidence score, and confirm the row visible on `/brands`.

---

### Decisions I'm locking in (flag if any are wrong)

1. **LLM:** Gemini 2.5 Pro via Lovable AI Gateway, not Anthropic Haiku. Matches every other extractor in this repo and the project memory rule. Output schema is identical.
2. **Pre-seed:** per-user on `/brands` mount, not a global DB INSERT. `brand_intelligence` rows are scoped by `user_id` (RLS) so there is no other valid path.
3. **Status rename:** `'crawled'` → `'completed'` everywhere (1 existing row updated by migration; UI badge wording switches too).
4. **Auto pre-seed** does **not** auto-crawl — user still clicks **Crawl all Priority 1**.

Reply "go" and I'll execute sections 1 → 5 then run the Sea Level verification. Reply with edits if any of the four locked decisions need to change.