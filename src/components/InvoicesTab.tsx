import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Plus, Search, FileText, Loader2 } from "lucide-react";
import { getUnprocessedInboxCount } from "@/components/EmailInboxPanel";
import { formatRelativeTime } from "@/lib/audit-log";

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
              return (
                <div key={r.id} className="px-3 py-2.5 flex items-center gap-3 hover:bg-muted/30">
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
