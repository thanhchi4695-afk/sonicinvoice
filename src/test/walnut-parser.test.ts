import { describe, expect, it } from "vitest";
import {
  extractSizeQtyPairs,
  findLineItemTable,
  inferDepartment,
  isSizeToken,
  normalizeWrappedCode,
  parseWalnutInvoiceText,
  seasonFromSku,
  splitMultiInvoicePdf,
  splitProductBlocks,
} from "@/lib/walnut-parser";

const WALNUT_TWO_INVOICES = `
WALNUT Tax Invoice
Invoice Date 24 Apr 2026 | Ref JR-19542198 | Invoice No 219242 | Customer PO No 19542198
Customer: Stomp Shoes

Code   Item   Options   Qty   Unit Price   Discount   Subtotal
Reid-HS24 -Coconut Tan   Reid Leather Sandal   Coconut Tan Tan   11   $68.16   $13.63   $599.81
Size: 36 37 38 39 40 41 42
Qty:  1  1  2  2  2  2  1

Product Cost: $599.81
Sub Total: $599.81
Tax (10%): $59.98
Tax Invoice Total (AUD): $659.79

WALNUT
Tax Invoice
Invoice Date 24 Apr 2026
Ref JR-18228196
Invoice No 219244
Customer PO No 18228196
Customer: Stomp Shoes

Code   Item   Options   Qty   Unit Price   Discount   Subtotal
Mon Cheri Skirt-W26-La Fraise   Mon Cheri Skirt   La Fraise Blue   6   $22.70   $0.00   $136.20
Size: 1 Year 2 Year 3 Year 4 Year 5 Year 6 Year
Qty:  1     1     1     1     1     1

Product Cost: $136.20
Sub Total: $136.20
Tax (10%): $13.62
Tax Invoice Total (AUD): $149.82
`;

/**
 * Walnut Melbourne invoice 219077 — the canary case for the Round 4 fix.
 *
 * Vermont Pant ships only 5 sizes (no size 16) — the size-16 column is
 * physically absent from the invoice, header reads `Qty: 5`, subtotal
 * $363.50 = 5 × $72.70. The other 4 products ship full 6-size grids.
 *
 * The pre-fix parser only emitted the FIRST product per chunk (used
 * `lines.find(headerRow)` → one match), so the LLM fallback path took over
 * and back-filled Vermont with a phantom size-16 row from a cached Walnut
 * size template. The fix iterates every product block independently and
 * reads each block's Size:/Qty: row literally.
 */
const WALNUT_219077 = `
WALNUT
Tax Invoice
Invoice Date 22 Apr 2026
Ref JR-18228187
Invoice No 219077
Customer PO No 18228187
Customer: Stomp Shoes

Code   Item   Options   Qty   Unit Price   Discount   Subtotal
Marrakesh Dress-W26-Mosaique   Marrakesh Dress   Mosaique Green   6   $68.16   $0.00   $408.96
Size: 6 8 10 12 14 16
Qty:  1 1 1  1  1  1

Madrid Pant-W26-Mosaique   Madrid Pant   Mosaique Green   6   $68.16   $0.00   $408.96
Size: 6 8 10 12 14 16
Qty:  1 1 1  1  1  1

Paris Dress-W26-Jaguar Jungle Orange   Paris Dress   Jaguar Jungle Orange   6   $104.52   $0.00   $627.12
Size: 6 8 10 12 14 16
Qty:  1 1 1  1  1  1

Vermont Pant-W26-Jaguar Jungle Orange   Vermont Pant   Jaguar Jungle Orange   5   $72.70   $0.00   $363.50
Size: 6 8 10 12 14
Qty:  1 1 1  1  1

Santiago Top-W26-Jaguar Jungle Orange   Santiago Top   Jaguar Jungle Orange   6   $63.61   $0.00   $381.66
Size: 6 8 10 12 14 16
Qty:  1 1 1  1  1  1

Product Cost: $2,190.20
Sub Total: $2,260.20
Tax (10%): $226.02
Tax Invoice Total (AUD): $2,486.22
`;

