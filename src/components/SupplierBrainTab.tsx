// ──────────────────────────────────────────────────────────────
// Brain tab — lives inside SupplierIntelligencePanel.
// Pattern-aware view: pattern badge (A–H), confidence colour,
// shared-template indicator, View / Reset template, totals strip.
//
// Drive import flow: paste link → list files → tick the ones
// you want → seed each in parallel with live per-file progress.
// ──────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { Brain, Eye, RotateCcw, Users, CheckCircle2, CloudDownload, Loader2, FileText, AlertCircle, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  PATTERN_LABEL,
  type InvoicePattern,
  getContributeShared,
  setContributeShared,
} from "@/lib/universal-classifier";
import SupplierWebsiteRRPPanel from "@/components/SupplierWebsiteRRPPanel";

interface SupplierRow {
  id: string;
  supplier_name: string;
  detected_pattern: string | null;
  confidence_score: number;
  invoice_count: number;
  last_correction_rate: number | null;
  is_shared_origin: boolean;
  column_map: Record<string, string> | null;
  last_invoice_date: string | null;
}

interface SharedRow {
  supplier_name: string;
  contributing_users: number;
  total_invoices_processed: number;
  is_verified: boolean;
}

function confidenceTone(score: number) {
  if (score >= 90) return { label: "Fully trained", cls: "bg-success/15 text-success border-success/30" };
  if (score >= 70) return { label: "Well trained",  cls: "bg-primary/15 text-primary border-primary/30" };
  if (score >= 50) return { label: "Learning",      cls: "bg-warning/15 text-warning border-warning/30" };
  return                { label: "Needs review",    cls: "bg-destructive/15 text-destructive border-destructive/30" };
}

