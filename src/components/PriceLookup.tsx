import { useState } from "react";
import { ChevronLeft, Search, Loader2, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  matchPrice,
  getSourceBadge,
  getConfidenceColor,
  getConfidenceBarColor,
  getApiKeys,
  type PriceResult,
  type PriceProduct,
} from "@/lib/price-intelligence";

interface PriceLookupProps {
  onBack: () => void;
}

const PriceLookup = ({ onBack }: PriceLookupProps) => {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [barcode, setBarcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PriceResult | null>(null);

  const handleLookup = async (skipCache = false) => {
    if (!name && !barcode) return;
    setLoading(true);
    setResult(null);
    const product: PriceProduct = { name, brand, barcode: barcode || undefined };
    try {
      const r = await matchPrice(product, "AUD", undefined, undefined, skipCache);
      setResult(r);
    } catch {
      setResult({ price: null, source: "Error", confidence: 0, method: "", allPrices: [], debugLog: ["Error occurred"] });
    }
    setLoading(false);
  };

  const apiKeys = getApiKeys();
  const hasAnyKey = !!(apiKeys.barcodeLookup || apiKeys.serpApi || apiKeys.goUpc);

  const badge = result ? getSourceBadge(result.method) : null;

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <div>
          <h2 className="text-lg font-semibold font-display">🔍 Price Lookup</h2>
          <p className="text-xs text-muted-foreground">Look up AU retail prices from multiple sources</p>
        </div>
      </div>

      {!hasAnyKey && (
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-primary">💡 No price APIs connected. Go to Account → API Keys to add them for faster, more accurate results. Claude AI will be used as fallback.</p>
        </div>
      )}

      {/* Search form */}
      <div className="space-y-3 mb-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Product name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mara One Piece"
            className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Brand</label>
            <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Bond Eye"
              className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Barcode (optional)</label>
            <input value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="EAN / UPC"
              className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm font-mono-data" />
          </div>
        </div>
        <Button variant="teal" className="w-full h-11" onClick={() => handleLookup()} disabled={loading || (!name && !barcode)}>
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
          {loading ? "Searching..." : "Look up price"}
        </Button>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-3">
          {/* Main result */}
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Price Result</h3>
              {badge && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>{badge.label}</span>
              )}
            </div>
            {result.price ? (
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-3xl font-bold font-mono-data">${result.price.toFixed(2)}</span>
                <span className="text-sm text-muted-foreground">AUD</span>
              </div>
            ) : (
              <p className="text-sm text-destructive mb-2">No price found</p>
            )}

            {/* Confidence bar */}
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${getConfidenceBarColor(result.confidence)}`}
                  style={{ width: `${result.confidence}%` }} />
              </div>
              <span className={`text-xs font-medium ${getConfidenceColor(result.confidence)}`}>
                {result.confidence}%
              </span>
            </div>

            {result.cached && (
              <p className="text-xs text-muted-foreground mb-2">
                💾 Cached · {result.cachedAt ? new Date(result.cachedAt).toLocaleDateString() : ''}
              </p>
            )}

            <Button variant="ghost" size="sm" onClick={() => handleLookup(true)} className="text-xs">
              <RefreshCw className="w-3 h-3 mr-1" /> Refresh (ignore cache)
            </Button>
          </div>

          {/* All prices found */}
          {result.allPrices.length > 0 && (
            <div className="bg-card rounded-lg border border-border p-4">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">All prices found</h4>
              <div className="space-y-1.5">
                {result.allPrices.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${p.trusted ? 'bg-success' : 'bg-muted-foreground/30'}`} />
                      <span className="text-muted-foreground truncate max-w-[160px]">{p.store}</span>
                    </div>
                    <span className="font-mono-data font-medium">${p.price.toFixed(2)} {p.currency}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Source waterfall log */}
          <div className="bg-card rounded-lg border border-border p-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Source waterfall</h4>
            <div className="space-y-1">
              {result.debugLog.map((log, i) => (
                <p key={i} className="text-xs font-mono-data text-muted-foreground">{log}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PriceLookup;
