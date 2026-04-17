import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft, Search, Trash2, Eye, Edit3, Brain, Upload,
  History, BookOpen, Sparkles, AlertCircle, Check, X,
  Clock, TrendingUp, Award, Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface SupplierIntelligencePanelProps {
  onBack: () => void;
  onOpenInvoiceFlow?: () => void;
}

interface SupplierProfileRow {
  id: string;
  supplier_name: string;
  supplier_name_variants: string[] | null;
  invoice_count: number;
  confidence_score: number;
  currency: string | null;
  country: string | null;
  is_known_brand: boolean;
  updated_at: string;
  created_at: string;
  profile_data: Record<string, unknown> | null;
}

interface InvoicePatternRow {
  id: string;
  supplier_profile_id: string | null;
  format_type: string | null;
  column_map: Record<string, string> | null;
  size_system: string | null;
  price_column_cost: string | null;
  price_column_rrp: string | null;
  gst_included_in_cost: boolean | null;
  gst_included_in_rrp: boolean | null;
  default_markup_multiplier: number | null;
  pack_notation_detected: boolean | null;
  size_matrix_detected: boolean | null;
  sample_headers: string[] | null;
  invoice_count: number;
  updated_at: string;
  created_at?: string;
  review_duration_seconds?: number | null;
  edit_count?: number | null;
  processing_quality_score?: number | null;
  exported_at?: string | null;
}

interface SupplierQualityStats {
  invoiceCount: number;
  avgDurationMin: number | null;
  avgEdits: number | null;
  avgQuality: number | null;
  bestQuality: number | null;
  recentScores: number[]; // last 5 chronological (oldest→newest)
  firstScore: number | null;
  lastScore: number | null;
}

interface CorrectionRow {
  id: string;
  supplier_profile_id: string | null;
  field_corrected: string | null;
  original_value: string | null;
  corrected_value: string | null;
  created_at: string;
}

const COMMON_SENSE_RULES = [
  { field: "Cost column", logic: "Header contains \"wholesale\", \"WSP\", \"buy price\", \"cost\" or \"ex GST\"" },
  { field: "RRP column", logic: "Header contains \"RRP\", \"retail\", \"sell price\" or \"recommended\"" },
  { field: "SKU column", logic: "Header contains \"style no\", \"SKU\", \"item code\", \"ref\" or \"product code\"" },
  { field: "Colour column", logic: "Header contains \"colour\", \"color\", \"col\" or \"colourway\"" },
  { field: "Product name", logic: "Header contains \"description\", \"name\", \"product\" or \"style name\"" },
  { field: "Size matrix", logic: "3+ numeric-only headers in a row (e.g. 8, 10, 12, 14, 16)" },
  { field: "Pack notation", logic: "Header matches pattern like \"1x8\" or \"2x10\"" },
  { field: "Currency check", logic: "If avg cost > 500 with no decimals → flag as likely JPY/USD, not AUD" },
  { field: "Currency default", logic: "Australian retail → AUD unless evidence suggests otherwise" },
  { field: "GST on cost", logic: "Default: cost is ex-GST (Australian wholesale standard)" },
  { field: "GST on RRP", logic: "Default: RRP is incl-GST (consumer-facing price)" },
  { field: "Markup — fashion", logic: "Default 2.2× cost when no RRP is provided" },
  { field: "Markup — accessories", logic: "Default 2.5× cost (higher margin category)" },
  { field: "Markup — basics", logic: "Default 2.0× cost (commodity items, tighter margin)" },
  { field: "Size system", logic: "Default AU sizing unless US (XS-XXL with 0/2/4) or EU (34-44) markers found" },
  { field: "Fuzzy supplier match", logic: "Levenshtein distance < 3 between names → treat as same supplier" },
  { field: "Header fingerprint", logic: "Sorted+normalised headers match a saved invoice → reuse that pattern" },
];

function confidenceColour(score: number) {
  if (score >= 70) return { bar: "bg-emerald-500", text: "text-emerald-400", label: "Strong" };
  if (score >= 40) return { bar: "bg-amber-500", text: "text-amber-400", label: "Learning" };
  return { bar: "bg-red-500", text: "text-red-400", label: "Weak" };
}

