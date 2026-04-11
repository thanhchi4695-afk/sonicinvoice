// Industry Configuration Engine — centralised industry definitions
// Each industry defines product types, tag layers, enrichment sources,
// variant attributes, SEO CTAs, special rules, and description style.

export interface IndustryProductType {
  name: string;
  tag: string;
  department?: string;
}

export interface IndustryTagLayer {
  name: string;
  description: string;
  type: 'single' | 'multiple' | 'auto' | 'fixed' | 'date';
  values: string[];
  order: number;
}

export interface IndustrySpecialRule {
  keyword: string;
  tag: string;
  caseSensitive: boolean;
  matchType: 'contains' | 'exact' | 'starts_with';
}

export interface IndustryVariantAttribute {
  name: string;
  values: string[];
}

export interface IndustryFeatureRule {
  pattern: RegExp;
  phrase: string;
}

/** Industry-specific field label overrides */
export interface IndustryFieldLabels {
  size: string;
  colour: string;
  material: string;
}

/** Google Shopping attribute mapping per industry */
export interface GoogleShoppingMapping {
  colour: string;        // what field maps to g:color
  size: string;          // what field maps to g:size
  material: string;      // what field maps to g:material
  age_group: string;     // default g:age_group value
  size_system?: string;  // e.g. AU, US
}

export interface IndustryDefinition {
  id: string;
  displayName: string;
  icon: string;
  descriptionLength: string;
  descriptionStyle: string;
  descriptionFeatures: string;
  productTypes: IndustryProductType[];
  defaultType: string;
  tagLayers: IndustryTagLayer[];
  specialRules: IndustrySpecialRule[];
  variantAttributes: IndustryVariantAttribute[];
  enrichmentSources: string[];
  seoCtas: string[];
  seoDescTemplate: string;
  featureRules: IndustryFeatureRule[];
  currencyDefault: string;
  /** UI field label overrides */
  fieldLabels: IndustryFieldLabels;
  /** Google Shopping attribute mapping */
  googleShopping: GoogleShoppingMapping;
  /** Whether this industry uses size-based inventory (size holes in restock) */
  hasSizeHoles: boolean;
}

