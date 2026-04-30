import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  Ban,
  Send,
  Wrench,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Image as ImageIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getProductFeedAttributes,
  updateProductFeedAttributes,
} from "@/lib/shopify/productFeedEnricher";
import {
  FixAttributesModal,
  type ProductFixInput,
} from "./FixAttributesModal";

// ───────────────────────── Types ─────────────────────────

type FeedStatus = "eligible" | "disapproved" | "warning" | "not_submitted" | "excluded";

interface ProductRow {
  id: string;
  title: string;
  handle: string;
  imageUrl: string | null;
  status: FeedStatus;
  errors: string[];
  variantIds: string[];
  productType: string | null;
  shopDomain: string;
}

interface ListResponse {
  rows: ProductRow[];
  nextCursor: string | null;
  hasNext: boolean;
  warning?: string;
}

const ERROR_LABELS: Record<string, string> = {
  missing_gtin: "GTIN",
  missing_gender: "Gender",
  missing_age_group: "Age group",
  missing_color: "Color",
  missing_size: "Size",
  image_too_small: "Image size",
};

const ERROR_FILTERS: { code: string; label: string }[] = [
  { code: "missing_gtin", label: "GTIN" },
  { code: "missing_gender", label: "Gender" },
  { code: "missing_age_group", label: "Age group" },
  { code: "image_too_small", label: "Image size" },
  { code: "complete", label: "100% sourced" },
];

const STATUS_TONE: Record<FeedStatus, { label: string; className: string; Icon: any }> = {
  eligible: {
    label: "Eligible",
    className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    Icon: CheckCircle2,
  },
  disapproved: {
    label: "Disapproved",
    className: "bg-destructive/10 text-destructive border-destructive/30",
    Icon: XCircle,
  },
  warning: {
    label: "Warning",
    className: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    Icon: AlertTriangle,
  },
  not_submitted: {
    label: "Not submitted",
    className: "bg-muted text-muted-foreground border-border",
    Icon: AlertTriangle,
  },
  excluded: {
    label: "Excluded",
    className: "bg-muted text-muted-foreground border-border",
    Icon: Ban,
  },
};

interface Props {
  onBack?: () => void;
  onFix?: (productId: string) => void;
}

const PAGE_SIZE = 50;

// ───────────────────────── Component ─────────────────────────

