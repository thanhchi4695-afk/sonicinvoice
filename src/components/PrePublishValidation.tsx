// Mandatory pre-publish validation gate. Sits between Review and Publish.
// Cannot be skipped: Publish CTA is disabled while any FAIL exists.
// On entry, runs validation; on continue, persists a `validation_runs` row.

import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, AlertTriangle, XCircle, CheckCircle2, Download,
  ChevronRight, Loader2, Edit3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import Papa from "papaparse";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ExportProduct } from "@/components/ExportReviewScreen";
import {
  validateForPublish, type ValidationReport, type CheckResult, type CatalogProduct,
} from "@/lib/prepublish-validation";

interface Props {
  products: ExportProduct[];
  invoiceId?: string;
  catalog?: CatalogProduct[];
  refillKeys?: Set<string>;
  onEditProduct?: (productKey: string) => void;
  onProceedToPublish: (publishedWithWarnings: boolean) => void;
  onBack?: () => void;
}

const SectionHeader = ({ icon, title, pass, warn, fail }: {
  icon: React.ReactNode; title: string; pass: number; warn: number; fail: number;
}) => (
  <div className="flex items-center justify-between mb-2">
    <div className="flex items-center gap-2">
      {icon}
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
    <div className="flex items-center gap-1.5 text-[10px]">
      {pass > 0 && <Badge variant="outline" className="border-success/40 text-success">{pass} pass</Badge>}
      {warn > 0 && <Badge variant="outline" className="border-warning/40 text-warning">{warn} warn</Badge>}
      {fail > 0 && <Badge variant="outline" className="border-destructive/40 text-destructive">{fail} fail</Badge>}
    </div>
  </div>
);

const sevIcon = (s: CheckResult["severity"]) => {
  if (s === "fail") return <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />;
  if (s === "warn") return <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />;
  return <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />;
};

const ResultList = ({ items, onEdit }: { items: CheckResult[]; onEdit?: (k: string) => void }) => (
  <ul className="space-y-1">
    {items.length === 0 ? (
      <li className="text-[11px] text-muted-foreground italic">All clear.</li>
    ) : items.map((r) => (
      <li
        key={r.id}
        id={`vrow-${r.severity}-${r.id}`}
        className="flex items-start justify-between gap-2 text-[11px] py-1.5 px-2 rounded border border-border bg-muted/20"
      >
        <div className="flex items-start gap-2 min-w-0">
          {sevIcon(r.severity)}
          <div className="min-w-0">
            {r.productLabel && <p className="font-medium truncate">{r.productLabel}</p>}
            <p className="text-muted-foreground">{r.message}</p>
          </div>
        </div>
        {onEdit && r.productKey && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => onEdit(r.productKey!)}>
            <Edit3 className="w-3 h-3 mr-1" /> Edit
          </Button>
        )}
      </li>
    ))}
  </ul>
);