function toTag(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function types(names: string[], dept?: string): IndustryProductType[] {
  return names.map(n => ({ name: n, tag: toTag(n), department: dept }));
}

const BASE_LAYERS: IndustryTagLayer[] = [
  { name: 'Gender', description: 'One tag per product', type: 'single', values: ['Womens', 'Mens', 'Kids', 'Unisex'], order: 1 },
  { name: 'Department', description: 'Product department', type: 'auto', values: [], order: 2 },
  { name: 'Product Type', description: 'From product type list', type: 'auto', values: [], order: 3 },
  { name: 'Brand', description: 'Vendor/brand name', type: 'auto', values: [], order: 4 },
  { name: 'Arrival Month', description: 'Month product arrived', type: 'date', values: [], order: 5 },
  { name: 'Price Status', description: 'Full price or on sale', type: 'single', values: ['full_price', 'sale'], order: 6 },
  { name: 'Special Properties', description: 'Detected from keywords', type: 'multiple', values: [], order: 7 },
];

// ═══════════════════════════════════════════════════════════════
// INDUSTRY DEFINITIONS
// ═══════════════════════════════════════════════════════════════

const SWIMWEAR: IndustryDefinition = {
  id: 'swimwear',
  displayName: 'Swimwear & Resort',
  icon: '👙',
  descriptionLength: '2-3',
  descriptionStyle: 'Write in a friendly, beach-lifestyle tone.',
  descriptionFeatures: 'Mention: fabric, support, cut, who it suits.',
  productTypes: types([
    'One Pieces', 'Bikini Tops', 'Bikini Bottoms', 'Bikini Set',
    'Tankini Tops', 'Swimdress', 'Rashies & Sunsuits', 'Blouson',
    'Boyleg', 'Swim Skirts', 'Swim Leggings', 'Swim Rompers',
    'Suit Saver', 'Womens Boardshorts',
    'Dresses', 'Tops', 'Pants', 'Skirts', 'Shorts',
    'Playsuits & Jumpsuits', 'Kimonos', 'Kaftans & Cover Ups',
    'Sarongs', 'Belts', 'Shirts',
    'Hats', 'Sunnies', 'Goggles', 'Earplugs', 'Swim Caps',
    'Bags', 'Beach Towels', 'Accessories', 'Swim Accessories',
    'Water Shoes', 'Jewellery', 'Earrings', 'Necklaces',
    'Bracelets', 'Wallets', 'Sunscreen & Lotions',
    'Floaties & Pool Toys',
    'Candles', 'Coasters', 'Greeting Cards', 'Christmas Decor',
    'Books', 'Mixers & Alcohol', 'Smelly Balls', 'Perfume',
    'Hair Wraps', 'Grooming & Toiletries',
    'Boardshorts', 'Mens Swimwear', 'Mens Briefs & Jammers',
    'Mens Rashies', 'Mens Shorts', 'Mens Shirts',
    'Mens Tees & Singlets', 'Mens Accessories',
    'Mens Hats & Caps', 'Mens Shoes & Thongs',
    'Kids Swimwear', 'Girls 00-7', 'Girls 8-16',
    'Boys 00-7', 'Boys 8-16', 'Kids Accessories',
  ], 'Swimwear'),
  defaultType: 'Swimwear',
  tagLayers: [...BASE_LAYERS],
  specialRules: [
    { keyword: 'underwire',      tag: 'underwire',         caseSensitive: false, matchType: 'contains' },
    { keyword: 'chlorine resist',tag: 'chlorine resist',   caseSensitive: false, matchType: 'contains' },
    { keyword: 'plus size',      tag: 'plus size',         caseSensitive: false, matchType: 'contains' },
    { keyword: 'tummy control',  tag: 'tummy control',     caseSensitive: false, matchType: 'contains' },
    { keyword: 'd-g',            tag: 'd-g',               caseSensitive: false, matchType: 'contains' },
    { keyword: 'a-dd',           tag: 'a-dd',              caseSensitive: false, matchType: 'contains' },
    { keyword: 'd-dd',           tag: 'd-dd',              caseSensitive: false, matchType: 'contains' },
    { keyword: 'mastectomy',     tag: 'mastectomy',        caseSensitive: false, matchType: 'contains' },
    { keyword: 'UPF',            tag: 'sun protection',    caseSensitive: false, matchType: 'contains' },
    { keyword: 'sun protect',    tag: 'sun protection',    caseSensitive: false, matchType: 'contains' },
    { keyword: 'maternity',      tag: 'maternity',         caseSensitive: false, matchType: 'contains' },
    { keyword: 'period swim',    tag: 'period swim',       caseSensitive: false, matchType: 'contains' },
    { keyword: 'boyleg',         tag: 'boyleg',            caseSensitive: false, matchType: 'contains' },
    { keyword: 'tie side',       tag: 'tie side',          caseSensitive: false, matchType: 'contains' },
    { keyword: 'gifting',        tag: 'gifting',           caseSensitive: false, matchType: 'contains' },
  ],
  variantAttributes: [
    { name: 'Size', values: ['8', '10', '12', '14', '16', '18', '20'] },
    { name: 'Colour', values: [] },
  ],
  enrichmentSources: ['ozresort.com.au', 'splishsplashswimwear.com.au', 'swimweargalore.com'],
  seoCtas: [
    'Shop the full collection at {store}',
    'New arrivals at {store} {city}',
    'Free shipping over {threshold} at {store}',
  ],
  seoDescTemplate: 'Shop the {product} by {brand}. {features}New arrivals at {store} {city}.',
  featureRules: [
    { pattern: /underwire/i, phrase: 'With underwire support.' },
    { pattern: /chlorine\s*resist/i, phrase: 'Chlorine resistant fabric.' },
    { pattern: /plus\s*size|extended\s*siz/i, phrase: 'Available in extended sizing.' },
    { pattern: /[d-g]\s*cup|full\s*bust/i, phrase: 'Full bust support in D-G cup.' },
    { pattern: /upf|sun\s*protect/i, phrase: 'UPF 50+ sun protection.' },
  ],
  currencyDefault: 'AUD',
};

const BEAUTY: IndustryDefinition = {
  id: 'beauty',
  displayName: 'Beauty & Cosmetics',
  icon: '💄',
  descriptionLength: '2-3',
  descriptionStyle: 'Write in a confident, aspirational beauty tone.',
  descriptionFeatures: 'Mention: key ingredients, skin type, finish.',
  productTypes: types([
    'Foundation', 'Concealer', 'Blush', 'Bronzer', 'Highlighter',
    'Eyeshadow', 'Eyeliner', 'Mascara', 'Lipstick', 'Lip Gloss',
    'Lip Liner', 'Setting Spray', 'Primer', 'Skincare', 'Moisturiser',
    'Serum', 'Cleanser', 'Toner', 'Face Mask', 'Sunscreen',
    'Body Lotion', 'Perfume', 'Hair Care', 'Nail Polish',
    'Brushes & Tools', 'Accessories',
  ], 'Beauty'),
  defaultType: 'Beauty',
  tagLayers: [
    { name: 'Skin Type', description: 'Target skin type', type: 'single', values: ['oily skin', 'dry skin', 'combination', 'sensitive skin', 'all skin types'], order: 1 },
    { name: 'Category', description: 'Product category', type: 'single', values: ['makeup', 'skincare', 'haircare', 'fragrance', 'nails', 'tools'], order: 2 },
    { name: 'Product Type', description: 'From product type list', type: 'auto', values: [], order: 3 },
    { name: 'Brand', description: 'Vendor/brand name', type: 'auto', values: [], order: 4 },
    { name: 'Arrival Month', description: 'Month product arrived', type: 'date', values: [], order: 5 },
    { name: 'Price Status', description: 'Full price or on sale', type: 'single', values: ['full_price', 'sale'], order: 6 },
    { name: 'Special Properties', description: 'Detected from keywords', type: 'multiple', values: [], order: 7 },
  ],
  specialRules: [
    { keyword: 'cruelty free', tag: 'cruelty-free', caseSensitive: false, matchType: 'contains' },
    { keyword: 'cruelty-free', tag: 'cruelty-free', caseSensitive: false, matchType: 'contains' },
    { keyword: 'vegan', tag: 'vegan', caseSensitive: false, matchType: 'contains' },
    { keyword: 'SPF', tag: 'SPF', caseSensitive: false, matchType: 'contains' },
    { keyword: 'natural', tag: 'natural', caseSensitive: false, matchType: 'contains' },
    { keyword: 'organic', tag: 'natural', caseSensitive: false, matchType: 'contains' },
    { keyword: 'anti-ageing', tag: 'anti-ageing', caseSensitive: false, matchType: 'contains' },
    { keyword: 'anti-aging', tag: 'anti-ageing', caseSensitive: false, matchType: 'contains' },
    { keyword: 'brightening', tag: 'brightening', caseSensitive: false, matchType: 'contains' },
    { keyword: 'hydrating', tag: 'hydrating', caseSensitive: false, matchType: 'contains' },
  ],
  variantAttributes: [
    { name: 'Shade', values: ['Ivory', 'Nude 05', 'Porcelain', 'Sand', 'Honey', 'Mocha', 'Espresso'] },
    { name: 'Size', values: ['Mini', '15ml', '30ml', '50ml', '100ml', 'Full Size', 'Travel Size'] },
  ],
  enrichmentSources: ['adorebeauty.com.au', 'lookfantastic.com.au', 'mecca.com.au', 'sephora.com.au'],
  seoCtas: [
    'Shop {brand} at {store} — free delivery over {threshold}',
    'New arrivals from {brand} at {store}',
    'Discover {brand} skincare at {store}',
    'Authentic {brand} with fast shipping at {store}',
  ],
  seoDescTemplate: 'Discover {product} by {brand}. {features}Shop now at {store} with free delivery.',
  featureRules: [
    { pattern: /cruelty[\s-]*free/i, phrase: 'Cruelty-free formula.' },
    { pattern: /\bvegan\b/i, phrase: '100% vegan.' },
    { pattern: /\bspf\b/i, phrase: 'With SPF sun protection.' },
    { pattern: /\bnatural\b/i, phrase: 'Made with natural ingredients.' },
    { pattern: /anti[\s-]*age?ing/i, phrase: 'Anti-ageing formula.' },
    { pattern: /brightening/i, phrase: 'Brightening formula.' },
    { pattern: /hydrating/i, phrase: 'Deeply hydrating.' },
  ],
  currencyDefault: 'AUD',
};

const CLOTHING: IndustryDefinition = {
  id: 'clothing',
  displayName: 'Clothing & Apparel',
  icon: '👗',
  descriptionLength: '2-3',
  descriptionStyle: 'Write in a stylish, trend-aware tone.',
  descriptionFeatures: 'Mention: fabric, fit, occasion, styling suggestions.',
  productTypes: types([
    'T-Shirt', 'Shirt', 'Blouse', 'Dress', 'Maxi Dress', 'Mini Dress',
    'Midi Dress', 'Jumpsuit', 'Playsuit', 'Jacket', 'Coat', 'Blazer',
    'Cardigan', 'Sweater', 'Hoodie', 'Pants', 'Jeans', 'Shorts',
    'Skirt', 'Activewear', 'Underwear', 'Socks', 'Pyjamas', 'Accessories',
  ], 'Clothing'),
  defaultType: 'Clothing',
  tagLayers: [
    { name: 'Gender', description: 'One tag per product', type: 'single', values: ['Womens', 'Mens', 'Kids', 'Unisex'], order: 1 },
    { name: 'Category', description: 'Product category', type: 'single', values: ['clothing', 'activewear', 'underwear', 'outerwear', 'loungewear'], order: 2 },
    { name: 'Product Type', description: 'From product type list', type: 'auto', values: [], order: 3 },
    { name: 'Brand', description: 'Vendor/brand name', type: 'auto', values: [], order: 4 },
    { name: 'Arrival Month', description: 'Month product arrived', type: 'date', values: [], order: 5 },
    { name: 'Price Status', description: 'Full price or on sale', type: 'single', values: ['full_price', 'sale'], order: 6 },
    { name: 'Special Properties', description: 'Detected from keywords', type: 'multiple', values: [], order: 7 },
  ],
  specialRules: [
    { keyword: 'sustainable', tag: 'sustainable', caseSensitive: false, matchType: 'contains' },
    { keyword: 'recycled', tag: 'sustainable', caseSensitive: false, matchType: 'contains' },
    { keyword: 'organic cotton', tag: 'organic-cotton', caseSensitive: false, matchType: 'contains' },
    { keyword: 'linen', tag: 'linen', caseSensitive: false, matchType: 'contains' },
    { keyword: 'plus size', tag: 'plus-size', caseSensitive: false, matchType: 'contains' },
    { keyword: 'new arrival', tag: 'new-arrivals', caseSensitive: false, matchType: 'contains' },
    { keyword: 'clearance', tag: 'clearance', caseSensitive: false, matchType: 'contains' },
  ],
  variantAttributes: [
    { name: 'Size', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '6', '8', '10', '12', '14', '16', '18'] },
    { name: 'Colour', values: [] },
  ],
  enrichmentSources: ['theiconic.com.au', 'stylerunner.com', 'myer.com.au', 'davidjones.com'],
  seoCtas: [
    'Shop the latest from {brand} at {store}',
    'New season arrivals — shop now at {store}',
    'Style meets value at {store}',
  ],
  seoDescTemplate: '{brand} {product}. {features}Shop the latest at {store}.',
  featureRules: [
    { pattern: /sustainab/i, phrase: 'Made from sustainable materials.' },
    { pattern: /organic\s*cotton/i, phrase: '100% organic cotton.' },
    { pattern: /plus\s*size|extended\s*siz/i, phrase: 'Available in extended sizes.' },
    { pattern: /linen/i, phrase: 'Premium linen fabric.' },
  ],
  currencyDefault: 'AUD',
};

