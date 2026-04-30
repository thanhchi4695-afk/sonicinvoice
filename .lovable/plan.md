# Competitive Pricing Engine — Lifecycle-Aware AI Markdown System

> **Status:** Planning only. Do **NOT** implement until the user explicitly says "implement the pricing engine plan."
> **Scope:** Sonic Invoices / Shopify app — fast-fashion merchants.
> **Goal:** Replace one-size-fits-all markdowns with a lifecycle-aware, competitor-informed, margin-protected pricing engine.

---

## 1. Problem Statement

Reactive, manual markdowns erode margin on items that could have sold higher and arrive too late on items already obsolete. The engine must:

- Balance **sell-through** vs **margin protection**.
- React to **inventory age**, **velocity**, **unit economics**, and **competitor prices**.
- Stay **merchant-supervised** at MVP (recommend, don't auto-apply).

---

## 2. Strategic Logic Framework

### 2.1 Data Foundation

**Internal (Shopify):**
- Inventory age (days on hand) — fast-fashion buckets: 0–14, 15–30, 31–45, 46–60, 60+.
- Velocity (units sold / week) and sudden velocity drops.
- Unit cost & current gross margin → enforce floor price.
- Sell-through % per variant.

**External (Competitors):**
- Source: Brave Search API (already configured) + existing `competitor-price-fetch` / `price-intelligence` edge functions and Chrome extension Zap button (see [chrome-extension-price-check](mem://integrations/chrome-extension-price-check)).
- Matching: SKU first → keyword + colour + material → image hashing fallback.
- Cache competitor prices in Supabase with TTL (suggest 24h).

### 2.2 Lifecycle Model (5 Phases)

| Phase | Trigger | Allowed Action | Shopify API |
|-------|---------|----------------|-------------|
| **1. Launch** | <14 days OR <20% sold | Alert only if competitor >15% lower | None |
| **2. First Mark** | 15–30 days OR 20–40% sold | 5–10% discount | `productVariantsBulkUpdate` (set `compareAtPrice` + `price`) |
| **3. Performance Check** | 31–45 days OR 40–60% sold | Hold + monitor; branch to 4 if slow | None |
| **4. Clearance Push** | 46–60 days OR <60% sold | 30–60% discount, competitor-aware | `productVariantsBulkUpdate` |
| **5. The Cleanse** | 60+ days | 70%+ "last chance" + destock/donate flag | Final heavy discount |

### 2.3 Recommendation Score

```
Discount_Score = (Lifecycle_Factor × 0.4)
               + (Competitor_Price_Gap × 0.3)
               + (Stock_Velocity_Factor × 0.2)
               + (Margin_Floor_Check × 0.1)
```

- **Margin Floor (hard rule):** never below `unit_cost × 1.05`.

---

## 3. Implementation Roadmap

### Phase 1 — MVP "Discount Assistant" (Recommend, don't apply)

**Goal:** merchant clicks "Get Pricing Recommendation" → modal explains analysis → merchant accepts / rejects / edits → audit log. Builds trust and gathers training data.

### Phase 2 — Technical Building Blocks

#### Component 1 — Competitor Scraper
- **File:** `src/lib/pricing/competitorScraper.ts`
- Input: `{ title, brand, sku }` + competitor URL (or domain list).
- Brave Search → scrape product page → return `{ name, price, currency }` or `null`.
- Reuses existing `competitor-price-fetch` edge function where possible.
- Robust handling of timeouts, 404s, and rate limits.

#### Component 2 — Lifecycle & Scoring Engine
- **File:** `src/lib/pricing/lifecycleEngine.ts`
- Pure function `analyzeProduct(input: ProductAnalysisInput): ProductAnalysisOutput`.
- No side effects → unit-testable with Vitest.
- Returns `{ phase, recommendedDiscountPct, recommendationAction, reason }`.

#### Component 3 — Discount Manager (Shopify Sync)
- **File:** `src/lib/shopify/priceManager.ts`
- `applyDiscount(variantId, discountPct)` → fetch current price → set `compareAtPrice` + `price` via GraphQL `productVariantsBulkUpdate`.
- Sequential 500ms delay (per [Shopify API concurrency](mem://tech-stack/shopify-api-concurrency) memory).
- Rollback on API failure.

### Phase 3 — Scheduling & Automation (post-MVP)
- Daily cron at 5:00 AM UTC (align with [markdown ladder](mem://features/markdown-ladder-automation) and [sales velocity automation](mem://features/sales-velocity-automation)).
- Background re-evaluation of all variants in Phases 2–5.

---

## 4. System Guardrails

- **Floor price:** `unit_cost × 1.05` (covers transaction fees) — non-negotiable, coded in `lifecycleEngine.ts`.
- **Schedule blackouts:** respect `no_discount_start_date` / `no_discount_end_date` metafields.
- **Confidence gating:** reuse [confidence export gate](mem://constraints/confidence-export-gate) — HIGH auto-apply (post-MVP only), MEDIUM requires confirm.
- **Margin protection:** integrate with existing [margin protection engine](mem://features/margin-protection-engine).
- **Audit log:** every recommendation, acceptance, rejection, override (reuse [audit log](mem://features/audit-log)).

---

## 5. Recommended Expansions (Agent Suggestions)

### 5a — High value, low effort
1. **Recommendation feedback loop** — capture accept / reject / edit per recommendation. After ~500 events, retrain weights of the scoring formula per merchant (industry-aware).
2. **"What-if" simulator** — slider in the modal: "If I discount 25%, projected sell-through in 7 days = X units, projected margin = $Y." Powered by historical velocity.
3. **Bundle / multi-buy suggestions** — for Phase 4–5 items, suggest "Buy 2 get 1 free" instead of straight discount when margin floor would be breached.
4. **Size-curve awareness** — only discount the *slow sizes* in a style (often only XS / XXL are stuck), not the whole variant group. Aligns with existing [variant grouping logic](mem://features/variant-grouping-logic).
5. **Channel-specific pricing** — different recommendation for online vs in-store (POS) — reuse [POS unified sync](mem://integrations/pos-unified-sync).

### 5b — Strategic moats
6. **Competitor price drift alerts** — push notification when a tracked competitor changes price >10%, even when your own product isn't due for review.
7. **Seasonal decay model** — swimwear in October is worth less than swimwear in March. Add a `seasonality_curve` per product type (industry profile aware — see [industry profile settings](mem://features/industry-profile-settings)).
8. **Cross-store price intelligence** (privacy-preserving) — anonymously aggregate price + sell-through across all Sonic Invoices merchants in the same industry profile to benchmark "is your price competitive for this brand in AU swimwear?"
9. **Restock vs discount decision** — engine occasionally recommends *restocking* a high-velocity item instead of discounting (replaces a markdown decision with a buy decision). Connects to [restock suggestions](mem://features/inventory-forecasting-formulas).
10. **Markdown calendar export** — generate a forward-looking calendar (next 30/60/90 days) of expected markdowns, exportable as CSV for finance / cash-flow planning.

### 5c — Trust & governance
11. **Dry-run mode** — simulate one full lifecycle pass and produce a report ("If you'd run this engine for the last 90 days, projected revenue +$X, margin +Y%") before any merchant turns it on.
12. **Approval workflows** — Buyer recommends → Admin approves bulk markdowns >25% (reuse [role-based access control](mem://features/role-based-access-control)).
13. **Slack / email digest** — daily summary of pending recommendations (Slack via existing `slack-approval` edge function).
14. **Reversal window** — every applied discount stays reversible for 24h with one click (stores previous price in metafield).

---

## 6. Data Model Sketch (for later)

New tables (Lovable Cloud):
- `pricing_recommendations` — one row per generated recommendation (variant_id, phase, discount_pct, score, reasons, status, created_at).
- `pricing_actions` — applied / rejected events (links to recommendation, merchant_user_id, applied_price, previous_price, rolled_back_at).
- `competitor_price_cache` — (sku|matched_key, competitor_domain, price, currency, fetched_at, ttl_expires_at).
- `pricing_settings` — per-merchant overrides (floor_multiplier, phase thresholds, blackout dates, channel rules).

All with RLS scoped to `user_id`, following the [Security hardening](mem://tech-stack/security-hardening) patterns.

---

## 7. Open Questions for the User (answer before implementation)

1. **Scope of MVP** — Discount Assistant only, or also include automated cron from day one (gated by confidence)?
2. **Competitor sources** — start with merchant-supplied URLs, or auto-discover via Brave Search across the brand's known competitor list?
3. **Industry coverage at launch** — swimwear / fashion only, or activewear, footwear, accessories too? Affects seasonality curves.
4. **Where to surface in UI** — new top-level "Pricing" tab, or inside existing Inventory / Tools area?
5. **Auto-apply threshold** — is there ever a case where merchant wants fully automatic markdowns (e.g. Phase 5 only, capped at X% of catalogue/day)?

---

## 8. Reference Memories

- [Margin protection engine](mem://features/margin-protection-engine)
- [Markdown ladder automation](mem://features/markdown-ladder-automation)
- [Sales velocity automation](mem://features/sales-velocity-automation)
- [Competitor price intelligence](mem://features/competitor-price-intelligence)
- [Chrome extension price check](mem://integrations/chrome-extension-price-check)
- [Shopify API concurrency](mem://tech-stack/shopify-api-concurrency)
- [Variant grouping logic](mem://features/variant-grouping-logic)
- [Inventory forecasting formulas](mem://features/inventory-forecasting-formulas)
- [Confidence export gate](mem://constraints/confidence-export-gate)
- [Audit log](mem://features/audit-log)
