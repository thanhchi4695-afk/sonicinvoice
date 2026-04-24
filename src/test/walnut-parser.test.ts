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

    const monCheriRows = result.rows.filter((row) => row.invoiceNumber === "219244");
    expect(monCheriRows).toHaveLength(6);
    expect(monCheriRows[0].department).toBe("kids clothing");
    expect(monCheriRows[0].size).toBe("1 Year");
    expect(monCheriRows[0].effectiveUnitCost).toBeCloseTo(22.7, 2);
  });
});