// ══════════════════════════════════════════════════════════
// Walnut Melbourne deterministic invoice parser.
//
// The Supabase Edge Function (`parse-invoice`) imports the same helpers
// to handle stitched multi-invoice PDFs from Walnut. They live here so
// they can be regression-tested with vitest without spinning up Deno.
// ══════════════════════════════════════════════════════════

export const MULTI_INVOICE_HEADER_RE = /Tax Invoice[\s\S]{0,500}?Invoice No[\s:]+(\d+)/gi;
export const TABLE_HEADER_RE = /Code\s+Item\s+Options\s+Qty\s+Unit Price\s+Discount\s+Subtotal/i;
export const TABLE_FOOTER_RE = /Product Cost:|Sub Total:|Payment Terms/i;
export const SEASON_RE = /^(SS|AW|S|W|FW|HO|RE|HS|MS|LS)\d{2}$/i;

const MONEY_RE = /\$?\s*(-?\d{1,6}(?:,\d{3})*(?:\.\d{2})|-?\d+(?:\.\d{2}))/;
const SIZE_TOKEN_RE = /^(?:XXS|XS|S|M|L|XL|XXL|XXXL|OS|ONE\s*SIZE|FREE\s*SIZE|\d{1,2}|\d{1,2}\s*(?:AU|US|UK|EU|W)|\d{1,2}\s*(?:YEAR|YR|Y)|\d{1,2}\s*-\s*\d{1,2}\s*(?:YEAR|YR|Y)|\d{1,2}\s*(?:MONTH|MONTHS|MO|M)|\d{1,2}\s*-\s*\d{1,2}\s*(?:MONTH|MONTHS|MO|M))$/i;

export interface WalnutInvoiceChunk {
  invoiceNumber: string;
  text: string;
}

export function cleanInvoiceText(raw: string): string {
  // NOTE: we deliberately preserve runs of spaces — they encode column
  // separators in PDF-extracted invoice text. Collapsing them to single
  // spaces destroys our ability to split header rows into [code, title,
  // colour, qty, …] columns. We only collapse runs of 4+ to a normalised
  // 3-space gap (still unambiguous as a column separator).
  return String(raw || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/ {4,}/g, "   ");
}

export function splitMultiInvoicePdf(rawText: string): WalnutInvoiceChunk[] {
  const text = cleanInvoiceText(rawText);
  const markers: Array<{ index: number; invoiceNumber: string }> = [];
  const re = new RegExp(MULTI_INVOICE_HEADER_RE.source, MULTI_INVOICE_HEADER_RE.flags);
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    markers.push({ index: match.index, invoiceNumber: match[1] || "" });
  }

  if (markers.length <= 1) {
    const invoiceMatch = text.match(/Invoice No[\s:]+(\d+)/i);
    return [{ invoiceNumber: invoiceMatch?.[1] || "", text }];
  }

  return markers.map((marker, idx) => ({
    invoiceNumber: marker.invoiceNumber,
    text: text.slice(marker.index, idx + 1 < markers.length ? markers[idx + 1].index : text.length),
  }));
}

export function parseMoney(value: string): number | null {
  const m = String(value || "").match(MONEY_RE);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function isSizeToken(value: string): boolean {
  return SIZE_TOKEN_RE.test(String(value || "").trim());
}

export function normalizeWrappedCode(code: string): string {
  const tokens = String(code || "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  return tokens.reduce((acc, token, idx) => {
    if (idx === 0) return token;
    if (token.startsWith("-")) return `${acc}${token}`;
    return `${acc} ${token}`;
  }, "");
}

