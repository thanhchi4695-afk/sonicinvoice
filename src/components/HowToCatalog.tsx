import { useState, useMemo } from "react";
import { Search, ChevronDown, ChevronRight, BookOpen, Lightbulb, ArrowRight } from "lucide-react";
import {
  featureRegistry,
  getFeaturesByCategory,
  searchFeatures,
  categoryLabels,
  categoryIcons,
  type FeatureEntry,
} from "@/lib/feature-registry";

interface HowToCatalogProps {
  onNavigateToFeature?: (flowKey: string) => void;
  onNavigateToTab?: (tab: string) => void;
}

const HowToCatalog = ({ onNavigateToFeature, onNavigateToTab }: HowToCatalogProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [openFeature, setOpenFeature] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const filteredFeatures = useMemo(() => searchFeatures(searchQuery), [searchQuery]);

  const grouped = useMemo(() => {
    const g: Record<string, FeatureEntry[]> = {};
    for (const f of filteredFeatures) {
      if (!g[f.category]) g[f.category] = [];
      g[f.category].push(f);
    }
    return g;
  }, [filteredFeatures]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const totalFeatures = featureRegistry.length;

  const categoryOrder = ["invoices", "inventory", "marketing", "tools", "accounting", "suppliers", "shopify", "settings"];

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <BookOpen className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold font-display">How To Guide</h1>
      </div>
      <p className="text-muted-foreground text-sm mb-1">
        Complete guide to every feature in Sonic Invoice
      </p>
      <p className="text-xs text-muted-foreground/60 mb-4">
        {totalFeatures} features documented · Auto-updated
      </p>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search features (e.g. 'invoice', 'seo', 'stock')..."
          className="w-full h-10 rounded-lg bg-input border border-border pl-10 pr-3 text-sm"
        />
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        {[
          { label: "Invoices", count: featureRegistry.filter(f => f.category === "invoices").length, icon: "📄" },
          { label: "Inventory", count: featureRegistry.filter(f => f.category === "inventory").length, icon: "📦" },
          { label: "Marketing", count: featureRegistry.filter(f => f.category === "marketing").length, icon: "📢" },
          { label: "Tools", count: featureRegistry.filter(f => f.category === "tools").length, icon: "🔧" },
        ].map(s => (
          <button
            key={s.label}
            onClick={() => setSearchQuery("")}
            className="bg-card rounded-lg border border-border p-2 text-center"
          >
            <span className="text-lg">{s.icon}</span>
            <p className="text-xs font-semibold mt-0.5">{s.count}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Category Sections */}
      {categoryOrder.filter(cat => grouped[cat]).map(cat => {
        const features = grouped[cat];
        const isExpanded = expandedCategories.has(cat) || searchQuery.length > 0;
        
        return (
          <section key={cat} className="mb-4">
            <button
              onClick={() => toggleCategory(cat)}
              className="w-full flex items-center gap-2 py-2 text-left"
            >
              <span className="text-lg">{categoryIcons[cat]}</span>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex-1">
                {categoryLabels[cat]}
              </h2>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {features.length}
              </span>
              {isExpanded
                ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                : <ChevronRight className="w-4 h-4 text-muted-foreground" />
              }
            </button>

            {isExpanded && (
              <div className="space-y-1.5 mt-1">
                {features.map(feature => {
                  const isOpen = openFeature === feature.id;
                  return (
                    <div
                      key={feature.id}
                      className="bg-card rounded-lg border border-border overflow-hidden"
                    >
                      {/* Feature header */}
                      <button
                        onClick={() => setOpenFeature(isOpen ? null : feature.id)}
                        className="w-full px-4 py-3 flex items-center gap-3 text-left"
                      >
                        <span className="text-xl flex-shrink-0">{feature.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{feature.name}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {feature.description}
                          </p>
                        </div>
                        {isOpen
                          ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        }
                      </button>

                      {/* Expanded content */}
                      {isOpen && (
                        <div className="px-4 pb-4 border-t border-border pt-3">
                          <p className="text-xs text-muted-foreground mb-3">
                            {feature.description}
                          </p>

                          {/* Steps */}
                          <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">
                            <BookOpen className="w-3 h-3" /> Step-by-step
                          </h4>
                          <ol className="text-xs text-muted-foreground space-y-1.5 pl-4 list-decimal mb-3">
                            {feature.howTo.map((step, i) => (
                              <li key={i} className="leading-relaxed">{step}</li>
                            ))}
                          </ol>

                          {/* Tips */}
                          {feature.tips && feature.tips.length > 0 && (
                            <>
                              <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">
                                <Lightbulb className="w-3 h-3 text-primary" /> Pro Tips
                              </h4>
                              <ul className="text-xs text-muted-foreground space-y-1 pl-4 list-disc mb-3">
                                {feature.tips.map((tip, i) => (
                                  <li key={i} className="leading-relaxed">{tip}</li>
                                ))}
                              </ul>
                            </>
                          )}

                          {/* Navigate button */}
                          {(feature.flowKey || feature.tabKey) && (
                            <button
                              onClick={() => {
                                if (feature.flowKey && onNavigateToFeature) {
                                  onNavigateToFeature(feature.flowKey);
                                } else if (feature.tabKey && onNavigateToTab) {
                                  onNavigateToTab(feature.tabKey);
                                }
                              }}
                              className="flex items-center gap-1.5 text-xs text-primary font-medium hover:underline mt-1"
                            >
                              <ArrowRight className="w-3 h-3" />
                              Open {feature.name}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {/* Empty state */}
      {filteredFeatures.length === 0 && (
        <div className="text-center py-12">
          <Search className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No features found for "{searchQuery}"</p>
          <button
            onClick={() => setSearchQuery("")}
            className="text-xs text-primary mt-2 hover:underline"
          >
            Clear search
          </button>
        </div>
      )}

      <p className="text-center text-[10px] text-muted-foreground/50 mt-8">
        Sonic Invoice v1.0 · {totalFeatures} features · Auto-updated catalog
      </p>
    </div>
  );
};

export default HowToCatalog;
