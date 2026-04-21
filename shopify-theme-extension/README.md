# Sonic Invoices — Theme App Extension

This is a minimal Shopify Theme App Extension. Sonic Invoices is primarily an
**admin back-office tool** (invoices → products, inventory, SEO), so this
extension adds a single optional storefront block merchants can drop onto a
product page to display a "Verified by Sonic Invoices" trust badge backed by
the product's invoice provenance.

## Why this exists

The Shopify App Store automated review checks for a Theme App Extension when
the app touches the storefront. Including this lightweight extension satisfies
the requirement and gives merchants an opt-in storefront surface.

## Files

- `shopify.extension.toml` — extension manifest
- `blocks/sonic_badge.liquid` — the app block merchants can add to any section

## Deploying

From your Shopify CLI workspace:

```
shopify app deploy
```

The extension is registered against client_id `aebbc68f4f67197beb20489d6d2987e4`
(see `shopify.app.toml`).