const FOOTWEAR: IndustryDefinition = {
  id: 'footwear',
  displayName: 'Footwear',
  icon: '👟',
  descriptionLength: '2-3',
  descriptionStyle: 'Write in a practical, style-forward tone.',
  descriptionFeatures: 'Mention: material, sole, fit, comfort features, occasion.',
  productTypes: types([
    'Sneakers', 'Running Shoes', 'Casual Shoes', 'Heels', 'Boots',
    'Ankle Boots', 'Sandals', 'Slides', 'Thongs', 'Flats', 'Loafers',
    'Dress Shoes', 'Work Boots', 'Kids Shoes', 'Slippers',
    'Orthotics', 'Accessories',
  ], 'Footwear'),
  defaultType: 'Footwear',
  tagLayers: [
    { name: 'Gender', description: 'One tag per product', type: 'single', values: ['Womens', 'Mens', 'Kids'], order: 1 },
    { name: 'Category', description: 'Product category', type: 'single', values: ['footwear', 'sneakers', 'formal', 'casual', 'sport', 'kids shoes'], order: 2 },
    { name: 'Product Type', description: 'From product type list', type: 'auto', values: [], order: 3 },
    { name: 'Brand', description: 'Vendor/brand name', type: 'auto', values: [], order: 4 },
    { name: 'Arrival Month', description: 'Month product arrived', type: 'date', values: [], order: 5 },
    { name: 'Price Status', description: 'Full price or on sale', type: 'single', values: ['full_price', 'sale'], order: 6 },
    { name: 'Special Properties', description: 'Detected from keywords', type: 'multiple', values: [], order: 7 },
  ],
  specialRules: [
    { keyword: 'wide fit', tag: 'wide-fit', caseSensitive: false, matchType: 'contains' },
    { keyword: 'vegan leather', tag: 'vegan-leather', caseSensitive: false, matchType: 'contains' },
    { keyword: 'waterproof', tag: 'waterproof', caseSensitive: false, matchType: 'contains' },
    { keyword: 'steel cap', tag: 'steel-cap', caseSensitive: false, matchType: 'contains' },
    { keyword: 'orthotic friendly', tag: 'orthotic-friendly', caseSensitive: false, matchType: 'contains' },
  ],
  variantAttributes: [
    { name: 'Size', values: ['5', '6', '7', '8', '9', '10', '11', '12'] },
    { name: 'Colour', values: [] },
    { name: 'Width', values: ['Standard', 'Wide', 'Narrow'] },
  ],
  enrichmentSources: ['stylerunner.com', 'platypusshoes.com.au', 'myer.com.au', 'schuh.com.au'],
  seoCtas: [
    'Shop {brand} footwear at {store}',
    'Free shipping over {threshold} at {store}',
    'New {brand} styles at {store}',
  ],
  seoDescTemplate: '{product} by {brand}. {features}Shop footwear at {store}.',
  featureRules: [
    { pattern: /wide\s*fit/i, phrase: 'Available in wide fit.' },
    { pattern: /vegan\s*leather/i, phrase: 'Made with vegan leather.' },
    { pattern: /waterproof/i, phrase: 'Waterproof construction.' },
    { pattern: /orthotic/i, phrase: 'Orthotic friendly.' },
  ],
  currencyDefault: 'AUD',
};

