import { useEffect, useState } from "react";
import { ChevronLeft, Loader2, Download, Calendar, FileText, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { persistParsedInvoice } from "@/lib/invoice-persistence";
import type { ValidatedProduct } from "@/lib/invoice-validator";
import { toast } from "@/hooks/use-toast";

type Series = "x" | "r";
type Mode = "single" | "bulk";

type ConsignmentRow = {
  id: string;
  name: string;
  status: string;
  supplier_invoice?: string | null;
  received_at?: string | null;
  created_at?: string | null;
  total_cost?: number;
  total_count?: number;
};

type POLineX = {
  product_id: string;
  sku: string;
  name: string;
  supplier_code?: string | null;
  received: number;
  count: number;
  cost: number;
  retail_price?: number | null;
};

type POLineR = {
  item_id: string;
  sku: string;
  name: string;
  ordered: number;
  received: number;
  cost: number;
  retail_price?: number | null;
};

type RPORow = {
  id: string;
  order_number: string;
  status: string;
  create_time: string;
  arrival_date?: string;
  total: number;
  vendor_name?: string | null;
};

interface Props {
  onBack: () => void;
}

const todayMinus = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

export default function LightspeedInvoiceImport({ onBack }: Props) {
  const [series, setSeries] = useState<Series | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("single");
  const [dateFrom, setDateFrom] = useState(todayMinus(30));
  const [dateTo, setDateTo] = useState(todayMinus(0));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [xRows, setXRows] = useState<ConsignmentRow[]>([]);
  const [rRows, setRRows] = useState<RPORow[]>([]);

  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set());

  // Detect connected series on mount
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setError("Not signed in");
          return;
        }
        const { data: rows } = await supabase
          .from("pos_connections")
          .select("platform, ls_x_access_token, ls_r_access_token")
          .eq("user_id", user.id);
        const hasX = rows?.some(r => r.platform === "lightspeed_x" && r.ls_x_access_token);
        const hasR = rows?.some(r => r.platform === "lightspeed_r" && r.ls_r_access_token);
        if (hasX) setSeries("x");
        else if (hasR) setSeries("r");
        else setError("No Lightspeed connection found. Connect Lightspeed first in Account → Connections.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to check connections");
      } finally {
        setSeriesLoading(false);
      }
    })();
  }, []);

  async function loadList() {
    if (!series) return;
    setLoading(true);
    setError(null);
    try {
      if (series === "x") {
        const { data, error } = await supabase.functions.invoke("pos-proxy", {
          body: {
            platform: "lightspeed_x",
            action: "list_consignments_x",
            date_from: dateFrom,
            date_to: dateTo,
            page_size: 100,
          },
        });
        if (error) throw error;
        if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
        setXRows(((data as { consignments?: ConsignmentRow[] })?.consignments) || []);
      } else {
        const { data, error } = await supabase.functions.invoke("pos-proxy", {
          body: {
            platform: "lightspeed_r",
            action: "list_purchase_orders_r",
            date_from: dateFrom,
            date_to: dateTo,
            limit: 100,
          },
        });
        if (error) throw error;
        if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
        setRRows(((data as { purchase_orders?: RPORow[] })?.purchase_orders) || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (series && !seriesLoading) loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, seriesLoading]);

  async function importOne(id: string, supplierFallback: string, displayName: string) {
    if (!series) return;
    setImporting(id);
    setError(null);
    try {
      let supplier = supplierFallback;
      let invoiceNumber = displayName;
      let dateStr = new Date().toISOString().slice(0, 10);
      let lines: ValidatedProduct[] = [];
      let total = 0;

      if (series === "x") {
        const { data, error } = await supabase.functions.invoke("pos-proxy", {
          body: { platform: "lightspeed_x", action: "get_consignment_x", consignment_id: id },
        });
        if (error) throw error;
        if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
        const d = data as { consignment: { supplier_name?: string | null; supplier_invoice?: string | null; received_at?: string | null; total_cost?: number; name?: string }, lines: POLineX[] };
        supplier = d.consignment.supplier_name || supplierFallback || "Unknown supplier";
        invoiceNumber = d.consignment.supplier_invoice || d.consignment.name || displayName;
        dateStr = (d.consignment.received_at || new Date().toISOString()).slice(0, 10);
        total = Number(d.consignment.total_cost || 0);
        lines = d.lines.map((l, i) => mkValidatedProduct({
          rowIndex: i,
          name: l.name || l.sku || "Unknown product",
          sku: l.sku || l.supplier_code || "",
          qty: Number(l.received || l.count || 0),
          cost: Number(l.cost || 0),
          rrp: Number(l.retail_price || 0),
        }));
      } else {
        const { data, error } = await supabase.functions.invoke("pos-proxy", {
          body: { platform: "lightspeed_r", action: "get_purchase_order_r", order_id: id },
        });
        if (error) throw error;
        if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
        const d = data as { purchase_order: { vendor_name?: string | null; arrival_date?: string; create_time?: string; total?: number; order_number?: string }, lines: POLineR[] };
        supplier = d.purchase_order.vendor_name || supplierFallback || "Unknown supplier";
        invoiceNumber = `PO-${d.purchase_order.order_number || id}`;
        dateStr = (d.purchase_order.arrival_date || d.purchase_order.create_time || new Date().toISOString()).slice(0, 10);
        total = Number(d.purchase_order.total || 0);
        lines = d.lines.map((l, i) => mkValidatedProduct({
          rowIndex: i,
          name: l.name || l.sku || "Unknown item",
          sku: l.sku,
          qty: Number(l.received || l.ordered || 0),
          cost: Number(l.cost || 0),
          rrp: Number(l.retail_price || 0),
        }));
      }

      if (lines.length === 0) {
        toast({ title: "No line items", description: "This Lightspeed record has no line items to import.", variant: "destructive" });
        return;
      }

      const subtotal = lines.reduce((s, l) => s + l.cost * l.qty, 0);
      const result = await persistParsedInvoice(
        {
          supplier,
          invoiceNumber,
          invoiceDate: dateStr,
          currency: "AUD",
          subtotal,
          gst: null,
          total: total || subtotal,
          documentType: "invoice",
          layoutType: series === "x" ? "lightspeed_x_consignment" : "lightspeed_r_po",
          filename: `Lightspeed ${series === "x" ? "consignment" : "PO"} ${invoiceNumber}`,
        },
        lines,
      );

      if (result.error) throw new Error(result.error);

      setImported(prev => new Set(prev).add(id));
      toast({
        title: "Imported",
        description: `${supplier} • ${lines.length} line${lines.length === 1 ? "" : "s"} added as draft invoice.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed";
      setError(msg);
      toast({ title: "Import failed", description: msg, variant: "destructive" });
    } finally {
      setImporting(null);
    }
  }

  async function importAll() {
    const items = series === "x" ? xRows : rRows;
    for (const row of items) {
      if (imported.has(String(row.id))) continue;
      const supplierFallback = series === "x" ? "" : (row as RPORow).vendor_name || "";
      const display = series === "x" ? (row as ConsignmentRow).name : `PO-${(row as RPORow).order_number}`;
      await importOne(String(row.id), supplierFallback, display);
    }
  }

  const list = series === "x" ? xRows : rRows;

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold font-display">🖥️ Import from Lightspeed</h2>
      </div>

      {seriesLoading ? (
        <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : !series ? (
        <div className="rounded-lg border border-border bg-card p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">No Lightspeed connection</p>
            <p className="text-xs text-muted-foreground mt-1">{error || "Connect your Lightspeed POS in Account → Connections to import supplier data here."}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-card p-3 mb-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="w-3.5 h-3.5" />
                <span>Connected: <strong className="text-foreground">Lightspeed {series === "x" ? "X-Series" : "R-Series"}</strong></span>
              </div>
              <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
                <button
                  onClick={() => setMode("single")}
                  className={`px-3 py-1.5 ${mode === "single" ? "bg-primary text-primary-foreground" : "bg-input"}`}
                >
                  Pick one
                </button>
                <button
                  onClick={() => setMode("bulk")}
                  className={`px-3 py-1.5 ${mode === "bulk" ? "bg-primary text-primary-foreground" : "bg-input"}`}
                >
                  Bulk by date range
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-3">
              <label className="text-xs">
                <span className="text-muted-foreground flex items-center gap-1 mb-1"><Calendar className="w-3 h-3" /> From</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full h-8 rounded-md bg-input border border-border px-2 text-xs"
                />
              </label>
              <label className="text-xs">
                <span className="text-muted-foreground flex items-center gap-1 mb-1"><Calendar className="w-3 h-3" /> To</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full h-8 rounded-md bg-input border border-border px-2 text-xs"
                />
              </label>
            </div>

            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="outline" onClick={loadList} disabled={loading} className="h-8 text-xs">
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Refresh list
              </Button>
              {mode === "bulk" && list.length > 0 && (
                <Button size="sm" onClick={importAll} disabled={!!importing} className="h-8 text-xs">
                  <Download className="w-3.5 h-3.5 mr-1" />
                  Import all ({list.length})
                </Button>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-xs p-2 mb-3">
              {error}
            </div>
          )}

          {loading && list.length === 0 ? (
            <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : list.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              No {series === "x" ? "consignments" : "purchase orders"} found in this date range.
            </p>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-2.5 py-1.5 font-medium">{series === "x" ? "Consignment" : "PO #"}</th>
                    <th className="px-2.5 py-1.5 font-medium">{series === "x" ? "Supplier ref" : "Vendor"}</th>
                    <th className="px-2.5 py-1.5 font-medium">Date</th>
                    <th className="px-2.5 py-1.5 font-medium text-right">Total</th>
                    <th className="px-2.5 py-1.5 font-medium">Status</th>
                    <th className="px-2.5 py-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {series === "x" && (xRows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-2.5 py-1.5 font-mono-data">{r.name}</td>
                      <td className="px-2.5 py-1.5">{r.supplier_invoice || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-2.5 py-1.5 text-muted-foreground whitespace-nowrap">{(r.received_at || r.created_at || "").slice(0, 10)}</td>
                      <td className="px-2.5 py-1.5 text-right font-mono-data">${Number(r.total_cost || 0).toFixed(2)}</td>
                      <td className="px-2.5 py-1.5"><span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border border-border">{r.status}</span></td>
                      <td className="px-2.5 py-1.5 text-right">
                        {imported.has(String(r.id)) ? (
                          <span className="inline-flex items-center gap-1 text-success text-[11px]"><Check className="w-3 h-3" /> Imported</span>
                        ) : (
                          <Button size="sm" variant="ghost" disabled={!!importing} onClick={() => importOne(String(r.id), "", r.name)} className="h-7 text-[11px] px-2">
                            {importing === String(r.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : "Import"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )))}
                  {series === "r" && (rRows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-2.5 py-1.5 font-mono-data">PO-{r.order_number}</td>
                      <td className="px-2.5 py-1.5">{r.vendor_name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-2.5 py-1.5 text-muted-foreground whitespace-nowrap">{(r.arrival_date || r.create_time || "").slice(0, 10)}</td>
                      <td className="px-2.5 py-1.5 text-right font-mono-data">${Number(r.total || 0).toFixed(2)}</td>
                      <td className="px-2.5 py-1.5"><span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border border-border">{r.status}</span></td>
                      <td className="px-2.5 py-1.5 text-right">
                        {imported.has(String(r.id)) ? (
                          <span className="inline-flex items-center gap-1 text-success text-[11px]"><Check className="w-3 h-3" /> Imported</span>
                        ) : (
                          <Button size="sm" variant="ghost" disabled={!!importing} onClick={() => importOne(String(r.id), r.vendor_name || "", `PO-${r.order_number}`)} className="h-7 text-[11px] px-2">
                            {importing === String(r.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : "Import"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground mt-3">
            Imports are saved as <strong>draft invoices</strong> in History. Open them to review, enrich, and push to your accounting platform.
          </p>
        </>
      )}
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────

function mkValidatedProduct(args: {
  rowIndex: number;
  name: string;
  sku: string;
  qty: number;
  cost: number;
  rrp: number;
}): ValidatedProduct {
  const { rowIndex, name, sku, qty, cost, rrp } = args;
  return {
    name,
    brand: "",
    sku,
    barcode: "",
    type: "",
    colour: "",
    size: "",
    qty,
    cost,
    rrp,
    _rowIndex: rowIndex,
    _rawName: name,
    _rawCost: cost,
    _confidence: 95,
    _confidenceLevel: "high",
    _confidenceReasons: [{ label: "Sourced from Lightspeed POS", delta: 0 }],
    _issues: [],
    _corrections: [],
    _rejected: false,
    _classification: "product_title",
    _suggestedTitle: name,
    _suggestedPrice: rrp || cost,
    _suggestedVendor: "",
    _costSource: "lightspeed",
  };
}
