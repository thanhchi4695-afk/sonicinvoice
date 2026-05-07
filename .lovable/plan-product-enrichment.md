# Product Enrichment Pipeline — Architecture Plan

## Core Insight

80% of the infrastructure already exists. This is an **orchestration problem**, not a new-build problem.

Existing pieces we wire together:
- `product-extract` edge function — 3-tier scrape cascade (JSON-LD → DOM selectors → LLM fallback)
- `image-pipeline` — downloads, resizes to WebP, uploads to `compressed-images` bucket
- `shopify-import` — pushes products back via Admin API at 2 req/s
- `brand-directory` — supplier websites for major AU fashion brands (Seafolly, Baku, Jantzen, Sunseeker, Sea Level, Bond Eye)
- `ProductHealthPanel` — already scores product completeness

Missing piece: **the orchestrator + scheduled retry loop**.

---

## Stage 1 — Shopify Gap Scanner

Pull all active products via Shopify Admin API. Classify as **incomplete** if:
- `images` array is empty, OR
- `body_html` is null/empty/under 50 chars (catches "TBA" / single-sentence placeholders)

Group by vendor for at-a-glance reporting: *"Seafolly: 12 products missing descriptions."*

**The "added before supplier released" case** — scanner must remember prior failures. Solved by `product_enrichment_queue` table (below) with `not_found` status + weekly retry.

---

## Stage 2 — Brand URL Matching

Look up Shopify `vendor` field in `brand-directory`. Fuzzy match handles:
- "Sea Level Swim" → "Sea Level"
- "Skye Group Pty Ltd" → "Jantzen"

For unknown brands, post chat notification once: *"3 products from Walnut Melbourne have no supplier URL — want to add it?"* Retailer pastes URL once, all future products from that brand auto-enrich.

---

## Stage 3 — Supplier Website Scraping

`product-extract` accepts a full URL. Here we have only SKU + brand site, so we need a **search step first**.

**New edge function: `find-product-url`**

Input: `{ brand_website, style_number | product_name }`
Output: `{ url: string | null, confidence: 'high' | 'low' | 'not_found' }`

Cascade:
1. `https://{brand_website}/search?q={style_number}` — parse first product result from HTML
2. `https://{brand_website}/products/{slugified_name}` — direct guess
3. Brave Search: `site:{brand_website} {style_number}` — first result

If all three fail → mark `not_found`, queue for weekly retry.

---

## Stage 4 — AI Enrichment

Claude Haiku writes:
- **Description** — uses scraped content + brand voice from `brand-directory` + store style (Splash Swimwear: premium, aspirational, beachy — never generic corporate)
- **SEO title** — existing pattern from KB3
- **Image alt text** — `Brand StyleName Colour — Splash Swimwear`

Most valuable for the "released before supplier" case: when supplier finally publishes, scraped content is the **definitive source** (official features, fabric, care). AI rewrite makes it store-appropriate vs B2B language.

---

## Stage 5 — Permission Queue + Weekly Review

All enriched products → `product_enrichment_queue` with `pending_review`.

Monday morning, proactive brain posts:
> "Weekend scan complete. 14 products now have images and descriptions ready to review — 8 Seafolly, 4 Baku, 2 Jantzen. 3 products from Walnut Melbourne weren't found on the supplier site yet (will retry next week). Want to review what's ready?"

**Review UI**: before/after cards (current blank state on left, proposed image+description on right). Approve / Edit / Skip per product. Bulk approve for trusted brands.

---

## The Retry Loop — "Not Released Yet" Handling

This is the highest-value, hardest-to-get-right part.

1. Every unfindable product → `status='not_found', retry_count=0, last_attempted=now()`
2. Weekly cron re-attempts, increments `retry_count`
3. After **8 failed retries (~2 months)** → flag for manual attention, stop wasting scrape budget
4. **When a retry succeeds** → specific chat ping:
   > "Seafolly style 205435 is now live on their site — I've pulled the images and description. Want to approve them now?"

That last notification is the magic moment.

---

## New Database Table

```sql
CREATE TABLE product_enrichment_queue (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES auth.users(id),
  shopify_product_id  TEXT NOT NULL,
  shopify_handle      TEXT NOT NULL,
  vendor              TEXT,
  style_number        TEXT,
  product_title       TEXT,
  supplier_url        TEXT,
  product_page_url    TEXT,
  status              TEXT DEFAULT 'pending',
  -- pending | scraping | not_found | enriched | pending_review
  -- approved | pushed | skipped | failed
  scraped_images      JSONB DEFAULT '[]',
  scraped_description TEXT,
  ai_description      TEXT,
  ai_seo_title        TEXT,
  ai_seo_description  TEXT,
  image_alt_text      TEXT,
  retry_count         INT DEFAULT 0,
  last_attempted      TIMESTAMPTZ,
  approved_at         TIMESTAMPTZ,
  pushed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);
```

RLS: user can only see/modify own rows. Indexes on `(user_id, status)` and `(user_id, last_attempted)`.

---

## Build Order — 3 Sprints

| Sprint | Build | Key new piece |
|--------|-------|---------------|
| 1 | `product_enrichment_queue` table + `find-product-url` edge function + weekly `pg_cron` | Gap scanner + URL finder |
| 2 | Orchestrator edge function: gap scan → brand match → find-product-url → product-extract → AI enrichment → queue | Pipeline runner |
| 3 | Review UI (before/after cards, approve/edit/skip) + proactive chat notification + Shopify push | Retailer-facing layer |

**Sprint 1 risk**: `find-product-url` depends on how supplier sites structure their search. **Test against Seafolly first** — clean URL patterns (`seafolly.com.au/products/style-name`). Baku and Jantzen have different structures — defer to Sprint 2 after happy path works.
