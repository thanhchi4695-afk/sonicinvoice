import { deriveArrivalMonth, type WholesaleOrder, type WholesaleLineItem } from "./wholesale-mapper";

// ── JOOR ──
export function parseJoorOrders(apiResponse: any): WholesaleOrder[] {
  const orders = apiResponse?.order ?? apiResponse?.orders ?? [];
  const arr = Array.isArray(orders) ? orders : [orders];

  return arr.map((o: any) => ({
    orderId: String(o.order_id),
    platform: "joor",
    brandName: o.line_items?.[0]?.brand || o.brand_name || "",
    season: o.order_season_code || "",
    collection: o.order_delivery_name || "",
    currency: o.order_currency || "AUD",
    orderTotal: parseFloat(o.order_total) || 0,
    retailerName: o.retailer?.customer_name || "",
    status: o.order_type_name || "Approved",
    importedAt: new Date().toISOString(),
    lineItems: (o.line_items || []).map((li: any): WholesaleLineItem => ({
      styleNumber: li.style_number || "",
      styleName: li.style_name || "",
      description: li.style_description || "",
      brand: li.brand || o.brand_name || "",
      productType: li.silhouette || "",
      fabrication: li.fabrication || "",
      colour: li.color_name || "",
      colourCode: li.color_code || "",
      size: li.size_name || "",
      barcode: li.upc || "",
      rrp: parseFloat(li.price_retail) || 0,
      wholesale: parseFloat(li.price_wholesale) || 0,
      quantityOrdered: parseInt(li.quantity_ordered) || 0,
      season: o.order_season_code || "",
      collection: o.order_delivery_name || "",
      arrivalMonth: deriveArrivalMonth(o.order_season_code),
      imageUrl: li.image_url || "",
      sourceOrderId: String(o.order_id),
      sourcePlatform: "joor",
    })),
  }));
}

// ── NuOrder CSV ──
export function parseNuOrderCSV(rows: Record<string, string>[]): WholesaleOrder[] {
  return parseCSVWithPlatform(rows, "nuorder", {
    orderId: ["Order #", "Order Number", "order_id"],
    brand: ["Brand", "Vendor"],
    season: ["Season"],
    collection: ["Category", "Collection"],
    retailer: ["Retailer", "Company"],
    styleNumber: ["Style Number", "Style #"],
    styleName: ["Style Name", "Product Name"],
    description: ["Description"],
    productType: ["Category", "Type"],
    fabrication: ["Material", "Fabrication"],
    colour: ["Color", "Colour"],
    colourCode: ["Color Code", "Colour Code"],
    size: ["Size"],
    barcode: ["UPC", "Barcode"],
    rrp: ["MSRP", "RRP"],
    wholesale: ["Wholesale", "Price"],
    qty: ["Quantity", "Qty"],
    image: ["Image", "Image URL"],
  });
}

// ── Brandscope CSV ──
export function parseBrandscopeCSV(rows: Record<string, string>[]): WholesaleOrder[] {
  return parseCSVWithPlatform(rows, "brandscope", {
    orderId: ["Order No", "Order Number", "PO Number"],
    brand: ["Brand"],
    season: ["Season", "Release"],
    collection: ["Delivery", "Collection", "Release"],
    retailer: ["Retailer", "Account"],
    styleNumber: ["Style Code", "SKU"],
    styleName: ["Style Name", "Product Name"],
    description: ["Description"],
    productType: ["Category", "Product Type"],
    fabrication: ["Material", "Fabrication"],
    colour: ["Colour", "Color"],
    colourCode: ["Colour Code", "Color Code"],
    size: ["Size"],
    barcode: ["Barcode", "EAN", "UPC"],
    rrp: ["RRP", "Retail"],
    wholesale: ["Wholesale Price", "Price Ex", "Unit Cost"],
    qty: ["Qty Ordered", "Quantity"],
    image: ["Image URL", "Image"],
  });
}

// ── Brandboom CSV ──
export function parseBrandboomCSV(rows: Record<string, string>[]): WholesaleOrder[] {
  return parseCSVWithPlatform(rows, "brandboom", {
    orderId: ["Order ID", "Order #", "order_id"],
    brand: ["Brand", "Company"],
    season: ["Season"],
    collection: ["Showroom", "Collection", "Linesheet"],
    retailer: ["Retailer", "Buyer"],
    styleNumber: ["Style Number", "Style #"],
    styleName: ["Style Name", "Product"],
    description: ["Description"],
    productType: ["Category", "Type"],
    fabrication: ["Material"],
    colour: ["Color", "Colour"],
    colourCode: ["Color Code", "Colour Code"],
    size: ["Size"],
    barcode: ["UPC", "Barcode"],
    rrp: ["Retail", "MSRP"],
    wholesale: ["Wholesale", "Price"],
    qty: ["Qty", "Quantity"],
    image: ["Image", "Image URL"],
  });
}

