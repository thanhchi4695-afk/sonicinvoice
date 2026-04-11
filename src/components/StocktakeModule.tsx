import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Plus, Download, Upload, ClipboardCheck, History,
  Check, Loader2, AlertTriangle, FileText,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";
import { getLocations } from "@/lib/shopify-api";
import Papa from "papaparse";

/* ─── Types ─── */

interface StocktakeRow {
  id: string;
  location: string;
  status: string;
  notes: string | null;
  counted_at: string;
  created_at: string;
  line_count?: number;
}

interface StocktakeLine {
  id: string;
  sku: string | null;
  barcode: string | null;
  product_title: string | null;
  shopify_variant_id: string | null;
  expected_qty: number;
  counted_qty: number;
  variance: number | null;
}

type Screen = "list" | "new" | "import_count" | "variance" | "applying" | "done" | "history_detail";

interface LocationOption {
  id: string;
  name: string;
}

/* ─── Component ─── */

interface StocktakeModuleProps {
  onBack: () => void;
}

const StocktakeModule = ({ onBack }: StocktakeModuleProps) => {
  const [screen, setScreen] = useState<Screen>("list");
  const [stocktakes, setStocktakes] = useState<StocktakeRow[]>([]);
  const [loading, setLoading] = useState(true);

  // New stocktake form
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [newLocation, setNewLocation] = useState("");
  const [newType, setNewType] = useState<"full" | "cycle">("full");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);

  // Active stocktake
  const [activeStocktakeId, setActiveStocktakeId] = useState<string | null>(null);
  const [activeLines, setActiveLines] = useState<StocktakeLine[]>([]);
  const [importedCounts, setImportedCounts] = useState<Map<string, number>>(new Map());

  // Apply progress
  const [applyProgress, setApplyProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    loadStocktakes();
    loadLocations();
  }, []);

  const loadLocations = async () => {
    try {
      const locs = await getLocations();
      setLocations(locs.map(l => ({ id: l.id, name: l.name })));
      if (locs.length > 0) setNewLocation(locs[0].name);
    } catch {
      setLocations([{ id: "main", name: "Main Store" }]);
      setNewLocation("Main Store");
    }
  };

  const loadStocktakes = async () => {
    setLoading(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      const { data, error } = await supabase
        .from("stocktakes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      // Get line counts
      const ids = (data || []).map(s => s.id);
      let lineCounts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: lines } = await supabase
          .from("stocktake_lines")
          .select("stocktake_id")
          .in("stocktake_id", ids);
        if (lines) {
          lines.forEach(l => {
            lineCounts[l.stocktake_id] = (lineCounts[l.stocktake_id] || 0) + 1;
          });
        }
      }

      setStocktakes(
        (data || []).map(s => ({ ...s, line_count: lineCounts[s.id] || 0 }))
      );
    } catch (err) {
      toast.error("Failed to load stocktakes");
    } finally {
      setLoading(false);
    }
  };

  /* ─── Create New Stocktake ─── */

  const handleCreateStocktake = async () => {
    setCreating(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("stocktakes")
        .insert({
          user_id: user.user.id,
          location: newLocation || "Main Store",
          status: "draft",
          notes: `${newType === "cycle" ? "Cycle count" : "Full stocktake"}${newDescription ? ` — ${newDescription}` : ""}`,
        })
        .select()
        .single();

      if (error) throw error;

      // Load system quantities from variants table for this location
      const { data: variants } = await supabase
        .from("variants")
        .select("id, sku, barcode, quantity, shopify_variant_id, product_id")
        .eq("user_id", user.user.id);

      const { data: products } = await supabase
        .from("products")
        .select("id, title")
        .eq("user_id", user.user.id);

      const productMap = new Map((products || []).map(p => [p.id, p.title]));

      // Insert stocktake lines for all variants
      if (variants && variants.length > 0) {
        const lines = variants.map(v => ({
          user_id: user.user!.id,
          stocktake_id: data.id,
          sku: v.sku,
          barcode: v.barcode,
          product_title: productMap.get(v.product_id) || null,
          shopify_variant_id: v.shopify_variant_id,
          expected_qty: v.quantity,
          counted_qty: 0,
          variance: null,
        }));

        const CHUNK = 50;
        for (let i = 0; i < lines.length; i += CHUNK) {
          await supabase.from("stocktake_lines").insert(lines.slice(i, i + CHUNK));
        }
      }

      addAuditEntry("stocktake_created", `Created ${newType} stocktake at ${newLocation} with ${variants?.length || 0} lines`);
      toast.success("Stocktake created");
      setActiveStocktakeId(data.id);
      await loadStocktakeLines(data.id);
      setScreen("import_count");
      loadStocktakes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create stocktake");
    } finally {
      setCreating(false);
    }
  };

  /* ─── Load Lines ─── */

  const loadStocktakeLines = async (stocktakeId: string) => {
    const { data, error } = await supabase
      .from("stocktake_lines")
      .select("*")
      .eq("stocktake_id", stocktakeId)
      .order("product_title", { ascending: true });

    if (!error && data) {
      setActiveLines(data as StocktakeLine[]);
    }
  };

  /* ─── Export System Quantities CSV ─── */

  const exportSystemCSV = () => {
    const rows = activeLines.map(l => ({
      SKU: l.sku || "",
      Barcode: l.barcode || "",
      Product: l.product_title || "",
      variant_id: l.shopify_variant_id || "",
      current_quantity: l.expected_qty,
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stocktake-system-quantities-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("System quantities exported");
  };

  /* ─── Import Counted Quantities ─── */

  const handleImportCounted = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const counts = new Map<string, number>();
        let matched = 0;

        (results.data as Record<string, string>[]).forEach(row => {
          const sku = (row.SKU || row.sku || row.Sku || "").trim();
          const barcode = (row.Barcode || row.barcode || "").trim();
          const qty = parseInt(row.counted_qty || row.Counted || row.counted || row.Count || row.count || "0", 10);

          if (isNaN(qty)) return;

          // Match by SKU first, then barcode
          const matchLine = activeLines.find(l =>
            (sku && l.sku && l.sku.toLowerCase() === sku.toLowerCase()) ||
            (barcode && l.barcode && l.barcode === barcode)
          );

          if (matchLine) {
            counts.set(matchLine.id, qty);
            matched++;
          }
        });

        setImportedCounts(counts);
        toast.success(`Matched ${matched} of ${results.data.length} rows`);

        // Update local state with imported counts
        setActiveLines(prev => prev.map(l => {
          const counted = counts.get(l.id);
          if (counted !== undefined) {
            return { ...l, counted_qty: counted, variance: counted - l.expected_qty };
          }
          return l;
        }));

        setScreen("variance");
      },
      error: () => toast.error("Failed to parse CSV"),
    });
  };

  /* ─── Variance Stats ─── */

  const varianceStats = useMemo(() => {
    const lines = activeLines.filter(l => l.variance !== null);
    const overCount = lines.filter(l => (l.variance || 0) > 0).length;
    const underCount = lines.filter(l => (l.variance || 0) < 0).length;
    const exactCount = lines.filter(l => l.variance === 0).length;
    const totalVariance = lines.reduce((sum, l) => sum + Math.abs(l.variance || 0), 0);
    return { overCount, underCount, exactCount, totalVariance, total: lines.length };
  }, [activeLines]);

  /* ─── Approve & Apply Adjustments ─── */

  const handleApproveAdjustments = async () => {
    const adjustLines = activeLines.filter(l => l.variance !== null && l.variance !== 0);
    if (adjustLines.length === 0) {
      toast.info("No variances to adjust");
      return;
    }

    setScreen("applying");
    setApplyProgress({ done: 0, total: adjustLines.length });

    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("Not authenticated");

      // Save counted quantities back to stocktake_lines
      for (const line of adjustLines) {
        await supabase
          .from("stocktake_lines")
          .update({ counted_qty: line.counted_qty, variance: line.variance })
          .eq("id", line.id);
      }

      // Try to push to Shopify
      const shopifyLines = adjustLines.filter(l => l.shopify_variant_id);
      let shopifySuccess = 0;

      if (shopifyLines.length > 0) {
        const BATCH = 10;
        for (let i = 0; i < shopifyLines.length; i += BATCH) {
          const batch = shopifyLines.slice(i, i + BATCH);
          const changes = batch.map(l => ({
            inventoryItemId: `gid://shopify/InventoryItem/${l.shopify_variant_id}`,
            locationId: `gid://shopify/Location/${locations[0]?.id || ""}`,
            delta: l.variance || 0,
          }));

          try {
            await supabase.functions.invoke("shopify-proxy", {
              body: {
                action: "graphql_adjust_inventory",
                inventory_changes: changes,
                reason: "stocktake_variance",
              },
            });
            shopifySuccess += batch.length;
          } catch {
            // Non-fatal
          }

          setApplyProgress({ done: Math.min(i + BATCH, shopifyLines.length), total: shopifyLines.length });
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // Create inventory adjustment records
      for (const line of adjustLines) {
        await supabase.from("inventory_adjustments").insert({
          user_id: user.user.id,
          sku: line.sku,
          barcode: line.barcode,
          product_title: line.product_title,
          shopify_variant_id: line.shopify_variant_id,
          adjustment_qty: line.variance || 0,
          reason: "Stocktake variance",
          location: locations[0]?.name || "Main Store",
        });
      }

      // Mark stocktake as completed
      if (activeStocktakeId) {
        await supabase
          .from("stocktakes")
          .update({ status: "completed" })
          .eq("id", activeStocktakeId);
      }

      addAuditEntry("stocktake_approved", `Approved stocktake with ${adjustLines.length} variances (${shopifySuccess} synced to Shopify)`);
      toast.success(`Applied ${adjustLines.length} adjustments`);
      setScreen("done");
      loadStocktakes();
    } catch (err) {
      toast.error("Failed to apply adjustments");
      setScreen("variance");
    }
  };

  /* ─── View History Detail ─── */

  const openHistoryDetail = async (st: StocktakeRow) => {
    setActiveStocktakeId(st.id);
    await loadStocktakeLines(st.id);
    setScreen("history_detail");
  };

  /* ─── Export Variance Report ─── */

  const exportVarianceCSV = () => {
    const rows = activeLines
      .filter(l => l.variance !== null)
      .map(l => ({
        SKU: l.sku || "",
        Product: l.product_title || "",
        System_Qty: l.expected_qty,
        Counted_Qty: l.counted_qty,
        Variance: l.variance,
      }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stocktake-variance-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Variance report exported");
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      draft: "bg-muted text-muted-foreground",
      in_progress: "bg-secondary text-secondary-foreground",
      completed: "bg-primary/10 text-primary",
    };
    return <Badge className={map[status] || "bg-muted text-muted-foreground"}>{status}</Badge>;
  };

  /* ═══════════════ SCREENS ═══════════════ */

  // ── LIST ──
  if (screen === "list") {
    return (
      <div className="px-4 pt-4 pb-24 max-w-4xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-xl font-semibold flex-1">Stocktakes</h1>
          <Button onClick={() => setScreen("new")} size="sm">
            <Plus className="w-4 h-4 mr-1" /> New Stocktake
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : stocktakes.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ClipboardCheck className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No stocktakes yet. Start a new one to begin counting.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {stocktakes.map(st => (
              <Card
                key={st.id}
                className="cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => openHistoryDetail(st)}
              >
                <CardContent className="py-3 px-4 flex items-center gap-4">
                  <ClipboardCheck className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{st.location} — {st.notes || "Stocktake"}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(st.counted_at).toLocaleDateString()} · {st.line_count || 0} items
                    </p>
                  </div>
                  {statusBadge(st.status)}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── NEW STOCKTAKE FORM ──
  if (screen === "new") {
    return (
      <div className="px-4 pt-4 pb-24 max-w-lg mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => setScreen("list")}><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-xl font-semibold">New Stocktake</h1>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Location</label>
            <Select value={newLocation} onValueChange={setNewLocation}>
              <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
              <SelectContent>
                {locations.map(l => (
                  <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>
                ))}
                <SelectItem value="Main Store">Main Store</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Type</label>
            <Select value={newType} onValueChange={(v) => setNewType(v as "full" | "cycle")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full Stocktake</SelectItem>
                <SelectItem value="cycle">Cycle Count</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Description (optional)</label>
            <Input
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              placeholder="e.g. End of season count"
            />
          </div>

          <Button onClick={handleCreateStocktake} disabled={creating} className="w-full">
            {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            Create & Load System Quantities
          </Button>
        </div>
      </div>
    );
  }

  // ── IMPORT COUNTED QUANTITIES ──
  if (screen === "import_count") {
    return (
      <div className="px-4 pt-4 pb-24 max-w-4xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => setScreen("list")}><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-xl font-semibold">Import Counted Quantities</h1>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 mb-6">
          <Card className="cursor-pointer hover:border-primary/30 transition-colors" onClick={exportSystemCSV}>
            <CardContent className="py-6 text-center">
              <Download className="w-8 h-8 text-primary mx-auto mb-2" />
              <p className="font-medium text-sm">Export System Quantities</p>
              <p className="text-xs text-muted-foreground mt-1">
                Download CSV with current stock levels ({activeLines.length} items)
              </p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-primary/30 transition-colors relative">
            <CardContent className="py-6 text-center">
              <Upload className="w-8 h-8 text-primary mx-auto mb-2" />
              <p className="font-medium text-sm">Import Counted Quantities</p>
              <p className="text-xs text-muted-foreground mt-1">
                Upload CSV with SKU + counted_qty columns
              </p>
              <input
                type="file"
                accept=".csv"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={handleImportCounted}
              />
            </CardContent>
          </Card>
        </div>

        <p className="text-sm text-muted-foreground">
          <strong>Step 1:</strong> Export system quantities to get your count sheet.{" "}
          <strong>Step 2:</strong> Fill in the <code>counted_qty</code> column and upload.
        </p>

        {/* Show current lines preview */}
        {activeLines.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-medium mb-2">System Quantities Preview ({activeLines.length} items)</h3>
            <div className="border rounded-lg overflow-auto max-h-[40vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">System Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeLines.slice(0, 50).map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">{l.sku || "—"}</TableCell>
                      <TableCell className="text-sm truncate max-w-[200px]">{l.product_title || "—"}</TableCell>
                      <TableCell className="text-right">{l.expected_qty}</TableCell>
                    </TableRow>
                  ))}
                  {activeLines.length > 50 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-xs text-muted-foreground">
                        + {activeLines.length - 50} more items
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── VARIANCE TABLE ──
  if (screen === "variance") {
    const varianceLines = activeLines.filter(l => l.variance !== null);
    return (
      <div className="px-4 pt-4 pb-24 max-w-5xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" onClick={() => setScreen("import_count")}><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-xl font-semibold flex-1">Variance Review</h1>
          <Button variant="outline" size="sm" onClick={exportVarianceCSV}>
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <Card><CardContent className="py-3 text-center">
            <p className="text-2xl font-bold">{varianceStats.total}</p>
            <p className="text-xs text-muted-foreground">Counted</p>
          </CardContent></Card>
          <Card><CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-primary">{varianceStats.exactCount}</p>
            <p className="text-xs text-muted-foreground">Exact</p>
          </CardContent></Card>
          <Card><CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-destructive">{varianceStats.underCount}</p>
            <p className="text-xs text-muted-foreground">Under</p>
          </CardContent></Card>
          <Card><CardContent className="py-3 text-center">
            <p className="text-2xl font-bold text-secondary-foreground">{varianceStats.overCount}</p>
            <p className="text-xs text-muted-foreground">Over</p>
          </CardContent></Card>
        </div>

        {/* Variance table */}
        <div className="border rounded-lg overflow-auto max-h-[50vh] mb-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">System</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {varianceLines
                .sort((a, b) => Math.abs(b.variance || 0) - Math.abs(a.variance || 0))
                .map(l => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.sku || "—"}</TableCell>
                  <TableCell className="text-sm truncate max-w-[200px]">{l.product_title || "—"}</TableCell>
                  <TableCell className="text-right">{l.expected_qty}</TableCell>
                  <TableCell className="text-right">{l.counted_qty}</TableCell>
                  <TableCell className={`text-right font-medium ${(l.variance || 0) < 0 ? "text-destructive" : (l.variance || 0) > 0 ? "text-primary" : ""}`}>
                    {(l.variance || 0) > 0 ? "+" : ""}{l.variance}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Button onClick={handleApproveAdjustments} className="w-full">
          <Check className="w-4 h-4 mr-2" />
          Approve & Apply {varianceLines.filter(l => l.variance !== 0).length} Adjustments
        </Button>
      </div>
    );
  }

  // ── APPLYING ──
  if (screen === "applying") {
    return (
      <div className="px-4 pt-4 pb-24 max-w-lg mx-auto animate-fade-in text-center">
        <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-primary" />
        <h2 className="text-lg font-semibold mb-2">Applying Adjustments…</h2>
        <Progress value={applyProgress.total > 0 ? (applyProgress.done / applyProgress.total) * 100 : 0} className="mb-2" />
        <p className="text-sm text-muted-foreground">{applyProgress.done} / {applyProgress.total}</p>
      </div>
    );
  }

  // ── DONE ──
  if (screen === "done") {
    return (
      <div className="px-4 pt-4 pb-24 max-w-lg mx-auto animate-fade-in text-center">
        <Check className="w-12 h-12 text-primary mx-auto mb-4" />
        <h2 className="text-lg font-semibold mb-2">Stocktake Complete</h2>
        <p className="text-sm text-muted-foreground mb-6">
          All adjustments have been applied and logged.
        </p>
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={exportVarianceCSV}>
            <Download className="w-4 h-4 mr-1" /> Export Report
          </Button>
          <Button onClick={() => { setScreen("list"); setActiveStocktakeId(null); }}>
            Back to Stocktakes
          </Button>
        </div>
      </div>
    );
  }

  // ── HISTORY DETAIL ──
  if (screen === "history_detail") {
    const st = stocktakes.find(s => s.id === activeStocktakeId);
    const varianceLines = activeLines.filter(l => l.variance !== null && l.variance !== 0);
    const isDraft = st?.status === "draft";

    return (
      <div className="px-4 pt-4 pb-24 max-w-5xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" onClick={() => { setScreen("list"); setActiveStocktakeId(null); }}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">{st?.location || "Stocktake"}</h1>
            <p className="text-xs text-muted-foreground">{st?.notes} · {st?.counted_at ? new Date(st.counted_at).toLocaleDateString() : ""}</p>
          </div>
          {st && statusBadge(st.status)}
        </div>

        {isDraft && (
          <div className="flex gap-3 mb-4">
            <Button variant="outline" size="sm" onClick={exportSystemCSV}>
              <Download className="w-4 h-4 mr-1" /> Export System Qtys
            </Button>
            <Button size="sm" className="relative">
              <Upload className="w-4 h-4 mr-1" /> Import Counts
              <input
                type="file"
                accept=".csv"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={handleImportCounted}
              />
            </Button>
          </div>
        )}

        {!isDraft && (
          <Button variant="outline" size="sm" className="mb-4" onClick={exportVarianceCSV}>
            <Download className="w-4 h-4 mr-1" /> Re-export Variance Report
          </Button>
        )}

        <div className="border rounded-lg overflow-auto max-h-[60vh]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">System</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(isDraft ? activeLines : activeLines.filter(l => l.variance !== null))
                .slice(0, 200)
                .map(l => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.sku || "—"}</TableCell>
                  <TableCell className="text-sm truncate max-w-[200px]">{l.product_title || "—"}</TableCell>
                  <TableCell className="text-right">{l.expected_qty}</TableCell>
                  <TableCell className="text-right">{l.counted_qty}</TableCell>
                  <TableCell className={`text-right font-medium ${(l.variance || 0) < 0 ? "text-destructive" : (l.variance || 0) > 0 ? "text-primary" : ""}`}>
                    {l.variance !== null ? ((l.variance > 0 ? "+" : "") + l.variance) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  return null;
};

export default StocktakeModule;
