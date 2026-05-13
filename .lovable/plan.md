# THE ICONIC SEO Architecture — Upgrade Plan

Upgrades the existing Universal SEO Collection Engine to mirror THE ICONIC's URL taxonomy, 5-part description formula, brand-page formula, FAQ blocks, internal link mesh, keyword tiers, competitor reference, and completeness scoring.

Built in 4 deployable phases so we can verify each before stacking the next.

---

## Phase A — Schema + taxonomy + keyword tiers

One migration adds the structural pieces THE ICONIC's model needs:

- `collection_suggestions.shopify_handle` (text) — handle Sonic will push to Shopify, validated unique per `user_id`.
- `collection_suggestions.taxonomy_level` (smallint 2–6) — drives prompt formula selection.
- `collection_suggestions.completeness_score` (smallint 0–100) + `completeness_breakdown` (jsonb) — populated by a trigger on every related write.
- `collection_seo_outputs.faq_html` (text) — rendered FAQ block (4–6 Q/A).
- `collection_seo_outputs.formula_parts` (jsonb) — stores the 5 description parts separately so we can re-stitch and re-link later without regenerating the model output.
- `brand_intelligence.iconic_reference` (jsonb) — H1, opening paragraph, sub-collection links, FAQ, top phrases scraped from `theiconic.com.au/{handle}/`.
- New table `collection_link_mesh` (`source_collection_id`, `target_collection_id`, `link_type` enum sibling/parent/child/occasion/material, `anchor_text`) with RLS scoped to `user_id`.
- New table `seo_keyword_tiers` (`tier` 1-5, `vertical`, `keyword`, `region`, `placement_hint`) — pre-seeded with the Tier 1–5 list from the spec for FOOTWEAR (Stomp) and SWIMWEAR (Splash).
- Seed-only insert (via insert tool, not migration) of the keyword tier list and the priority taxonomy rows for Stomp + Splash so the engine has something to plan against on day 1.

## Phase B — Engine rewrite (`seo-collection-engine` v2)

Replace the current single-shot prompt with a deterministic pipeline:

1. **Resolve taxonomy_level** from `collection_type` and handle pattern (Level 2 broad / 3 type / 4 sub-type / 5 brand or brand+cat / 6 occasion).
2. **Pick keyword tiers by level** per Part 6's mapping (Tier 1→title only, Tier 2→H1+opener, Tier 3→brand opener, Tier 4→Part 4+CTA, Tier 5→Part 2+FAQ).
3. **Pull link mesh** rows (3–5) per Rules 1–5 in Part 5.
4. **Pull `iconic_reference`** when level ≥ 5 brand pages.
5. **Single Gemini 2.5 Pro call** asking for the 5 parts + 4–6 FAQ entries as separate JSON keys (not one HTML blob), plus brand-page variant when `taxonomy_level = 5`.
6. **Validators** (extend `_shared/seo-validators.ts`):
   - 200+ word body, 5 distinct part keys present, 3–5 internal links resolve to real handles,
   - FAQ has 4–6 entries, each answer 30–80 words,
   - banned phrases, local signal, keyword-in-first-12-words rules retained,
   - brand-page variant must mention founding year + ≥2 sub-collection links.
7. **Stitch** parts → `description_html` and FAQ → `faq_html` server-side; persist parts in `formula_parts` for reassembly.

## Phase C — Link mesh + FAQ + ICONIC crawler

- `seo-link-mesh-builder` edge function — given a `user_id`, recomputes `collection_link_mesh` from the user's `collection_suggestions` by applying Rules 1–5. Idempotent; safe to re-run after each new collection.
- Extend `brand-intelligence-crawler` Step 7B → 7C: also fetch `https://www.theiconic.com.au/{slug}/` for FOOTWEAR brands using Firecrawl (`formats: ['markdown','links']`), extract H1, first 2 sentences, sub-collection links containing the brand slug, any Q/A pairs in markdown, and the top 10 phrases by frequency. Store in `brand_intelligence.iconic_reference`.
- `seo-collection-engine` writes FAQ to `faq_html` and (best-effort) pushes to Shopify as a metafield `seo.faq_content` via existing `getValidShopifyToken` + `metafieldsSet` mutation. Failure to push does not block local save.

## Phase D — Completeness scoring + admin UX

- DB trigger on `collection_seo_outputs` and `collection_blog_plans` recomputes `collection_suggestions.completeness_score` using the 7-element rubric from Part 8.
- `/seo-engine` page gains:
  - taxonomy_level column,
  - completeness badge (red/amber/green) per row,
  - "Complete SEO" button per row that, for any score < 80, runs `seo-collection-engine` and `seo-rules-validator` in sequence to fill missing parts,
  - filter chips: All / Incomplete / Partial / Complete.
- New `/seo-link-mesh` page lists each collection with its outbound + inbound links and a "Rebuild mesh" button calling `seo-link-mesh-builder`.

## Out of scope this round

- Auto-creating Shopify collections from the taxonomy (Sonic will still suggest — push-to-Shopify stays a separate confirm step).
- Multi-language / hreflang.
- Automated detection of new ICONIC URL slugs we haven't pre-mapped.

## Build order

1. Phase A migration → seed keyword tiers + Stomp/Splash priority taxonomy.
2. Phase B engine rewrite + validators (deploy + smoke test on one row).
3. Phase C mesh builder + crawler upgrade (deploy + run once for Stomp).
4. Phase D scoring trigger + UI updates.

Reply **go** to start Phase A, or name a different starting phase.
