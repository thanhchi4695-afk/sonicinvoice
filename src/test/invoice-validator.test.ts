import { describe, expect, it } from "vitest";
import { validateAndCleanProducts } from "@/lib/invoice-validator";

describe("validateAndCleanProducts", () => {
  it("keeps repeated variant titles when rows have real product signals", () => {
    const raw = [
      {
        name: "Reid Leather Sandal",
        brand: "Walnut Melbourne",
        sku: "Reid-HS24",
        barcode: "",
        type: "Sandal",
        colour: "Coconut Tan",
        size: "36",
        qty: 1,
        cost: 68.16,
        rrp: 199.95,
      },
      {
        name: "Reid Leather Sandal",
        brand: "Walnut Melbourne",
        sku: "Reid-HS24",
        barcode: "",
        type: "Sandal",
        colour: "Coconut Tan",
        size: "37",
        qty: 1,
        cost: 68.16,
        rrp: 199.95,
      },
      {
        name: "Reid Leather Sandal",
        brand: "Walnut Melbourne",
        sku: "Reid-HS24",
        barcode: "",
        type: "Sandal",
        colour: "Coconut Tan",
        size: "38",
        qty: 2,
        cost: 68.16,
        rrp: 199.95,
      },
      {
        name: "Mon Cheri Skirt",
        brand: "Walnut Melbourne",
        sku: "MonCheriSkirt-W26",
        barcode: "",
        type: "Skirt",
        colour: "La Fraise",
        size: "1 Year",
        qty: 1,
        cost: 22.7,
        rrp: 59.95,
      },
    ];

    const { products, debug } = validateAndCleanProducts(raw, "Walnut Melbourne");

    expect(debug.rejected).toBe(0);
    expect(products.every((product) => !product._rejected)).toBe(true);
    expect(products.filter((product) => product.name === "Reid Leather Sandal")).toHaveLength(3);
  });
});