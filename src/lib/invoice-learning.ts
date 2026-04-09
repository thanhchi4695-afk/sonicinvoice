// Invoice Learning Memory Engine
// Stores structural patterns learned from parsed invoices and merchant corrections
// No brand-specific logic — learns from document structure only

const MEMORY_KEY = "invoice_learning_memory";

// ── Core types ─────────────────────────────────────────────

export interface LayoutFingerprint {
  layoutType: string;
  variantMethod: string;
  sizeSystem: string;
  tableHeaders: string[];       // detected column headers in order
  lineItemZone: string;         // description of where products are
  costFieldRule: string;        // which field is cost
  quantityFieldRule: string;    // how quantity is expressed
  groupingRequired: boolean;
}

export interface NoisePattern {
  text: string;                 // the rejected row text (lowercased)
  reason: string;               // why it was noise
  occurrences: number;          // how many times this was rejected
}

export interface FieldCorrectionRule {
  field: string;                // "colour", "size", "cost", "title", etc.
  pattern: string;              // the AI's original extraction
  corrected: string;            // what the merchant changed it to
  occurrences: number;
  category?: CorrectionCategory; // structured correction type
}

export type CorrectionCategory =
  | "non_product_pattern"       // row was not a product (freight, GST, etc.)
  | "cost_field_mapping"        // AI picked wrong cost field
  | "size_interpretation"       // size grid / size system correction
  | "colour_extraction"         // colour was wrong or missing
  | "title_cleanup"             // title needed cleanup or rewrite
  | "grouping_rule"             // variant grouping was wrong
  | "vendor_mapping"            // vendor/brand was wrong
  | "quantity_mapping"          // quantity field was wrong
  | "reclassification"          // row moved between accepted/review/rejected
  | "general";                  // catch-all

export interface GroupingRule {
  description: string;          // e.g. "group by style_code ignoring colour suffix"
  occurrences: number;
}

export interface ReclassificationPattern {
  rawText: string;
  from: "accepted" | "review" | "rejected";
  to: "accepted" | "review" | "rejected";
  reason: string;
  occurrences: number;
}

export interface InvoiceMemory {
  // Identity — keyed by structural similarity, not brand name
  supplierName: string;         // supplier detected (used as secondary key)
  fingerprint: LayoutFingerprint;

  // Learning data
  noisePatterns: NoisePattern[];
  fieldCorrections: FieldCorrectionRule[];
  groupingRules: GroupingRule[];
  reclassifications: ReclassificationPattern[];  // NEW: tab movement patterns

  // Stats
  totalParses: number;
  totalCorrections: number;
  lastParsed: string;
  createdAt: string;
  confidenceBoost: number;      // 0-20, earned through successful corrections
}

// ── Storage ────────────────────────────────────────────────

function getAllMemories(): Record<string, InvoiceMemory> {
  try { return JSON.parse(localStorage.getItem(MEMORY_KEY) || "{}"); } catch { return {}; }
}

function saveAllMemories(memories: Record<string, InvoiceMemory>) {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memories));
}

/** Generate a structural key from a fingerprint (not from supplier name) */
function fingerprintKey(fp: LayoutFingerprint): string {
  const headers = (fp.tableHeaders || []).slice(0, 6).join("|").toLowerCase();
  return `${fp.layoutType}::${fp.variantMethod}::${headers}`;
}

/** Generate a supplier-based fallback key */
function supplierKey(supplier: string): string {
  return `supplier::${supplier.toLowerCase().trim()}`;
}

// ── Public API ─────────────────────────────────────────────

/** Record a successful parse into learning memory */
export function recordParseSuccess(
  supplier: string,
  fingerprint: LayoutFingerprint,
  rejectedRows?: { raw_text: string; rejection_reason: string }[],
) {
  const memories = getAllMemories();
  const fpKey = fingerprintKey(fingerprint);
  const supKey = supplierKey(supplier);

  // Use fingerprint key as primary, supplier as alias
  const existing = memories[fpKey] || memories[supKey];
  
  if (existing) {
    existing.fingerprint = fingerprint;
    existing.totalParses += 1;
    existing.lastParsed = new Date().toISOString();
    // Increase confidence with each successful parse (max +20)
    existing.confidenceBoost = Math.min(20, existing.confidenceBoost + 2);

    // Learn noise patterns from AI rejections
    if (rejectedRows) {
      for (const r of rejectedRows) {
        const text = (r.raw_text || "").toLowerCase().trim();
        if (!text) continue;
        const existing_noise = existing.noisePatterns.find(n => n.text === text);
        if (existing_noise) {
          existing_noise.occurrences += 1;
        } else {
          existing.noisePatterns.push({ text, reason: r.rejection_reason, occurrences: 1 });
        }
      }
      // Keep top 30 noise patterns by occurrence
      existing.noisePatterns.sort((a, b) => b.occurrences - a.occurrences);
      existing.noisePatterns = existing.noisePatterns.slice(0, 30);
    }

    memories[fpKey] = existing;
    // Also save under supplier key for fallback lookup
    if (supKey !== fpKey) memories[supKey] = existing;
  } else {
    const newMemory: InvoiceMemory = {
      supplierName: supplier,
      fingerprint,
      noisePatterns: (rejectedRows || [])
        .filter(r => r.raw_text)
        .map(r => ({ text: r.raw_text.toLowerCase().trim(), reason: r.rejection_reason, occurrences: 1 }))
        .slice(0, 30),
      fieldCorrections: [],
      groupingRules: [],
      reclassifications: [],
      totalParses: 1,
      totalCorrections: 0,
      lastParsed: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      confidenceBoost: 0,
    };
    memories[fpKey] = newMemory;
    memories[supKey] = newMemory;
  }

  saveAllMemories(memories);
}

