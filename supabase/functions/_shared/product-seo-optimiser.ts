// Louenhide/Megantic product-level optimiser.
// Computes handle, SEO title, meta description for a product BEFORE Shopify push.
// Single source of truth for handle/title/meta formulas — used by publishing-agent
// AND the audit panel (which validates the SAME thresholds).

const BAG_TYPE_TOKENS = [
  "crossbody", "shoulder", "tote", "handbag", "clutch", "backpack",
  "sling", "bum-bag", "bumbag", "belt-bag", "bucket", "hobo", "satchel",
  "top-handle", "mini-bag", "pouch", "wallet", "card-holder", "purse",
  "weekender", "cosmetic", "toiletry", "duffle", "laptop-bag", "phone-bag",
  "beach-bag", "travel-bag", "carry-on",
];

const ACCESSORY_VENDOR_HINTS = [
  "louenhide", "olga berg", "peta and jain", "peta & jain", "status anxiety",
];

const JEWELLERY_VENDOR_HINTS = [
  "amber sceats","by charlotte","mayol","arms of eve","emma pills","avant studio",
  "noah the label","heaven mayhem","porter","lana wilkinson","midsummer star","olga de polga",
];

const JEWELLERY_TYPE_TOKENS = [
  "earrings","earring","hoops","hoop","studs","stud","necklace","pendant","chain","choker",
  "bracelet","bangle","cuff","ring","signet","anklet","charm",
];

const JEWELLERY_METAL_TOKENS = [
  "gold-filled","gold filled","14k gold","18k gold","rose gold","sterling silver",
  "vermeil","pearl","silver","gold",
];

