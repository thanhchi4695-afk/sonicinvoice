import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, ChevronRight, BookOpen, Lightbulb, ArrowRight, Link2, List } from "lucide-react";
import { toast } from "sonner";
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
  const featureRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const stepRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const filteredFeatures = useMemo(() => searchFeatures(searchQuery), [searchQuery]);

  // ── Deep-link support: #how/<feature-id> and #how/<feature-id>/step-N ──
  // Always show a ToC for these flagship guides; auto-show for any 5+ step feature.
  const TOC_FORCE_FEATURES = new Set([
    "margin_guardian_rules",
    "slack_approval_workflow",
    "margin_guardian_extension",
  ]);
  const shouldShowToc = (id: string, stepCount: number) =>
    TOC_FORCE_FEATURES.has(id) || stepCount >= 5;

  const slugForStep = (featureId: string, stepIndex: number) =>
    `how/${featureId}/step-${stepIndex + 1}`;

  const parseHash = (hash: string): { featureId?: string; stepIndex?: number } => {
    const cleaned = hash.replace(/^#/, "");
    if (!cleaned.startsWith("how/")) return {};
    const parts = cleaned.split("/");
    const featureId = parts[1];
    const stepPart = parts[2];
    const stepMatch = stepPart?.match(/^step-(\d+)$/);
    return {
      featureId,
      stepIndex: stepMatch ? Math.max(0, Number(stepMatch[1]) - 1) : undefined,
    };
  };

  // Apply current URL hash → expand the right feature and scroll to step.
  // Runs on mount, on hashchange (back/forward + manual edits), and again
  // once the targeted card has actually rendered so step refs exist.
  const applyHash = () => {
    const { featureId, stepIndex } = parseHash(window.location.hash);
    if (!featureId) return;
    const target = featureRegistry.find(f => f.id === featureId);
    if (!target) return;
    setOpenFeature(featureId);
    setExpandedCategories(prev => {
      if (prev.has(target.category)) return prev;
      const next = new Set(prev);
      next.add(target.category);
      return next;
    });
    // Try scrolling now and again after layout settles (refs may not exist yet).
    const scrollTo = () => {
      const stepEl = stepIndex !== undefined ? stepRefs.current[`${featureId}:${stepIndex}`] : null;
      const featureEl = featureRefs.current[featureId];
      const el = stepEl ?? featureEl;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: stepEl ? "center" : "start" });
        return true;
      }
      return false;
    };
    requestAnimationFrame(() => {
      if (!scrollTo()) {
        // Card still mounting after expanding category — retry on next frame.
        requestAnimationFrame(() => { scrollTo(); });
      }
    });
  };

  useEffect(() => {
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After openFeature changes (e.g. on first render the card wasn't mounted yet),
  // re-sync scroll to the step from the URL if any.
  useEffect(() => {
    if (!openFeature) return;
    const { featureId, stepIndex } = parseHash(window.location.hash);
    if (featureId !== openFeature || stepIndex === undefined) return;
    requestAnimationFrame(() => {
      stepRefs.current[`${featureId}:${stepIndex}`]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [openFeature]);

  const copyAnchor = async (anchor: string, label: string) => {
    const url = `${window.location.origin}${window.location.pathname}#${anchor}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`Copied link to ${label}`);
    } catch {
      window.location.hash = anchor;
      toast.message("Link applied to URL — copy from address bar");
    }
  };

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
                  const featureAnchor = `how/${feature.id}`;
                  const showToc = shouldShowToc(feature.id, feature.howTo.length);
                  return (
                    <div
                      key={feature.id}
                      id={featureAnchor}
                      ref={el => (featureRefs.current[feature.id] = el)}
                      className="bg-card rounded-lg border border-border overflow-hidden scroll-mt-20"
                    >
                      {/* Feature header */}
                      <div className="w-full px-4 py-3 flex items-center gap-3">
                        <button
                          onClick={() => {
                            const next = isOpen ? null : feature.id;
                            setOpenFeature(next);
                            const base = `${window.location.pathname}${window.location.search}`;
                            if (next) {
                              // pushState so refresh + back button + share all work.
                              history.pushState(null, "", `${base}#${featureAnchor}`);
                            } else {
                              // Closing clears the hash so the URL reflects current view.
                              history.pushState(null, "", base);
                            }
                          }}
                          className="flex-1 flex items-center gap-3 text-left min-w-0"
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
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            copyAnchor(featureAnchor, feature.name);
                          }}
                          aria-label={`Copy link to ${feature.name}`}
                          title="Copy link to this guide"
                          className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-muted flex-shrink-0"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Expanded content */}
                      {isOpen && (
                        <div className="px-4 pb-4 border-t border-border pt-3">
                          <p className="text-xs text-muted-foreground mb-3">
                            {feature.description}
                          </p>

                          {/* Mini ToC for long / flagship guides */}
                          {showToc && feature.howTo.length > 1 && (
                            <nav
                              aria-label={`${feature.name} table of contents`}
                              className="mb-3 rounded-md border border-border bg-muted/30 p-3"
                            >
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                                <List className="w-3 h-3" /> On this page
                              </p>
                              <ol className="space-y-1 text-xs">
                                {feature.howTo.map((step, i) => {
                                  const slug = slugForStep(feature.id, i);
                                  const preview = step.length > 70 ? step.slice(0, 67) + "…" : step;
                                  return (
                                    <li key={i} className="flex items-start gap-2">
                                      <a
                                        href={`#${slug}`}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          const base = `${window.location.pathname}${window.location.search}`;
                                          history.pushState(null, "", `${base}#${slug}`);
                                          stepRefs.current[`${feature.id}:${i}`]?.scrollIntoView({
                                            behavior: "smooth",
                                            block: "center",
                                          });
                                        }}
                                        className="text-primary hover:underline leading-relaxed flex-1"
                                      >
                                        <span className="font-mono text-[10px] text-muted-foreground mr-1.5">
                                          {String(i + 1).padStart(2, "0")}
                                        </span>
                                        {preview}
                                      </a>
                                    </li>
                                  );
                                })}
                              </ol>
                            </nav>
                          )}

                          {/* Steps */}
                          <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">
                            <BookOpen className="w-3 h-3" /> Step-by-step
                          </h4>
                          <ol className="text-xs text-muted-foreground space-y-1.5 pl-4 list-decimal mb-3">
                            {feature.howTo.map((step, i) => {
                              const slug = slugForStep(feature.id, i);
                              return (
                                <li
                                  key={i}
                                  id={slug}
                                  ref={el => (stepRefs.current[`${feature.id}:${i}`] = el)}
                                  className="leading-relaxed scroll-mt-24 group"
                                >
                                  {step}
                                  {showToc && (
                                    <button
                                      onClick={() => copyAnchor(slug, `step ${i + 1}`)}
                                      aria-label={`Copy link to step ${i + 1}`}
                                      title="Copy link to this step"
                                      className="ml-1.5 align-middle opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-opacity"
                                    >
                                      <Link2 className="inline w-3 h-3" />
                                    </button>
                                  )}
                                </li>
                              );
                            })}
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
