import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft, ChevronDown, ChevronRight, Search, Edit3, Brain,
  History as HistoryIcon, BookOpen, Sparkles, Save, X, Info,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import SupplierBrainTab from "@/components/SupplierBrainTab";

interface SupplierIntelligencePanelProps {
  onBack: () => void;
  onOpenInvoiceFlow?: () => void;
}

interface IntelligenceRow {
  id: string;
  supplier_name: string;
  name_variants: string[] | null;
  column_map: Record<string, string> | null;
  confidence_score: number;
  invoice_count: number;
  size_system: string | null;
  sku_prefix_pattern: string | null;
  gst_on_cost: boolean | null;
  gst_on_rrp: boolean | null;
  markup_multiplier: number | null;
  last_invoice_date: string | null;
  last_match_method: string | null;
  created_at: string;
  updated_at: string;
}

interface LogRow {
  id: string;
  supplier_name: string;
  event_type: string;
  match_method: string | null;
  confidence_before: number | null;
  confidence_after: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

const COMMON_SENSE_RULES: Array<{
  category: string;
  rules: Array<{ field: string; logic: string; tooltip: string }>;
}> = [
  {
    category: "Column Detection",
    rules: [
      { field: "Unit Cost", logic: "\"Wholesale\", \"WSP\", \"Buy Price\", \"Cost\" → Unit Cost", tooltip: "Applied when scanning invoice headers — case-insensitive match maps the column to the wholesale cost field." },
      { field: "Retail Price", logic: "\"RRP\", \"Retail\", \"Recommended Retail\", \"SRP\" → Retail Price", tooltip: "Applied to identify the consumer-facing recommended retail price column." },
      { field: "SKU", logic: "\"Style\", \"Style Code\", \"Item No\", \"SKU\" → SKU", tooltip: "Applied to detect the unique product/style identifier column used for matching to your catalog." },
      { field: "Product Title", logic: "\"Description\", \"Style Description\", \"Product Name\" → Product Title", tooltip: "Applied to capture the human-readable product name used as the title in Shopify or your POS." },
      { field: "Colour", logic: "\"Colour\", \"Color\", \"Colourway\" → Colour", tooltip: "Applied to detect colour variant data — accepts both AU/UK and US spellings." },
      { field: "Size", logic: "\"Size\", \"Sizing\" → Size", tooltip: "Applied when a single size column exists (as opposed to a size matrix grid)." },
    ],
  },
  {
    category: "Size Matrix Detection",
    rules: [
      { field: "Numeric size grid", logic: "Numeric column headers (6, 8, 10, 12, 14, 16) → detected as size grid, expanded to individual rows", tooltip: "Applied when 3+ adjacent headers are numeric only — each cell value becomes a separate variant row with that size." },
    ],
  },
  {
    category: "Australian GST Defaults",
    rules: [
      { field: "Cost prices", logic: "Cost prices assumed ex-GST unless marked otherwise", tooltip: "Applied for AU wholesale invoices where the supplier doesn't explicitly tag the cost as GST-inclusive." },
      { field: "RRP prices", logic: "RRP prices assumed incl-GST unless marked otherwise", tooltip: "Applied because consumer-facing retail prices in Australia are quoted GST-inclusive by law." },
      { field: "GST rate", logic: "GST rate: 10%", tooltip: "Applied when adding GST to ex-GST cost or extracting GST from incl-GST RRP." },
    ],
  },
  {
    category: "SKU Pattern Detection",
    rules: [
      { field: "Style code format", logic: "Alphanumeric codes with hyphens detected as style codes", tooltip: "Applied to identify codes like SF-2419 or AB_1234 as the primary SKU; longer suffixes treated as variant codes." },
      { field: "Brand prefix learning", logic: "Brand prefix patterns learned after 2+ invoices", tooltip: "Applied after the system sees the same supplier twice — the common prefix (e.g. \"SF-\") is locked into the supplier profile." },
    ],
  },
];

function confidenceColour(score: number) {
  if (score >= 61) return { bar: "bg-success", text: "text-success", label: "Strong" };
  if (score >= 31) return { bar: "bg-warning", text: "text-warning", label: "Building" };
  return { bar: "bg-destructive", text: "text-destructive", label: "New" };
}

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return format(new Date(iso), "d MMM yyyy");
  } catch {
    return "Unknown";
  }
}