export default function SupplierBrainTab() {
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [shared, setShared] = useState<SharedRow[]>([]);
  const [contribute, setContribute] = useState(true);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<SupplierRow | null>(null);
  const [driveUrl, setDriveUrl] = useState("");

  // Drive picker state machine: idle → picking → seeding → done
  type FileStatus = "queued" | "running" | "done" | "skipped" | "error";
  interface DriveFileItem {
    id: string;
    name: string;
    selected: boolean;
    status: FileStatus;
    message?: string;
    supplier?: string;
  }
  const [driveStage, setDriveStage] = useState<"idle" | "picking" | "seeding" | "done">("idle");
  const [listing, setListing] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);

  const listDriveFiles = async () => {
    if (!driveUrl.trim()) {
      toast.error("Paste a Google Drive folder link first");
      return;
    }
    setListing(true);
    try {
      const { data, error } = await supabase.functions.invoke("drive-list", {
        body: { url: driveUrl.trim() },
      });
      if (error) throw error;
      const files = (data?.files || []) as Array<{ id: string; name: string; mimeType: string }>;
      if (files.length === 0) {
        toast.error("No files found", {
          description: "Make sure the folder is shared as 'Anyone with the link'.",
        });
        return;
      }
      setDriveFiles(files.map((f) => ({
        id: f.id,
        name: f.name,
        selected: true, // default: all selected
        status: "queued" as FileStatus,
      })));
      setDriveStage("picking");
    } catch (e) {
      toast.error("Could not list folder", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setListing(false);
    }
  };

  const toggleAll = (on: boolean) => {
    setDriveFiles((prev) => prev.map((f) => ({ ...f, selected: on })));
  };

  const seedSelected = async () => {
    const targets = driveFiles.filter((f) => f.selected);
    if (targets.length === 0) {
      toast.error("Tick at least one file first");
      return;
    }
    setDriveStage("seeding");
    setDriveFiles((prev) => prev.map((f) => f.selected ? { ...f, status: "queued" } : f));

    // Parallel with small concurrency cap so we don't hammer the AI gateway.
    const CONCURRENCY = 3;
    const queue = [...targets];
    let active = 0;

    await new Promise<void>((resolve) => {
      const next = () => {
        if (queue.length === 0 && active === 0) return resolve();
        while (active < CONCURRENCY && queue.length > 0) {
          const file = queue.shift()!;
          active += 1;
          setDriveFiles((prev) => prev.map((f) =>
            f.id === file.id ? { ...f, status: "running" } : f,
          ));
          supabase.functions
            .invoke("drive-seed-one", { body: { fileId: file.id, fileName: file.name } })
            .then(({ data, error }) => {
              const ok = !error && data?.ok;
              setDriveFiles((prev) => prev.map((f) => {
                if (f.id !== file.id) return f;
                if (ok) {
                  return {
                    ...f,
                    status: "done",
                    supplier: data.supplier_name,
                    message: `Pattern ${data.detected_pattern || "?"} · ${data.confidence}%`,
                  };
                }
                const msg = error?.message || data?.error || "Failed";
                return {
                  ...f,
                  status: msg.toLowerCase().includes("low-confidence") ? "skipped" : "error",
                  message: msg,
                };
              }));
            })
            .catch((err) => {
              setDriveFiles((prev) => prev.map((f) =>
                f.id === file.id
                  ? { ...f, status: "error", message: err instanceof Error ? err.message : "Failed" }
                  : f,
              ));
            })
            .finally(() => {
              active -= 1;
              next();
            });
        }
      };
      next();
    });

    setDriveStage("done");
    void load();
  };

  const resetDrive = () => {
    setDriveStage("idle");
    setDriveFiles([]);
  };

  const load = async () => {
    setLoading(true);
    const [{ data: si }, { data: sh }, contribFlag] = await Promise.all([
      supabase.from("supplier_intelligence")
        .select("id, supplier_name, detected_pattern, confidence_score, invoice_count, last_correction_rate, is_shared_origin, column_map, last_invoice_date")
        .order("invoice_count", { ascending: false }),
      supabase.from("shared_supplier_profiles")
        .select("supplier_name, contributing_users, total_invoices_processed, is_verified"),
      getContributeShared(),
    ]);
    setRows((si || []) as SupplierRow[]);
    setShared((sh || []) as SharedRow[]);
    setContribute(contribFlag);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const totals = useMemo(() => {
    // Dedupe by lower(supplier_name) so casing variants (e.g. "Rhythm" +
    // "RHYTHM") aren't double-counted in the "Suppliers learned" tile.
    const uniqueKeys = new Set(rows.map(r => (r.supplier_name || "").trim().toLowerCase()).filter(Boolean));
    const uniqueCount = uniqueKeys.size;
    const avg = rows.length
      ? Math.round(rows.reduce((s, r) => s + (r.confidence_score || 0), 0) / rows.length)
      : 0;
    const contributions = rows.filter(r => !r.is_shared_origin).length;
    return { suppliers: uniqueCount, avg, sharedAvailable: shared.length, contributions };
  }, [rows, shared]);

  const resetTemplate = async (row: SupplierRow) => {
    if (!confirm(`Reset learned template for "${row.supplier_name}"? The next invoice will be re-learned from scratch.`)) return;
    const { error } = await supabase
      .from("supplier_intelligence")
      .update({
        column_map: {} as never,
        detected_pattern: null,
        confidence_score: 20,
        last_correction_rate: null,
      } as never)
      .eq("id", row.id);
    if (error) {
      toast.error("Reset failed", { description: error.message });
      return;
    }
    toast.success(`Template reset for ${row.supplier_name}`);
    void load();
  };

  const toggleContribute = async (on: boolean) => {
    setContribute(on);
    await setContributeShared(on);
    toast.success(on
      ? "Contributing structural templates to the shared community pool"
      : "Stopped contributing — your data stays local");
  };

  if (loading) {
    return <div className="text-xs text-muted-foreground py-8 text-center">Loading supplier brain…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Totals strip */}
      <div className="grid grid-cols-4 gap-2">
        <Card className="p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wide">Suppliers learned</p><p className="text-xl font-semibold">{totals.suppliers}</p></Card>
        <Card className="p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg confidence</p><p className="text-xl font-semibold">{totals.avg}%</p></Card>
        <Card className="p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wide">Shared templates</p><p className="text-xl font-semibold">{totals.sharedAvailable}</p></Card>
        <Card className="p-3"><p className="text-[10px] text-muted-foreground uppercase tracking-wide">Your contributions</p><p className="text-xl font-semibold">{totals.contributions}</p></Card>
      </div>

      {/* Contribute toggle */}
      <Card className="p-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Users className="w-5 h-5 text-primary mt-0.5" />
          <div>
            <p className="text-sm font-semibold">Contribute to shared templates</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Share <strong>only the column structure</strong> (which header maps to which field) when
              you accept an extraction. Never your prices, quantities, or product data. Helps the
              app recognise the same supplier instantly for other retailers.
            </p>
          </div>
        </div>
        <Switch checked={contribute} onCheckedChange={toggleContribute} />
      </Card>

      {/* Website RRP source manager */}
      <SupplierWebsiteRRPPanel />

      {/* Import from Google Drive — paste link → pick files → seed with live progress */}
      <Card className="p-4">
        <div className="flex items-start gap-2.5 mb-3">
          <CloudDownload className="w-5 h-5 text-primary mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold">Import invoices from Google Drive</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Paste a public folder link, choose which sample invoices to learn from, then watch each one
              get classified live. Adds the <strong>structural template only</strong> (column map + pattern) to your
              personal brain <em>and</em> the shared pool. Prices and quantities are never stored.
            </p>
          </div>
        </div>

        {/* Step 1 — paste link */}
        {driveStage === "idle" && (
          <div className="flex gap-2">
            <Input
              value={driveUrl}
              onChange={(e) => setDriveUrl(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/..."
              className="text-xs"
              disabled={listing}
              onKeyDown={(e) => { if (e.key === "Enter") void listDriveFiles(); }}
            />
            <Button onClick={listDriveFiles} disabled={listing} size="sm">
              {listing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Listing…</> : "List files"}
            </Button>
          </div>
        )}

        {/* Step 2 — pick which to import */}
        {(driveStage === "picking" || driveStage === "seeding" || driveStage === "done") && (
          <div className="space-y-3">
            {driveStage === "seeding" || driveStage === "done" ? (
              <SeedProgressHeader files={driveFiles} stage={driveStage} onReset={resetDrive} />
            ) : (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">
                  {driveFiles.length} file{driveFiles.length === 1 ? "" : "s"} found ·{" "}
                  <strong>{driveFiles.filter((f) => f.selected).length} selected</strong>
                </span>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => toggleAll(true)}>Select all</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleAll(false)}>None</Button>
                  <Button size="sm" variant="ghost" onClick={resetDrive}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}

            <div className="max-h-72 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {driveFiles.map((f) => (
                <div key={f.id} className="flex items-center gap-2 px-2.5 py-2 text-xs">
                  {driveStage === "picking" ? (
                    <Checkbox
                      checked={f.selected}
                      onCheckedChange={(v) => setDriveFiles((prev) => prev.map((p) =>
                        p.id === f.id ? { ...p, selected: !!v } : p,
                      ))}
                    />
                  ) : (
                    <StatusIcon status={f.status} />
                  )}
                  <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{f.name}</p>
                    {f.message && (
                      <p className={`truncate text-[10px] ${
                        f.status === "error" ? "text-destructive" :
                        f.status === "skipped" ? "text-warning" :
                        f.status === "done" ? "text-success" : "text-muted-foreground"
                      }`}>
                        {f.supplier ? <strong>{f.supplier}</strong> : null}
                        {f.supplier && f.message ? " · " : null}
                        {f.message}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {driveStage === "picking" && (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={resetDrive}>Cancel</Button>
                <Button size="sm" onClick={seedSelected}
                  disabled={driveFiles.filter((f) => f.selected).length === 0}>
                  Import {driveFiles.filter((f) => f.selected).length} invoice
                  {driveFiles.filter((f) => f.selected).length === 1 ? "" : "s"}
                </Button>
              </div>
            )}

            {driveStage === "done" && (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={resetDrive}>Import another folder</Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Supplier rows */}
      {rows.length === 0 ? (
        <div className="text-center py-12 text-xs text-muted-foreground">
          <Brain className="w-8 h-8 mx-auto mb-2 opacity-40" />
          No suppliers learned yet. Process an invoice to start training the brain.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(r => {
            const tone = confidenceTone(r.confidence_score);
            const pattern = r.detected_pattern as InvoicePattern | null;
            return (
              <Card key={r.id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold truncate">{r.supplier_name}</p>
                      {pattern && (
                        <Badge variant="outline" className="text-[10px]">
                          Pattern {pattern} · {PATTERN_LABEL[pattern] || "Unknown"}
                        </Badge>
                      )}
                      {r.is_shared_origin && (
                        <Badge variant="outline" className="text-[10px] gap-1 border-primary/30 text-primary">
                          <Users className="w-3 h-3" /> Shared
                        </Badge>
                      )}
                      {r.confidence_score >= 95 && (
                        <Badge variant="outline" className="text-[10px] gap-1 border-success/30 text-success">
                          <CheckCircle2 className="w-3 h-3" /> 95%+ accurate
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                      <span className={`px-1.5 py-0.5 rounded border ${tone.cls}`}>{r.confidence_score}% · {tone.label}</span>
                      <span>{r.invoice_count} invoice{r.invoice_count === 1 ? "" : "s"}</span>
                      {r.last_correction_rate != null && (
                        <span>{Math.round(r.last_correction_rate * 100)}% correction rate</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => setViewing(r)}>
                      <Eye className="w-3.5 h-3.5 mr-1" /> Template
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => resetTemplate(r)}>
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {viewing?.id === r.id && (
                  <div className="mt-3 rounded-md bg-muted/30 p-3 text-[11px] space-y-1">
                    <p className="text-muted-foreground">Column map:</p>
                    {Object.keys(r.column_map || {}).length === 0 ? (
                      <p className="italic">Not learned yet.</p>
                    ) : (
                      <ul className="font-mono space-y-0.5">
                        {Object.entries(r.column_map || {}).map(([k, v]) => (
                          <li key={k}><span className="text-muted-foreground">{k}</span> → <strong>{v}</strong></li>
                        ))}
                      </ul>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setViewing(null)} className="mt-2">Close</Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sub-components for the Drive picker ──────────────────────

function StatusIcon({ status }: { status: "queued" | "running" | "done" | "skipped" | "error" }) {
  switch (status) {
    case "running":
      return <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />;
    case "done":
      return <Check className="w-3.5 h-3.5 text-success shrink-0" />;
    case "skipped":
      return <AlertCircle className="w-3.5 h-3.5 text-warning shrink-0" />;
    case "error":
      return <X className="w-3.5 h-3.5 text-destructive shrink-0" />;
    case "queued":
    default:
      return <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/40 shrink-0" />;
  }
}

function SeedProgressHeader({
  files,
  stage,
  onReset,
}: {
  files: Array<{ status: "queued" | "running" | "done" | "skipped" | "error"; selected: boolean }>;
  stage: "seeding" | "done";
  onReset: () => void;
}) {
  const targets = files.filter((f) => f.selected);
  const done = targets.filter((f) => f.status === "done").length;
  const skipped = targets.filter((f) => f.status === "skipped").length;
  const errored = targets.filter((f) => f.status === "error").length;
  const running = targets.filter((f) => f.status === "running").length;
  const finished = done + skipped + errored;
  const pct = targets.length === 0 ? 0 : Math.round((finished / targets.length) * 100);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          {stage === "seeding" ? (
            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
          )}
          <span className="font-medium">
            {stage === "seeding"
              ? `Importing ${finished} / ${targets.length}…`
              : `Done — ${done} learned${skipped ? `, ${skipped} skipped` : ""}${errored ? `, ${errored} failed` : ""}`}
          </span>
        </div>
        {stage === "done" && (
          <Button size="sm" variant="ghost" onClick={onReset}>
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <Progress value={pct} className="h-1.5" />
      {running > 0 && stage === "seeding" && (
        <p className="text-[10px] text-muted-foreground">Processing {running} in parallel…</p>
      )}
    </div>
  );
}
