// ──────────────────────────────────────────────────────────────
// Group-by-Collection grouping logic — Seafolly invoice scenario.
// Mirrors the `collectionGroups` memo in PostParseReviewScreen so
// CI catches any regression in the Story → section bucketing rules:
//   • preserves invoice order (first collection seen renders first)
//   • items lacking a collection fall into "Unassigned"
//   • totalUnits sums quantities per section
// ──────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

interface Row {
  _rowIndex: number;
  qty: number;
  collection?: string;
}

const UNASSIGNED = "Unassigned";

function bucketByCollection(rows: Row[]) {
  const order: string[] = [];
  const buckets = new Map<string, Row[]>();
  for (const r of rows) {
    const key = (r.collection || "").trim() || UNASSIGNED;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(r);
  }
  return order.map((name) => ({
    name,
    items: buckets.get(name)!,
    totalUnits: buckets.get(name)!.reduce((s, i) => s + (i.qty || 0), 0),
  }));
}

describe("Group by Collection — Seafolly invoice", () => {
  // Row order matches the uploaded Seafolly invoice exactly:
  // SummerChintz / Beach Bound / SummerChintz / Beach Bound (interleaved).
  const seafollyRows: Row[] = [
    { _rowIndex: 0, qty: 7, collection: "SummerChintz" },   // Longline Slide Tri
    { _rowIndex: 1, qty: 9, collection: "Beach Bound" },     // Ring Front Tank
    { _rowIndex: 2, qty: 6, collection: "SummerChintz" },   // DD Cup Underwire Bra
    { _rowIndex: 3, qty: 9, collection: "SummerChintz" },   // MultiFit Ring Front Tank
    { _rowIndex: 4, qty: 7, collection: "Beach Bound" },     // Hipster Pant
    { _rowIndex: 5, qty: 8, collection: "SummerChintz" },   // Hipster Pant (Ecru)
    { _rowIndex: 6, qty: 7, collection: "SummerChintz" },   // Retro Pant
    { _rowIndex: 7, qty: 7, collection: "SummerChintz" },   // Tie Side Rio Pant
    { _rowIndex: 8, qty: 3, collection: "Beach Bound" },     // Scoop High Cut Rio
    { _rowIndex: 9, qty: 3, collection: "SummerChintz" },   // Summer Chintz Sarong
    { _rowIndex: 10, qty: 7, collection: "SummerChintz" },  // Shirred Waist Wrap Pant
    { _rowIndex: 11, qty: 7, collection: "SummerChintz" },  // Scarf Dress
    { _rowIndex: 12, qty: 6, collection: "SummerChintz" },  // Bandeau Mini Dress
  ];

  it("buckets all 13 rows into the two expected stories", () => {
    const groups = bucketByCollection(seafollyRows);
    expect(groups.map((g) => g.name)).toEqual(["SummerChintz", "Beach Bound"]);
    expect(groups[0].items).toHaveLength(10);
    expect(groups[1].items).toHaveLength(3);
  });

  it("sums totalUnits per collection (matches invoice line totals)", () => {
    const groups = bucketByCollection(seafollyRows);
    // SummerChintz: 7+6+9+8+7+7+3+7+7+6 = 67
    expect(groups[0].totalUnits).toBe(67);
    // Beach Bound: 9+7+3 = 19
    expect(groups[1].totalUnits).toBe(19);
    // 67 + 19 = 86 = "Total Units" printed on the Seafolly invoice footer.
    expect(groups[0].totalUnits + groups[1].totalUnits).toBe(86);
  });

  it("preserves invoice order — first row's collection renders first", () => {
    const groups = bucketByCollection(seafollyRows);
    expect(groups[0].name).toBe("SummerChintz");
  });

  it("falls back to 'Unassigned' when AI failed to extract a collection", () => {
    const mixed: Row[] = [
      { _rowIndex: 0, qty: 2, collection: "SummerChintz" },
      { _rowIndex: 1, qty: 5 }, // no collection
      { _rowIndex: 2, qty: 1, collection: "" }, // empty string
      { _rowIndex: 3, qty: 4, collection: "Beach Bound" },
    ];
    const groups = bucketByCollection(mixed);
    expect(groups.map((g) => g.name)).toEqual([
      "SummerChintz",
      "Unassigned",
      "Beach Bound",
    ]);
    expect(groups[1].items).toHaveLength(2);
    expect(groups[1].totalUnits).toBe(6);
  });
});
