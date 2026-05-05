// Canonical rule-method definitions for the Collection Builder.
// Some collection types are FIXED (one valid method only). Others let the
// user choose which Shopify smart-collection rule column to build with.

export type RuleColumn = "tag" | "title" | "vendor" | "type" | "product_type" | "variant_price";
export type RuleRelation =
  | "equals" | "contains" | "starts_with" | "ends_with"
  | "greater_than" | "less_than" | "not_equals";

export type RuleMethod = {
  label: string;
  description: string;
  rule_column: RuleColumn;
  rule_relation: RuleRelation;
  condition_template: string;   // {brand}, {tag}, {type}, {style_name}, etc.
  disjunctive: boolean;
  reliability: "high" | "medium" | "low";
  requires_good_tags: boolean;
  requires_good_type: boolean;
};

export type CollectionTypeConfig = {
  level_label: string;
  display_name: string;
  icon: string;
  choice_required: boolean;
  fixed_method?: RuleMethod;
  available_methods?: RuleMethod[];
  recommended_method?: string;
  note?: string;
};

export const COLLECTION_TYPE_CONFIGS: CollectionTypeConfig[] = [
  // ── Fixed ──────────────────────────────────────────
  {
    level_label: "brand",
    display_name: "Brand Collection",
    icon: "🏷️",
    choice_required: false,
    fixed_method: {
      label: "By vendor name",
      description: "Products where vendor = brand name",
      rule_column: "vendor", rule_relation: "equals",
      condition_template: "{brand}",
      disjunctive: false, reliability: "high",
      requires_good_tags: false, requires_good_type: false,
    },
    note: "Vendor is always set — this is the most reliable method.",
  },
  {
    level_label: "brand_story",
    display_name: "Brand Story / Print Collection",
    icon: "✨",
    choice_required: false,
    fixed_method: {
      label: "By title keyword",
      description: "Products where title contains the style name",
      rule_column: "title", rule_relation: "contains",
      condition_template: "{style_name}",
      disjunctive: false, reliability: "high",
      requires_good_tags: false, requires_good_type: false,
    },
    note: "Style/story/print names only exist in the product title — this is the only reliable method.",
  },
  {
    level_label: "feature",
    display_name: "Feature Collection",
    icon: "⭐",
    choice_required: false,
    fixed_method: {
      label: "By tag",
      description: "Products where tag = feature tag",
      rule_column: "tag", rule_relation: "equals",
      condition_template: "{feature_tag}",
      disjunctive: false, reliability: "high",
      requires_good_tags: true, requires_good_type: false,
    },
    note: "Feature tags are explicitly applied per the tag system.",
  },
  {
    level_label: "colour",
    display_name: "Colour Collection",
    icon: "🎨",
    choice_required: false,
    fixed_method: {
      label: "By tag",
      description: "Products where tag contains colour name",
      rule_column: "tag", rule_relation: "contains",
      condition_template: "{colour}",
      disjunctive: false, reliability: "medium",
      requires_good_tags: true, requires_good_type: false,
    },
    note: "Requires colour tags to be applied consistently.",
  },
  {
    level_label: "new_arrivals",
    display_name: "New Arrivals",
    icon: "🆕",
    choice_required: false,
    fixed_method: {
      label: "By new tag",
      description: "Products where tag = new arrivals",
      rule_column: "tag", rule_relation: "equals",
      condition_template: "new arrivals",
      disjunctive: false, reliability: "high",
      requires_good_tags: true, requires_good_type: false,
    },
  },

  // ── Choice required ────────────────────────────────
  {
    level_label: "category",
    display_name: "Category Collection",
    icon: "📂",
    choice_required: true,
    recommended_method: "By product type",
    note: "Both methods work. Use 'By product type' if your Type column is consistently filled. Use 'By tag' if tags are more reliable.",
    available_methods: [
      {
        label: "By product type",
        description: "Products where type = category name",
        rule_column: "type", rule_relation: "equals",
        condition_template: "{product_type}",
        disjunctive: false, reliability: "high",
        requires_good_tags: false, requires_good_type: true,
      },
      {
        label: "By tag",
        description: "Products where tag = category tag",
        rule_column: "tag", rule_relation: "equals",
        condition_template: "{category_tag}",
        disjunctive: false, reliability: "high",
        requires_good_tags: true, requires_good_type: false,
      },
      {
        label: "By tag OR type (broadest)",
        description: "Either tag or type matches — widest net",
        rule_column: "tag", rule_relation: "equals",
        condition_template: "{category_tag}",
        disjunctive: true, reliability: "high",
        requires_good_tags: true, requires_good_type: true,
      },
    ],
  },
  {
    level_label: "brand_category",
    display_name: "Brand + Category Collection",
    icon: "🏷️📂",
    choice_required: true,
    recommended_method: "By vendor AND tag",
    note: "For Splash Swimwear, 'By vendor AND tag' is recommended because tags are consistently applied.",
    available_methods: [
      {
        label: "By vendor AND tag",
        description: "Vendor = brand AND tag = category",
        rule_column: "vendor", rule_relation: "equals",
        condition_template: "{brand}",
        disjunctive: false, reliability: "high",
        requires_good_tags: true, requires_good_type: false,
      },
      {
        label: "By vendor AND type",
        description: "Vendor = brand AND type = category",
        rule_column: "vendor", rule_relation: "equals",
        condition_template: "{brand}",
        disjunctive: false, reliability: "high",
        requires_good_tags: false, requires_good_type: true,
      },
      {
        label: "By title prefix",
        description: "Title starts with brand name",
        rule_column: "title", rule_relation: "starts_with",
        condition_template: "{brand}",
        disjunctive: false, reliability: "medium",
        requires_good_tags: false, requires_good_type: false,
      },
    ],
  },
  {
    level_label: "sub_category",
    display_name: "Sub-category Collection",
    icon: "📁",
    choice_required: true,
    recommended_method: "By title keyword",
    note: "Sub-categories like 'Hipster', 'High Waist', 'Bandeau' are most reliably found in the product title.",
    available_methods: [
      {
        label: "By title keyword",
        description: "Title contains the cut/silhouette name",
        rule_column: "title", rule_relation: "contains",
        condition_template: "{sub_category}",
        disjunctive: false, reliability: "high",
        requires_good_tags: false, requires_good_type: false,
      },
      {
        label: "By tag",
        description: "Tag equals the sub-category tag",
        rule_column: "tag", rule_relation: "equals",
        condition_template: "{sub_category_tag}",
        disjunctive: false, reliability: "medium",
        requires_good_tags: true, requires_good_type: false,
      },
    ],
  },
];

