// ───────────────────────────────────────────────────────────────
// Azure Document Intelligence (prebuilt-layout) + LLM interpreter.
// Stage A: Azure Layout API extracts every table cell with row/col.
// Stage B: LLM reads the structured table JSON (not the raw PDF)
//          and returns one line item per colour × size cell.
// ───────────────────────────────────────────────────────────────
import { callAI, getContent, AIGatewayError } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AZURE_KEY = Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_KEY");
const AZURE_ENDPOINT = (Deno.env.get("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT") || "").replace(/\/+$/, "");
const API_VERSION = "2024-11-30";

interface AzureCell {
  rowIndex: number;
  columnIndex: number;
  rowSpan?: number;
  columnSpan?: number;
  content: string;
  kind?: string;
}
interface AzureTable {
  rowCount: number;
  columnCount: number;
  cells: AzureCell[];
}

function tableToGrid(t: AzureTable): string[][] {
  const grid: string[][] = Array.from({ length: t.rowCount }, () =>
    Array.from({ length: t.columnCount }, () => "")
  );
  for (const c of t.cells) {
    if (grid[c.rowIndex] && c.columnIndex < t.columnCount) {
      grid[c.rowIndex][c.columnIndex] = (c.content || "").trim();
    }
  }
  return grid;
}

async function runAzureLayout(fileBase64: string): Promise<AzureTable[]> {
  if (!AZURE_KEY || !AZURE_ENDPOINT) {
    throw new Error("Azure Document Intelligence credentials not configured");
  }

  const bytes = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));
  const url = `${AZURE_ENDPOINT}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=${API_VERSION}&outputContentFormat=markdown`;

  const submit = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": AZURE_KEY,
      "Content-Type": "application/octet-stream",
    },
    body: bytes,
  });

  if (!submit.ok) {
    const body = await submit.text().catch(() => "");
    throw new Error(`Azure submit failed (${submit.status}): ${body.slice(0, 400)}`);
  }

  const opLocation = submit.headers.get("operation-location");
  if (!opLocation) throw new Error("Azure did not return operation-location");

  // Poll
  const deadline = Date.now() + 110_000; // leave headroom under 150s
  let result: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetch(opLocation, {
      headers: { "Ocp-Apim-Subscription-Key": AZURE_KEY },
    });
    if (!poll.ok) continue;
    const j = await poll.json();
    const status = String(j?.status || "").toLowerCase();
    if (status === "succeeded") { result = j; break; }
    if (status === "failed") throw new Error(`Azure analysis failed: ${JSON.stringify(j?.error || {}).slice(0, 300)}`);
  }
  if (!result) throw new Error("Azure analysis timed out");

  const analyze = (result as { analyzeResult?: { tables?: AzureTable[] } }).analyzeResult;
  return analyze?.tables ?? [];
}

const LLM_SYSTEM = `You are an expert at interpreting wholesale fashion invoice tables parsed by an OCR layout engine.

Australian fashion invoices come in two formats:

FORMAT A — SIZE GRID
Rows = colours/styles, columns = sizes (XS/S/M/L/XL or 6/8/10/12/14/16).
Each cell intersection = one size's quantity.

FORMAT B — FLAT LIST (like Bond Eye, Baku, Jantzen)
Each row = one product line.
Columns typically: Style | Description | Units | RRP | SP | Disc% | Value | GST | Total
SP = sell price to retailer = cost ex GST.
RRP = recommended retail price incl GST.
Products may be grouped under category headers like "Recycled" or "Eco" — inherit the category as a tag but do not treat it as a product.
Sub-rows showing "O/S: N" = outstanding qty — use N as the qty for that product.

YOUR TASK:
1. Detect which format this invoice uses.
2. For FORMAT A: emit one line per colour × size intersection with qty > 0.
3. For FORMAT B: emit one line per product row.
   - style_code = the Style column value
   - product_title = Description column value
   - colour = extract from description after the last dash (e.g. "Ava 1 Pce - Black" → colour = "Black")
   - size = "" (no size on flat list invoices)
   - qty = Units column value, OR the O/S sub-row value if Units is blank
   - unit_cost = SP column value (ex GST)
   - rrp = RRP column value (incl GST)
   - category = section header if present (e.g. "Recycled", "Eco")
4. Skip: totals, subtotals, freight, GST rows, pure header rows, "O/S:" sub-rows (already used for qty), payment details rows.

Return STRICT JSON ONLY (no markdown):
{
  "format": "size_grid" | "flat_list",
  "products": [
    {
      "product_title": "",
      "style_code": "",
      "colour": "",
      "size": "",
      "qty": 1,
      "unit_cost": 0,
      "rrp": 0,
      "category": "",
      "sku": null
    }
  ]
}

Numbers must be JSON numbers not strings. Empty string for missing text, null for sku.`;

async function interpretTablesWithLLM(tables: AzureTable[], fileName: string, supplierName?: string) {
  const grids = tables.map((t, i) => ({
    table_index: i,
    row_count: t.rowCount,
    column_count: t.columnCount,
    rows: tableToGrid(t),
  }));

  const userPayload =
    `File: ${fileName}\n` +
    (supplierName ? `Supplier hint: ${supplierName}\n` : "") +
    `Number of tables: ${tables.length}\n\n` +
    `TABLE DATA (each row is an array of cell strings, indexed by column):\n` +
    JSON.stringify(grids).slice(0, 180_000);

  const data = await callAI({
    model: "google/gemini-2.5-pro",
    temperature: 0.05,
    messages: [
      { role: "system", content: LLM_SYSTEM },
      { role: "user", content: userPayload },
    ],
  });

  const raw = getContent(data);
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (m?.[1] || raw).trim();
  let parsed: { products?: unknown[]; format?: string };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${jsonStr.slice(0, 200)}`);
  }
  return {
    products: Array.isArray(parsed.products) ? parsed.products : [],
    format: parsed.format ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { fileContent, fileName, fileType, supplierName } = await req.json();
    if (!fileContent || !fileName) {
      return json({ error: "fileContent and fileName are required" }, 400);
    }

    const ext = String(fileType || fileName.split(".").pop() || "").toLowerCase();
    if (ext !== "pdf") {
      // Azure Layout supports images too, but our pipeline already handles images well via the LLM.
      return json({ skipped: true, reason: "non-pdf input" }, 200);
    }

    const t0 = Date.now();
    const tables = await runAzureLayout(fileContent);
    const tAzure = Date.now() - t0;

    // Raw Azure table JSON — preserved exactly as returned by prebuilt-layout
    // so any downstream LLM step (or audit) can re-interpret it.
    const rawTables = tables.map((t, i) => ({
      table_index: i,
      row_count: t.rowCount,
      column_count: t.columnCount,
      cells: t.cells,
      grid: tableToGrid(t),
    }));

    if (!tables.length) {
      return json({ products: [], raw_tables: [], tables_found: 0, azure_ms: tAzure, note: "no tables detected" }, 200);
    }

    const products = await interpretTablesWithLLM(tables, fileName, supplierName);
    return json({
      products,
      raw_tables: rawTables,
      tables_found: tables.length,
      azure_ms: tAzure,
      total_ms: Date.now() - t0,
      source: "azure_layout",
    }, 200);
  } catch (err) {
    console.error("azure-table-extract error:", err);
    const status = err instanceof AIGatewayError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : "Azure extraction failed" }, status);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