/** Infer a structured correction category from field name */
export function inferCorrectionCategory(field: string): CorrectionCategory {
  const map: Record<string, CorrectionCategory> = {
    title: "title_cleanup", name: "title_cleanup",
    colour: "colour_extraction", color: "colour_extraction",
    size: "size_interpretation",
    cost: "cost_field_mapping", price: "cost_field_mapping",
    sku: "general", barcode: "general",
    qty: "quantity_mapping", quantity: "quantity_mapping",
    vendor: "vendor_mapping", brand: "vendor_mapping",
    ai_teaching: "general",
  };
  return map[field.toLowerCase()] || "general";
}

/** Record a merchant field correction with structured category */
export function recordFieldCorrection(
  supplier: string,
  field: string,
  original: string,
  corrected: string,
  category?: CorrectionCategory,
) {
  const memories = getAllMemories();
  const supKey = supplierKey(supplier);
  const memory = memories[supKey];
  if (!memory) return;

  const cat = category || inferCorrectionCategory(field);
  const existing = memory.fieldCorrections.find(
    fc => fc.field === field && fc.pattern === original && fc.corrected === corrected
  );
  if (existing) {
    existing.occurrences += 1;
    existing.category = cat;
  } else {
    memory.fieldCorrections.push({ field, pattern: original, corrected, occurrences: 1, category: cat });
  }
  // Keep top 50 corrections
  memory.fieldCorrections.sort((a, b) => b.occurrences - a.occurrences);
  memory.fieldCorrections = memory.fieldCorrections.slice(0, 50);
  memory.totalCorrections += 1;
  // Confidence drops slightly with corrections (AI got it wrong)
  memory.confidenceBoost = Math.max(0, memory.confidenceBoost - 1);

  saveAllMemories(memories);
}

/** Record a reclassification (row moved between tabs) */
export function recordReclassification(
  supplier: string,
  rawText: string,
  from: "accepted" | "review" | "rejected",
  to: "accepted" | "review" | "rejected",
  reason: string,
) {
  const memories = getAllMemories();
  const supKey = supplierKey(supplier);
  const memory = memories[supKey];
  if (!memory) return;

  // Initialize if missing (backward compat)
  if (!memory.reclassifications) memory.reclassifications = [];

  const text = rawText.toLowerCase().trim();
  const existing = memory.reclassifications.find(
    r => r.rawText === text && r.from === from && r.to === to
  );
  if (existing) {
    existing.occurrences += 1;
  } else {
    memory.reclassifications.push({ rawText: text, from, to, reason, occurrences: 1 });
  }
  memory.reclassifications.sort((a, b) => b.occurrences - a.occurrences);
  memory.reclassifications = memory.reclassifications.slice(0, 30);
  memory.totalCorrections += 1;
  memory.confidenceBoost = Math.max(0, memory.confidenceBoost - 1);

  saveAllMemories(memories);
}

/** Record a noise rejection (merchant manually rejected a row) */
export function recordNoiseRejection(supplier: string, rowText: string, reason: string) {
  const memories = getAllMemories();
  const supKey = supplierKey(supplier);
  const memory = memories[supKey];
  if (!memory) return;

  const text = rowText.toLowerCase().trim();
  const existing = memory.noisePatterns.find(n => n.text === text);
  if (existing) {
    existing.occurrences += 1;
  } else {
    memory.noisePatterns.push({ text, reason, occurrences: 1 });
  }
  memory.noisePatterns.sort((a, b) => b.occurrences - a.occurrences);
  memory.noisePatterns = memory.noisePatterns.slice(0, 30);

  saveAllMemories(memories);
}

/** Record a grouping correction */
export function recordGroupingRule(supplier: string, description: string) {
  const memories = getAllMemories();
  const supKey = supplierKey(supplier);
  const memory = memories[supKey];
  if (!memory) return;

  const existing = memory.groupingRules.find(g => g.description === description);
  if (existing) {
    existing.occurrences += 1;
  } else {
    memory.groupingRules.push({ description, occurrences: 1 });
  }
  memory.groupingRules = memory.groupingRules.slice(0, 10);

  saveAllMemories(memories);
}