// ── Faire API ──
export function parseFaireOrders(apiResponse: any): WholesaleOrder[] {
  const orders = apiResponse?.orders ?? [];
  return orders.map((o: any): WholesaleOrder => ({
    orderId: o.id || o.order_id || "",
    platform: "faire",
    brandName: o.brand?.name || "",
    season: o.season || "",
    collection: o.brand?.name || "",
    currency: o.currency || "AUD",
    orderTotal: (o.order_total_cents || 0) / 100,
    retailerName: o.retailer?.name || o.ship_to?.company_name || "",
    status: o.state || "ordered",
    importedAt: new Date().toISOString(),
    lineItems: (o.items || []).map((item: any): WholesaleLineItem => {
      const variant = item.product_option || {};
      return {
        styleNumber: variant.sku || item.product_id || "",
        styleName: item.name || item.product_name || "",
        description: item.description || "",
        brand: o.brand?.name || "",
        productType: item.category || "",
        fabrication: "",
        colour: variant.option1_value || variant.color || "",
        colourCode: "",
        size: variant.option2_value || variant.size || "",
        barcode: variant.barcode || variant.upc || "",
        rrp: (item.retailer_cost_cents || 0) / 100,
        wholesale: (item.wholesale_cost_cents || 0) / 100,
        quantityOrdered: item.quantity || 0,
        season: o.season || "",
        collection: o.brand?.name || "",
        arrivalMonth: deriveArrivalMonth(o.season || ""),
        imageUrl: item.image_url || "",
        sourceOrderId: o.id || "",
        sourcePlatform: "faire",
      };
    }),
  }));
}

// ── Generic CSV ──
export function parseGenericCSV(rows: Record<string, string>[]): WholesaleOrder[] {
  return parseCSVWithPlatform(rows, "csv", {
    orderId: ["Order No", "Order Number", "Order ID", "PO Number", "Order #", "order_id", "po_number"],
    brand: ["Brand", "Vendor", "Supplier", "brand"],
    season: ["Season", "Release", "season"],
    collection: ["Collection", "Delivery", "Linesheet", "Range", "collection"],
    retailer: ["Retailer", "Buyer", "Account", "Customer", "retailer"],
    styleNumber: ["Style Number", "Style Code", "SKU", "Style #", "style_number", "Article No"],
    styleName: ["Style Name", "Product Name", "Title", "Product", "Name", "style_name"],
    description: ["Description", "Body", "description"],
    productType: ["Type", "Category", "Product Type", "Silhouette", "product_type"],
    fabrication: ["Material", "Fabrication", "Fabric", "fabrication"],
    colour: ["Colour", "Color", "Colorway", "colour_name", "color_name"],
    colourCode: ["Colour Code", "Color Code", "colour_code", "color_code"],
    size: ["Size", "Size Name", "size", "Size Label"],
    barcode: ["Barcode", "UPC", "EAN", "GTIN", "barcode", "upc"],
    rrp: ["RRP", "MSRP", "Retail", "Retail Price", "rrp", "msrp"],
    wholesale: ["Wholesale", "Price", "Cost", "Unit Cost", "Wholesale Price", "Price Ex GST", "wholesale_price"],
    qty: ["Qty", "Quantity", "QTY", "Units", "qty_ordered", "Qty Ordered"],
    image: ["Image", "Image URL", "Image Src", "image_url", "Photo URL"],
  });
}

// ── Shared CSV parser ──
function parseCSVWithPlatform(
  rows: Record<string, string>[],
  platform: string,
  fieldMap: Record<string, string[]>
): WholesaleOrder[] {
  const get = (row: Record<string, string>, keys: string[]): string => {
    for (const k of keys) {
      if (row[k]) return row[k];
      const found = Object.keys(row).find((rk) => rk.toLowerCase() === k.toLowerCase());
      if (found && row[found]) return row[found];
    }
    return "";
  };

  const orderMap = new Map<string, WholesaleOrder>();

  for (const row of rows) {
    const orderId = get(row, fieldMap.orderId) || "imported";

    if (!orderMap.has(orderId)) {
      orderMap.set(orderId, {
        orderId,
        platform,
        brandName: get(row, fieldMap.brand),
        season: get(row, fieldMap.season),
        collection: get(row, fieldMap.collection),
        currency: get(row, ["Currency", "currency"]) || "AUD",
        orderTotal: 0,
        retailerName: get(row, fieldMap.retailer),
        status: "Imported",
        importedAt: new Date().toISOString(),
        lineItems: [],
      });
    }

    const order = orderMap.get(orderId)!;
    const qty = parseInt(get(row, fieldMap.qty) || "0") || 0;
    const wholesale = parseFloat(get(row, fieldMap.wholesale) || "0") || 0;
    order.orderTotal += qty * wholesale;

    order.lineItems.push({
      styleNumber: get(row, fieldMap.styleNumber),
      styleName: get(row, fieldMap.styleName),
      description: get(row, fieldMap.description),
      brand: get(row, fieldMap.brand),
      productType: get(row, fieldMap.productType),
      fabrication: get(row, fieldMap.fabrication),
      colour: get(row, fieldMap.colour),
      colourCode: get(row, fieldMap.colourCode),
      size: get(row, fieldMap.size),
      barcode: get(row, fieldMap.barcode),
      rrp: parseFloat(get(row, fieldMap.rrp) || "0") || 0,
      wholesale,
      quantityOrdered: qty,
      season: get(row, fieldMap.season),
      collection: get(row, fieldMap.collection),
      arrivalMonth: deriveArrivalMonth(get(row, fieldMap.season)),
      imageUrl: get(row, fieldMap.image),
      sourceOrderId: orderId,
      sourcePlatform: platform,
    });
  }

  return Array.from(orderMap.values());
}

// Auto-detect which platform a CSV likely came from based on column headers
export function detectPlatform(headers: string[]): string {
  const h = headers.map((s) => s.toLowerCase());
  if (h.some((c) => c.includes("style_number") || c.includes("silhouette")) && h.some((c) => c.includes("upc")))
    return "joor";
  if (h.some((c) => c.includes("ship start") || c.includes("ship end")))
    return "nuorder";
  if (h.some((c) => c.includes("ean") || c.includes("price ex")))
    return "brandscope";
  if (h.some((c) => c.includes("showroom")))
    return "brandboom";
  if (h.some((c) => c.includes("faire") || c.includes("retailer_cost")))
    return "faire";
  return "csv";
}
