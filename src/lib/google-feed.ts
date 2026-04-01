// Google Shopping Feed Generator
// Produces Google Merchant Center-ready XML and TSV feeds

export const GOOGLE_PRODUCT_CATEGORY: Record<string, string> = {
  'One Piece': '5439',
  'One Pieces': '5439',
  'Bikini Tops': '1870',
  'Bikini Bottoms': '1871',
  'Bikini Set': '5440',
  'Tankini Tops': '1870',
  'Rashies & Sunsuits': '5378',
  'Dresses': '2271',
  'Tops': '212',
  'Pants': '207',
  'Skirts': '208',
  'Kaftans & Cover Ups': '1843',
  'Sarongs': '1843',
  'Hats': '2612',
  'Sunnies': '178',
  'Accessories': '169',
  'Bags': '6551',
  'Beach Towels': '2800',
  'Goggles': '990',
  'Boardshorts': '5441',
  'Mens Swimwear': '5441',
  'Mens Shorts': '213',
  'Mens Shirt': '212',
  'Kids Swimwear': '5439',
  'Girls 00-7': '5439',
  'Girls 8-16': '5439',
  'Kids Accessories': '169',
};

const GOOGLE_GENDER: Record<string, string> = {
  'Womens': 'female',
  'mens': 'male',
  'kids': 'unisex',
};

const GOOGLE_AGE_GROUP: Record<string, string> = {
  'Womens': 'adult',
  'mens': 'adult',
  'kids': 'kids',
};

export interface GoogleFeedProduct {
  name: string;
  brand: string;
  type: string;
  price: number;
  rrp: number;
  cogs?: number;
  tags?: string;
  description?: string;
  colour?: string;
  size?: string;
  barcode?: string;
  sku?: string;
}

export interface GoogleFeedItem {
  id: string;
  title: string;
  description: string;
  link: string;
  image_link: string;
  price: string;
  sale_price: string;
  sale_price_effective_date: string;
  availability: string;
  condition: string;
  brand: string;
  gtin: string;
  mpn: string;
  google_product_category: string;
  product_type: string;
  color: string;
  size: string;
  gender: string;
  age_group: string;
  custom_label_0: string;
  custom_label_1: string;
  custom_label_2: string;
  custom_label_3: string;
  custom_label_4: string;
  cost_of_goods_sold: string;
  auto_pricing_min_price: string;
}

function escXml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function getMarginFloor(): number {
  const saved = parseFloat(localStorage.getItem('margin_floor') || '');
  return (!isNaN(saved) && saved >= 1.0) ? saved : 1.20;
}

export function setMarginFloor(val: number) {
  localStorage.setItem('margin_floor', String(val));
}

function calcMinPrice(cogs: number): string {
  if (!cogs || cogs <= 0) return '';
  return (cogs * getMarginFloor()).toFixed(2);
}

export function buildGoogleFeedItem(p: GoogleFeedProduct, saleDateStr?: string): GoogleFeedItem {
  const handle = `${p.name}-${p.brand}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);

  const storeDomain = localStorage.getItem('shopify_store_url') || 'yourstore.com.au';

  const tagArr = (p.tags || '').split(',').map(t => t.trim());
  let genderKey = 'Womens';
  if (tagArr.includes('mens')) genderKey = 'mens';
  if (tagArr.includes('kids')) genderKey = 'kids';

  const cost = p.price;
  const retail = p.rrp;
  const hasRRP = retail > cost && retail > 0;
  const regularPrice = hasRRP ? retail.toFixed(2) : cost.toFixed(2);
  const salePrice = hasRRP ? cost.toFixed(2) : '';

  let colour = p.colour || '';
  if (!colour) {
    const parts = p.name.split(' - ');
    if (parts.length > 1) colour = parts[parts.length - 1].trim();
  }

  const gpc = GOOGLE_PRODUCT_CATEGORY[p.type] || '169';

  return {
    id: handle,
    title: `${p.brand} ${p.name}`,
    description: p.description || `${p.name} by ${p.brand}. Premium ${p.type?.toLowerCase() || 'fashion'}.`,
    link: `https://${storeDomain}/products/${handle}`,
    image_link: '',
    price: `${regularPrice} AUD`,
    sale_price: salePrice ? `${salePrice} AUD` : '',
    availability: 'in_stock',
    condition: 'new',
    brand: p.brand || '',
    gtin: p.barcode || '',
    mpn: p.sku || '',
    google_product_category: gpc,
    product_type: p.type || '',
    color: colour,
    size: p.size || '',
    gender: GOOGLE_GENDER[genderKey] || 'female',
    age_group: GOOGLE_AGE_GROUP[genderKey] || 'adult',
    custom_label_0: p.brand || '',
    custom_label_1: p.type || '',
    custom_label_2: tagArr.find(t => /^\w{3}\d{2}$/.test(t)) || '',
    custom_label_3: hasRRP ? 'sale' : 'full_price',
    custom_label_4: '',
    sale_price_effective_date: (salePrice && saleDateStr) ? saleDateStr : '',
    cost_of_goods_sold: p.cogs && p.cogs > 0 ? `${p.cogs.toFixed(2)} AUD` : '',
    auto_pricing_min_price: p.cogs && p.cogs > 0 ? `${calcMinPrice(p.cogs)} AUD` : '',
  };
}

