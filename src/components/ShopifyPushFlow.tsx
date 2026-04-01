import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import { Check, X, Loader2, ExternalLink, Download, ShoppingBag, AlertTriangle, RotateCcw } from "lucide-react";
import { PushProduct, PushResult, pushProducts, getConnection, recordPush } from "@/lib/shopify-api";

interface ShopifyPushFlowProps {
  products: PushProduct[];
  source?: string;
  onFallbackCSV?: () => void;
}

const ShopifyPushFlow = ({ products, source, onFallbackCSV }: ShopifyPushFlowProps) => {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [storeUrl, setStoreUrl] = useState("");
  const [shopName, setShopName] = useState("");
  const [productStatus, setProductStatus] = useState("draft");
  const [showConfirm, setShowConfirm] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [results, setResults] = useState<PushResult[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getConnection().then((conn) => {
      if (conn) {
        setConnected(true);
        setStoreUrl(conn.store_url);
        setShopName(conn.shop_name || conn.store_url);
        setProductStatus(conn.product_status || "draft");
      } else {
        setConnected(false);
      }
    });
  }, []);

  const stats = useMemo(() => {
    const created = results.filter((r) => r.status === "success").length;
    const errors = results.filter((r) => r.status === "error").length;
    const pending = results.filter((r) => r.status === "pending" || r.status === "pushing").length;
    const total = results.length;
    const progress = total > 0 ? ((total - pending) / total) * 100 : 0;
    return { created, errors, pending, total, progress };
  }, [results]);

  const handlePush = async () => {
    setShowConfirm(false);
    setPushing(true);
    setDone(false);

    const finalResults = await pushProducts(products, productStatus, setResults);

    setResults(finalResults);
    setPushing(false);
    setDone(true);

    const created = finalResults.filter((r) => r.status === "success").length;
    const errors = finalResults.filter((r) => r.status === "error").length;
    await recordPush(storeUrl, created, 0, errors, `${created} created, ${errors} errors`, source || "bulk_sale");
  };

  const handleRetryFailed = async () => {
    const failedIndices = results.map((r, i) => (r.status === "error" ? i : -1)).filter((i) => i >= 0);
    const failedProducts = failedIndices.map((i) => products[i]);
    setPushing(true);
    setDone(false);

    const retryResults = await pushProducts(failedProducts, productStatus, (partial) => {
      const merged = [...results];
      failedIndices.forEach((origIdx, newIdx) => {
        if (partial[newIdx]) merged[origIdx] = partial[newIdx];
      });
      setResults(merged);
    });

    const merged = [...results];
    failedIndices.forEach((origIdx, newIdx) => {
      merged[origIdx] = retryResults[newIdx];
    });
    setResults(merged);
    setPushing(false);
    setDone(true);
  };

  if (connected === null) return null;

  // Not connected — show CSV fallback only
  if (!connected) {
    return null;
  }

  // Pushing / Done state
  if (pushing || done) {
    return (
      <div className="bg-card rounded-lg border border-border p-4 space-y-4">
        <div className="flex items-center gap-2">
          {pushing ? (
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
          ) : stats.errors > 0 ? (
            <AlertTriangle className="w-4 h-4 text-secondary" />
          ) : (
            <Check className="w-4 h-4 text-success" />
          )}
          <h4 className="text-sm font-semibold">
            {pushing ? "Pushing to Shopify..." : stats.errors > 0 ? "Push completed with errors" : "Push complete!"}
          </h4>
        </div>

        <Progress value={stats.progress} className="h-2" />
        <p className="text-xs text-muted-foreground">
          {stats.created} of {stats.total} products pushed
          {stats.errors > 0 && ` · ${stats.errors} errors`}
        </p>

        {/* Live product list */}
        <div className="max-h-48 overflow-y-auto divide-y divide-border rounded-lg border border-border">
          {results.map((r, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
              {r.status === "success" && <Check className="w-3 h-3 text-success shrink-0" />}
              {r.status === "error" && <X className="w-3 h-3 text-destructive shrink-0" />}
              {r.status === "pushing" && <Loader2 className="w-3 h-3 text-primary animate-spin shrink-0" />}
              {r.status === "pending" && <span className="w-3 h-3 rounded-full border border-muted-foreground shrink-0" />}
              <span className="flex-1 truncate">{r.title}</span>
              {r.error && <span className="text-destructive truncate max-w-[120px]">{r.error}</span>}
            </div>
          ))}
        </div>

        {done && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`https://${storeUrl}/admin/products`, "_blank")}
              className="text-xs"
            >
              <ExternalLink className="w-3 h-3 mr-1" /> View in Shopify
            </Button>
            {stats.errors > 0 && (
              <Button variant="outline" size="sm" onClick={handleRetryFailed} className="text-xs">
                <RotateCcw className="w-3 h-3 mr-1" /> Retry failed ({stats.errors})
              </Button>
            )}
            {stats.errors > 0 && onFallbackCSV && (
              <Button variant="ghost" size="sm" onClick={onFallbackCSV} className="text-xs">
                <Download className="w-3 h-3 mr-1" /> Download failed as CSV
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Ready to push
  return (
    <>
      <div className="bg-card rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-semibold">Push to Shopify</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          {products.length} products ready · Creates as {productStatus}s for your review
        </p>
        <Button
          variant="teal"
          className="w-full h-12 text-base"
          onClick={() => setShowConfirm(true)}
          disabled={products.length === 0}
        >
          <ShoppingBag className="w-4 h-4 mr-2" /> Push {products.length} products to Shopify
        </Button>
        {onFallbackCSV && (
          <button onClick={onFallbackCSV} className="text-xs text-muted-foreground flex items-center gap-1 mx-auto">
            <Download className="w-3 h-3" /> Download CSV instead
          </button>
        )}
      </div>

      {/* Confirmation modal */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Push to Shopify</DialogTitle>
            <DialogDescription>
              You are about to push {products.length} products to {shopName}.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs">
              <Check className="w-3 h-3 text-success" /> {products.length} products will be created as {productStatus}s
            </p>
            <p className="flex items-center gap-1.5 text-xs">
              <Check className="w-3 h-3 text-success" /> Nothing goes live until you publish in Shopify
            </p>
          </div>
          <DialogFooter className="flex-row gap-2">
            <Button variant="ghost" onClick={() => setShowConfirm(false)} className="flex-1">Cancel</Button>
            <Button variant="teal" onClick={handlePush} className="flex-1">Confirm push →</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ShopifyPushFlow;
