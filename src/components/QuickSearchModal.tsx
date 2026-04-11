import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Search, Package, ClipboardList, Users, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (flow: string) => void;
}

interface SearchResult {
  type: "product" | "po" | "supplier" | "invoice";
  id: string;
  title: string;
  subtitle?: string;
  flow: string;
}

const icons = {
  product: Package,
  po: ClipboardList,
  supplier: Users,
  invoice: FileText,
};

const QuickSearchModal = ({ open, onOpenChange, onNavigate }: Props) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) { setQuery(""); setResults([]); }
  }, [open]);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      const q = `%${query}%`;
      const [products, pos, suppliers] = await Promise.all([
        supabase.from("products").select("id, title, vendor").ilike("title", q).limit(5),
        supabase.from("purchase_orders").select("id, po_number, supplier_name").ilike("po_number", q).limit(5),
        supabase.from("suppliers").select("id, name").ilike("name", q).limit(5),
      ]);
      const r: SearchResult[] = [];
      products.data?.forEach((p) => r.push({ type: "product", id: p.id, title: p.title, subtitle: p.vendor || undefined, flow: "inventory_view" }));
      pos.data?.forEach((p) => r.push({ type: "po", id: p.id, title: p.po_number, subtitle: p.supplier_name, flow: "purchase_orders" }));
      suppliers.data?.forEach((s) => r.push({ type: "supplier", id: s.id, title: s.name, flow: "suppliers" }));
      setResults(r);
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products, POs, suppliers…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border font-mono">ESC</kbd>
        </div>
        <div className="max-h-72 overflow-auto">
          {loading && <p className="p-4 text-xs text-muted-foreground">Searching…</p>}
          {!loading && query.length >= 2 && results.length === 0 && (
            <p className="p-4 text-xs text-muted-foreground">No results found.</p>
          )}
          {results.map((r) => {
            const Icon = icons[r.type];
            return (
              <button
                key={r.type + r.id}
                onClick={() => { onNavigate(r.flow); onOpenChange(false); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors"
              >
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.title}</p>
                  {r.subtitle && <p className="text-xs text-muted-foreground truncate">{r.subtitle}</p>}
                </div>
                <span className="ml-auto text-[10px] uppercase text-muted-foreground">{r.type}</span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default QuickSearchModal;