describe("Walnut parser regression", () => {
  it("isSizeToken accepts numeric, alpha and kids age sizes", () => {
    expect(isSizeToken("36")).toBe(true);
    expect(isSizeToken("XS")).toBe(true);
    expect(isSizeToken("1 Year")).toBe(true);
    expect(isSizeToken("0-3 Months")).toBe(true);
    expect(isSizeToken("12M")).toBe(true);
    expect(isSizeToken("foo")).toBe(false);
  });

  it("normalizeWrappedCode reassembles multi-line codes (no spaces around hyphens)", () => {
    expect(normalizeWrappedCode("Reid-HS24 -Coconut Tan")).toBe("Reid-HS24-Coconut Tan");
  });

  it("inferDepartment returns kids clothing for age-based sizes on a skirt", () => {
    expect(inferDepartment("skirt", ["1 Year", "2 Year"])).toBe("kids clothing");
    expect(inferDepartment("sandal", ["1 Year"])).toBe("kids shoes");
    expect(inferDepartment("dress", ["8", "10"])).toBeNull();
  });

  it("seasonFromSku recognises HS / MS / LS prefixes alongside SS / AW", () => {
    expect(seasonFromSku("Reid-HS24-Coconut Tan")).toBe("HS24");
    expect(seasonFromSku("Mon Cheri Skirt-W26-La Fraise")).toBe("W26");
    expect(seasonFromSku("Style-MS25-Print")).toBe("MS25");
    expect(seasonFromSku("plain-sku")).toBe("");
  });

  it("splitMultiInvoicePdf detects each Tax Invoice header", () => {
    const chunks = splitMultiInvoicePdf(WALNUT_TWO_INVOICES);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].invoiceNumber).toBe("219242");
    expect(chunks[1].invoiceNumber).toBe("219244");
  });

  it("findLineItemTable + extractSizeQtyPairs handle a single-line table", () => {
    const chunks = splitMultiInvoicePdf(WALNUT_TWO_INVOICES);
    const table = findLineItemTable(chunks[1].text);
    expect(table).not.toBeNull();
    const pairs = extractSizeQtyPairs(table!);
    expect(pairs).toHaveLength(6);
    expect(pairs[0]).toEqual({ size: "1 Year", quantity: 1 });
  });

  it("parseWalnutInvoiceText returns 2 groups and 13 expanded variant rows", () => {
    const result = parseWalnutInvoiceText(WALNUT_TWO_INVOICES);
    expect(result.invoiceCount).toBe(2);
    expect(result.invoiceNumbers).toEqual(["219242", "219244"]);
    expect(result.rows).toHaveLength(13);

    const reidRows = result.rows.filter((row) => row.invoiceNumber === "219242");
    expect(reidRows).toHaveLength(7);
    const reidQty = reidRows.reduce((sum, row) => sum + row.quantity, 0);
    expect(reidQty).toBe(11);
    // Per-unit discount must reduce cost from $68.16 to $54.53.
    expect(reidRows[0].effectiveUnitCost).toBeCloseTo(54.53, 2);
    expect(reidRows[0].costSource).toBe("discount_adjusted");
    expect(reidRows.every((row) => row.qtyChecksumOk)).toBe(true);
    expect(reidRows.every((row) => row.qtyHeaderMatch)).toBe(true);

    const monCheriRows = result.rows.filter((row) => row.invoiceNumber === "219244");
    expect(monCheriRows).toHaveLength(6);
    expect(monCheriRows[0].department).toBe("kids clothing");
    expect(monCheriRows[0].size).toBe("1 Year");
    expect(monCheriRows[0].effectiveUnitCost).toBeCloseTo(22.7, 2);

    expect(result.warnings).toEqual([]);
  });
});