export default function PrePublishValidation({
  products, invoiceId, catalog, refillKeys, onEditProduct, onProceedToPublish, onBack,
}: Props) {
  const [running, setRunning] = useState(true);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [confirmWarnings, setConfirmWarnings] = useState(false);
  const [persisting, setPersisting] = useState(false);

  useEffect(() => {
    setRunning(true);
    // Defer to next tick so the spinner paints once.
    const t = setTimeout(() => {
      setReport(validateForPublish({ products, catalog, refillKeys }));
      setRunning(false);
    }, 50);
    return () => clearTimeout(t);
  }, [products, catalog, refillKeys]);

  const totals = report?.totals || { pass: 0, warn: 0, fail: 0 };
  const blocked = totals.fail > 0;

  const allFails = useMemo(() => {
    if (!report) return [];
    return [
      ...report.price.results, ...report.variant.results,
      ...report.sku.results, ...report.catalog.results,
    ].filter((r) => r.severity === "fail");
  }, [report]);

  const scrollToFirstFail = () => {
    if (allFails[0]) {
      document.getElementById(`vrow-fail-${allFails[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const exportCSV = () => {
    if (!report) return;
    const rows = products.map((p) => ({
      brand: p.brand, name: p.name, sku: p.sku || "",
      barcode: p.barcode || "", colour: p.colour || "", size: p.size || "",
      price: p.price, rrp: p.rrp,
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `validation-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const persistRun = async (publishedWithWarnings: boolean) => {
    if (!report) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("validation_runs").insert({
      user_id: user.id,
      invoice_id: invoiceId ?? null,
      total_lines: report.totalLines,
      price_issues: report.price.warn + report.price.fail,
      variant_issues: report.variant.warn + report.variant.fail,
      sku_issues: report.sku.warn + report.sku.fail,
      catalog_issues: report.catalog.warn + report.catalog.fail,
      published_with_warnings: publishedWithWarnings,
    } as never);
  };

  const handlePublish = async (withWarnings: boolean) => {
    if (blocked) return;
    setPersisting(true);
    try {
      await persistRun(withWarnings);
      toast.success("Validation logged");
      onProceedToPublish(withWarnings);
    } catch (e) {
      toast.error("Failed to log validation", { description: e instanceof Error ? e.message : "Unknown" });
    } finally {
      setPersisting(false);
    }
  };

  if (running || !report) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 flex items-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <span className="text-sm">Running pre-publish validation…</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold">
            Review before publishing — {report.totalProducts} item{report.totalProducts === 1 ? "" : "s"}, {report.totalVariants} variant{report.totalVariants === 1 ? "" : "s"}
          </h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Fix any issues flagged below before pushing to Shopify.
        </p>
        <div className="flex items-center gap-2 mt-2">
          {totals.fail > 0 && <Badge variant="outline" className="border-destructive/50 text-destructive">{totals.fail} blocking</Badge>}
          {totals.warn > 0 && <Badge variant="outline" className="border-warning/50 text-warning">{totals.warn} warnings</Badge>}
          {totals.fail === 0 && totals.warn === 0 && <Badge variant="outline" className="border-success/50 text-success">All checks passed</Badge>}
        </div>
      </div>

      {/* Section 1 — Price */}
      <section>
        <SectionHeader
          icon={<span className="text-base">💲</span>}
          title="Price validation"
          pass={report.price.pass} warn={report.price.warn} fail={report.price.fail}
        />
        <p className="text-[10px] text-muted-foreground mb-2">
          {report.price.pass} prices look correct, {report.price.warn + report.price.fail} need review
        </p>
        <ResultList items={report.price.results} onEdit={onEditProduct} />
      </section>

      {/* Section 2 — Variants */}
      <section>
        <SectionHeader
          icon={<span className="text-base">🎨</span>}
          title="Variant completeness"
          pass={report.variant.pass} warn={report.variant.warn} fail={report.variant.fail}
        />
        <ResultList items={report.variant.results} onEdit={onEditProduct} />
      </section>

      {/* Section 3 — SKU/Barcode */}
      <section>
        <SectionHeader
          icon={<span className="text-base">🏷️</span>}
          title="SKU & barcode"
          pass={report.sku.pass} warn={report.sku.warn} fail={report.sku.fail}
        />
        <ResultList items={report.sku.results} onEdit={onEditProduct} />
      </section>

      {/* Section 4 — Catalog */}
      <section>
        <SectionHeader
          icon={<span className="text-base">🛍️</span>}
          title="Shopify catalog cross-check"
          pass={report.catalog.pass} warn={report.catalog.warn} fail={report.catalog.fail}
        />
        <p className="text-[10px] text-muted-foreground mb-2">
          {report.catalog.newProducts} new · {report.catalog.refillsMatched} refills matched · {report.catalog.needReview} need review
        </p>
        <ResultList items={report.catalog.results} onEdit={onEditProduct} />
      </section>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border">
        <div className="flex items-center gap-2">
          {onBack && (
            <Button size="sm" variant="ghost" onClick={onBack}>Back to review</Button>
          )}
          <Button size="sm" variant="outline" onClick={scrollToFirstFail} disabled={allFails.length === 0}>
            Fix all issues
          </Button>
          <Button size="sm" variant="outline" onClick={exportCSV}>
            <Download className="w-3.5 h-3.5 mr-1" /> Export to CSV for review
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {totals.warn > 0 && totals.fail === 0 && (
            <Button size="sm" variant="outline" onClick={() => setConfirmWarnings(true)} disabled={persisting}>
              Publish anyway ({totals.warn} warning{totals.warn === 1 ? "" : "s"})
            </Button>
          )}
          <Button
            size="sm"
            variant="teal"
            onClick={() => handlePublish(false)}
            disabled={blocked || totals.warn > 0 || persisting}
            title={blocked ? "Resolve all failures before publishing" : ""}
          >
            {persisting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
            Publish <ChevronRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmWarnings} onOpenChange={setConfirmWarnings}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish with warnings?</AlertDialogTitle>
            <AlertDialogDescription>
              You have {totals.warn} unresolved warning{totals.warn === 1 ? "" : "s"}. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmWarnings(false); void handlePublish(true); }}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
