import { useEffect, useMemo, useState } from "react";
import { Info, Lock, Sparkles, RotateCcw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  COLLECTION_TYPE_CONFIGS,
  DEFAULT_METHOD_PREFS,
  MethodPreferences,
  PREFS_LS_KEY,
  getSmartDefaults,
  methodLabelToPrefKey,
  prefKeyToMethodLabel,
} from "@/lib/collection-rule-methods";

// Per-fixed-type lock reason — shown in tooltip with 🔒
const LOCK_REASONS: Record<string, string> = {
  brand: "Vendor field is always the most reliable signal for brand collections.",
  brand_story: "Style/print names only exist in the product title. Tags and product types never contain story names like 'Mayflower' or 'Bandwave'. This cannot be changed.",
  feature: "Feature tags (chlorine resist, underwire, d-g, tummy control) are explicitly applied and are the definitive signal.",
  colour: "Colour tags are applied per the tag system — most reliable signal for colour collections.",
  new_arrivals: "The 'new arrivals' tag is set explicitly when products are received.",
};

interface Props {
  storeName?: string;
  /** Loaded products — used to compute tag/type quality. */
  products?: { tags?: string; product_type?: string }[];
  value: MethodPreferences;
  onChange: (next: MethodPreferences) => void;
}

export function loadStoredPrefs(storeName?: string): MethodPreferences {
  try {
    const raw = localStorage.getItem(PREFS_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...getSmartDefaults(storeName), ...parsed } as MethodPreferences;
    }
  } catch { /* */ }
  return getSmartDefaults(storeName);
}

export default function CollectionRuleMethodChooser({ storeName, products = [], value, onChange }: Props) {
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (!remember) return;
    try { localStorage.setItem(PREFS_LS_KEY, JSON.stringify(value)); } catch { /* */ }
  }, [value, remember]);

  const isSplash = !!storeName?.toLowerCase().includes("splash");

  const { tagRate, typeRate } = useMemo(() => {
    if (!products.length) return { tagRate: 1, typeRate: 1 };
    const tagged = products.filter(p => (p.tags || "").trim().length > 0).length;
    const typed = products.filter(p => (p.product_type || "").trim().length > 0).length;
    return { tagRate: tagged / products.length, typeRate: typed / products.length };
  }, [products]);

  const choiceConfigs = COLLECTION_TYPE_CONFIGS.filter(c => c.choice_required);
  const fixedConfigs = COLLECTION_TYPE_CONFIGS.filter(c => !c.choice_required);

  const setChoice = (level_label: keyof MethodPreferences, label: string) => {
    const key = methodLabelToPrefKey(level_label, label);
    if (!key) return;
    onChange({ ...value, [level_label]: key } as MethodPreferences);
  };

  const warningFor = (m: { requires_good_tags: boolean; requires_good_type: boolean }) => {
    const checks: { label: string; pct: number }[] = [];
    if (m.requires_good_tags) checks.push({ label: "tags", pct: tagRate });
    if (m.requires_good_type) checks.push({ label: "types", pct: typeRate });
    if (checks.length === 0) return null;
    const worst = checks.reduce((a, b) => (a.pct < b.pct ? a : b));
    const pct = Math.round(worst.pct * 100);
    if (pct >= 90) return { tone: "ok" as const, text: `${pct}% of products have ${worst.label} — reliable.` };
    if (pct >= 70) return { tone: "warn" as const, text: `Only ${pct}% of products have ${worst.label} — may miss some.` };
    return { tone: "bad" as const, text: `Only ${pct}% of products have ${worst.label} — pick a different method or fix data first.` };
  };

  return (
    <div className="rounded-md border border-border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" /> How to build your collections
        </h3>
        <p className="text-xs text-muted-foreground">
          Choose the rule method for each collection type. Fixed types are set automatically.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {isSplash && (
          <span className="rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] px-2 py-1">
            ✓ Splash Swimwear smart defaults applied
          </span>
        )}
        <Button
          size="sm" variant="ghost" className="h-6 px-2 text-[11px] ml-auto"
          onClick={() => onChange(getSmartDefaults(storeName))}
        >
          <RotateCcw className="w-3 h-3 mr-1" /> Reset to defaults
        </Button>
      </div>

      <div className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border pb-1">
        Requires your choice
      </div>

      {/* Choice cards */}
      <div className="space-y-3">
        {choiceConfigs.map(cfg => {
          const currentLabel = prefKeyToMethodLabel(cfg.level_label, value[cfg.level_label as keyof MethodPreferences]);
          return (
            <div key={cfg.level_label} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <span>{cfg.icon}</span> {cfg.display_name}
                </div>
                {cfg.note && (
                  <span title={cfg.note} className="text-muted-foreground"><Info className="w-3.5 h-3.5" /></span>
                )}
              </div>
              <div className="space-y-1.5">
                {cfg.available_methods!.map(m => {
                  const checked = currentLabel === m.label;
                  const isRecommended = cfg.recommended_method === m.label;
                  const warn = warningFor(m);
                  return (
                    <label key={m.label} className={`flex items-start gap-2 p-2 rounded cursor-pointer text-sm ${checked ? "bg-muted" : "hover:bg-muted/40"}`}>
                      <input
                        type="radio"
                        className="mt-1"
                        name={`method-${cfg.level_label}`}
                        checked={checked}
                        onChange={() => setChoice(cfg.level_label as keyof MethodPreferences, m.label)}
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{m.label}</span>
                          {isRecommended && <Badge className="text-[10px]">Recommended</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{m.description}</div>
                        {warn && (
                          <div className={`text-[11px] mt-1 ${
                            warn.tone === "ok" ? "text-primary" :
                            warn.tone === "warn" ? "text-amber-500" :
                            "text-destructive"
                          }`}>
                            {warn.tone === "ok" ? "✅ " : warn.tone === "warn" ? "⚠️ " : "⛔ "} {warn.text}
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Fixed types — locked, with tooltip explaining why */}
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border pb-1">
        Set automatically (no choice needed)
      </div>
      <TooltipProvider delayDuration={150}>
        <ul className="space-y-1.5">
          {fixedConfigs.map(cfg => {
            const m = cfg.fixed_method!;
            const reason = LOCK_REASONS[cfg.level_label] || cfg.note || "Fixed by design — most reliable signal for this collection type.";
            return (
              <li key={cfg.level_label} className="flex items-center gap-2 rounded border border-border/60 bg-muted/20 px-2 py-1.5 text-xs">
                <span>{cfg.icon}</span>
                <b className="text-foreground">{cfg.display_name}</b>
                <span className="text-muted-foreground">→ {m.rule_column} {m.rule_relation} {m.condition_template}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Why is this locked?">
                      <Lock className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs text-xs">
                    {reason}
                  </TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </TooltipProvider>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">Remember my choices for next time</span>
        <Switch checked={remember} onCheckedChange={(v) => {
          setRemember(v);
          if (!v) { try { localStorage.removeItem(PREFS_LS_KEY); } catch { /* */ } }
        }} />
      </div>
    </div>
  );
}

export { DEFAULT_METHOD_PREFS };
