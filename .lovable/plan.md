# URL Product Extractor Agent — Active Plan

**Goal:** User pastes a product URL → agent returns `{ name, description, price, currency, normalizedPrice, images[] }` ready for the Shopify pipeline.

## Locked extraction cascade (escalate only on failure)
| Step | Method | Coverage | When |
|---|---|---|---|
| 1 | JSON-LD / microdata Product schema | ~15% | Sites with rich snippets |
| 2 | Universal DOM selectors (Cheerio + og:*) | ~30–40% | Shopify / WooCommerce |
| 3 | LLM raw HTML → tool-call JSON | ~80% | Most remaining sites |
| 4 | Playwright + LLM | ~90–95% | JS-heavy / blocked |
| 5 | 3rd-party API (Apify / ScrapingBee) | ~99% | Last resort |

## File structure (locked)
```
src/lib/product-extract/
  extract-product.ts      ← orchestrator
  jsonld-parser.ts
  dom-selectors.ts
  llm-extractor.ts
  image-downloader.ts
  currency-detector.ts
supabase/functions/product-enrich/index.ts
```

## Images
- Priority: `og:image` → near price → product container → gallery
- Stream via Sharp (resize, WebP) → existing `compressed-images` bucket, no disk
- Validate `content-type` is image/*; kill-switch >10MB total

## Currency
- Regex + `currency-symbol-map` → ISO; cross-check `<html lang>`
- Always store `originalPrice` + `originalCurrency`
- Frankfurter API for optional display conversion
- Unknown currency → `warnings[]`, never silent default

## Controls
- Per-user rate limit in edge function
- All 3rd-party API keys live in edge env only
- Log every attempt to processing history (URL, strategy, ms, image count, currency)

## UI entry points
- "Fetch from URL" button in `InvoiceFlow` and `QuickCapture`
- Reuse `LinePipelineProgress` to visualise the 5-step cascade

## Roadmap (do not reorder)
1. Orchestrator + strategies 1–3
2. Image downloader (Sharp + storage)
3. Currency detector + normalisation
4. UI "Fetch from URL" buttons
5. Edge function deploy + test 10–20 real pages
6. Rate limiting / budget caps
7. (Later) Strategy 4 Playwright + Strategy 5 3rd-party APIs

## Plan-adherence rules for future prompts
- Reject any change that adds a new extraction step outside the 5-tier cascade.
- Reject any prompt that asks to call AI providers directly from the client — must go through `product-enrich`.
- Reject any plan to bypass JSON-LD/selectors and jump straight to LLM (cost discipline).
- Reject any new image storage bucket — reuse `compressed-images`.
- Reject any silent currency default — must surface `warnings[]`.