export function normalizeWhitespace(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * Like normalizeWhitespace but preserves runs of 2+ spaces (encoded as a
 * triple-space marker) so callers can still detect column separators after
 * trimming. Used for header-row parsing where column boundaries matter.
 */
export function normalizeColumnSpaced(value: string): string {
  return String(value || "")
    .replace(/\t/g, "   ")
    .replace(/ {2,}/g, "   ")
    .trim();
}

export function inferProductType(title: string): string {
  const t = String(title || "").toLowerCase();
  if (/sandal|shoe|boot|sneaker|loafer/.test(t)) return "sandal";
  if (/skirt/.test(t)) return "skirt";
  if (/dress/.test(t)) return "dress";
  if (/pant|trouser/.test(t)) return "pant";
  if (/top|tee|shirt|blouse/.test(t)) return "top";
  return "";
}

export function inferDepartment(type: string, sizes: string[]): string | null {
  const hasKidsSizes = sizes.some((size) => /year|yr|month|months|\d+y|\d+m/i.test(size));
  if (!hasKidsSizes) return null;
  return /shoe|sandal|boot|sneaker/i.test(type) ? "kids shoes" : "kids clothing";
}

export function findLineItemTable(invoiceText: string): string | null {
  const clean = cleanInvoiceText(invoiceText);
  const headerMatch = clean.match(TABLE_HEADER_RE);
  if (!headerMatch || headerMatch.index == null) return null;
  const start = headerMatch.index + headerMatch[0].length;
  const rest = clean.slice(start);
  const footerMatch = rest.match(TABLE_FOOTER_RE);
  const end = footerMatch?.index != null ? start + footerMatch.index : clean.length;
  return clean.slice(start, end).trim();
}

/**
 * Split the line-item table text into per-product blocks.
 *
 * A Walnut invoice with N products produces N (header-row, Size:, Qty:) triples,
 * back-to-back. Each block must be parsed independently — the size header for
 * one product MUST NOT bleed into the next. This was the root cause of the
 * Walnut 219077 phantom "Vermont Pant size 16" bug: the original parser called
 * `lines.find(headerRow)` once and only ever emitted the first product, OR
 * (when the deterministic path was bypassed) the LLM fell back to a cached
 * Walnut size template and back-filled missing sizes.
 *
 * A header row looks like:
 *   `<style code>  <title>  <colour>  <total_qty>  $unit_price  [$discount]  $line_total`
 * It contains `$` and a numeric qty, and is NOT a `Size:` / `Qty:` line.
 */
export function splitProductBlocks(tableText: string): string[] {
  // Use column-spaced normalisation so header rows keep their multi-space
  // column separators intact for downstream parseProductBlock().
  const lines = tableText.split("\n").map(normalizeColumnSpaced).filter(Boolean);
  const headerIndices: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^size\s*:/i.test(line) || /^qty\s*:/i.test(line)) continue;
    if (!/\$/.test(line) || !/\d/.test(line)) continue;
    // Header rows have `<digits> $<money>` somewhere — the total qty just before
    // the unit price. Reject lines that are pure "$X.XX $Y.YY" totals.
    if (!/\s\d+\s+\$?\s*\d/.test(line)) continue;
    headerIndices.push(i);
  }
  if (headerIndices.length === 0) return [];
  const blocks: string[] = [];
  for (let i = 0; i < headerIndices.length; i += 1) {
    const start = headerIndices[i];
    const end = i + 1 < headerIndices.length ? headerIndices[i + 1] : lines.length;
    blocks.push(lines.slice(start, end).join("\n"));
  }
  return blocks;
}

export function extractSizeQtyPairs(tableText: string): Array<{ size: string; quantity: number }> {
  const lines = tableText.split("\n").map((line) => normalizeWhitespace(line)).filter(Boolean);
  const sizeLineIndex = lines.findIndex((line) => /^size\s*:/i.test(line));
  const qtyLineIndex = lines.findIndex((line) => /^qty\s*:/i.test(line));
  if (sizeLineIndex === -1 || qtyLineIndex === -1) return [];

  const sizeTokens = lines[sizeLineIndex]
    .replace(/^size\s*:/i, "")
    .trim()
    .split(/\s{2,}|\t|\s(?=\d{1,2}(?:\s*(?:year|yr|month|months|m|y))?\b)|\s(?=XXS|XS|S|M|L|XL|XXL|XXXL|OS\b)/i)
    .map(normalizeWhitespace)
    .filter(Boolean);
  const qtyTokens = lines[qtyLineIndex]
    .replace(/^qty\s*:/i, "")
    .trim()
    .split(/\s+/)
    .map((token) => Number(token.replace(/[^\d.-]/g, "")))
    .filter((n) => Number.isFinite(n));

  const sizes = sizeTokens.filter(isSizeToken);
  const count = Math.min(sizes.length, qtyTokens.length);
  const pairs: Array<{ size: string; quantity: number }> = [];
  for (let i = 0; i < count; i += 1) {
    if (qtyTokens[i] > 0) pairs.push({ size: sizes[i], quantity: qtyTokens[i] });
  }
  return pairs;
}