const HEALTH: IndustryDefinition = {
  id: 'health',
  displayName: 'Health & Supplements',
  icon: '💊',
  descriptionLength: '2-3',
  descriptionStyle: 'Focus on key ingredients and health benefits.',
  descriptionFeatures: 'Mention: key nutrients, serving size, flavour.',
  productTypes: types([
    'Protein Powder', 'Pre-Workout', 'Post-Workout', 'Vitamins',
    'Minerals', 'Omega-3', 'Probiotics', 'Collagen', 'Weight Loss',
    'Energy', 'Greens', 'Protein Bars', 'Snacks', 'Sports Nutrition',
    'Herbal Supplements', 'Skincare Supplements',
  ], 'Health'),
  defaultType: 'Health',
  tagLayers: [
    { name: 'Goal', description: 'Health/fitness goal', type: 'single', values: ['muscle gain', 'weight loss', 'energy', 'recovery', 'immunity', 'gut health', 'general health'], order: 1 },
    { name: 'Category', description: 'Product category', type: 'single', values: ['protein', 'vitamins', 'supplements', 'sports nutrition', 'herbal', 'snacks'], order: 2 },
    { name: 'Product Type', description: 'From product type list', type: 'auto', values: [], order: 3 },
    { name: 'Brand', description: 'Vendor/brand name', type: 'auto', values: [], order: 4 },
    { name: 'Arrival Month', description: 'Month product arrived', type: 'date', values: [], order: 5 },
    { name: 'Price Status', description: 'Full price or on sale', type: 'single', values: ['full_price', 'sale'], order: 6 },
    { name: 'Special Properties', description: 'Detected from keywords', type: 'multiple', values: [], order: 7 },
  ],
  specialRules: [
    { keyword: 'vegan', tag: 'vegan', caseSensitive: false, matchType: 'contains' },
    { keyword: 'gluten free', tag: 'gluten-free', caseSensitive: false, matchType: 'contains' },
    { keyword: 'gluten-free', tag: 'gluten-free', caseSensitive: false, matchType: 'contains' },
    { keyword: 'dairy free', tag: 'dairy-free', caseSensitive: false, matchType: 'contains' },
    { keyword: 'dairy-free', tag: 'dairy-free', caseSensitive: false, matchType: 'contains' },
    { keyword: 'natural', tag: 'natural', caseSensitive: false, matchType: 'contains' },
    { keyword: 'organic', tag: 'organic', caseSensitive: false, matchType: 'contains' },
    { keyword: 'TGA approved', tag: 'TGA-approved', caseSensitive: false, matchType: 'contains' },
  ],
  variantAttributes: [
    { name: 'Flavour', values: ['Chocolate', 'Vanilla', 'Strawberry', 'Unflavoured', 'Berry', 'Caramel'] },
    { name: 'Size', values: ['500g', '1kg', '2kg', '30 caps', '60 caps', '90 caps', '120 caps'] },
  ],
  enrichmentSources: ['chemistwarehouse.com.au', 'iherb.com', 'bodybuilding.com', 'supplementwarehouse.com.au'],
  seoCtas: [
    'Shop {brand} supplements at {store}',
    'Fast delivery from {store}',
    'Quality {brand} at {store}',
  ],
  seoDescTemplate: '{product} by {brand}. {features}Shop at {store}.',
  featureRules: [
    { pattern: /\bvegan\b/i, phrase: 'Vegan-friendly formula.' },
    { pattern: /gluten[\s-]*free/i, phrase: 'Gluten-free.' },
    { pattern: /dairy[\s-]*free/i, phrase: 'Dairy-free.' },
    { pattern: /\borganic\b/i, phrase: 'Certified organic.' },
  ],
  currencyDefault: 'AUD',
};

