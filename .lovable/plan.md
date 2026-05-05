# Sola Strategy for Collections — Composable Agent Pipeline

Status: PLAN ONLY — not yet implemented. User will send the build prompt later.

## Vision
Turn the Collection Builder from a one-off tool into a continuously running,
composable agent pipeline (Sola-style):
1. Every trigger creates a workflow (not just a button click).
2. Every decision is logged with reasoning (auditable).
3. Workflows adapt when stock changes (self-healing).
4. Human approval gates are first-class.
5. The system learns from every correction.

## Workflows to Build

### W1 — Invoice Arrival → Auto-Create Collections
- Trigger: invoice processed successfully (existing watchdog).
- Diff against `collection_memory` to find new brands / style lines.
- Propose new brand-story / sub-category collections.
- Send approval (email + Slack): "Walnut Marrakesh — create collection?"
- On approve → create in Shopify; on deny → log + never re-ask for that style.

### W2 — Weekly Collection Health Check
- Trigger: Supabase pg_cron, Mondays 08:00 Darwin.
- Scan all Shopify collections; flag:
  - 0-product collections (sold out / season ended)
  - +10 product growth (suggest splitting)
  - Missing SEO description
- Email Lisa a weekly digest: Needs Attention / New Opportunities / Top Performers.

### W3 — Stock Change → Membership Update
- Trigger: inventory drop to 0 (existing adjust-inventory hook).
- Sold-out product → drop from "New Arrivals", remove `new` tag.
- Whole style line empty → archive the collection (hide, don't delete).
- Stock replenished from new invoice → restore archived collections, refresh New Arrivals tag rules.

### W4 — Auto-SEO for New Collections
- Trigger: new Shopify collection with empty body_html.
- Read smart rule → fetch 5 sample products from `product_catalog_cache`.
- Claude generates 250–350 word body, internal links, meta title ≤65, meta desc ≤155.
- Push via `update_collection_seo`; log to new `seo_generation_log` table.
- Promotes existing CollectionSEOFlow from manual → automatic.

### W5 — Seasonal Collection Lifecycle
- **Start (Oct / Apr):** create "Summer 25/26 Arrivals" with `tag = Summer 25/26`, generate SEO, publish.
- **Mid-season (+45d):** detect low sales velocity → feed `lifecycleEngine.ts`, propose markdown ladder, suggest move to Sale collection.
- **End-of-season (+90d):** archive seasonal collection, create Clearance collection, tag remaining stock `clearance`.

### W6 — Performance Monitoring + Auto-Optimise
- Trigger: weekly (after GA refresh).
- Read collection pageview data (GA API or Shopify Analytics).
- High views + low CTR → regenerate SEO with new keyword angle.
- 0 views → check sitemap inclusion, add internal links from related pages.
- Report: "3 collections got 0 visits this week."

## Architecture Notes (reuse existing scaffolding)
- Reuse the existing 5-step agent orchestrator (retry + step tracking) used by invoice processing.
- New tables likely needed:
  - `collection_workflow_runs` (run id, workflow_id, trigger, status, steps[], started_at, finished_at)
  - `collection_workflow_decisions` (run_id, decision, rationale, approved_by, approved_at)
  - `seo_generation_log`
  - `collection_archive_log` (handle, archived_at, reason, restored_at)
- New edge functions:
  - `collections-workflow-w1-invoice-arrival`
  - `collections-workflow-w2-weekly-health` (pg_cron)
  - `collections-workflow-w3-stock-change`
  - `collections-workflow-w4-auto-seo`
  - `collections-workflow-w5-seasonal-lifecycle` (pg_cron daily)
  - `collections-workflow-w6-performance` (pg_cron weekly)
- Approval surface: reuse Slack + email infra; add an in-app "Workflow inbox" UI.

## Open Questions for the User (when build starts)
1. Approval channel preference: Slack only, email only, or both?
2. Season start dates — fixed (Oct 1 / Apr 1) or configurable per store?
3. GA connector vs Shopify Analytics for W6?
4. Should W3 auto-archive immediately, or always require approval first?
5. Auto-publish W4 SEO content, or send to draft for review?

## Build Order (recommended)
1. Workflow run/decision tables + base orchestrator wrapper.
2. W4 (Auto-SEO) — highest immediate value, lowest blast radius.
3. W1 (Invoice → collections) — extends existing decomposer.
4. W3 (Stock-driven membership) — builds on inventory hooks.
5. W2 (Weekly health digest).
6. W5 (Seasonal lifecycle).
7. W6 (Performance + auto-optimise) — needs analytics data source.
