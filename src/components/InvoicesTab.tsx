import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Plus, Search, FileText, Loader2, ChevronRight, Trash2, X } from "lucide-react";
import { getUnprocessedInboxCount } from "@/components/EmailInboxPanel";
import { formatRelativeTime, addAuditEntry } from "@/lib/audit-log";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface InvoicesTabProps {
  onStartInvoice: () => void;
  onStartStockCheck: () => void;
  onStartPackingSlip: () => void;
  onStartScanMode: () => void;
  onStartEmailInbox: () => void;
  onStartJoor: () => void;
  onStartWholesaleImport: () => void;
  onStartLookbookImport: () => void;
  onStartPurchaseOrders: () => void;
  onStartOrderForm: () => void;
  onStartAccounting: () => void;
  onStartRestock: () => void;
  onStartReorder: () => void;
  onStartSuppliers: () => void;
  onStartCatalogMemory: () => void;
  /** Open Processing History — used as the row-click target until per-invoice detail screens exist. */
  onOpenHistory?: (patternId?: string) => void;
}

interface InvoiceRow {
  id: string;
  created_at: string;
  original_filename: string | null;
  supplier_profile_id: string | null;
  supplier_name: string | null;
  review_status: string | null;
  variants_extracted: number | null;
  edit_count: number | null;
  processing_duration_seconds: number | null;
  match_method: string | null;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  reviewed: { label: "Done", cls: "bg-success/15 text-success border-success/20" },
  needs_review: { label: "Needs review", cls: "bg-warning/15 text-warning border-warning/20" },
  draft: { label: "Draft", cls: "bg-muted text-muted-foreground border-border" },
  failed: { label: "Failed", cls: "bg-destructive/15 text-destructive border-destructive/20" },
};