const ELECTRONICS: IndustryDefinition = {
  id: 'electronics',
  displayName: 'Electronics & Gadgets',
  icon: '📱',
  descriptionLength: '3-4',
  descriptionStyle: 'Focus on specs, compatibility, and use cases.',
  descriptionFeatures: 'Mention: key specs, compatibility, dimensions, use case.',
  productTypes: types([
    'Smartphone', 'Tablet', 'Laptop', 'Desktop', 'Monitor',
    'Headphones', 'Earbuds', 'Speaker', 'Keyboard', 'Mouse', 'Webcam',
    'TV', 'Streaming Device', 'Gaming Console', 'Controller',
    'Camera', 'Drone', 'Smart Home', 'Cables & Adapters',
    'Cases & Covers', 'Chargers', 'Power Banks', 'Accessories',
  ], 'Electronics'),
  defaultType: 'Electronics',
  tagLayers: [
    { name: 'Category', description: 'Product category', type: 'single', values: ['smartphones', 'audio', 'computing', 'gaming', 'smart home', 'accessories'], order: 1 },
    { name: 'Compatibility', description: 'Platform/ecosystem', type: 'single', values: ['Apple', 'Android', 'Windows', 'Universal'], order: 2 },
    { name: 'Product Type', description: 'From product type list', type: 'auto', values: [], order: 3 },
    { name: 'Brand', description: 'Vendor/brand name', type: 'auto', values: [], order: 4 },
    { name: 'Arrival Month', description: 'Month product arrived', type: 'date', values: [], order: 5 },
    { name: 'Price Status', description: 'Full price or on sale', type: 'single', values: ['full_price', 'sale'], order: 6 },
    { name: 'Special Properties', description: 'Detected from keywords', type: 'multiple', values: [], order: 7 },
  ],
  specialRules: [
    { keyword: 'wireless', tag: 'wireless', caseSensitive: false, matchType: 'contains' },
    { keyword: 'Bluetooth', tag: 'bluetooth', caseSensitive: false, matchType: 'contains' },
    { keyword: 'USB-C', tag: 'usb-c', caseSensitive: false, matchType: 'contains' },
    { keyword: 'WiFi 6', tag: 'wifi-6', caseSensitive: false, matchType: 'contains' },
    { keyword: 'refurbished', tag: 'refurbished', caseSensitive: false, matchType: 'contains' },
    { keyword: 'open box', tag: 'open-box', caseSensitive: false, matchType: 'contains' },
  ],
  variantAttributes: [
    { name: 'Colour', values: [] },
    { name: 'Storage', values: ['64GB', '128GB', '256GB', '512GB', '1TB'] },
    { name: 'Configuration', values: [] },
  ],
  enrichmentSources: ['staticice.com.au', 'mwave.com.au', 'scorptec.com.au', 'jbhifi.com.au'],
  seoCtas: [
    'Shop {brand} at {store} — fast delivery',
    'Latest tech at {store}',
    'Free shipping over {threshold} at {store}',
  ],
  seoDescTemplate: '{product} by {brand}. {features}Shop at {store} — fast delivery.',
  featureRules: [
    { pattern: /\bwireless\b/i, phrase: 'Wireless connectivity.' },
    { pattern: /\busb[\s-]*c\b/i, phrase: 'USB-C compatible.' },
    { pattern: /\bbluetooth\b/i, phrase: 'Bluetooth enabled.' },
    { pattern: /wifi[\s-]*6/i, phrase: 'WiFi 6 support.' },
  ],
  currencyDefault: 'AUD',
};