export default function ProductFeedTable({ onBack, onFix }: Props) {
  // Server-driven cursor pages
  const [pages, setPages] = useState<string[]>([""]); // empty string = first page (cursor=null)
  const [pageIndex, setPageIndex] = useState(0);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | FeedStatus>("all");
  const [errorFilters, setErrorFilters] = useState<Set<string>>(new Set());

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Fix-attributes modal state
  const [fixOpen, setFixOpen] = useState(false);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixProducts, setFixProducts] = useState<ProductFixInput[]>([]);

  const openFixModal = useCallback(
    async (productIds: string[]) => {
      if (productIds.length === 0) {
        toast.error("Select at least one product");
        return;
      }
      setFixOpen(true);
      setFixLoading(true);
      setFixProducts([]);
      try {
        const titleById = new Map(rows.map((r) => [r.id, r.title]));
        const results: ProductFixInput[] = [];
        for (const id of productIds) {
          try {
            const attrs = await getProductFeedAttributes(id);
            results.push({
              productId: attrs.productId,
              title: titleById.get(id) ?? id,
              gender: attrs.gender,
              ageGroup: attrs.ageGroup,
              color: attrs.color,
              material: null,
              pattern: null,
              condition: null,
              googleProductCategory: attrs.googleProductCategory,
              variants: attrs.variants.map((v) => ({
                variantId: v.variantId,
                size: v.size,
              })),
            });
          } catch (e) {
            console.error("Failed to load attributes for", id, e);
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        if (results.length === 0) {
          toast.error("Could not load product attributes");
          setFixOpen(false);
        } else {
          setFixProducts(results);
        }
      } finally {
        setFixLoading(false);
      }
    },
    [rows],
  );

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPages([""]);
      setPageIndex(0);
      setSelected(new Set());
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const fetchPage = useCallback(
    async (cursor: string) => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: invokeErr } = await supabase.functions.invoke(
          "google-merchant-status",
          {
            body: {
              action: "list",
              cursor: cursor || null,
              pageSize: PAGE_SIZE,
              search: debouncedSearch || null,
            },
          },
        );
        if (invokeErr) throw new Error(invokeErr.message);
        if (data?.error) throw new Error(data.error);
        const resp = data as ListResponse;
        setRows(resp.rows ?? []);
        setHasNext(!!resp.hasNext);
        // Track the next cursor so we can advance
        if (resp.hasNext && resp.nextCursor) {
          setPages((prev) => {
            const copy = [...prev];
            copy[pageIndex + 1] = resp.nextCursor!;
            return copy;
          });
        }
      } catch (e) {
        setError((e as Error).message || "Failed to load products");
        setRows([]);
        setHasNext(false);
      } finally {
        setLoading(false);
      }
    },
    [debouncedSearch, pageIndex],
  );

  useEffect(() => {
    fetchPage(pages[pageIndex] ?? "");
  }, [pageIndex, debouncedSearch, fetchPage]); // pages updated inline; intentionally omitted

  // Client-side filtering on top of the server page
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (errorFilters.size > 0) {
        const wantsComplete = errorFilters.has("complete");
        const otherCodes = [...errorFilters].filter((c) => c !== "complete");
        if (wantsComplete && r.errors.length > 0) {
          if (otherCodes.length === 0) return false;
        }
        if (otherCodes.length > 0) {
          const matchesAny = otherCodes.some((c) => r.errors.includes(c));
          if (!matchesAny && !(wantsComplete && r.errors.length === 0)) return false;
        }
      }
      return true;
    });
  }, [rows, statusFilter, errorFilters]);

  // ── Selection helpers ──
  const allOnPageSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.id));
  const someOnPageSelected = filteredRows.some((r) => selected.has(r.id));

  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const r of filteredRows) next.delete(r.id);
      } else {
        for (const r of filteredRows) next.add(r.id);
      }
      return next;
    });
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleErrorFilter = (code: string) => {
    setErrorFilters((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  // ── Bulk actions ──
  const runBulk = async (
    label: string,
    fn: (row: ProductRow) => Promise<void>,
  ) => {
    const targets = rows.filter((r) => selected.has(r.id));
    if (targets.length === 0) {
      toast.error("Select at least one product");
      return;
    }
    setActionBusy(true);
    let ok = 0;
    let failed = 0;
    for (const r of targets) {
      try {
        await fn(r);
        ok++;
      } catch (e) {
        failed++;
        console.error(`${label} failed for`, r.id, e);
      }
      // 500ms cadence per project memory (Shopify API concurrency)
      await new Promise((res) => setTimeout(res, 500));
    }
    setActionBusy(false);
    toast.success(`${label}: ${ok} done${failed ? `, ${failed} failed` : ""}`);
    setSelected(new Set());
    fetchPage(pages[pageIndex] ?? "");
  };

  const bulkExclude = () =>
    runBulk("Excluded", async (r) => {
      await updateProductFeedAttributes(r.id, {
        productId: r.id,
        gender: null,
        ageGroup: null,
        color: null,
        googleProductCategory: null,
        customLabels: [null, null, null, "excluded", null],
        variants: [],
      });
      // Use direct metafieldsSet through proxy for the feed_excluded flag
      await supabase.functions.invoke("shopify-proxy", {
        body: {
          action: "graphql",
          query: `mutation($metafields:[MetafieldsSetInput!]!){
            metafieldsSet(metafields:$metafields){ userErrors{ message } }
          }`,
          variables: {
            metafields: [
              {
                ownerId: r.id,
                namespace: "google",
                key: "feed_excluded",
                type: "boolean",
                value: "true",
              },
            ],
          },
        },
      });
    });

  const bulkSubmit = () =>
    runBulk("Submitted", async (r) => {
      await supabase.functions.invoke("shopify-proxy", {
        body: {
          action: "graphql",
          query: `mutation($metafields:[MetafieldsSetInput!]!){
            metafieldsSet(metafields:$metafields){ userErrors{ message } }
          }`,
          variables: {
            metafields: [
              {
                ownerId: r.id,
                namespace: "google",
                key: "feed_excluded",
                type: "boolean",
                value: "false",
              },
            ],
          },
        },
      });
    });

  const bulkUpdateAttrs = () => {
    openFixModal(rows.filter((r) => selected.has(r.id)).map((r) => r.id));
  };

  // ── UI ──
  return (
    <div className="max-w-[1400px] mx-auto p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold truncate">
              Product feed manager
            </h1>
            <p className="text-xs text-muted-foreground">
              Showing {filteredRows.length} of {rows.length} on this page
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchPage(pages[pageIndex] ?? "")}
          disabled={loading}
        >
          <RefreshCw className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by product title…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as any)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Feed status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="disapproved">Disapproved</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="eligible">Eligible</SelectItem>
                <SelectItem value="excluded">Excluded</SelectItem>
                <SelectItem value="not_submitted">Not submitted</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-border/50">
            <span className="text-xs font-medium text-muted-foreground">
              Error type:
            </span>
            {ERROR_FILTERS.map((f) => (
              <label
                key={f.code}
                className="flex items-center gap-1.5 text-xs cursor-pointer"
              >
                <Checkbox
                  checked={errorFilters.has(f.code)}
                  onCheckedChange={() => toggleErrorFilter(f.code)}
                />
                {f.label}
              </label>
            ))}
            {(statusFilter !== "all" || errorFilters.size > 0) && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-xs"
                onClick={() => {
                  setStatusFilter("all");
                  setErrorFilters(new Set());
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-md bg-primary/5 border border-primary/20">
          <span className="text-sm font-medium px-2">
            {selected.size} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={bulkSubmit}
            disabled={actionBusy}
          >
            <Send className="w-3.5 h-3.5 mr-1.5" /> Bulk submit
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={bulkUpdateAttrs}
            disabled={actionBusy}
          >
            <Wrench className="w-3.5 h-3.5 mr-1.5" /> Update attributes
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={bulkExclude}
            disabled={actionBusy}
          >
            <Ban className="w-3.5 h-3.5 mr-1.5" /> Bulk exclude
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
            className="ml-auto"
          >
            Clear
          </Button>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="text-sm font-medium">Products</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2 text-left">
                    <Checkbox
                      checked={
                        allOnPageSelected
                          ? true
                          : someOnPageSelected
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={togglePage}
                    />
                  </th>
                  <th className="w-14 px-2 py-2 text-left">Image</th>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-left w-[140px]">Status</th>
                  <th className="px-3 py-2 text-left">Errors</th>
                  <th className="px-3 py-2 text-right w-[260px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-t border-border/50">
                      <td colSpan={6} className="px-3 py-2">
                        <Skeleton className="h-8 w-full" />
                      </td>
                    </tr>
                  ))
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-12 text-center text-sm text-muted-foreground"
                    >
                      No products match these filters.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r) => {
                    const tone = STATUS_TONE[r.status];
                    const StatusIcon = tone.Icon;
                    const productNumeric = r.id.split("/").pop();
                    const editUrl = `https://${r.shopDomain}/admin/products/${productNumeric}`;
                    return (
                      <tr
                        key={r.id}
                        className={cn(
                          "border-t border-border/50 hover:bg-muted/30 transition-colors",
                          selected.has(r.id) && "bg-primary/5",
                        )}
                        style={{ height: 32 }}
                      >
                        <td className="px-3">
                          <Checkbox
                            checked={selected.has(r.id)}
                            onCheckedChange={() => toggleRow(r.id)}
                          />
                        </td>
                        <td className="px-2">
                          {r.imageUrl ? (
                            <img
                              src={r.imageUrl}
                              alt={r.title}
                              loading="lazy"
                              className="w-9 h-9 rounded object-cover border border-border"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded bg-muted flex items-center justify-center text-muted-foreground">
                              <ImageIcon className="w-4 h-4" />
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <a
                            href={editUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-foreground hover:text-primary inline-flex items-center gap-1 max-w-[420px] truncate"
                            title={r.title}
                          >
                            <span className="truncate">{r.title}</span>
                            <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
                          </a>
                          {r.productType && (
                            <p className="text-xs text-muted-foreground truncate">
                              {r.productType}
                            </p>
                          )}
                        </td>
                        <td className="px-3">
                          <Badge
                            variant="outline"
                            className={cn("gap-1 font-normal", tone.className)}
                          >
                            <StatusIcon className="w-3 h-3" />
                            {tone.label}
                          </Badge>
                        </td>
                        <td className="px-3">
                          {r.errors.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {r.errors.map((c) => (
                                <Badge
                                  key={c}
                                  variant="secondary"
                                  className="text-[10px] py-0 px-1.5 font-normal"
                                >
                                  {ERROR_LABELS[c] ?? c}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              asChild
                            >
                              <a href={editUrl} target="_blank" rel="noopener noreferrer">
                                <Eye className="w-3.5 h-3.5 mr-1" /> View
                              </a>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() =>
                                onFix ? onFix(r.id) : openFixModal([r.id])
                              }
                            >
                              <Wrench className="w-3.5 h-3.5 mr-1" /> Fix
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => {
                                setSelected(new Set([r.id]));
                                bulkExclude();
                              }}
                              disabled={actionBusy}
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => {
                                setSelected(new Set([r.id]));
                                bulkSubmit();
                              }}
                              disabled={actionBusy}
                            >
                              <Send className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Page {pageIndex + 1} · {PAGE_SIZE} per page
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
            disabled={pageIndex === 0 || loading}
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex((i) => i + 1)}
            disabled={!hasNext || loading}
          >
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>

      <FixAttributesModal
        open={fixOpen}
        onOpenChange={(o) => {
          setFixOpen(o);
          if (!o) setFixProducts([]);
        }}
        products={fixProducts}
        onSaved={() => {
          setSelected(new Set());
          fetchPage(pages[pageIndex] ?? "");
        }}
      />
      {fixOpen && fixLoading && (
        <div className="fixed bottom-4 right-4 text-xs text-muted-foreground bg-background border rounded px-3 py-2 shadow z-50">
          Loading attributes…
        </div>
      )}
    </div>
  );
}