const SupplierIntelligencePanel = ({ onBack, onOpenInvoiceFlow }: SupplierIntelligencePanelProps) => {
  const [profiles, setProfiles] = useState<SupplierProfileRow[]>([]);
  const [patterns, setPatterns] = useState<Record<string, InvoicePatternRow>>({});
  const [allPatterns, setAllPatterns] = useState<InvoicePatternRow[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editJson, setEditJson] = useState("");
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) { setLoading(false); return; }

    const [{ data: profs }, { data: pats }, { data: corrs }] = await Promise.all([
      supabase.from("supplier_profiles").select("*").eq("is_active", true).order("updated_at", { ascending: false }),
      supabase.from("invoice_patterns").select("*").order("updated_at", { ascending: false }),
      supabase.from("correction_log").select("*").order("created_at", { ascending: false }).limit(200),
    ]);

    setProfiles((profs as SupplierProfileRow[]) || []);
    const patternMap: Record<string, InvoicePatternRow> = {};
    const all = (pats as InvoicePatternRow[]) || [];
    for (const p of all) {
      if (p.supplier_profile_id && !patternMap[p.supplier_profile_id]) patternMap[p.supplier_profile_id] = p;
    }
    setPatterns(patternMap);
    setAllPatterns(all);
    setCorrections((corrs as CorrectionRow[]) || []);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((p) =>
      p.supplier_name.toLowerCase().includes(q) ||
      (p.supplier_name_variants || []).some((v) => v.toLowerCase().includes(q))
    );
  }, [profiles, search]);

  // Per-supplier quality aggregates
  const qualityBySupplier = useMemo(() => {
    const map: Record<string, SupplierQualityStats> = {};
    const grouped: Record<string, InvoicePatternRow[]> = {};
    for (const p of allPatterns) {
      if (!p.supplier_profile_id) continue;
      (grouped[p.supplier_profile_id] ||= []).push(p);
    }
    for (const [sid, rows] of Object.entries(grouped)) {
      // chronological oldest → newest
      const sorted = [...rows].sort(
        (a, b) => +new Date(a.exported_at || a.updated_at) - +new Date(b.exported_at || b.updated_at),
      );
      const durations = sorted.map((r) => r.review_duration_seconds).filter((v): v is number => typeof v === "number");
      const edits = sorted.map((r) => r.edit_count).filter((v): v is number => typeof v === "number");
      const scores = sorted.map((r) => r.processing_quality_score).filter((v): v is number => typeof v === "number");
      const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
      map[sid] = {
        invoiceCount: sorted.length,
        avgDurationMin: durations.length ? avg(durations)! / 60 : null,
        avgEdits: avg(edits),
        avgQuality: avg(scores),
        bestQuality: scores.length ? Math.max(...scores) : null,
        recentScores: scores.slice(-5),
        firstScore: scores[0] ?? null,
        lastScore: scores[scores.length - 1] ?? null,
      };
    }
    return map;
  }, [allPatterns]);

  // Aggregate report
  const qualityReport = useMemo(() => {
    const allScores: number[] = [];
    let totalInvoices = 0;
    let savedMins = 0;
    for (const stats of Object.values(qualityBySupplier)) {
      totalInvoices += stats.invoiceCount;
      // recompute time savings from raw rows
    }
    for (const r of allPatterns) {
      const s = r.processing_quality_score;
      if (typeof s === "number") {
        allScores.push(s);
        if (s > 80) savedMins += 15;
        else if (s >= 50) savedMins += 7;
      }
    }
    const avgQuality = allScores.length
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
      : null;

    let mostReliable: { name: string; score: number } | null = null;
    let mostImproved: { name: string; delta: number } | null = null;
    let weakest: { name: string; score: number } | null = null;

    for (const prof of profiles) {
      const s = qualityBySupplier[prof.id];
      if (!s) continue;
      if (s.avgQuality != null) {
        if (!mostReliable || s.avgQuality > mostReliable.score) {
          mostReliable = { name: prof.supplier_name, score: s.avgQuality };
        }
        if (s.invoiceCount > 3 && (!weakest || s.avgQuality < weakest.score)) {
          weakest = { name: prof.supplier_name, score: s.avgQuality };
        }
      }
      if (s.firstScore != null && s.lastScore != null && s.invoiceCount >= 2) {
        const delta = s.lastScore - s.firstScore;
        if (!mostImproved || delta > mostImproved.delta) {
          mostImproved = { name: prof.supplier_name, delta };
        }
      }
    }

    return {
      totalInvoices: allPatterns.length,
      scoredInvoices: allScores.length,
      avgQuality,
      hoursSaved: Math.round((savedMins / 60) * 10) / 10,
      mostReliable,
      mostImproved,
      weakest,
    };
  }, [allPatterns, qualityBySupplier, profiles]);

  const correctionsByProfile = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of corrections) {
      if (c.supplier_profile_id) map[c.supplier_profile_id] = (map[c.supplier_profile_id] || 0) + 1;
    }
    return map;
  }, [corrections]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete learned profile for "${name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("supplier_profiles").update({ is_active: false }).eq("id", id);
    if (error) { toast.error("Delete failed"); return; }
    toast.success(`Removed "${name}" from learned suppliers`);
    setProfiles((prev) => prev.filter((p) => p.id !== id));
  };

  const startEdit = (id: string) => {
    const pattern = patterns[id];
    setEditingId(id);
    setEditJson(JSON.stringify({
      column_map: pattern?.column_map || {},
      size_system: pattern?.size_system,
      price_column_cost: pattern?.price_column_cost,
      price_column_rrp: pattern?.price_column_rrp,
      gst_included_in_cost: pattern?.gst_included_in_cost,
      gst_included_in_rrp: pattern?.gst_included_in_rrp,
      default_markup_multiplier: pattern?.default_markup_multiplier,
    }, null, 2));
  };

  const saveEdit = async () => {
    if (!editingId) return;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(editJson); }
    catch { toast.error("Invalid JSON"); return; }

    const pattern = patterns[editingId];
    if (!pattern) return;

    const { error } = await supabase
      .from("invoice_patterns")
      .update({
        column_map: (parsed.column_map as Record<string, string>) || {},
        size_system: (parsed.size_system as string) ?? pattern.size_system,
        price_column_cost: (parsed.price_column_cost as string) ?? null,
        price_column_rrp: (parsed.price_column_rrp as string) ?? null,
        gst_included_in_cost: (parsed.gst_included_in_cost as boolean) ?? false,
        gst_included_in_rrp: (parsed.gst_included_in_rrp as boolean) ?? true,
        default_markup_multiplier: (parsed.default_markup_multiplier as number) ?? 2.2,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pattern.id);

    if (error) { toast.error("Save failed"); return; }
    toast.success("Rules updated");
    setEditingId(null);
    loadAll();
  };

  const learningTimeline = useMemo(() => {
    // Build a unified timeline from corrections + pattern updates
    const events: Array<{
      date: string;
      supplier: string;
      supplierId: string | null;
      kind: "processed" | "correction";
      formatType?: string | null;
      confidence?: number;
      isKnown?: boolean;
      correctionField?: string | null;
    }> = [];

    for (const p of profiles) {
      const pattern = patterns[p.id];
      events.push({
        date: p.updated_at,
        supplier: p.supplier_name,
        supplierId: p.id,
        kind: "processed",
        formatType: pattern?.format_type,
        confidence: p.confidence_score,
        isKnown: (p.invoice_count || 0) > 1,
      });
    }
    for (const c of corrections) {
      const prof = profiles.find((p) => p.id === c.supplier_profile_id);
      events.push({
        date: c.created_at,
        supplier: prof?.supplier_name || "Unknown supplier",
        supplierId: c.supplier_profile_id,
        kind: "correction",
        correctionField: c.field_corrected,
      });
    }
    return events.sort((a, b) => +new Date(b.date) - +new Date(a.date)).slice(0, 100);
  }, [profiles, patterns, corrections]);

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-4 max-w-6xl mx-auto">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-semibold">Supplier Intelligence</h1>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              What the app has learned about your suppliers
            </p>
          </div>
          {onOpenInvoiceFlow && (
            <Button size="sm" onClick={onOpenInvoiceFlow}>
              <Upload className="w-4 h-4 mr-1.5" />
              Train with invoice
            </Button>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search suppliers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Tabs defaultValue="known">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="known"><BookOpen className="w-4 h-4 mr-1.5" />Known suppliers</TabsTrigger>
            <TabsTrigger value="log"><History className="w-4 h-4 mr-1.5" />Learning log</TabsTrigger>
            <TabsTrigger value="rules"><Sparkles className="w-4 h-4 mr-1.5" />Common sense</TabsTrigger>
          </TabsList>

          {/* TAB 1 — Known suppliers */}
          <TabsContent value="known" className="space-y-3 mt-4">
            {/* Quality report — aggregate across all suppliers */}
            {!loading && qualityReport.scoredInvoices > 0 && (
              <Card className="p-5 bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
                <div className="flex items-start gap-3 mb-4">
                  <Trophy className="w-5 h-5 text-primary mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold">Quality report</p>
                    <p className="text-xs text-muted-foreground">
                      Aggregate extraction performance across every supplier you've processed.
                    </p>
                  </div>
                </div>

                {/* Hero ROI number */}
                <div className="bg-background/50 rounded-lg p-4 mb-4 text-center">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                    Estimated time saved vs manual entry
                  </p>
                  <p className="text-4xl font-bold text-emerald-400">
                    {qualityReport.hoursSaved} <span className="text-2xl font-medium">hours</span>
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <ReportStat label="Invoices processed" value={qualityReport.totalInvoices.toString()} />
                  <ReportStat
                    label="Avg quality score"
                    value={qualityReport.avgQuality != null ? `${qualityReport.avgQuality}/100` : "—"}
                  />
                  <ReportStat
                    label="Most reliable"
                    value={qualityReport.mostReliable
                      ? `${qualityReport.mostReliable.name} (${Math.round(qualityReport.mostReliable.score)})`
                      : "—"}
                  />
                  <ReportStat
                    label="Most improved"
                    value={qualityReport.mostImproved && qualityReport.mostImproved.delta > 0
                      ? `${qualityReport.mostImproved.name} (+${Math.round(qualityReport.mostImproved.delta)})`
                      : "—"}
                  />
                  <ReportStat
                    label="Weakest format"
                    value={qualityReport.weakest
                      ? `${qualityReport.weakest.name} (${Math.round(qualityReport.weakest.score)})`
                      : "—"}
                  />
                </div>
              </Card>
            )}

            {loading && <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>}
            {!loading && filtered.length === 0 && (
              <Card className="p-8 text-center">
                <Brain className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <p className="font-medium mb-1">No suppliers learned yet</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Process an invoice and the app will start learning the supplier's format automatically.
                </p>
                {onOpenInvoiceFlow && (
                  <Button onClick={onOpenInvoiceFlow}><Upload className="w-4 h-4 mr-1.5" />Upload an invoice</Button>
                )}
              </Card>
            )}

            {filtered.map((p) => {
              const pattern = patterns[p.id];
              const colour = confidenceColour(p.confidence_score || 0);
              const correctionCount = correctionsByProfile[p.id] || 0;
              const expanded = expandedId === p.id;
              const editing = editingId === p.id;

              return (
                <Card key={p.id} className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold truncate">{p.supplier_name}</h3>
                        {p.is_known_brand && <Badge variant="secondary" className="text-xs">Known brand</Badge>}
                        {p.currency && p.currency !== "AUD" && (
                          <Badge variant="outline" className="text-xs">{p.currency}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {p.invoice_count || 0} {p.invoice_count === 1 ? "invoice" : "invoices"} processed
                        {" · "}Last seen {format(new Date(p.updated_at), "d MMM yyyy")}
                        {correctionCount > 0 && ` · ${correctionCount} correction${correctionCount > 1 ? "s" : ""}`}
                      </p>

                      {/* Confidence bar */}
                      <div className="mt-3 flex items-center gap-3">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${colour.bar} transition-all`}
                            style={{ width: `${Math.max(4, p.confidence_score || 0)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium ${colour.text} w-20 text-right`}>
                          {p.confidence_score || 0}% · {colour.label}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setExpandedId(expanded ? null : p.id)}>
                        <Eye className="w-4 h-4 mr-1.5" />{expanded ? "Hide" : "View"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => startEdit(p.id)}>
                        <Edit3 className="w-4 h-4 mr-1.5" />Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(p.id, p.supplier_name)}>
                        <Trash2 className="w-4 h-4 mr-1.5 text-destructive" />Delete
                      </Button>
                    </div>
                  </div>

                  {/* Expanded rules view */}
                  {expanded && !editing && (
                    <div className="mt-4 pt-4 border-t border-border space-y-3 text-sm">
                      {!pattern && <p className="text-muted-foreground italic">No pattern saved yet for this supplier.</p>}
                      {pattern && (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <RuleField label="Format type" value={pattern.format_type} />
                            <RuleField label="Size system" value={pattern.size_system} />
                            <RuleField label="Cost column" value={pattern.price_column_cost} />
                            <RuleField label="RRP column" value={pattern.price_column_rrp} />
                            <RuleField label="GST on cost" value={pattern.gst_included_in_cost ? "Inclusive" : "Exclusive"} />
                            <RuleField label="GST on RRP" value={pattern.gst_included_in_rrp ? "Inclusive" : "Exclusive"} />
                            <RuleField label="Default markup" value={pattern.default_markup_multiplier ? `${pattern.default_markup_multiplier}×` : null} />
                            <RuleField label="Pack notation" value={pattern.pack_notation_detected ? "Yes" : "No"} />
                          </div>

                          {pattern.column_map && Object.keys(pattern.column_map).length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1.5">Column map</p>
                              <div className="bg-muted rounded-md p-2.5 space-y-1">
                                {Object.entries(pattern.column_map).map(([header, role]) => (
                                  <div key={header} className="flex items-center justify-between text-xs">
                                    <span className="font-mono">{header}</span>
                                    <span className="text-muted-foreground">→ {String(role)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {p.supplier_name_variants && p.supplier_name_variants.length > 1 && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1.5">Also seen as</p>
                              <div className="flex flex-wrap gap-1.5">
                                {p.supplier_name_variants.map((v) => (
                                  <Badge key={v} variant="outline" className="text-xs">{v}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Edit mode */}
                  {editing && (
                    <div className="mt-4 pt-4 border-t border-border space-y-3">
                      <p className="text-xs text-muted-foreground">
                        Edit the saved rules as JSON. Be careful — mistakes here affect every future invoice from this supplier.
                      </p>
                      <Textarea
                        value={editJson}
                        onChange={(e) => setEditJson(e.target.value)}
                        className="font-mono text-xs min-h-[200px]"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveEdit}><Check className="w-4 h-4 mr-1.5" />Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          <X className="w-4 h-4 mr-1.5" />Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </TabsContent>

          {/* TAB 2 — Learning log */}
          <TabsContent value="log" className="space-y-2 mt-4">
            {learningTimeline.length === 0 && (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                No activity yet. Process an invoice to populate the learning log.
              </Card>
            )}
            {learningTimeline
              .filter((e) => !search.trim() || e.supplier.toLowerCase().includes(search.toLowerCase()))
              .map((e, i) => (
                <Card key={i} className="p-3 flex items-start gap-3">
                  <div className="mt-0.5">
                    {e.kind === "processed" ? (
                      e.isKnown ? (
                        <Badge className="bg-teal-500/15 text-teal-400 border-teal-500/30 hover:bg-teal-500/15">Known</Badge>
                      ) : (
                        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15">New</Badge>
                      )
                    ) : (
                      <Badge variant="outline" className="border-red-500/30 text-red-400">
                        <AlertCircle className="w-3 h-3 mr-1" />Correction
                      </Badge>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{e.supplier}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(e.date), "d MMM yyyy · HH:mm")}
                      {e.kind === "processed" && e.formatType && ` · format ${e.formatType}`}
                      {e.kind === "processed" && typeof e.confidence === "number" && ` · ${e.confidence}% confidence`}
                      {e.kind === "correction" && e.correctionField && ` · field "${e.correctionField}" corrected`}
                    </p>
                  </div>
                </Card>
              ))}
          </TabsContent>

          {/* TAB 3 — Common sense rules */}
          <TabsContent value="rules" className="mt-4">
            <Card className="p-4 mb-3 bg-primary/5 border-primary/20">
              <div className="flex gap-3">
                <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">What the app knows by default</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    These are the universal rules applied to every new supplier <strong>before</strong> any learning happens.
                    They're tuned for Australian retail. Once you process invoices, learned rules take priority.
                  </p>
                </div>
              </div>
            </Card>

            <div className="space-y-2">
              {COMMON_SENSE_RULES.map((rule) => (
                <Card key={rule.field} className="p-3 flex items-start gap-3">
                  <div className="w-40 shrink-0">
                    <p className="text-sm font-medium">{rule.field}</p>
                  </div>
                  <p className="text-sm text-muted-foreground flex-1">{rule.logic}</p>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

const RuleField = ({ label, value }: { label: string; value: string | number | null | undefined }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm font-medium mt-0.5">{value ?? <span className="text-muted-foreground italic">—</span>}</p>
  </div>
);

export default SupplierIntelligencePanel;