const HOME: IndustryDefinition = {
  id: 'home',
  displayName: 'Home & Lifestyle',
  icon: '🏠',
  descriptionLength: '2-3',
  descriptionStyle: 'Describe the aesthetic, material, and use.',
  descriptionFeatures: 'Mention: material, dimensions, care instructions, styling.',
  productTypes: types([
    'Cushion', 'Throw', 'Blanket', 'Bedding', 'Towels', 'Candle',
    'Diffuser', 'Vase', 'Picture Frame', 'Wall Art', 'Mirror',
    'Storage', 'Organiser', 'Kitchen', 'Cookware', 'Tableware',
    'Glassware', 'Outdoor', 'Garden', 'Lighting', 'Rugs',
    'Curtains', 'Furniture', 'Gifts', 'Stationery',
  ], 'Home'),
  defaultType: 'Homeware',
  tagLayers: [
    { name: 'Room', description: 'Room or area', type: 'single', values: ['bedroom', 'living room', 'kitchen', 'bathroom', 'outdoor', 'office'], order: 1 },
    { name: 'Category', description: 'Product category', type: 'single', values: ['decor', 'bedding', 'candles', 'kitchen', 'storage', 'gifts'], order: 2 },
    { name: 'Product Type', description: 'From product type list', type: 'auto', values: [], order: 3 },
    { name: 'Brand', description: 'Vendor/brand name', type: 'auto', values: [], order: 4 },
    { name: 'Arrival Month', description: 'Month product arrived', type: 'date', values: [], order: 5 },
    { name: 'Price Status', description: 'Full price or on sale', type: 'single', values: ['full_price', 'sale'], order: 6 },
    { name: 'Special Properties', description: 'Detected from keywords', type: 'multiple', values: [], order: 7 },
  ],
  specialRules: [
    { keyword: 'handmade', tag: 'handmade', caseSensitive: false, matchType: 'contains' },
    { keyword: 'sustainable', tag: 'sustainable', caseSensitive: false, matchType: 'contains' },
    { keyword: 'Australian made', tag: 'australian-made', caseSensitive: false, matchType: 'contains' },
    { keyword: 'gifting', tag: 'gifting', caseSensitive: false, matchType: 'contains' },
  ],
  variantAttributes: [
    { name: 'Colour', values: [] },
    { name: 'Size', values: ['Small', 'Medium', 'Large', 'Queen', 'King'] },
    { name: 'Material', values: ['Cotton', 'Linen', 'Wool', 'Ceramic', 'Glass', 'Wood'] },
  ],
  enrichmentSources: ['hardtofind.com.au', 'temple-webster.com.au', 'myer.com.au', 'kmart.com.au'],
  seoCtas: [
    'Shop {brand} homewares at {store}',
    'Transform your space with {store}',
    'Free shipping over {threshold} at {store}',
  ],
  seoDescTemplate: '{product} by {brand}. {features}Shop homewares at {store}.',
  featureRules: [
    { pattern: /handmade/i, phrase: 'Handmade.' },
    { pattern: /sustainab/i, phrase: 'Made from sustainable materials.' },
    { pattern: /australian\s*made/i, phrase: 'Australian made.' },
  ],
  currencyDefault: 'AUD',
};