export function getCollectionTypeConfig(level_label: string): CollectionTypeConfig | undefined {
  return COLLECTION_TYPE_CONFIGS.find(c => c.level_label === level_label);
}

// Compact preference shape sent to the edge function
export type MethodPreferences = {
  category: "type" | "tag" | "tag_or_type";
  brand_category: "vendor_tag" | "vendor_type" | "title_prefix";
  sub_category: "title" | "tag";
};

export const DEFAULT_METHOD_PREFS: MethodPreferences = {
  category: "type",
  brand_category: "vendor_type",
  sub_category: "title",
};

export const SPLASH_METHOD_PREFS: MethodPreferences = {
  category: "tag",
  brand_category: "vendor_tag",
  sub_category: "title",
};

export function getSmartDefaults(storeName?: string): MethodPreferences {
  if (storeName?.toLowerCase().includes("splash")) return { ...SPLASH_METHOD_PREFS };
  return { ...DEFAULT_METHOD_PREFS };
}

// Map a UI method label → preference key for that level
export function methodLabelToPrefKey(level_label: string, label: string): string | undefined {
  if (level_label === "category") {
    if (label === "By product type") return "type";
    if (label === "By tag") return "tag";
    if (label === "By tag OR type (broadest)") return "tag_or_type";
  }
  if (level_label === "brand_category") {
    if (label === "By vendor AND tag") return "vendor_tag";
    if (label === "By vendor AND type") return "vendor_type";
    if (label === "By title prefix") return "title_prefix";
  }
  if (level_label === "sub_category") {
    if (label === "By title keyword") return "title";
    if (label === "By tag") return "tag";
  }
  return undefined;
}

export function prefKeyToMethodLabel(level_label: string, key: string): string | undefined {
  const cfg = getCollectionTypeConfig(level_label);
  if (!cfg?.available_methods) return undefined;
  // reverse map by canonical position
  if (level_label === "category") {
    return { type: "By product type", tag: "By tag", tag_or_type: "By tag OR type (broadest)" }[key];
  }
  if (level_label === "brand_category") {
    return { vendor_tag: "By vendor AND tag", vendor_type: "By vendor AND type", title_prefix: "By title prefix" }[key];
  }
  if (level_label === "sub_category") {
    return { title: "By title keyword", tag: "By tag" }[key];
  }
  return undefined;
}

export const PREFS_LS_KEY = "sonic_collection_method_prefs";
