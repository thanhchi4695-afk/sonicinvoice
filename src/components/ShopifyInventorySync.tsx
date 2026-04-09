import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Check, X, Loader2, Search, Package, ArrowDownUp, RefreshCw,
  AlertTriangle, ChevronDown, ChevronUp,
} from "lucide-react";
import {
  getConnection, getLocations, getProductsPage,
  findVariantBySKU, findVariantByBarcode,
  adjustInventory, updateVariantCost,
  type ShopifyVariantMatch,
} from "@/lib/shopify-api";

/* ─── Types ─── */
interface SyncItem {
  localSku: string;
  localBarcode?: string;
  localTitle: string;
  localQty: number;
  localCost: number;
  match: ShopifyVariantMatch | null;
  matchMethod: "sku" | "barcode" | "none";
  status: "pending" | "matching" | "matched" | "not_found" | "syncing" | "done" | "error";
  error?: string;
  stockAdjustment?: number;
  costChanged?: boolean;
}

interface ShopifyInventorySyncProps {
  /** Products from invoice/import to sync */
  items: Array<{
    sku?: string;
    barcode?: string;
    title: string;
    quantity: number;
    cost: number;
  }>;
  onComplete?: () => void;
}

const ShopifyInventorySync = ({ items, onComplete }: ShopifyInventorySyncProps) => {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [syncItems, setSyncItems] = useState<SyncItem[]>([]);
  const [phase, setPhase] = useState<"idle" | "matching" | "review" | "syncing" | "done">("idle");
  const [showConfirm, setShowConfirm] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Init
  useEffect(() => {
    (async () => {
      const conn = await getConnection();
      if (!conn) { setConnected(false); return; }
      setConnected(true);
      const locs = await getLocations();
      const activeLocs = locs.filter(l => l.active);
      setLocations(activeLocs);
      if (conn.default_location_id) setSelectedLocation(conn.default_location_id);
      else if (activeLocs.length > 0) setSelectedLocation(activeLocs[0].id);
    })();
  }, []);

  // Build sync items from props
  useEffect(() => {
    setSyncItems(items.map(item => ({
      localSku: item.sku || "",
      localBarcode: item.barcode,
      localTitle: item.title,
      localQty: item.quantity,
      localCost: item.cost,
      match: null,
      matchMethod: "none",
      status: "pending",
    })));
  }, [items]);

  const stats = useMemo(() => {
    const matched = syncItems.filter(i => i.status === "matched" || i.status === "done").length;
    const notFound = syncItems.filter(i => i.status === "not_found").length;
    const errors = syncItems.filter(i => i.status === "error").length;
    const done = syncItems.filter(i => i.status === "done").length;
    return { matched, notFound, errors, done, total: syncItems.length };
  }, [syncItems]);

  /* ── Phase 1: Match items ── */
  const handleMatch = async () => {
    setPhase("matching");
    const updated = [...syncItems];

    for (let i = 0; i < updated.length; i++) {
      updated[i].status = "matching";
      setSyncItems([...updated]);

      try {
        // Try SKU first
        if (updated[i].localSku) {
          const skuMatch = await findVariantBySKU(updated[i].localSku);
          if (skuMatch) {
            updated[i].match = skuMatch;
            updated[i].matchMethod = "sku";
            updated[i].status = "matched";
            updated[i].stockAdjustment = updated[i].localQty;
            updated[i].costChanged = skuMatch.cost !== null && parseFloat(skuMatch.cost) !== updated[i].localCost;
            setSyncItems([...updated]);
            continue;
          }
        }

        // Try barcode
        if (updated[i].localBarcode) {
          const barcodeMatches = await findVariantByBarcode(updated[i].localBarcode!);
          if (barcodeMatches.length > 0) {
            updated[i].match = barcodeMatches[0];
            updated[i].matchMethod = "barcode";
            updated[i].status = "matched";
            updated[i].stockAdjustment = updated[i].localQty;
            updated[i].costChanged = barcodeMatches[0].cost !== null && parseFloat(barcodeMatches[0].cost) !== updated[i].localCost;
            setSyncItems([...updated]);
            continue;
          }
        }

        updated[i].status = "not_found";
      } catch (err) {
        updated[i].status = "error";
        updated[i].error = err instanceof Error ? err.message : "Match failed";
      }

      setSyncItems([...updated]);
      // Rate limit
      await new Promise(r => setTimeout(r, 300));
    }

    setPhase("review");
  };

  /* ── Phase 2: Sync inventory ── */
  const handleSync = async () => {
    setShowConfirm(false);
    setPhase("syncing");
    const updated = [...syncItems];
    const toSync = updated.filter(i => i.status === "matched" && i.match);

    for (const item of toSync) {
      item.status = "syncing";
      setSyncItems([...updated]);

      try {
        // Adjust inventory
        if (item.stockAdjustment && item.stockAdjustment > 0 && item.match!.inventory_item_id) {
          await adjustInventory(
            selectedLocation,
            item.match!.inventory_item_id,
            item.stockAdjustment
          );
        }

        // Update cost if changed
        if (item.costChanged && item.match!.variant_id) {
          await updateVariantCost(item.match!.variant_id, String(item.localCost));
        }

        item.status = "done";
      } catch (err) {
        item.status = "error";
        item.error = err instanceof Error ? err.message : "Sync failed";
      }

      setSyncItems([...updated]);
      await new Promise(r => setTimeout(r, 500));
    }

    setPhase("done");
    onComplete?.();
  };

  if (connected === null) return null;
  if (!connected) return null;

  return (
    <div className="bg-card rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowDownUp className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-semibold">Inventory Sync</h4>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
          {items.length} items
        </span>
      </div>

      {/* Location selector */}
      {phase === "idle" && locations.length > 1 && (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Location</label>
          <select
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
          >
            {locations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Idle state */}
      {phase === "idle" && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Match {items.length} items by SKU/barcode, then adjust stock and update cost in Shopify.
          </p>
          <Button
            onClick={handleMatch}
            className="w-full"
            disabled={items.length === 0 || !selectedLocation}
          >
            <Search className="w-4 h-4 mr-2" /> Match & Sync Inventory
          </Button>
        </div>
      )}

      {/* Matching / Review / Syncing / Done */}
      {phase !== "idle" && (
        <>
          {phase === "matching" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Matching items against Shopify...
            </div>
          )}

          {phase === "syncing" && (
            <>
              <Progress value={(stats.done / Math.max(stats.matched, 1)) * 100} className="h-2" />
              <p className="text-xs text-muted-foreground">
                Syncing {stats.done} of {stats.matched}...
              </p>
            </>
          )}

          {(phase === "review" || phase === "done") && (
            <div className="flex gap-3 text-xs">
              <span className="flex items-center gap-1 text-success">
                <Check className="w-3 h-3" /> {stats.matched} matched
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <X className="w-3 h-3" /> {stats.notFound} not found
              </span>
              {stats.errors > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <AlertTriangle className="w-3 h-3" /> {stats.errors} errors
                </span>
              )}
            </div>
          )}

          {/* Item list */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Hide" : "Show"} details
          </button>

          {expanded && (
            <div className="max-h-48 overflow-y-auto divide-y divide-border rounded-lg border border-border">
              {syncItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
                  {item.status === "matched" && <Check className="w-3 h-3 text-success shrink-0" />}
                  {item.status === "done" && <Check className="w-3 h-3 text-success shrink-0" />}
                  {item.status === "not_found" && <X className="w-3 h-3 text-muted-foreground shrink-0" />}
                  {item.status === "error" && <X className="w-3 h-3 text-destructive shrink-0" />}
                  {(item.status === "matching" || item.status === "syncing") && (
                    <Loader2 className="w-3 h-3 text-primary animate-spin shrink-0" />
                  )}
                  {item.status === "pending" && (
                    <span className="w-3 h-3 rounded-full border border-muted-foreground shrink-0" />
                  )}
                  <span className="flex-1 truncate">{item.localTitle}</span>
                  <span className="text-muted-foreground shrink-0">
                    {item.localSku || item.localBarcode || "—"}
                  </span>
                  {item.matchMethod !== "none" && (
                    <span className="text-[10px] px-1 rounded bg-muted text-muted-foreground">
                      {item.matchMethod}
                    </span>
                  )}
                  {item.stockAdjustment !== undefined && item.status === "matched" && (
                    <span className="text-success text-[10px]">+{item.stockAdjustment}</span>
                  )}
                  {item.costChanged && (
                    <span className="text-[10px] text-secondary">cost↑</span>
                  )}
                  {item.error && (
                    <span className="text-destructive truncate max-w-[100px]">{item.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          {phase === "review" && stats.matched > 0 && (
            <Button onClick={() => setShowConfirm(true)} className="w-full">
              <RefreshCw className="w-4 h-4 mr-2" />
              Sync {stats.matched} matched items to Shopify
            </Button>
          )}

          {phase === "done" && (
            <p className="text-xs text-success flex items-center gap-1">
              <Check className="w-3 h-3" /> Sync complete — {stats.done} items updated
            </p>
          )}
        </>
      )}

      {/* Confirmation */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Inventory Sync</DialogTitle>
            <DialogDescription>
              This will adjust stock levels and update costs for {stats.matched} items in Shopify.
            </DialogDescription>
          </DialogHeader>
          <div className="text-xs space-y-1.5">
            <p className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-success" /> {stats.matched} variants will receive stock
            </p>
            <p className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-success" /> Cost updates applied where prices changed
            </p>
            <p className="flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 text-secondary" /> {stats.notFound} items had no match
            </p>
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button variant="ghost" onClick={() => setShowConfirm(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleSync} className="flex-1">Confirm sync →</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ShopifyInventorySync;