export interface WalnutVariantRow {
  invoiceNumber: string;
  styleCode: string;
  productTitle: string;
  colour: string;
  size: string;
  quantity: number;
  unitPrice: number | null;
  discount: number | null;
  effectiveUnitCost: number | null;
  lineTotal: number | null;
  productType: string;
  department: string | null;
  costSource: "direct" | "discount_adjusted" | "derived_from_line_total";
  qtyChecksumOk: boolean;
  /** Header `Qty:` field for this product. */
  headerQty: number;
  /**
   * True when the count of size rows extracted for this product matches the
   * header `Qty:` field. Defence-in-depth against parsers that invent or drop
   * sizes (Walnut 219077 Vermont Pant phantom-size-16 bug).
   */
  qtyHeaderMatch: boolean;
}

export interface WalnutParseResult {
  invoiceCount: number;
  invoiceNumbers: string[];
  rows: WalnutVariantRow[];
  /**
   * Per-product warnings raised by the Qty header validator. Empty when every
   * product's extracted size-row count equals its header Qty. Surfaced on the
   * review screen so users can confirm or correct before downstream steps run.
   */
  warnings: Array<{
    invoiceNumber: string;
    productTitle: string;
    colour: string;
    extractedRows: number;
    headerQty: number;
    message: string;
  }>;
}

export function seasonFromSku(sku?: string): string {
  if (!sku) return "";
  const parts = sku.split(/[-_/]/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (SEASON_RE.test(part)) return part.toUpperCase();
  }
  return "";
}

interface ParsedProductBlock {
  styleCode: string;
  productTitle: string;
  colour: string;
  totalQty: number;
  unitPrice: number | null;
  discount: number | null;
  lineTotal: number | null;
  qtyPairs: Array<{ size: string; quantity: number }>;
}

/**
 * Parse a single product block (one header row + its own Size:/Qty: lines).
 * The block is sovereign — never reads sizes/qtys outside its own slice.
 */
function parseProductBlock(blockText: string): ParsedProductBlock | null {
  // Preserve column-spacing on the header row so we can split on multi-space
  // boundaries; size/qty lines don't need it.
  const lines = blockText.split("\n").map(normalizeColumnSpaced).filter(Boolean);
  const headerRow = lines.find((line) => /\$/.test(line) && /\d/.test(line) && !/^size\s*:/i.test(line) && !/^qty\s*:/i.test(line));
  if (!headerRow) return null;

  const moneyValues = Array.from(headerRow.matchAll(/\$?\s*\d{1,6}(?:,\d{3})*(?:\.\d{2})/g))
    .map((m) => parseMoney(m[0]))
    .filter((n): n is number => n != null);
  const qtyMatch = headerRow.match(/\s(\d+)\s+\$?\s*\d/);
  const totalQty = qtyMatch ? Number(qtyMatch[1]) : 0;
  const headerPrefix = qtyMatch ? headerRow.slice(0, qtyMatch.index).trim() : headerRow;

  // Primary split: column separators (2+ spaces). This is the well-formed
  // PDF-text path and produces clean [code, title, colour] tuples.
  let prefixParts = headerPrefix.split(/\s{2,}/).map(normalizeWhitespace).filter(Boolean);

  // Lenient fallback for OCR / single-space text: if column separators were
  // lost, derive title + colour from the style code itself (Walnut style
  // codes are `<Title>-<Season>-<Colour>` e.g. `Vermont Pant-W26-Jaguar Jungle Orange`).
  if (prefixParts.length < 3) {
    const wholeCodePlusRest = normalizeWhitespace(headerPrefix);
    // Style code is the first whitespace-separated token cluster ending before
    // the duplicated title (Walnut prints `<code> <title> <colour>` with the
    // title and colour repeated outside the code). Take everything as the
    // raw style code, then derive title + colour from its hyphen segments.
    const rawCode = wholeCodePlusRest.split(/\s{2,}|\s(?=[A-Z][a-z]+\s+[A-Z])/)[0] || wholeCodePlusRest;
    const codeNorm = normalizeWrappedCode(rawCode);
    const segments = codeNorm.split("-").map((s) => s.trim()).filter(Boolean);
    const seasonIdx = segments.findIndex((s) => SEASON_RE.test(s));
    if (seasonIdx > 0) {
      const titleFromCode = segments.slice(0, seasonIdx).join(" ").trim();
      const colourFromCode = segments.slice(seasonIdx + 1).join(" ").trim();
      prefixParts = [codeNorm, titleFromCode, colourFromCode].filter(Boolean);
    } else if (segments.length >= 2) {
      // No season marker — assume `<title>-<colour>`.
      prefixParts = [codeNorm, segments[0], segments.slice(1).join(" ")];
    }
  }

  const styleCode = normalizeWrappedCode(prefixParts[0] || "");
  const productTitle = prefixParts[1] || "";
  const colour = normalizeWhitespace((prefixParts.slice(2).join(" ") || "").replace(/\bTan\s+Tan\b/i, "Tan"));

  // CRITICAL: extractSizeQtyPairs is called with this block's text only —
  // never the full invoice table — so each product's size header is sovereign.
  const qtyPairs = extractSizeQtyPairs(blockText);
  const unitPrice = moneyValues[0] ?? null;
  const discount = moneyValues.length >= 3 ? moneyValues[1] : null;
  const lineTotal = moneyValues[moneyValues.length - 1] ?? null;

  return { styleCode, productTitle, colour, totalQty, unitPrice, discount, lineTotal, qtyPairs };
}