const SPORTS: IndustryDefinition = {
  id: 'sports',
  displayName: 'Sports & Outdoors',
  icon: '⚽',
  descriptionLength: '2-3',
  descriptionStyle: 'Write in an active, performance-focused tone.',
  descriptionFeatures: 'Mention: performance features, material, sport/activity, fit.',
  productTypes: types([
    'Running Shoes', 'Training Shorts', 'Sports Top', 'Sports Bra',
    'Leggings', 'Jacket', 'Gym Bag', 'Water Bottle', 'Yoga Mat',
    'Resistance Bands', 'Weights', 'Cycling', 'Swimming', 'Team Sports',
    'Camping', 'Hiking', 'Surfing', 'Tennis', 'Golf',
    'Protective Gear', 'Accessories',
  ], 'Sports'),
  defaultType: 'Sports',
  tagLayers: [
    { name: 'Sport', description: 'Sport or activity', type: 'single', values: ['running', 'gym', 'yoga', 'swimming', 'cycling', 'surfing', 'camping'], order: 1 },
    { name: 'Category', description: 'Product category', type: 'single', values: ['clothing', 'footwear', 'equipment', 'accessories', 'nutrition'], order: 2 },
    { name: 'Product Type', description: 'From product type list', type: 'auto', values: [], order: 3 },
    { name: 'Brand', description: 'Vendor/brand name', type: 'auto', values: [], order: 4 },
    { name: 'Arrival Month', description: 'Month product arrived', type: 'date', values: [], order: 5 },
    { name: 'Price Status', description: 'Full price or on sale', type: 'single', values: ['full_price', 'sale'], order: 6 },
    { name: 'Special Properties', description: 'Detected from keywords', type: 'multiple', values: [], order: 7 },
  ],
  specialRules: [
    { keyword: 'UV protection', tag: 'uv-protection', caseSensitive: false, matchType: 'contains' },
    { keyword: 'waterproof', tag: 'waterproof', caseSensitive: false, matchType: 'contains' },
    { keyword: 'recycled', tag: 'recycled', caseSensitive: false, matchType: 'contains' },
  ],
  variantAttributes: [
    { name: 'Size', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
    { name: 'Colour', values: [] },
  ],
  enrichmentSources: ['rebel.com.au', 'surfstitch.com', 'wiggle.com.au', 'decathlon.com.au'],
  seoCtas: [
    'Shop {brand} at {store}',
    'Gear up at {store} — free delivery over {threshold}',
    'Performance gear from {brand} at {store}',
  ],
  seoDescTemplate: '{product} by {brand}. {features}Shop sports gear at {store}.',
  featureRules: [
    { pattern: /uv\s*protect/i, phrase: 'UV protection.' },
    { pattern: /waterproof/i, phrase: 'Waterproof construction.' },
    { pattern: /recycled/i, phrase: 'Made from recycled materials.' },
  ],
  currencyDefault: 'AUD',
};

const GENERAL: IndustryDefinition = {
  id: 'general',
  displayName: 'General Retail',
  icon: '🛒',
  descriptionLength: '2-3',
  descriptionStyle: 'Write in a helpful, informative retail tone.',
  descriptionFeatures: 'Mention: key features, material, and use case.',
  productTypes: [{ name: 'General', tag: 'general' }],
  defaultType: 'General',
  tagLayers: [
    { name: 'Category', description: 'User-defined category', type: 'single', values: [], order: 1 },
    { name: 'Brand', description: 'Vendor/brand name', type: 'auto', values: [], order: 2 },
    { name: 'Arrival Month', description: 'Month product arrived', type: 'date', values: [], order: 3 },
    { name: 'Price Status', description: 'Full price or on sale', type: 'single', values: ['full_price', 'sale'], order: 4 },
  ],
  specialRules: [],
  variantAttributes: [
    { name: 'Size', values: [] },
    { name: 'Colour', values: [] },
  ],
  enrichmentSources: [],
  seoCtas: [
    'Shop now at {store}',
    'Free shipping over {threshold} at {store}',
    'New arrivals at {store}',
  ],
  seoDescTemplate: '{product} by {brand}. {features}Shop at {store}.',
  featureRules: [],
  currencyDefault: 'AUD',
};

// ═══════════════════════════════════════════════════════════════
// REGISTRY
// ═══════════════════════════════════════════════════════════════

const INDUSTRY_REGISTRY: Record<string, IndustryDefinition> = {
  swimwear: SWIMWEAR,
  beauty: BEAUTY,
  clothing: CLOTHING,
  fashion: CLOTHING, // alias
  footwear: FOOTWEAR,
  health: HEALTH,
  electronics: ELECTRONICS,
  home: HOME,
  sports: SPORTS,
  general: GENERAL,
  // Legacy aliases
  jewellery: GENERAL,
};

export function getIndustryDefinition(id: string): IndustryDefinition {
  return INDUSTRY_REGISTRY[id] || GENERAL;
}

export function getIndustryList(): { id: string; name: string; icon: string }[] {
  // Return deduplicated list (no aliases)
  const unique = [SWIMWEAR, BEAUTY, CLOTHING, FOOTWEAR, HEALTH, ELECTRONICS, HOME, SPORTS, GENERAL];
  return unique.map(i => ({ id: i.id, name: i.displayName, icon: i.icon }));
}

export function getAllIndustryIds(): string[] {
  return ['swimwear', 'beauty', 'clothing', 'footwear', 'health', 'electronics', 'home', 'sports', 'general'];
}