describe("Walnut Round 4 — per-product block parsing (219077 regression)", () => {
  it("splitProductBlocks emits one block per product header row", () => {
    const chunks = splitMultiInvoicePdf(WALNUT_219077);
    expect(chunks).toHaveLength(1);
    const table = findLineItemTable(chunks[0].text)!;
    const blocks = splitProductBlocks(table);
    expect(blocks).toHaveLength(5);
    expect(blocks[0]).toMatch(/Marrakesh Dress/);
    expect(blocks[1]).toMatch(/Madrid Pant/);
    expect(blocks[2]).toMatch(/Paris Dress/);
    expect(blocks[3]).toMatch(/Vermont Pant/);
    expect(blocks[4]).toMatch(/Santiago Top/);
  });

  it("each product block's Size: row is sovereign — no cross-product bleed", () => {
    const chunks = splitMultiInvoicePdf(WALNUT_219077);
    const table = findLineItemTable(chunks[0].text)!;
    const blocks = splitProductBlocks(table);
    const vermontBlock = blocks[3];
    const vermontPairs = extractSizeQtyPairs(vermontBlock);
    // Vermont has 5 sizes — the size-16 column is physically absent.
    expect(vermontPairs).toHaveLength(5);
    expect(vermontPairs.map((p) => p.size)).toEqual(["6", "8", "10", "12", "14"]);
    expect(vermontPairs.every((p) => p.quantity === 1)).toBe(true);

    // All other products have 6 sizes (full grid).
    [0, 1, 2, 4].forEach((idx) => {
      const pairs = extractSizeQtyPairs(blocks[idx]);
      expect(pairs).toHaveLength(6);
      expect(pairs.map((p) => p.size)).toEqual(["6", "8", "10", "12", "14", "16"]);
    });
  });

  it("parseWalnutInvoiceText returns 29 rows for 219077 (NOT 30 — no phantom Vermont size 16)", () => {
    const result = parseWalnutInvoiceText(WALNUT_219077);
    expect(result.invoiceCount).toBe(1);
    expect(result.invoiceNumbers).toEqual(["219077"]);
    // 6 + 6 + 6 + 5 + 6 = 29 — NOT 30.
    expect(result.rows).toHaveLength(29);
  });

  it("Vermont Pant Jaguar Jungle has exactly 5 size rows summing to $363.50", () => {
    const result = parseWalnutInvoiceText(WALNUT_219077);
    const vermont = result.rows.filter((r) => r.productTitle === "Vermont Pant");
    expect(vermont).toHaveLength(5);
    expect(vermont.map((r) => r.size).sort()).toEqual(["10", "12", "14", "6", "8"]);
    expect(vermont.every((r) => r.colour === "Jaguar Jungle Orange")).toBe(true);
    expect(vermont.every((r) => r.effectiveUnitCost === 72.7)).toBe(true);
    const subtotal = vermont.reduce((sum, r) => sum + (r.effectiveUnitCost ?? 0) * r.quantity, 0);
    expect(subtotal).toBeCloseTo(363.5, 2);
    // Phantom-size-16 must not appear.
    expect(vermont.find((r) => r.size === "16")).toBeUndefined();
  });

  it("All 4 full-grid products keep their 6 size rows (parser is not over-fitted to 5)", () => {
    const result = parseWalnutInvoiceText(WALNUT_219077);
    ["Marrakesh Dress", "Madrid Pant", "Paris Dress", "Santiago Top"].forEach((title) => {
      const rows = result.rows.filter((r) => r.productTitle === title);
      expect(rows, `${title} should have 6 size rows`).toHaveLength(6);
      expect(rows.find((r) => r.size === "16"), `${title} should include size 16`).toBeDefined();
    });
  });

  it("Qty header validator passes for all 5 products on 219077 (no false alarms)", () => {
    const result = parseWalnutInvoiceText(WALNUT_219077);
    expect(result.warnings).toEqual([]);
    expect(result.rows.every((r) => r.qtyHeaderMatch)).toBe(true);
    // Per-product header Qty must match extracted row count.
    const groups = new Map<string, number>();
    result.rows.forEach((r) => groups.set(r.productTitle, (groups.get(r.productTitle) ?? 0) + 1));
    expect(groups.get("Marrakesh Dress")).toBe(6);
    expect(groups.get("Madrid Pant")).toBe(6);
    expect(groups.get("Paris Dress")).toBe(6);
    expect(groups.get("Vermont Pant")).toBe(5);
    expect(groups.get("Santiago Top")).toBe(6);
  });

  it("Qty header validator FIRES when extracted rows ≠ header Qty (defence-in-depth)", () => {
    // Synthetic invoice where the size matrix accidentally has 6 columns
    // but the header says Qty: 5 — exactly what the old phantom-size-16 bug
    // would have produced. Validator must catch it and emit a warning.
    const PHANTOM_INVOICE = `
WALNUT Tax Invoice
Invoice No 999999

Code   Item   Options   Qty   Unit Price   Discount   Subtotal
Vermont Pant-W26-JJO   Vermont Pant   Jaguar Jungle Orange   5   $72.70   $0.00   $363.50
Size: 6 8 10 12 14 16
Qty:  1 1 1  1  1  1

Product Cost: $363.50
Sub Total: $363.50
`;
    const result = parseWalnutInvoiceText(PHANTOM_INVOICE);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].productTitle).toBe("Vermont Pant");
    expect(result.warnings[0].extractedRows).toBe(6);
    expect(result.warnings[0].headerQty).toBe(5);
    expect(result.warnings[0].message).toMatch(/please review/i);
    // Rows should still be returned (so the user can edit them on the review
    // screen) but every row inherits the qtyHeaderMatch=false flag.
    expect(result.rows.every((r) => r.qtyHeaderMatch === false)).toBe(true);
  });
});