export function generateGoogleFeedXML(products: GoogleFeedProduct[], storeName?: string, saleDateStr?: string): string {
  const items = products.map(p => buildGoogleFeedItem(p, saleDateStr));
  const title = storeName || 'Product Feed';
  const domain = localStorage.getItem('shopify_store_url') || 'yourstore.com.au';

  const xmlItems = items.map(item => `    <item>
      <g:id>${escXml(item.id)}</g:id>
      <g:title>${escXml(item.title)}</g:title>
      <g:description>${escXml(item.description)}</g:description>
      <g:link>${escXml(item.link)}</g:link>
      <g:image_link>${escXml(item.image_link)}</g:image_link>
      <g:price>${escXml(item.price)}</g:price>${item.sale_price ? `
      <g:sale_price>${escXml(item.sale_price)}</g:sale_price>` : ''}${item.sale_price_effective_date ? `
      <g:sale_price_effective_date>${escXml(item.sale_price_effective_date)}</g:sale_price_effective_date>` : ''}
      <g:availability>${item.availability}</g:availability>
      <g:condition>${item.condition}</g:condition>
      <g:brand>${escXml(item.brand)}</g:brand>${item.gtin ? `
      <g:gtin>${escXml(item.gtin)}</g:gtin>` : ''}${item.mpn ? `
      <g:mpn>${escXml(item.mpn)}</g:mpn>` : ''}
      <g:google_product_category>${escXml(item.google_product_category)}</g:google_product_category>
      <g:product_type>${escXml(item.product_type)}</g:product_type>${item.color ? `
      <g:color>${escXml(item.color)}</g:color>` : ''}${item.size ? `
      <g:size>${escXml(item.size)}</g:size>` : ''}
      <g:gender>${item.gender}</g:gender>
      <g:age_group>${item.age_group}</g:age_group>${item.cost_of_goods_sold ? `
      <g:cost_of_goods_sold>${escXml(item.cost_of_goods_sold)}</g:cost_of_goods_sold>` : ''}${item.auto_pricing_min_price ? `
      <g:auto_pricing_min_price>${escXml(item.auto_pricing_min_price)}</g:auto_pricing_min_price>` : ''}
      <g:custom_label_0>${escXml(item.custom_label_0)}</g:custom_label_0>
      <g:custom_label_1>${escXml(item.custom_label_1)}</g:custom_label_1>
      <g:custom_label_2>${escXml(item.custom_label_2)}</g:custom_label_2>
      <g:custom_label_3>${escXml(item.custom_label_3)}</g:custom_label_3>
      <g:custom_label_4>${escXml(item.custom_label_4)}</g:custom_label_4>
    </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escXml(title)} — Google Shopping Feed</title>
    <link>https://${escXml(domain)}</link>
    <description>Product feed for Google Merchant Center</description>
${xmlItems}
  </channel>
</rss>`;
}

export function generateGoogleFeedTSV(products: GoogleFeedProduct[], saleDateStr?: string): string {
  const items = products.map(p => buildGoogleFeedItem(p, saleDateStr));
  const headers = [
    'id', 'title', 'description', 'link', 'image_link',
    'price', 'sale_price', 'availability', 'condition',
    'brand', 'gtin', 'mpn', 'google_product_category',
    'product_type', 'color', 'size', 'gender', 'age_group',
    'custom_label_0', 'custom_label_1', 'custom_label_2',
    'custom_label_3', 'custom_label_4', 'sale_price_effective_date',
    'cost_of_goods_sold', 'auto_pricing_min_price',
  ];
  const rows = [
    headers.join('\t'),
    ...items.map(item =>
      headers.map(h => String((item as any)[h] || '').replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t')
    ),
  ];
  return rows.join('\n');
}

// ── Google Promotions Feed ─────────────────────────────────

export interface SaleMeta {
  appliedAt: string;
  pct: number;
  tags: string[];
  handles: string[];
  direction: string;
  discountType?: string;
}

const SALE_META_KEY = 'last_sale_meta';

export function saveSaleMeta(meta: SaleMeta) {
  localStorage.setItem(SALE_META_KEY, JSON.stringify(meta));
}

export function getSaleMeta(): SaleMeta | null {
  try {
    const raw = localStorage.getItem(SALE_META_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function generatePromotionsFeed(meta?: SaleMeta | null): string | null {
  const m = meta || getSaleMeta();
  if (!m || m.direction !== 'apply') return null;

  const storeDomain = localStorage.getItem('shopify_store_url') || 'yourstore.com.au';

  const tagSlug = m.tags.slice(0, 2)
    .join('-').toLowerCase().replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  const dateSlug = new Date(m.appliedAt).toISOString().slice(0, 7).replace('-', '');
  const promotionId = `${tagSlug || 'sale'}-${m.pct}off-${dateSlug}`;

  const start = new Date(m.appliedAt);
  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  const fmt = (d: Date) => d.toISOString().slice(0, 10) + 'T00:00+10:00';
  const dateRange = `${fmt(start)}/${fmt(end)}`;

  const tagLabel = m.tags.slice(0, 2).join(', ') || 'selected products';
  let longTitle = `${m.pct}% off ${tagLabel}`;
  if (longTitle.length > 60) longTitle = longTitle.slice(0, 57) + '...';

  const itemIds = m.handles
    .slice(0, 500)
    .map(h => `        <item_id>${escXml(h)}</item_id>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.google.com/shopping/promotions/2020/01"
      xmlns:g="http://base.google.com/ns/1.0">
  <promotions>
    <promotion>
      <g:promotion_id>${escXml(promotionId)}</g:promotion_id>
      <g:product_applicability>SPECIFIC_PRODUCTS</g:product_applicability>
      <g:offer_type>PERCENT_OFF</g:offer_type>
      <g:percent_off>${m.pct}</g:percent_off>
      <g:long_title>${escXml(longTitle)}</g:long_title>
      <g:promotion_effective_dates>${dateRange}</g:promotion_effective_dates>
      <g:redemption_channel>ONLINE</g:redemption_channel>
      <g:item_id_inclusion>
${itemIds}
      </g:item_id_inclusion>
    </promotion>
  </promotions>
</feed>`;
}
