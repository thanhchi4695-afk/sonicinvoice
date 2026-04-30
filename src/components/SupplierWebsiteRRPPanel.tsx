// ══════════════════════════════════════════════════════════════
// Supplier Website RRP Panel
//
// Lets a retailer point each supplier at their public storefront
// (Shopify-hosted today) so RRPs come from the brand's website
// instead of a markup formula. UI lives inside SupplierBrainTab.
//
// Per supplier you can:
//   • paste a website URL
//   • toggle "use website RRP" on/off
//   • re-scrape on demand and see how many products were cached
// ══════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Globe, Loader2, RefreshCw, ExternalLink, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SupplierWithWebsite {
  id: string;
  supplier_name: string;
  website_url: string | null;
  website_pricing_enabled: boolean;
  website_scraper_type: string;
  website_last_scraped_at: string | null;
  website_products_cached: number;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function SupplierWebsiteRRPPanel() {
  const [rows, setRows] = useState<SupplierWithWebsite[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [scrapingId, setScrapingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("supplier_profiles" as never)
      .select(
        "id, supplier_name, website_url, website_pricing_enabled, website_scraper_type, website_last_scraped_at, website_products_cached",
      )
      .order("supplier_name", { ascending: true });
    if (error) {
      toast.error("Couldn't load suppliers", { description: error.message });
      setLoading(false);
      return;
    }
    const list = (data || []) as unknown as SupplierWithWebsite[];
    setRows(list);
    setDrafts(
      Object.fromEntries(list.map((r) => [r.id, r.website_url || ""])),
    );
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const saveUrl = async (row: SupplierWithWebsite) => {
    const url = (drafts[row.id] || "").trim();
    setSavingId(row.id);
    const { error } = await supabase
      .from("supplier_profiles" as never)
      .update({ website_url: url || null } as never)
      .eq("id", row.id);
    setSavingId(null);
    if (error) {
      toast.error("Save failed", { description: error.message });
      return;
    }
    toast.success("Website saved");
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, website_url: url || null } : r,
      ),
    );
  };

  const toggleEnabled = async (row: SupplierWithWebsite, on: boolean) => {
    if (on && !row.website_url) {
      toast.error("Add a website URL first");
      return;
    }
    const { error } = await supabase
      .from("supplier_profiles" as never)
      .update({ website_pricing_enabled: on } as never)
      .eq("id", row.id);
    if (error) {
      toast.error("Update failed", { description: error.message });
      return;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, website_pricing_enabled: on } : r,
      ),
    );
    toast.success(
      on
        ? `Using website RRP for ${row.supplier_name}`
        : `Reverted to markup formula for ${row.supplier_name}`,
    );
  };

  const rescrape = async (row: SupplierWithWebsite) => {
    if (!row.website_url) {
      toast.error("Add a website URL first");
      return;
    }
    setScrapingId(row.id);
    try {
      const { data, error } = await supabase.functions.invoke(
        "supplier-website-scrape",
        { body: { supplier_profile_id: row.id } },
      );
      if (error) throw error;
      const cached = (data as { products_cached?: number })?.products_cached ?? 0;
      toast.success(`Scraped ${cached} products from ${row.supplier_name}`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error("Scrape failed", { description: msg });
    } finally {
      setScrapingId(null);
    }
  };

  if (loading) {
    return (
      <div className="text-xs text-muted-foreground py-8 text-center">
        Loading suppliers…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="p-6 text-center">
        <Globe className="w-6 h-6 mx-auto mb-2 opacity-40" />
        <p className="text-xs text-muted-foreground">
          No suppliers in your brain yet — process an invoice first, then come
          back here to point each brand at its website.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-start gap-2.5">
          <Globe className="w-5 h-5 text-primary mt-0.5" />
          <div>
            <p className="text-sm font-semibold">Use the brand's website for RRP</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              For brands with a public Shopify storefront (Walnut Melbourne,
              Seafolly, Tigerlily, etc.), Sonic can read RRPs straight from the
              site instead of guessing with a markup formula. Toggle a supplier
              on, paste their URL, hit <strong>Re-scrape</strong>, and the next
              invoice prices against their published RRPs.
            </p>
          </div>
        </div>
      </Card>

      <div className="space-y-2">
        {rows.map((r) => (
          <Card key={r.id} className="p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold truncate">
                    {r.supplier_name}
                  </p>
                  {r.website_pricing_enabled && (
                    <Badge
                      variant="outline"
                      className="text-[10px] gap-1 border-primary/30 text-primary"
                    >
                      <Globe className="w-3 h-3" /> Website RRP active
                    </Badge>
                  )}
                  {r.website_products_cached > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {r.website_products_cached.toLocaleString()} cached
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Last scraped: {formatRelative(r.website_last_scraped_at)}
                  {" · "}
                  Source:{" "}
                  {r.website_pricing_enabled ? "website" : "markup formula"}
                </p>
              </div>
              <Switch
                checked={r.website_pricing_enabled}
                onCheckedChange={(on) => toggleEnabled(r, on)}
              />
            </div>

            <div className="flex gap-2 items-center">
              <Input
                value={drafts[r.id] ?? ""}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                }
                placeholder="https://walnutmelbourne.com"
                className="text-xs h-8"
              />
              {r.website_url && (
                <a
                  href={r.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                  title="Open website"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveUrl(r)}
                disabled={
                  savingId === r.id ||
                  (drafts[r.id] || "") === (r.website_url || "")
                }
              >
                {savingId === r.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  "Save"
                )}
              </Button>
              <Button
                size="sm"
                onClick={() => rescrape(r)}
                disabled={scrapingId === r.id || !r.website_url}
              >
                {scrapingId === r.id ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                    Scraping…
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 mr-1" />
                    Re-scrape
                  </>
                )}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