export function parseWalnutInvoiceText(rawText: string): WalnutParseResult {
  const chunks = splitMultiInvoicePdf(rawText);
  const invoiceNumbers: string[] = [];
  const rows: WalnutVariantRow[] = [];
  const warnings: WalnutParseResult["warnings"] = [];

  chunks.forEach((chunk) => {
    const invoiceNumber = chunk.invoiceNumber || chunk.text.match(/Invoice No[\s:]+(\d+)/i)?.[1] || "";
    if (invoiceNumber) invoiceNumbers.push(invoiceNumber);

    const tableText = findLineItemTable(chunk.text);
    if (!tableText) return;

    const blocks = splitProductBlocks(tableText);
    // Telemetry: emit one log per product so we can audit literal header reads.
    blocks.forEach((blockText) => {
      const parsed = parseProductBlock(blockText);
      if (!parsed) return;
      const { styleCode, productTitle, colour, totalQty, unitPrice, discount, lineTotal, qtyPairs } = parsed;

      const headerSizes = qtyPairs.map((p) => p.size);
      // eslint-disable-next-line no-console
      console.log(`[size-matrix] invoice=${invoiceNumber} product="${productTitle}" colour="${colour}" header_sizes=[${headerSizes.join(",")}] extracted_rows=${qtyPairs.length} header_qty=${totalQty}`);

      const qtyChecksum = qtyPairs.reduce((sum, pair) => sum + pair.quantity, 0);
      const qtyHeaderMatch = qtyPairs.length === totalQty || qtyChecksum === totalQty;

      if (!qtyHeaderMatch && totalQty > 0) {
        warnings.push({
          invoiceNumber,
          productTitle,
          colour,
          extractedRows: qtyPairs.length,
          headerQty: totalQty,
          message: `Extracted ${qtyPairs.length} size rows but invoice header says Qty: ${totalQty} — please review`,
        });
      }

      let costSource: WalnutVariantRow["costSource"] = "direct";
      let effectiveUnitCost = unitPrice;
      if (unitPrice != null && discount != null) {
        effectiveUnitCost = Math.round((unitPrice - discount) * 100) / 100;
        costSource = "discount_adjusted";
        if (lineTotal != null && totalQty > 0) {
          const subtotalCheck = effectiveUnitCost * totalQty;
          if (Math.abs(subtotalCheck - lineTotal) > 0.05) {
            effectiveUnitCost = Math.round((lineTotal / totalQty) * 100) / 100;
            costSource = "derived_from_line_total";
          }
        }
      }

      const productType = inferProductType(productTitle);
      const department = inferDepartment(productType, qtyPairs.map((p) => p.size));

      qtyPairs.forEach((pair) => {
        rows.push({
          invoiceNumber,
          styleCode,
          productTitle,
          colour,
          size: pair.size,
          quantity: pair.quantity,
          unitPrice,
          discount,
          effectiveUnitCost,
          lineTotal,
          productType,
          department,
          costSource,
          qtyChecksumOk: qtyChecksum === totalQty,
          headerQty: totalQty,
          qtyHeaderMatch,
        });
      });
    });
  });

  return { invoiceCount: chunks.length, invoiceNumbers, rows, warnings };
}