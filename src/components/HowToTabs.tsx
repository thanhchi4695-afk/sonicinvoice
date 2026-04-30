import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Compass, Search, ArrowRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchFeatures } from "@/lib/feature-registry";

const HowToCatalog = lazy(() => import("@/components/HowToCatalog"));
const LightspeedGuide = lazy(() => import("@/components/LightspeedGuide"));

interface Props {
  onNavigateToFeature?: (flowKey: string) => void;
  onNavigateToTab?: (tab: string) => void;
}

type SubTab = "howto" | "guide";

// Searchable index of LightspeedGuide content. Keep in sync with the component.
const GUIDE_INDEX: { title: string; body: string }[] = [
  {
    title: "How the sync works",
    body: "Supplier sends invoice PDF Excel email Sonic Invoice AI reads enriches Lightspeed CSV export POS system of record auto syncs Shopify store online sales channel",
  },
  {
    title: "What to edit where",
    body: "Do not edit in Shopify product name price SKU description handle URL inventory quantity variants sizes Safe to edit in Shopify product images SEO title SEO description collections Shopify tags",
  },
  {
    title: "The complete workflow",
    body: "Receive invoice from supplier Upload to Sonic Invoice AI enrichment RRP description images tags SEO Download Lightspeed CSV handle name SKU brand supply price retail price tags size colour Import into Lightspeed POS Catalog Products Import Lightspeed syncs to Shopify Add images SEO in Shopify",
  },
  {
    title: "Import instructions (X-Series)",
    body: "Lightspeed X-Series Catalog Products Import drag drop CSV spreadsheet checker validation Continue error report Publish to Shopify file CSV XLSX XLS column headers",
  },
  {
    title: "Import instructions (R-Series)",
    body: "Lightspeed R-Series Inventory Import Items New Import upload file create new items only large imports 100 products Retail Imports Team Speeder Help chat Support ID",
  },
];

function countGuideMatches(query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  return GUIDE_INDEX.filter(s =>
    s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q)
  ).length;
}

const HowToTabs = ({ onNavigateToFeature, onNavigateToTab }: Props) => {
  const [sub, setSub] = useState<SubTab>("howto");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const featureMatches = useMemo(
    () => (query.trim() ? searchFeatures(query).length : 0),
    [query]
  );
  const guideMatches = useMemo(() => countGuideMatches(query), [query]);

  // Auto-switch tab when only one side has results.
  useEffect(() => {
    if (!query.trim()) return;
    if (featureMatches > 0 && guideMatches === 0 && sub !== "howto") setSub("howto");
    else if (guideMatches > 0 && featureMatches === 0 && sub !== "guide") setSub("guide");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, featureMatches, guideMatches]);

  // Cmd/Ctrl+K focuses the search bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tabs: { id: SubTab; label: string; icon: typeof BookOpen; count: number }[] = [
    { id: "howto", label: "How To", icon: BookOpen, count: featureMatches },
    { id: "guide", label: "Guide", icon: Compass, count: guideMatches },
  ];

  return (
    <div className="animate-fade-in">
      {/* Sticky header: search + sub-tabs */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="px-4 pt-3 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search articles, guides, and features…  (⌘K)"
              className="w-full h-10 rounded-lg bg-input border border-border pl-10 pr-9 text-sm"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {query.trim() && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {featureMatches + guideMatches === 0
                ? `No matches for "${query}"`
                : `${featureMatches} feature${featureMatches === 1 ? "" : "s"} · ${guideMatches} guide section${guideMatches === 1 ? "" : "s"}`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 px-4">
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = sub === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSub(t.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {t.label}
                {query.trim() && t.count > 0 && (
                  <span
                    className={cn(
                      "ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                      isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cross-tab hint when matches exist on the inactive side */}
      {query.trim() && (
        (sub === "howto" && guideMatches > 0 && featureMatches === 0) ||
        (sub === "guide" && featureMatches > 0 && guideMatches === 0)
      ) && (
        <div className="mx-4 mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            No matches here. Try the other tab.
          </p>
          <button
            onClick={() => setSub(sub === "howto" ? "guide" : "howto")}
            className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
          >
            Open {sub === "howto" ? "Guide" : "How To"}
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
        {sub === "howto" && (
          <HowToCatalog
            onNavigateToFeature={onNavigateToFeature}
            onNavigateToTab={onNavigateToTab}
            searchQuery={query}
            onSearchChange={setQuery}
            hideSearchBar
          />
        )}
        {sub === "guide" && <LightspeedGuide onBack={() => setSub("howto")} />}
      </Suspense>
    </div>
  );
};

export default HowToTabs;
