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

const LLM_SYSTEM = `You are an expert at interpreting wholesale fashion invoice tables that have already been parsed by an OCR layout engine.

Each table cell is given to you with its row and column position preserved.

Your task:
1. Identify which table is the SIZE GRID (rows often = colours/styles, columns often = sizes such as XS/S/M/L/XL/6/8/10/12).
2. For every colour-row × size-column intersection, emit ONE line item — even if quantity is 0.
3. Inherit product_title, style_code and unit_cost from header rows or adjacent columns when needed.
4. Skip totals, subtotals, freight, GST and pure header rows.

Return STRICT JSON ONLY (no markdown, no commentary) in this exact shape:
{
  "products": [
    {
      "product_title": "",
      "style_code": "",
      "colour": "",
      "size": "",
      "qty": 0,
      "unit_cost": 0,
      "sku": null
    }
  ]
}

Numbers must be JSON numbers, not strings. Use empty strings for missing text, null for missing sku.`;

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
  let parsed: { products?: unknown[] };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${jsonStr.slice(0, 200)}`);
  }
  return Array.isArray(parsed.products) ? parsed.products : [];
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