export function slugify(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export function detectBagType(...sources: (string | null | undefined)[]): string | null {
  const hay = sources.filter(Boolean).join(" ").toLowerCase();
  // Multi-word matches first (laptop-bag before bag)
  for (const tok of BAG_TYPE_TOKENS.filter((t) => t.includes("-"))) {
    if (hay.includes(tok.replace("-", " ")) || hay.includes(tok)) return tok;
  }
  for (const tok of BAG_TYPE_TOKENS) {
    if (new RegExp(`\\b${tok}\\b`).test(hay)) return tok;
  }
  return null;
}

export function detectJewelleryType(...sources: (string | null | undefined)[]): string | null {
  const hay = sources.filter(Boolean).join(" ").toLowerCase();
  for (const tok of JEWELLERY_TYPE_TOKENS) {
    if (new RegExp(`\\b${tok}\\b`).test(hay)) return tok;
  }
  return null;
}

export function detectMetal(...sources: (string | null | undefined)[]): string | null {
  const hay = sources.filter(Boolean).join(" ").toLowerCase();
  for (const tok of JEWELLERY_METAL_TOKENS) {
    if (hay.includes(tok)) return tok;
  }
  return null;
}

export function isJewelleryVendor(vendor: string | null | undefined, productType: string | null | undefined): boolean {
  const v = (vendor || "").toLowerCase();
  if (JEWELLERY_VENDOR_HINTS.some((h) => v.includes(h))) return true;
  const t = (productType || "").toLowerCase();
  return /jewellery|jewelry|earring|necklace|bracelet|ring|bangle|pendant|hoop|stud|chain|anklet|charm/.test(t);
}

export function isAccessoryVendor(vendor: string | null | undefined, productType: string | null | undefined): boolean {
  const v = (vendor || "").toLowerCase();
  if (ACCESSORY_VENDOR_HINTS.some((h) => v.includes(h))) return true;
  const t = (productType || "").toLowerCase();
  return /bag|wallet|clutch|accessor/i.test(t);
}

export interface OptimiserInput {
  title: string;            // raw style/product name
  brand?: string | null;
  colour?: string | null;
  bagType?: string | null;  // pre-detected; falls back to detect from title
  productType?: string | null;
  storeName?: string | null;
  storeCity?: string | null;
  freeShippingThreshold?: string | null;  // e.g. "99"
  bodyHtml?: string | null; // existing body — preserved if 200+ words
}

export interface OptimisedSeo {
  handle: string;
  seoTitle: string;
  metaDescription: string;
  bodyHtml: string;
  bagType: string | null;
  flags: string[];          // human-readable issues encountered (for audit log)
}

function clampMeta(s: string): string {
  // Target 150–160 chars (matches retry-loop validator)
  if (s.length >= 150 && s.length <= 160) return s;
  if (s.length > 160) return s.slice(0, 159).replace(/\s+\S*$/, "") + ".";
  // Pad with a generic store-trust phrase only if too short
  return s;
}

function clampTitle(s: string): string {
  if (s.length <= 60) return s;
  return s.slice(0, 59).replace(/\s+\S*$/, "") + "…";
}

export function optimiseProductSeo(input: OptimiserInput): OptimisedSeo {
  const flags: string[] = [];
  const brand = (input.brand || "").trim();
  const styleName = (input.title || "").trim();
  const colour = (input.colour || "").trim();

  // JEWELLERY path — formula: {Brand} {Style Name} {Metal} {Jewellery Type}
  const isJewel = isJewelleryVendor(input.brand, input.productType);
  if (isJewel) {
    const jewelType = detectJewelleryType(input.title, input.productType, brand);
    const metal = detectMetal(input.title, input.productType, input.bodyHtml);
    if (!jewelType) flags.push("no_jewellery_type_detected");
    if (!metal) flags.push("no_metal_detected");

    const handleParts = [brand, styleName, metal, jewelType].filter(Boolean).map(slugify).filter(Boolean);
    const handle = handleParts.join("-").replace(/-{2,}/g, "-").slice(0, 80) || slugify(styleName) || "product";

    const titleHay = `${brand} ${styleName}`.toLowerCase();
    const titleBits = [
      brand,
      styleName,
      metal && !titleHay.includes(metal.toLowerCase()) && metal.replace(/-/g, " "),
      jewelType && !new RegExp(`\\b${jewelType}\\b`, "i").test(titleHay) && jewelType,
    ].filter(Boolean) as string[];
    const seoTitle = clampTitle(titleBits.join(" ").replace(/\s+/g, " ").trim());

    const store = (input.storeName || "").trim();
    const city = (input.storeCity || "").trim();
    const ship = (input.freeShippingThreshold || "").trim();
    const piece = [brand, styleName].filter(Boolean).join(" ");
    const benefit = metal && jewelType
      ? `Demi-fine ${metal.replace(/-/g, " ")} ${jewelType} crafted for everyday wear`
      : jewelType
      ? `Demi-fine ${jewelType} crafted for everyday wear`
      : "Demi-fine jewellery crafted for everyday wear";
    const shopBit = store
      ? ` Shop at ${store}${city ? `, ${city}` : ""}${ship ? ` — free shipping over $${ship}.` : "."}`
      : "";
    let meta = `${benefit}. ${piece}.${shopBit}`.replace(/\s+/g, " ").trim();
    if (meta.length < 150) {
      const pad = " Gift boxed and ready to ship Australia-wide.";
      meta = (meta + pad).slice(0, 160);
    }
    meta = clampMeta(meta);
    if (meta.length < 150 || meta.length > 160) flags.push(`meta_length_${meta.length}`);

    let bodyHtml = (input.bodyHtml || "").trim();
    const wc = bodyHtml.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
    if (wc < 200) {
      if (bodyHtml) flags.push(`body_padded_from_${wc}_words`);
      bodyHtml = (bodyHtml ? bodyHtml + "\n\n" : "") + generateJewelleryBody({ brand, styleName, metal, jewelType, store, city });
    }
    return { handle, seoTitle, metaDescription: meta, bodyHtml, bagType: null, flags };
  }

  const bagType = input.bagType || detectBagType(input.title, input.productType, brand);

  if (!bagType) flags.push("no_bag_type_detected");

  // ── Handle: {brand}-{style}-{colour}-{bag-type}
  const handleParts = [brand, styleName, colour, bagType].filter(Boolean).map(slugify).filter(Boolean);
  const handle = handleParts.join("-").replace(/-{2,}/g, "-").slice(0, 80) || slugify(styleName) || "product";

  // ── SEO title: {Brand} {Style} {Colour} {Bag Type}
  const titleBits = [
    brand,
    styleName,
    colour && `- ${colour}`,
    bagType && !new RegExp(bagType.replace("-", "[ -]"), "i").test(`${brand} ${styleName}`) && bagType.replace(/-/g, " "),
  ].filter(Boolean) as string[];
  const seoTitle = clampTitle(titleBits.join(" ").replace(/\s+/g, " ").trim());

  // ── Meta: {Feature benefit}. {Brand} {Style} in {colour}. {Store + shipping}.
  const store = (input.storeName || "").trim();
  const city = (input.storeCity || "").trim();
  const ship = (input.freeShippingThreshold || "").trim();
  const benefit = bagType
    ? `Versatile ${bagType.replace(/-/g, " ")} for everyday wear`
    : "Designed for everyday wear";
  const piece = [brand, styleName].filter(Boolean).join(" ");
  const colourPhrase = colour ? ` in ${colour}` : "";
  const shopBit = store
    ? ` Shop at ${store}${city ? `, ${city}` : ""}${ship ? ` — free shipping over $${ship}.` : "."}`
    : "";
  let meta = `${benefit}. ${piece}${colourPhrase}.${shopBit}`.replace(/\s+/g, " ").trim();
  // Pad if short
  if (meta.length < 150) {
    const pad = " Discover the full range and order online today.";
    meta = (meta + pad).slice(0, 160);
  }
  meta = clampMeta(meta);
  if (meta.length < 150 || meta.length > 160) flags.push(`meta_length_${meta.length}`);

  // ── Body: only generate if missing or too short (preserve curated copy)
  let bodyHtml = (input.bodyHtml || "").trim();
  const wordCount = bodyHtml.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 200) {
    if (bodyHtml) flags.push(`body_padded_from_${wordCount}_words`);
    const generated = generateBody({ brand, styleName, colour, bagType, store, city });
    bodyHtml = bodyHtml ? `${bodyHtml}\n\n${generated}` : generated;
  }

  return { handle, seoTitle, metaDescription: meta, bodyHtml, bagType, flags };
}

