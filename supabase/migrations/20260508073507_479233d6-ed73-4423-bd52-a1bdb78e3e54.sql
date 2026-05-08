INSERT INTO public.brand_profiles (
  supplier_key, supplier_name, supplier_legal, shopify_vendor,
  confidence, invoices_processed, gst_inclusive_pricing, rrp_on_invoice,
  notes, created_at, updated_at
) VALUES
('foil','Foil','Longbeach Apparel Australia Pty Ltd','Foil',80,1,FALSE,TRUE,
  'NZ-based supplier (Christchurch) with AU ABN. SKU pattern CF##### (5 digits). Type C size matrix with TWO grids (letter sizes 2XS-3XL and AU numeric 6-24). RRP embedded at end of description text (e.g. "SHEER FUN SHELL TOP 109.95") - extract trailing dollar amount as RRP and strip from style name. Always use Foil as Shopify Vendor, not Longbeach Apparel.',
  NOW(),NOW()),
('adorne','Adorne','Adorne','Adorne',80,1,TRUE,TRUE,
  'CRITICAL: Sub Total is TAX-INCLUSIVE (unusual for AU) AND per-unit Price column is GST-inclusive. Both require ÷1.1 before storing as cost or running validation. Validation: sum of (unit price ÷ 1.1) × qty must match (Sub Total ÷ 1.1).',
  NOW(),NOW()),
('ibisa','Ibisa','Function Design Group Pty Ltd','Ibisa',75,1,FALSE,TRUE,
  'Multi-brand distributor: Function Design Group also distributes Rubyyaya and Lulalife. Match by brand field on invoice, not supplier name. 5% wholesale discount typical. Footwear uses EU sizes - if footwear styles appear set type=shoes and vendor=Ibisa.',
  NOW(),NOW()),
('skechers','Skechers','Accent Brands Pty Ltd','Skechers',80,1,TRUE,TRUE,
  'CRITICAL: Price (Tax) column is GST-INCLUSIVE - ÷1.1 for Shopify cost. Validation example: 7 × ($69.99 ÷ 1.1) = $445.41 = Total Gross. Multi-brand distributor: Accent Brands also distributes Hype DC, Platypus and Athletes Foot - always check Brand field on invoice and use that as Shopify Vendor, not Accent Brands.',
  NOW(),NOW()),
('colorado','Colorado','Australian Footwear Pty Ltd','Colorado',80,1,FALSE,TRUE,
  'Australian Footwear Pty Ltd (ABN 40 168 259 210) is part of Munro Footwear Group, which also distributes Williams, Diana Ferrari and Cinori. Always use brand field (Colorado/Williams/Diana Ferrari/Cinori) as Shopify Vendor, not the legal entity.',
  NOW(),NOW()),
('pasduchas','Pasduchas','Global Fashion Traders Pty Ltd','Pasduchas',75,1,FALSE,TRUE,
  'RRP and size BOTH embedded in description text (e.g. "FAYE STRAPLESS MAXI: BLUR FLORAL, Sz 6, RRP $380"). Parser must extract: style name (before colon), colour (after colon, before Sz), size (Sz# pattern), and RRP ($ amount after RRP). No separate size column on this invoice format.',
  NOW(),NOW())
ON CONFLICT (supplier_key) DO UPDATE SET
  supplier_legal = EXCLUDED.supplier_legal,
  shopify_vendor = EXCLUDED.shopify_vendor,
  confidence = GREATEST(public.brand_profiles.confidence, EXCLUDED.confidence),
  invoices_processed = GREATEST(public.brand_profiles.invoices_processed, EXCLUDED.invoices_processed),
  gst_inclusive_pricing = EXCLUDED.gst_inclusive_pricing,
  rrp_on_invoice = EXCLUDED.rrp_on_invoice,
  notes = EXCLUDED.notes,
  updated_at = NOW();