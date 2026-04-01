import { describe, it, expect } from "vitest";
import { runAnalytics, buildReorderItems, generateJoorCSV } from "@/lib/restock-analytics";
import type { ParsedInventory, InventoryVariant } from "@/lib/inventory-parser";

const makeVariant = (overrides: Partial<InventoryVariant>): InventoryVariant => ({
  productId: "", productName: "", brand: "", productType: "",
  sizeName: "Size", sizeValue: "", colourName: "Colour", colourValue: "Black",
  sku: "", qty: 0, price: 0, costPrice: 0, status: "active",
  ...overrides,
});

const testInventory: ParsedInventory = {
  source: "shopify_products",
  allBrands: ["Bond Eye", "Jantzen", "Seafolly"],
  allTypes: ["One Piece", "Kaftan"],
  totalProducts: 3,
  totalVariants: 12,
  archivedExcluded: 0,
  variants: [
    makeVariant({ productId: "mara", productName: "Mara One Piece", brand: "Bond Eye", productType: "One Piece", sizeValue: "8", sku: "BE2204-8", qty: 0, price: 180, costPrice: 58 }),
    makeVariant({ productId: "mara", productName: "Mara One Piece", brand: "Bond Eye", productType: "One Piece", sizeValue: "10", sku: "BE2204-10", qty: 4, price: 180, costPrice: 58 }),
    makeVariant({ productId: "mara", productName: "Mara One Piece", brand: "Bond Eye", productType: "One Piece", sizeValue: "12", sku: "BE2204-12", qty: 3, price: 180, costPrice: 58 }),
    makeVariant({ productId: "mara", productName: "Mara One Piece", brand: "Bond Eye", productType: "One Piece", sizeValue: "14", sku: "BE2204-14", qty: 2, price: 180, costPrice: 58 }),
    makeVariant({ productId: "sahara", productName: "Sahara Kaftan", brand: "Jantzen", productType: "Kaftan", sizeValue: "S", sku: "JA82001-S", qty: 0, price: 120, costPrice: 42 }),
    makeVariant({ productId: "sahara", productName: "Sahara Kaftan", brand: "Jantzen", productType: "Kaftan", sizeValue: "M", sku: "JA82001-M", qty: 0, price: 120, costPrice: 42 }),
    makeVariant({ productId: "sahara", productName: "Sahara Kaftan", brand: "Jantzen", productType: "Kaftan", sizeValue: "L", sku: "JA82001-L", qty: 5, price: 120, costPrice: 42 }),
    makeVariant({ productId: "sahara", productName: "Sahara Kaftan", brand: "Jantzen", productType: "Kaftan", sizeValue: "XL", sku: "JA82001-XL", qty: 4, price: 120, costPrice: 42 }),
    makeVariant({ productId: "mira", productName: "Mira One Piece", brand: "Seafolly", productType: "One Piece", sizeValue: "8", sku: "SF001-8", qty: 0, price: 160, costPrice: 50 }),
    makeVariant({ productId: "mira", productName: "Mira One Piece", brand: "Seafolly", productType: "One Piece", sizeValue: "10", sku: "SF001-10", qty: 0, price: 160, costPrice: 50 }),
    makeVariant({ productId: "mira", productName: "Mira One Piece", brand: "Seafolly", productType: "One Piece", sizeValue: "12", sku: "SF001-12", qty: 0, price: 160, costPrice: 50 }),
    makeVariant({ productId: "mira", productName: "Mira One Piece", brand: "Seafolly", productType: "One Piece", sizeValue: "14", sku: "SF001-14", qty: 0, price: 160, costPrice: 50 }),
  ],
};

describe("Restock Analytics", () => {
  const result = runAnalytics(testInventory);

  it("detects correct number of products", () => {
    expect(result.products).toHaveLength(3);
  });

  it("identifies Mira as complete stockout", () => {
    const mira = result.products.find(p => p.productId === "mira");
    expect(mira?.issue).toBe("complete_stockout");
  });

  it("identifies Mara as size hole", () => {
    const mara = result.products.find(p => p.productId === "mara");
    expect(mara?.issue).toBe("size_hole");
    expect(mara?.holesCount).toBe(1);
  });

  it("identifies Sahara as size hole with 2 holes", () => {
    const sahara = result.products.find(p => p.productId === "sahara");
    expect(sahara?.issue).toBe("size_hole");
    expect(sahara?.holesCount).toBe(2);
  });

  it("calculates correct summary", () => {
    expect(result.summary.completeStockouts).toBe(1);
    expect(result.summary.productsWithHoles).toBe(2);
  });

  it("suggests reorder for Mara size 8 = 4 units", () => {
    const mara = result.products.find(p => p.productId === "mara");
    const size8 = mara?.sizes.find(s => s.size === "8");
    expect(size8?.suggestedReorder).toBe(4); // avg(4,3,2)=3, ceil(3*1.2)=4
  });

  it("suggests reorder for Sahara S/M = 6 units", () => {
    const sahara = result.products.find(p => p.productId === "sahara");
    const sizeS = sahara?.sizes.find(s => s.size === "S");
    expect(sizeS?.suggestedReorder).toBe(6); // avg(5,4)=4.5, ceil(4.5*1.2)=6
  });

  it("builds reorder items correctly", () => {
    const items = buildReorderItems(result.products);
    expect(items.length).toBeGreaterThan(0);
    const maraItem = items.find(i => i.productId === "mara" && i.size === "8");
    expect(maraItem?.qty).toBe(4);
  });

  it("generates JOOR CSV", () => {
    const items = buildReorderItems(result.products);
    const csv = generateJoorCSV(items, "Bond Eye");
    expect(csv).toContain("Bond Eye");
    expect(csv).toContain("Mara One Piece");
  });

  it("calculates brand health", () => {
    expect(result.brands).toHaveLength(3);
    const bondEye = result.brands.find(b => b.brand === "Bond Eye");
    expect(bondEye?.soldOut).toBe(1);
  });

  it("sorts products by priority descending", () => {
    for (let i = 1; i < result.products.length; i++) {
      expect(result.products[i - 1].priorityScore).toBeGreaterThanOrEqual(result.products[i].priorityScore);
    }
  });
});