/** Find the best matching memory for a supplier or layout */
export function findBestMemory(supplier?: string): InvoiceMemory | null {
  if (!supplier) return null;
  const memories = getAllMemories();
  
  // Exact supplier match
  const supKey = supplierKey(supplier);
  if (memories[supKey]) return memories[supKey];

  // Fuzzy supplier match
  const lowerSupplier = supplier.toLowerCase().trim();
  for (const [key, mem] of Object.entries(memories)) {
    if (key.startsWith("supplier::")) {
      const stored = key.replace("supplier::", "");
      if (lowerSupplier.includes(stored) || stored.includes(lowerSupplier)) {
        return mem;
      }
    }
  }

  return null;
}

/** Find a memory by layout fingerprint (structure-based matching) */
export function findMemoryByLayout(layoutType: string, variantMethod: string, tableHeaders: string[]): InvoiceMemory | null {
  const memories = getAllMemories();
  const headerStr = tableHeaders.slice(0, 6).join("|").toLowerCase();
  const fpKey = `${layoutType}::${variantMethod}::${headerStr}`;
  
  if (memories[fpKey]) return memories[fpKey];

  // Partial match: same layout + variant method
  for (const [key, mem] of Object.entries(memories)) {
    if (!key.startsWith("supplier::") && key.startsWith(`${layoutType}::${variantMethod}::`)) {
      return mem;
    }
  }

  return null;
}

/** Build a comprehensive hint for the AI from learned memory */
export function buildMemoryHint(supplier?: string): Record<string, unknown> | null {
  const memory = findBestMemory(supplier);
  if (!memory) return null;

  const hint: Record<string, unknown> = {
    layoutType: memory.fingerprint.layoutType,
    variantMethod: memory.fingerprint.variantMethod,
    sizeSystem: memory.fingerprint.sizeSystem,
    tableHeaders: memory.fingerprint.tableHeaders,
    lineItemZone: memory.fingerprint.lineItemZone,
    costFieldRule: memory.fingerprint.costFieldRule,
    quantityFieldRule: memory.fingerprint.quantityFieldRule,
    groupingRequired: memory.fingerprint.groupingRequired,
    confidenceBoost: memory.confidenceBoost,
    totalParses: memory.totalParses,
  };

  // Add noise patterns as exclusion rules
  if (memory.noisePatterns.length > 0) {
    hint.noiseExclusions = memory.noisePatterns
      .filter(n => n.occurrences >= 2) // only include patterns seen 2+ times
      .slice(0, 15)
      .map(n => `Reject rows matching: "${n.text}" (reason: ${n.reason})`);
  }

  // Add field corrections as categorized rules
  if (memory.fieldCorrections.length > 0) {
    hint.corrections = memory.fieldCorrections
      .filter(fc => fc.occurrences >= 1)
      .slice(0, 20)
      .map(fc => `[${fc.category || "general"}] In field "${fc.field}": replace "${fc.pattern}" with "${fc.corrected}" (seen ${fc.occurrences}x)`);

    // Also provide category-specific summaries for stronger AI guidance
    const categories = new Map<string, number>();
    memory.fieldCorrections.forEach(fc => {
      const cat = fc.category || "general";
      categories.set(cat, (categories.get(cat) || 0) + fc.occurrences);
    });
    hint.correctionSummary = Object.fromEntries(categories);
  }

  // Add grouping rules
  if (memory.groupingRules.length > 0) {
    hint.groupingRules = memory.groupingRules.map(g => g.description);
  }

  // Add reclassification patterns
  const reclasses = memory.reclassifications || [];
  if (reclasses.length > 0) {
    hint.reclassifications = reclasses
      .filter(r => r.occurrences >= 2)
      .slice(0, 10)
      .map(r => `Rows like "${r.rawText}" should be ${r.to} (was ${r.from}, reason: ${r.reason}, seen ${r.occurrences}x)`);
  }

  return hint;
}

/** Get all memories as a list for display */
export function getMemoryList(): InvoiceMemory[] {
  const memories = getAllMemories();
  // Deduplicate — only return supplier-keyed entries
  const seen = new Set<string>();
  const list: InvoiceMemory[] = [];
  for (const [key, mem] of Object.entries(memories)) {
    if (!key.startsWith("supplier::")) continue;
    const supName = mem.supplierName.toLowerCase();
    if (seen.has(supName)) continue;
    seen.add(supName);
    list.push(mem);
  }
  return list.sort((a, b) => b.totalParses - a.totalParses);
}

/** Delete a memory entry */
export function deleteMemory(supplier: string) {
  const memories = getAllMemories();
  const supKey = supplierKey(supplier);
  const memory = memories[supKey];
  
  // Remove supplier key
  delete memories[supKey];
  
  // Remove fingerprint key if exists
  if (memory) {
    const fpKey = fingerprintKey(memory.fingerprint);
    delete memories[fpKey];
  }
  
  saveAllMemories(memories);
}

/** Get memory stats for a supplier */
export function getMemoryStats(supplier: string): { parses: number; corrections: number; boost: number; noisePatterns: number } | null {
  const memory = findBestMemory(supplier);
  if (!memory) return null;
  return {
    parses: memory.totalParses,
    corrections: memory.totalCorrections,
    boost: memory.confidenceBoost,
    noisePatterns: memory.noisePatterns.length,
  };
}