const InvoicesTab = (props: InvoicesTabProps) => {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const unread = getUnprocessedInboxCount();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setRows([]); setLoading(false); return; }

      const { data: patterns } = await supabase
        .from("invoice_patterns")
        .select("id, created_at, original_filename, supplier_profile_id, review_status, variants_extracted, edit_count, processing_duration_seconds, match_method")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);

      const supplierIds = Array.from(new Set((patterns ?? []).map(p => p.supplier_profile_id).filter(Boolean) as string[]));
      let nameMap: Record<string, string> = {};
      if (supplierIds.length) {
        const { data: profiles } = await supabase
          .from("supplier_profiles")
          .select("id, supplier_name")
          .in("id", supplierIds);
        nameMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.supplier_name]));
      }

      if (cancelled) return;
      setRows((patterns ?? []).map(p => ({
        ...p,
        supplier_name: p.supplier_profile_id ? (nameMap[p.supplier_profile_id] ?? null) : null,
      })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const vendors = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => { if (r.supplier_name) set.add(r.supplier_name); });
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (vendorFilter !== "all" && r.supplier_name !== vendorFilter) return false;
      if (statusFilter !== "all" && (r.review_status ?? "draft") !== statusFilter) return false;
      if (!q) return true;
      return (r.original_filename ?? "").toLowerCase().includes(q) || (r.supplier_name ?? "").toLowerCase().includes(q);
    });
  }, [rows, search, vendorFilter, statusFilter]);

  // Selection helpers — only IDs that exist in the currently filtered view count.
  const filteredIds = useMemo(() => filtered.map(r => r.id), [filtered]);
  const selectedInView = useMemo(() => filteredIds.filter(id => selected.has(id)), [filteredIds, selected]);
  const allInViewSelected = filteredIds.length > 0 && selectedInView.length === filteredIds.length;
  const someInViewSelected = selectedInView.length > 0 && !allInViewSelected;

  const toggleRow = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllInView = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allInViewSelected) {
        filteredIds.forEach(id => next.delete(id));
      } else {
        filteredIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setDeleting(true);
    const { error } = await supabase.from("invoice_patterns").delete().in("id", ids);
    setDeleting(false);
    setConfirmOpen(false);
    if (error) {
      toast.error(`Couldn't delete: ${error.message}`);
      return;
    }
    setRows(prev => prev.filter(r => !selected.has(r.id)));
    addAuditEntry("Invoices", `Deleted ${ids.length} invoice${ids.length === 1 ? "" : "s"} via bulk action`);
    toast.success(`Deleted ${ids.length} invoice${ids.length === 1 ? "" : "s"}`);
    clearSelection();
  };

  const newInvoiceMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="h-8 gap-1.5">
          <Plus className="w-3.5 h-3.5" /> New invoice
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground tracking-wider">Import sources</DropdownMenuLabel>
        <DropdownMenuItem onClick={props.onStartInvoice}>📄 Import invoice</DropdownMenuItem>
        <DropdownMenuItem onClick={props.onStartStockCheck}>🔍 Stock check</DropdownMenuItem>
        <DropdownMenuItem onClick={props.onStartPackingSlip}>📦 Packing slip</DropdownMenuItem>
        <DropdownMenuItem onClick={props.onStartScanMode}>📷 Scan mode</DropdownMenuItem>
        <DropdownMenuItem onClick={props.onStartEmailInbox}>
          📧 Email inbox {unread ? <span className="ml-auto text-[10px] bg-primary text-primary-foreground rounded-full px-1.5">{unread}</span> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground tracking-wider">B2B sources</DropdownMenuLabel>
        <DropdownMenuItem onClick={props.onStartJoor}>🔗 JOOR orders</DropdownMenuItem>
        <DropdownMenuItem onClick={props.onStartWholesaleImport}>📥 Wholesale import</DropdownMenuItem>
        <DropdownMenuItem onClick={props.onStartLookbookImport}>📸 Lookbook import</DropdownMenuItem>
        <DropdownMenuItem onClick={props.onStartPurchaseOrders}>📋 Purchase orders</DropdownMenuItem>
        <DropdownMenuItem onClick={props.onStartOrderForm}>📝 Order forms</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold font-display mb-1">Invoices</h1>
          <p className="text-muted-foreground text-sm">Every invoice you've processed</p>
        </div>
        {newInvoiceMenu}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search file or vendor"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Select value={vendorFilter} onValueChange={setVendorFilter}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Vendor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vendors</SelectItem>
            {vendors.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="reviewed">Done</SelectItem>
            <SelectItem value="needs_review">Needs review</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk action bar — appears when rows are selected */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md border border-primary/30 bg-primary/5">
          <span className="text-xs font-medium">{selected.size} selected</span>
          <span className="text-[10px] text-muted-foreground">
            {selectedInView.length < selected.size && `${selected.size - selectedInView.length} hidden by filters`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={clearSelection}>
              <X className="w-3 h-3 mr-1" /> Clear
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 px-2 text-[11px]"
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="w-3 h-3 mr-1" /> Delete
            </Button>
          </div>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading invoices…
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card rounded-lg border border-border p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-muted mx-auto flex items-center justify-center mb-3">
            <FileText className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium mb-1">No invoices yet</p>
          <p className="text-xs text-muted-foreground mb-4">Import your first invoice to see it listed here.</p>
          {newInvoiceMenu}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          No invoices match the current filters.
        </div>
      ) : (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="divide-y divide-border">
            {filtered.map(r => {
              const status = STATUS_BADGE[r.review_status ?? "draft"] ?? STATUS_BADGE.draft;
              const isDraft = (r.review_status ?? "draft") === "draft" || (r.review_status ?? "") === "needs_review";
              const actionLabel = isDraft ? "Resume" : "View";
              const handleOpen = () => props.onOpenHistory?.(r.id);
              return (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={handleOpen}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpen(); }
                  }}
                  className="px-3 py-2.5 flex items-center gap-3 hover:bg-muted/40 cursor-pointer focus:outline-none focus:bg-muted/40"
                >
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{r.supplier_name ?? "Unknown vendor"}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${status.cls}`}>{status.label}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate font-mono-data">{r.original_filename ?? "—"}</p>
                  </div>
                  <div className="hidden sm:flex flex-col items-end text-[10px] text-muted-foreground shrink-0 min-w-[110px]">
                    <span>{formatRelativeTime(r.created_at)}</span>
                    <span>
                      {r.variants_extracted ?? 0} lines
                      {r.edit_count ? ` · ${r.edit_count} edits` : ""}
                      {r.processing_duration_seconds ? ` · ${r.processing_duration_seconds}s` : ""}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] shrink-0"
                    onClick={(e) => { e.stopPropagation(); handleOpen(); }}
                  >
                    {actionLabel}
                  </Button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" />
                </div>
              );
            })}
          </div>
          <div className="px-3 py-2 text-[10px] text-muted-foreground border-t border-border bg-muted/20">
            Showing {filtered.length} of {rows.length} invoices
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoicesTab;