function eventTypeLabel(type: string): string {
  switch (type) {
    case "supplier_learned": return "🆕 New supplier learned";
    case "supplier_updated": return "🔄 Profile updated";
    case "rule_updated": return "📐 Rule updated";
    case "correction_recorded": return "✏️ Correction recorded";
    case "manual_edit": return "✏️ Manual edit";
    default: return type.replace(/_/g, " ");
  }
}

function matchMethodLabel(method: string | null): string {
  if (!method) return "—";
  return method.replace(/_/g, " ");
}

const SupplierIntelligencePanel = ({ onBack }: SupplierIntelligencePanelProps) => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<IntelligenceRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [search, setSearch] = useState(() => {
    if (typeof window === "undefined") return "";
    const pre = window.sessionStorage.getItem("supplierIntel.filter");
    if (pre) {
      window.sessionStorage.removeItem("supplierIntel.filter");
      return pre;
    }
    return "";
  });
  const [activeTab, setActiveTab] = useState<"known" | "brain" | "log" | "rules">("known");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>("");
  const [expandedLog, setExpandedLog] = useState<Set<string>>(new Set());

  const loadAll = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    // Pull intelligence rows + supplier profiles + per-supplier pattern counts
    // in parallel so we can reconcile the three sources into a single list.
    const [{ data: si }, { data: lg }, { data: profiles }, { data: patternRows }] =
      await Promise.all([
        supabase
          .from("supplier_intelligence")
          .select("*")
          .order("invoice_count", { ascending: false }),
        supabase
          .from("supplier_learning_log")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
        userId
          ? supabase
              .from("supplier_profiles")
              .select("id, supplier_name, invoice_count, updated_at")
              .eq("user_id", userId)
          : Promise.resolve({ data: [] as Array<{ id: string; supplier_name: string; invoice_count: number | null; updated_at: string }> }),
        userId
          ? supabase
              .from("invoice_patterns")
              .select("supplier_profile_id, updated_at")
              .eq("user_id", userId)
          : Promise.resolve({ data: [] as Array<{ supplier_profile_id: string | null; updated_at: string }> }),
      ]);

    const intelRows = (si || []) as IntelligenceRow[];

    // Count actual invoice_patterns rows per supplier (matches what
    // Processing History shows). Falls back to supplier_profiles.invoice_count
    // when no patterns are linked yet.
    const profileList = (profiles || []) as Array<{ id: string; supplier_name: string; invoice_count: number | null; updated_at: string }>;
    const patternsBySupplier = new Map<string, number>();
    for (const p of (patternRows || []) as Array<{ supplier_profile_id: string | null }>) {
      if (!p.supplier_profile_id) continue;
      patternsBySupplier.set(p.supplier_profile_id, (patternsBySupplier.get(p.supplier_profile_id) || 0) + 1);
    }

    // Override displayed invoice_count using actual pattern counts so the
    // Supplier Intelligence + Processing History views stay in sync.
    const intelByName = new Map(intelRows.map(r => [r.supplier_name.toLowerCase(), r] as const));
    for (const profile of profileList) {
      const intel = intelByName.get(profile.supplier_name.toLowerCase());
      if (!intel) continue;
      const actual = patternsBySupplier.get(profile.id) ?? profile.invoice_count ?? 0;
      if (actual > 0) intel.invoice_count = actual;
    }

    // Backfill: any supplier_profiles missing from supplier_intelligence
    // (so e.g. "Rhythm" appears here when it appears in Processing History).
    const reconciled: IntelligenceRow[] = [...intelRows];
    for (const profile of profileList) {
      if (intelByName.has(profile.supplier_name.toLowerCase())) continue;
      const count = patternsBySupplier.get(profile.id) ?? profile.invoice_count ?? 0;
      if (count === 0) continue;
      reconciled.push({
        id: `profile-${profile.id}`,
        supplier_name: profile.supplier_name,
        name_variants: [],
        column_map: {},
        confidence_score: 20,
        invoice_count: count,
        size_system: null,
        sku_prefix_pattern: null,
        gst_on_cost: null,
        gst_on_rrp: null,
        markup_multiplier: null,
        last_invoice_date: profile.updated_at,
        last_match_method: null,
        created_at: profile.updated_at,
        updated_at: profile.updated_at,
      });
    }
    reconciled.sort((a, b) => b.invoice_count - a.invoice_count);

    setRows(reconciled);
    setLogs((lg || []) as LogRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.supplier_name.toLowerCase().includes(q) ||
      (r.name_variants || []).some(v => v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const toggleRow = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleLogRow = (id: string) => {
    setExpandedLog(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startEdit = (row: IntelligenceRow) => {
    setEditing(row.id);
    setEditDraft(JSON.stringify(row.column_map ?? {}, null, 2));
  };

  const saveEdit = async (row: IntelligenceRow) => {
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(editDraft);
    } catch {
      toast.error("Invalid JSON", { description: "Column map must be valid JSON." });
      return;
    }
    const { error } = await supabase
      .from("supplier_intelligence")
      .update({ column_map: parsed as never } as never)
      .eq("id", row.id);

    if (error) {
      toast.error("Save failed", { description: error.message });
      return;
    }

    // Audit log entry — store the BEFORE confidence as both "before" and "after"
    // so the chronological tab still gets a row without misrepresenting the
    // confidence change.
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await supabase.from("supplier_learning_log").insert({
        user_id: session.user.id,
        supplier_name: row.supplier_name,
        event_type: "manual_edit",
        match_method: row.last_match_method,
        confidence_before: row.confidence_score,
        confidence_after: row.confidence_score,
        details: { fields_changed: ["column_map"] } as never,
      } as never);
    }

    setEditing(null);
    toast.success("Rules updated", { description: `${row.supplier_name} column map saved.` });
    void loadAll();
  };

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background animate-fade-in pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-base font-semibold font-display flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" /> Supplier Intelligence
          </h2>
          <p className="text-[11px] text-muted-foreground">
            How the app learns your suppliers — and the rules it falls back on.
          </p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {rows.length} known {rows.length === 1 ? "supplier" : "suppliers"}
        </Badge>
      </div>

      <div className="px-4 py-4">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList className="grid w-full grid-cols-4 mb-4">
            <TabsTrigger value="known" className="text-xs gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Known Suppliers
            </TabsTrigger>
            <TabsTrigger value="brain" className="text-xs gap-1.5">
              <Brain className="w-3.5 h-3.5" /> Brain
            </TabsTrigger>
            <TabsTrigger value="log" className="text-xs gap-1.5">
              <HistoryIcon className="w-3.5 h-3.5" /> Learning Log
            </TabsTrigger>
            <TabsTrigger value="rules" className="text-xs gap-1.5">
              <BookOpen className="w-3.5 h-3.5" /> Common Sense
            </TabsTrigger>
          </TabsList>

          <TabsContent value="brain" className="mt-0">
            <SupplierBrainTab />
          </TabsContent>

          {/* ── Tab 1: Known Suppliers ────────────────────── */}
          <TabsContent value="known" className="space-y-3 mt-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search suppliers or aliases…"
                className="pl-9 h-9 text-sm"
              />
            </div>

            {loading ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                Loading…
              </Card>
            ) : filtered.length === 0 ? (
              <Card className="p-8 text-center">
                <Brain className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium mb-1">No supplier intelligence yet</p>
                <p className="text-xs text-muted-foreground">
                  Process your first invoice to start building a profile.
                </p>
              </Card>
            ) : (
              <Card className="divide-y divide-border overflow-hidden">
                {/* Header row */}
                <div className="grid grid-cols-[2fr_70px_1.4fr_1fr_1.2fr_90px] gap-2 px-3 py-2 bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                  <span>Supplier</span>
                  <span className="text-center">Invoices</span>
                  <span>Confidence</span>
                  <span>Last invoice</span>
                  <span>Match method</span>
                  <span className="text-right">Rules</span>
                </div>

                {filtered.map((row) => {
                  const conf = confidenceColour(row.confidence_score);
                  const isExpanded = expanded.has(row.id);
                  const isEditing = editing === row.id;
                  return (
                    <div key={row.id}>
                      <div className="grid grid-cols-[2fr_70px_1.4fr_1fr_1.2fr_90px] gap-2 px-3 py-2.5 items-center text-xs">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{row.supplier_name}</p>
                          {(row.name_variants?.length ?? 0) > 0 && (
                            <p className="text-[10px] text-muted-foreground truncate">
                              aka {row.name_variants!.slice(0, 2).join(", ")}
                              {(row.name_variants!.length > 2) && ` +${row.name_variants!.length - 2}`}
                            </p>
                          )}
                        </div>
                        <div className="text-center font-mono font-bold">{row.invoice_count}</div>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full ${conf.bar} transition-all`}
                              style={{ width: `${row.confidence_score}%` }}
                            />
                          </div>
                          <span className={`text-[10px] font-mono font-bold ${conf.text} shrink-0`}>
                            {row.confidence_score}%
                          </span>
                        </div>
                        <div className="text-muted-foreground">
                          {formatRelative(row.last_invoice_date)}
                        </div>
                        <div className="text-muted-foreground capitalize truncate">
                          {matchMethodLabel(row.last_match_method)}
                        </div>
                        <div className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggleRow(row.id)}
                            className="h-7 px-2 text-[10px] gap-1"
                          >
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            View
                          </Button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="px-3 pb-4 pt-1 bg-muted/20 space-y-3 text-xs">
                          {/* Column mappings */}
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                                Column mappings
                              </p>
                              {!isEditing ? (
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={() => startEdit(row)}>
                                  <Edit3 className="w-3 h-3" /> Edit rules
                                </Button>
                              ) : (
                                <div className="flex gap-1">
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={() => setEditing(null)}>
                                    <X className="w-3 h-3" /> Cancel
                                  </Button>
                                  <Button size="sm" variant="default" className="h-6 px-2 text-[10px] gap-1" onClick={() => saveEdit(row)}>
                                    <Save className="w-3 h-3" /> Save
                                  </Button>
                                </div>
                              )}
                            </div>
                            {isEditing ? (
                              <Textarea
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                className="font-mono text-[11px] min-h-[140px]"
                              />
                            ) : Object.keys(row.column_map ?? {}).length === 0 ? (
                              <p className="text-[11px] text-muted-foreground italic">No column mappings learned yet.</p>
                            ) : (
                              <div className="rounded-md border border-border overflow-hidden">
                                {Object.entries(row.column_map ?? {}).map(([header, field], i) => (
                                  <div
                                    key={header}
                                    className={`grid grid-cols-2 gap-2 px-3 py-1.5 text-[11px] ${i % 2 === 0 ? "bg-card" : "bg-muted/20"}`}
                                  >
                                    <span className="font-mono text-muted-foreground truncate">{header}</span>
                                    <span className="font-mono text-foreground truncate">→ {field}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Brand patterns */}
                          <div>
                            <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5">
                              Brand patterns
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                              <div className="rounded-md border border-border bg-card p-2">
                                <p className="text-[9px] text-muted-foreground uppercase">SKU prefix</p>
                                <p className="font-mono text-[11px] mt-0.5">{row.sku_prefix_pattern || "—"}</p>
                              </div>
                              <div className="rounded-md border border-border bg-card p-2">
                                <p className="text-[9px] text-muted-foreground uppercase">Size system</p>
                                <p className="font-mono text-[11px] mt-0.5">{row.size_system || "—"}</p>
                              </div>
                              <div className="rounded-md border border-border bg-card p-2">
                                <p className="text-[9px] text-muted-foreground uppercase">Markup</p>
                                <p className="font-mono text-[11px] mt-0.5">
                                  {row.markup_multiplier ? `${row.markup_multiplier}×` : "—"}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* GST */}
                          <div>
                            <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5">
                              GST settings
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded-md border border-border bg-card p-2">
                                <p className="text-[9px] text-muted-foreground uppercase">Cost</p>
                                <p className="text-[11px] mt-0.5">
                                  {row.gst_on_cost === null ? "Unknown" : row.gst_on_cost ? "Incl GST" : "Ex GST"}
                                </p>
                              </div>
                              <div className="rounded-md border border-border bg-card p-2">
                                <p className="text-[9px] text-muted-foreground uppercase">RRP</p>
                                <p className="text-[11px] mt-0.5">
                                  {row.gst_on_rrp === null ? "Unknown" : row.gst_on_rrp ? "Incl GST" : "Ex GST"}
                                </p>
                              </div>
                            </div>
                          </div>

                          <p className="text-[10px] text-muted-foreground pt-1">
                            Last updated {formatRelative(row.updated_at)}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </Card>
            )}
          </TabsContent>

          {/* ── Tab 2: Learning Log ───────────────────────── */}
          <TabsContent value="log" className="space-y-2 mt-0">
            {loading ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
            ) : logs.length === 0 ? (
              <Card className="p-8 text-center">
                <HistoryIcon className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium mb-1">No learning events yet</p>
                <p className="text-xs text-muted-foreground">Process invoices to start building history.</p>
              </Card>
            ) : (
              <Card className="divide-y divide-border overflow-hidden">
                <div className="grid grid-cols-[140px_1.6fr_1.4fr_1.2fr_1.4fr_28px] gap-2 px-3 py-2 bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                  <span>Timestamp</span>
                  <span>Supplier</span>
                  <span>Event</span>
                  <span>Match method</span>
                  <span>Confidence</span>
                  <span></span>
                </div>
                {logs.map((log) => {
                  const isOpen = expandedLog.has(log.id);
                  const before = log.confidence_before;
                  const after = log.confidence_after;
                  const delta = (typeof before === "number" && typeof after === "number") ? after - before : null;
                  return (
                    <div key={log.id}>
                      <button
                        type="button"
                        onClick={() => toggleLogRow(log.id)}
                        className="w-full grid grid-cols-[140px_1.6fr_1.4fr_1.2fr_1.4fr_28px] gap-2 px-3 py-2 items-center text-xs hover:bg-muted/30 text-left"
                      >
                        <span className="text-muted-foreground font-mono text-[10px]">
                          {format(new Date(log.created_at), "d MMM HH:mm")}
                        </span>
                        <span className="truncate font-medium">{log.supplier_name}</span>
                        <span className="truncate">{eventTypeLabel(log.event_type)}</span>
                        <span className="truncate text-muted-foreground capitalize">
                          {matchMethodLabel(log.match_method)}
                        </span>
                        <span className="font-mono text-[11px] flex items-center gap-1">
                          {before !== null ? `${before}%` : "—"}
                          <span className="text-muted-foreground">→</span>
                          {after !== null ? `${after}%` : "—"}
                          {delta !== null && delta !== 0 && (
                            <span className={`text-[10px] ${delta > 0 ? "text-success" : "text-destructive"}`}>
                              ({delta > 0 ? "+" : ""}{delta})
                            </span>
                          )}
                        </span>
                        <span className="text-muted-foreground">
                          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3 pt-1 bg-muted/20 space-y-2">
                          <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap">
                            {JSON.stringify(log.details ?? {}, null, 2)}
                          </pre>
                          {(() => {
                            const invoiceId = (log.details as { invoice_id?: string } | null)?.invoice_id;
                            if (!invoiceId) return null;
                            return (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (typeof window !== "undefined") {
                                    window.sessionStorage.setItem("processingHistory.filter", invoiceId);
                                    window.dispatchEvent(new CustomEvent("sonic:navigate-flow", { detail: "processing-history" }));
                                  }
                                }}
                                className="text-[10px] text-primary hover:underline font-medium"
                              >
                                View invoice in Processing History →
                              </button>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </Card>
            )}
          </TabsContent>

          {/* ── Tab 3: Common Sense Rules (read-only) ─────── */}
          <TabsContent value="rules" className="space-y-3 mt-0">
            <div>
              <h3 className="text-sm font-semibold font-display">Universal Detection Rules</h3>
              <p className="text-xs text-muted-foreground">Applied when no supplier profile exists</p>
            </div>
            <Card className="p-3 bg-muted/20 border-dashed">
              <p className="text-xs text-muted-foreground">
                These universal rules run on every brand-new supplier — once a real invoice is processed,
                the supplier's learned profile takes over. Hover the <Info className="w-3 h-3 inline -mt-0.5" /> icon
                on any rule to see when it's applied.
              </p>
            </Card>

            <TooltipProvider delayDuration={150}>
              {COMMON_SENSE_RULES.map((section) => (
                <Card key={section.category} className="overflow-hidden">
                  <div className="px-3 py-2 bg-muted/30 border-b border-border">
                    <p className="text-xs font-semibold">{section.category}</p>
                  </div>
                  <div className="divide-y divide-border">
                    {section.rules.map((rule) => (
                      <div key={rule.field} className="grid grid-cols-[160px_1fr_28px] gap-3 px-3 py-2 text-xs items-start">
                        <span className="font-medium text-foreground">{rule.field}</span>
                        <span className="text-muted-foreground">{rule.logic}</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={`When this rule is applied: ${rule.tooltip}`}
                              className="text-muted-foreground hover:text-foreground transition-colors justify-self-end"
                            >
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-xs text-xs">
                            {rule.tooltip}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </TooltipProvider>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default SupplierIntelligencePanel;
