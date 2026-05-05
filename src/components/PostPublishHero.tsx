import { useEffect, useMemo, useState } from "react";
import { Bot, Check, ChevronRight, ExternalLink, Lock, Sparkles, Tag, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { openShopifyAdmin } from "@/lib/open-shopify-admin";

export type PostPublishProduct = {
  title?: string;
  name?: string;
  vendor?: string;
  brand?: string;
  product_type?: string;
  type?: string;
  tags?: string | string[];
  handle?: string;
};

interface Props {
  count: number;
  shopName: string;
  storeUrl?: string;
  products: PostPublishProduct[];
  onProcessAnother?: () => void;
  onBuildCollections?: () => void;
}

type Pill = {
  label: string;
  level: "brand" | "brand_story" | "category" | "feature" | "colour";
  isNew: boolean;
};

const LEVEL_META: Record<Pill["level"], { icon: string; label: string; locked: boolean }> = {
  brand: { icon: "🏷️", label: "brand", locked: false },
  brand_story: { icon: "✨", label: "brand_story", locked: true },
  category: { icon: "📂", label: "category", locked: false },
  feature: { icon: "🌟", label: "feature", locked: true },
  colour: { icon: "🎨", label: "colour", locked: true },
};

function slug(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Extract candidate "style line" from a title — first 1-2 words after vendor.
function extractStoryWord(title: string, vendor: string): string | null {
  if (!title) return null;
  let t = title.trim();
  if (vendor) {
    const re = new RegExp(`^${vendor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i");
    t = t.replace(re, "");
  }
  // Strip leading qualifiers
  t = t.replace(/^(the|a|an)\s+/i, "");
  const first = t.split(/[\s\-,]/)[0];
  if (!first || first.length < 3) return null;
  // Skip generic words
  if (/^(dress|top|skirt|pant|short|bikini|swim|shirt|jacket|coat|tee|cardigan|jumper|sweater|hat|bag)$/i.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

const PostPublishHero = ({ count, shopName, storeUrl, products, onProcessAnother, onBuildCollections }: Props) => {
  const [memoryHandles, setMemoryHandles] = useState<Set<string> | null>(null);
  const [memoryVendors, setMemoryVendors] = useState<Set<string> | null>(null);

  // Background detection (200ms delay so success animation feels instant)
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setMemoryHandles(new Set()); setMemoryVendors(new Set()); return; }
        const { data } = await supabase
          .from("collection_memory")
          .select("collection_handle, collection_title, level")
          .eq("user_id", user.id);
        const handles = new Set<string>();
        const vendors = new Set<string>();
        (data || []).forEach((r: any) => {
          if (r.collection_handle) handles.add(r.collection_handle.toLowerCase());
          if (r.level === "brand" && r.collection_title) vendors.add(r.collection_title.toLowerCase().trim());
        });
        setMemoryHandles(handles);
        setMemoryVendors(vendors);
      } catch {
        setMemoryHandles(new Set()); setMemoryVendors(new Set());
      }
    }, 200);
    return () => clearTimeout(t);
  }, []);

  const detection = useMemo(() => {
    const vendorCounts = new Map<string, number>();
    const storyCounts = new Map<string, { vendor: string; word: string; count: number }>();
    const typeCounts = new Map<string, number>();

    for (const p of products) {
      const vendor = (p.vendor || p.brand || "").trim();
      const title = (p.title || p.name || "").trim();
      const type = (p.product_type || p.type || "").trim();
      if (vendor) vendorCounts.set(vendor, (vendorCounts.get(vendor) || 0) + 1);
      if (type) typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
      if (vendor && title) {
        const word = extractStoryWord(title, vendor);
        if (word) {
          const k = `${vendor}::${word}`;
          const cur = storyCounts.get(k);
          if (cur) cur.count++;
          else storyCounts.set(k, { vendor, word, count: 1 });
        }
      }
    }

    const known = memoryHandles ?? new Set<string>();
    const knownVendors = memoryVendors ?? new Set<string>();
    const ready = memoryHandles !== null;

    const pills: Pill[] = [];
    const newBrands: string[] = [];

    // Brand-story pills (≥2 products with same first word)
    for (const { vendor, word, count } of storyCounts.values()) {
      if (count < 2) continue;
      const handle = slug(`${vendor}-${word}`);
      pills.push({
        label: `${vendor} ${word}`,
        level: "brand_story",
        isNew: ready && !known.has(handle),
      });
    }

    // Brand pills
    for (const v of vendorCounts.keys()) {
      const handle = slug(v);
      const isNew = ready && !known.has(handle) && !knownVendors.has(v.toLowerCase().trim());
      if (isNew) newBrands.push(v);
      pills.push({ label: v, level: "brand", isNew });
    }

    // Category pills
    for (const t of typeCounts.keys()) {
      const handle = slug(t);
      pills.push({ label: t, level: "category", isNew: ready && !known.has(handle) });
    }

    // Sort: new first, then brand_story, then brand, then category
    const order: Record<Pill["level"], number> = { brand_story: 0, brand: 1, category: 2, feature: 3, colour: 4 };
    pills.sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      return order[a.level] - order[b.level];
    });

    const newCount = pills.filter(p => p.isNew).length;
    return { pills, newBrands, newCount, ready };
  }, [products, memoryHandles, memoryVendors]);

  const headline = detection.newBrands.length > 0
    ? `${detection.newBrands[0]} is new to your store.`
    : detection.newCount > 0
      ? `${detection.newCount} new style line${detection.newCount === 1 ? "" : "s"} detected in this invoice.`
      : "All collections already exist for these products.";

  const visiblePills = detection.pills.slice(0, 4);
  const overflow = Math.max(0, detection.pills.length - visiblePills.length);

  return (
    <div className="space-y-3 mb-4">
      {/* Compact success confirmation */}
      <div className="flex items-center gap-2 animate-fade-in">
        <span className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-success/15 text-success animate-scale-in">
          <Check className="w-3.5 h-3.5" />
        </span>
        <p className="text-sm">
          <span className="font-semibold text-success">{count} product{count === 1 ? "" : "s"}</span>
          <span className="text-muted-foreground"> published to {shopName}</span>
        </p>
      </div>

      {/* HERO — Collection Autopilot card */}
      <div
        className="rounded-2xl p-6 animate-fade-in"
        style={{
          background: "linear-gradient(135deg, #0F172A 0%, #1E3A5F 100%)",
          border: "1px solid rgba(99, 102, 241, 0.4)",
        }}
      >
        {/* Top row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bot className="w-8 h-8 text-indigo-300" />
            <span className="text-white text-base font-semibold">Collection Autopilot</span>
            <Badge className="bg-indigo-500/90 hover:bg-indigo-500/90 text-white border-transparent text-[10px] px-2 py-0.5">NEW</Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex w-2 h-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span className="text-xs text-emerald-300 font-medium">Active</span>
          </div>
        </div>

        {/* Headline */}
        <h3 className="text-white text-xl font-bold leading-tight mb-1">
          {detection.ready ? headline : "Scanning for new collections…"}
        </h3>
        <p className="text-slate-300 text-sm mb-4">
          {detection.ready && detection.pills.length > 0
            ? "The AI found these collections to create automatically:"
            : detection.ready
              ? "No new collections suggested for this invoice."
              : "Checking collection memory…"}
        </p>

        {/* Pills */}
        {visiblePills.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {visiblePills.map((p, i) => {
              const meta = LEVEL_META[p.level];
              return (
                <span
                  key={i}
                  className={
                    p.isNew
                      ? "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-700 text-white border border-slate-600"
                      : "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700"
                  }
                  title={p.isNew ? "New collection" : "Already exists"}
                >
                  <span>{meta.icon}</span>
                  <span>{p.label}</span>
                  <span className={p.isNew ? "text-indigo-300" : "text-slate-500"}>
                    [{meta.label}]
                  </span>
                  {meta.locked && <Lock className="w-3 h-3 text-slate-400" />}
                </span>
              );
            })}
            {overflow > 0 && (
              <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs text-slate-400">
                + {overflow} more collection{overflow === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        {/* Action row */}
        <div className="space-y-2">
          <Button
            className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-semibold h-11"
            onClick={onBuildCollections}
            disabled={!detection.ready || detection.pills.length === 0}
          >
            <Sparkles className="w-4 h-4" />
            Create these collections now
            <ChevronRight className="w-4 h-4" />
          </Button>
          <button
            type="button"
            className="block w-full text-center text-xs text-slate-400 hover:text-slate-200 transition-colors"
            onClick={() => window.dispatchEvent(new CustomEvent("sonic:navigate-flow", { detail: "collection_decomposer" }))}
          >
            Or enable autopilot to create them automatically
          </button>
        </div>

        {/* Footer note */}
        <p className="text-[11px] text-slate-500 mt-4 flex items-center gap-1.5">
          <Lock className="w-3 h-3" />
          Brand story collections use title-based rules and cannot be overridden
        </p>
      </div>

      {/* Secondary actions */}
      <div className="flex flex-wrap gap-2">
        {onProcessAnother && (
          <Button size="sm" variant="outline" onClick={onProcessAnother}>
            Process another invoice
          </Button>
        )}
        {storeUrl && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => openShopifyAdmin(`https://${storeUrl}/admin/products`)}
          >
            <ExternalLink className="w-3.5 h-3.5" /> View in Shopify
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onBuildCollections}>
          <Layers className="w-3.5 h-3.5" /> Build collections
        </Button>
      </div>
    </div>
  );
};

export default PostPublishHero;