function generateBody(o: {
  brand: string; styleName: string; colour: string;
  bagType: string | null; store: string; city: string;
}): string {
  const piece = [o.brand, o.styleName].filter(Boolean).join(" ") || "This piece";
  const bt = o.bagType?.replace(/-/g, " ") || "accessory";
  const colourPhrase = o.colour ? ` in ${o.colour}` : "";
  const cityPhrase = o.city ? ` in ${o.city}` : "";
  const storePhrase = o.store ? ` ${o.store}${cityPhrase}` : "";
  return [
    `<p>The ${piece}${colourPhrase} is a ${bt} built for everyday Australian life. ${o.brand ? `${o.brand} designs` : "It is designed"} with everyday practicality in mind, balancing considered detail with hard-wearing materials so the piece keeps its shape after months of real use.</p>`,
    `<p>This ${bt} sits comfortably across work, weekend and travel. It carries the essentials without bulk — phone, wallet, keys, sunglasses, a small water bottle — and the interior layout keeps everything findable so you are not digging at the bottom for keys at the door.</p>`,
    `<p>${o.colour ? `The ${o.colour} colourway is a true everyday neutral that pairs back to denim, tailoring and weekend dressing equally well.` : "Available across a curated colour range that pairs back to most everyday outfits."} Care is straightforward — wipe the exterior with a soft damp cloth, store stuffed with tissue when not in use.</p>`,
    `<p>Shop the ${piece}${storePhrase} online or in-store, with fast Australia-wide shipping and easy returns.</p>`,
  ].join("\n");
}
