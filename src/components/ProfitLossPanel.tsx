import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ChevronLeft, Plus, Trash2, Upload, Download, TrendingUp, TrendingDown,
  DollarSign, BarChart3, Calendar, Check, X, RefreshCw, AlertTriangle,
  Receipt, Settings2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell
} from "recharts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarWidget } from "@/components/ui/calendar";
import { format, startOfMonth, endOfMonth, eachMonthOfInterval, subMonths } from "date-fns";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import Papa from "papaparse";
import { toast } from "sonner";

/* ─── Types ─── */
interface ExpenseItem {
  id: string;
  name: string;
  type: "fixed" | "variable" | "one-off";
  gstInclusive: boolean;        // whether amounts include GST
  gstRate: number;               // e.g. 0.1 for 10%
  monthlyAmounts: Record<string, number>; // "2024-01" → amount (inc or ex GST per flag)
}

interface ExpenseCategory {
  id: string;
  name: string;
  icon: string;
  accountCode: string;           // e.g. "61700" for freight
  items: ExpenseItem[];
}

interface RevenueEntry {
  month: string;
  gross: number;
  cogs: number;
  shipping_collected: number;
  refunds: number;
  gst_collected: number;
}

interface CategoryMapping {
  keyword: string;
  categoryId: string;
}

interface PLData {
  categories: ExpenseCategory[];
  revenue: RevenueEntry[];
  currency: string;
  gstRate: number;                   // default GST rate (0.1 for AU)
  customMappings: CategoryMapping[]; // saved keyword→category rules
  updatedAt: string;
}

/* ─── Default expense categories based on Splash Swimwear P&L ─── */
const DEFAULT_CATEGORIES: ExpenseCategory[] = [
  {
    id: "advertising", name: "Advertising & Marketing", icon: "📢", accountCode: "61500",
    items: [
      { id: "google_ads", name: "Google Advertising", type: "variable", gstInclusive: true, gstRate: 0.1, monthlyAmounts: {} },
      { id: "facebook_ads", name: "Facebook / Meta Advertising", type: "variable", gstInclusive: true, gstRate: 0.1, monthlyAmounts: {} },
      { id: "microsoft_ads", name: "Microsoft Advertising", type: "variable", gstInclusive: true, gstRate: 0.1, monthlyAmounts: {} },
    ],
  },
  {
    id: "apps", name: "App Subscriptions", icon: "📱", accountCode: "61200",
    items: [
      { id: "shopify_fees", name: "Shopify Fees", type: "fixed", gstInclusive: true, gstRate: 0.1, monthlyAmounts: {} },
      { id: "post_co", name: "Post Co App", type: "fixed", gstInclusive: true, gstRate: 0.1, monthlyAmounts: {} },
      { id: "growave", name: "Growave", type: "fixed", gstInclusive: true, gstRate: 0, monthlyAmounts: {} },
      { id: "simprosys", name: "Simprosys", type: "fixed", gstInclusive: true, gstRate: 0, monthlyAmounts: {} },
    ],
  },
  {
    id: "shipping", name: "Shipping & Postage", icon: "📦", accountCode: "61700",
    items: [
      { id: "postage", name: "Postage / Shipping Costs", type: "variable", gstInclusive: true, gstRate: 0.1, monthlyAmounts: {} },
    ],
  },
  {
    id: "staff", name: "Staff & Wages", icon: "👥", accountCode: "62000",
    items: [],
  },
  {
    id: "rent", name: "Rent & Utilities", icon: "🏪", accountCode: "62500",
    items: [],
  },
  {
    id: "insurance", name: "Insurance", icon: "🛡️", accountCode: "63000",
    items: [],
  },
  {
    id: "packaging", name: "Packaging & Supplies", icon: "📦", accountCode: "61800",
    items: [],
  },
  {
    id: "professional", name: "Professional Services", icon: "💼", accountCode: "64000",
    items: [],
  },
  {
    id: "other", name: "Other Expenses", icon: "📋", accountCode: "69000",
    items: [],
  },
];

/* ─── Storage ─── */
const STORAGE_KEY = "pl_dashboard_data_v2";
const MAPPINGS_KEY = "pl_category_mappings";

function loadPLData(): PLData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate old items without GST fields
      parsed.categories = (parsed.categories || DEFAULT_CATEGORIES).map((c: ExpenseCategory) => ({
        ...c,
        accountCode: c.accountCode || "",
        items: c.items.map((i: ExpenseItem) => ({
          ...i,
          gstInclusive: i.gstInclusive ?? true,
          gstRate: i.gstRate ?? 0.1,
        })),
      }));
      return { ...parsed, gstRate: parsed.gstRate ?? 0.1, customMappings: parsed.customMappings || [] };
    }
    // Try migrate from v1
    const v1 = localStorage.getItem("pl_dashboard_data");
    if (v1) {
      const old = JSON.parse(v1);
      const migrated: PLData = {
        categories: (old.categories || DEFAULT_CATEGORIES).map((c: any) => ({
          ...c,
          accountCode: "",
          items: (c.items || []).map((i: any) => ({
            ...i,
            gstInclusive: true,
            gstRate: 0.1,
          })),
        })),
        revenue: (old.revenue || []).map((r: any) => ({ ...r, gst_collected: 0 })),
        currency: old.currency || "AUD",
        gstRate: 0.1,
        customMappings: [],
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {}
  return { categories: DEFAULT_CATEGORIES, revenue: [], currency: "AUD", gstRate: 0.1, customMappings: [], updatedAt: new Date().toISOString() };
}

function savePLData(data: PLData) {
  data.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* ─── Helpers ─── */
const fmt = (n: number) => `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtSigned = (n: number) => n < 0 ? `-${fmt(n)}` : fmt(n);
const monthKey = (d: Date) => format(d, "yyyy-MM");
const monthLabel = (key: string) => {
  const [y, m] = key.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m) - 1]} ${y.slice(2)}`;
};

function calcExGst(amount: number, inclusive: boolean, rate: number): number {
  if (rate === 0 || !inclusive) return amount;
  return amount / (1 + rate);
}
function calcGst(amount: number, inclusive: boolean, rate: number): number {
  if (rate === 0) return 0;
  if (inclusive) return amount - amount / (1 + rate);
  return amount * rate;
}

/* ─── AI expense classifier (enhanced) ─── */
function classifyExpense(name: string, customMappings: CategoryMapping[]): string {
  const lower = name.toLowerCase();
  // Check custom mappings first
  for (const m of customMappings) {
    if (lower.includes(m.keyword.toLowerCase())) return m.categoryId;
  }
  if (/advertis|ads|google|facebook|meta|microsoft|bing|tiktok|marketing|campaign|promo/i.test(lower)) return "advertising";
  if (/app|shopify|plugin|subscription|saas|software|simprosys|growave|linktree|currency|zoom|label/i.test(lower)) return "apps";
  if (/post|ship|freight|delivery|courier|auspost|sendle|aramex|dhl|ups|fedex|packaging|pack/i.test(lower)) return "shipping";
  if (/wage|salary|staff|employee|super|payroll|worker|casual/i.test(lower)) return "staff";
  if (/rent|lease|power|electric|water|internet|phone|utility/i.test(lower)) return "rent";
  if (/insurance|indemnity|liability|cover/i.test(lower)) return "insurance";
  if (/packaging|tissue|box|bag|supplies|label|sticker/i.test(lower)) return "packaging";
  if (/accountant|legal|lawyer|consult|book-?keep/i.test(lower)) return "professional";
  return "other";
}

interface Props { onBack: () => void; }
type View = "overview" | "expenses" | "revenue" | "gst" | "settings";

const PIE_COLORS = [
  "hsl(var(--primary))", "hsl(var(--warning))", "hsl(var(--destructive))",
  "hsl(var(--success))", "hsl(var(--accent-foreground))",
  "#8884d8", "#ffc658", "#82ca9d", "#ff7c7c",
];

const ProfitLossPanel = ({ onBack }: Props) => {
  const [data, setData] = useState<PLData>(loadPLData);
  const [view, setView] = useState<View>("overview");
  const [dateFrom, setDateFrom] = useState<Date>(() => subMonths(startOfMonth(new Date()), 11));
  const [dateTo, setDateTo] = useState<Date>(() => endOfMonth(new Date()));
  const [newItemName, setNewItemName] = useState("");
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [importingAccounting, setImportingAccounting] = useState(false);
  const [newMappingKeyword, setNewMappingKeyword] = useState("");
  const [newMappingCategory, setNewMappingCategory] = useState("");

  useEffect(() => { savePLData(data); }, [data]);

  const months = useMemo(() => {
    const start = startOfMonth(dateFrom);
    const end = startOfMonth(dateTo);
    return eachMonthOfInterval({ start, end }).map(d => monthKey(d));
  }, [dateFrom, dateTo]);

  /* ─── GST-Aware Calculations ─── */
  const calculations = useMemo(() => {
    const monthlyExpensesExGst: Record<string, number> = {};
    const monthlyExpensesGst: Record<string, number> = {};
    const monthlyRevenue: Record<string, number> = {};
    const monthlyCOGS: Record<string, number> = {};
    const monthlyGrossProfit: Record<string, number> = {};
    const monthlyNetProfit: Record<string, number> = {};
    const monthlyGstCollected: Record<string, number> = {};
    const monthlyGstPaid: Record<string, number> = {};
    const categoryTotals: Record<string, number> = {};
    const categoryGst: Record<string, number> = {};

    months.forEach(m => {
      let totalExpExGst = 0;
      let totalExpGst = 0;
      data.categories.forEach(cat => {
        let catTotal = 0;
        let catGst = 0;
        cat.items.forEach(item => {
          const raw = item.monthlyAmounts[m] || 0;
          const exGst = calcExGst(raw, item.gstInclusive, item.gstRate);
          const gst = calcGst(raw, item.gstInclusive, item.gstRate);
          totalExpExGst += exGst;
          totalExpGst += gst;
          catTotal += exGst;
          catGst += gst;
        });
        categoryTotals[cat.id] = (categoryTotals[cat.id] || 0) + catTotal;
        categoryGst[cat.id] = (categoryGst[cat.id] || 0) + catGst;
      });
      monthlyExpensesExGst[m] = totalExpExGst;
      monthlyExpensesGst[m] = totalExpGst;

      const rev = data.revenue.find(r => r.month === m);
      const gross = rev?.gross || 0;
      const cogs = rev?.cogs || 0;
      const shippingCollected = rev?.shipping_collected || 0;
      const refunds = rev?.refunds || 0;
      const gstCollected = rev?.gst_collected || 0;

      monthlyRevenue[m] = gross + shippingCollected - refunds;
      monthlyCOGS[m] = cogs;
      monthlyGrossProfit[m] = monthlyRevenue[m] - cogs;
      monthlyNetProfit[m] = monthlyGrossProfit[m] - totalExpExGst;
      monthlyGstCollected[m] = gstCollected;
      monthlyGstPaid[m] = totalExpGst;
    });

    const totalRevenue = Object.values(monthlyRevenue).reduce((s, v) => s + v, 0);
    const totalCOGS = Object.values(monthlyCOGS).reduce((s, v) => s + v, 0);
    const totalExpenses = Object.values(monthlyExpensesExGst).reduce((s, v) => s + v, 0);
    const totalGstCollected = Object.values(monthlyGstCollected).reduce((s, v) => s + v, 0);
    const totalGstPaid = Object.values(monthlyGstPaid).reduce((s, v) => s + v, 0);
    const grossProfit = totalRevenue - totalCOGS;
    const netProfit = grossProfit - totalExpenses;
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
    const basOwing = totalGstCollected - totalGstPaid;

    return {
      monthlyExpensesExGst, monthlyExpensesGst, monthlyRevenue, monthlyCOGS,
      monthlyGrossProfit, monthlyNetProfit, monthlyGstCollected, monthlyGstPaid,
      categoryTotals, categoryGst, totalRevenue, totalCOGS, totalExpenses,
      grossProfit, netProfit, profitMargin, totalGstCollected, totalGstPaid, basOwing,
    };
  }, [data, months]);

  const chartData = useMemo(() =>
    months.map(m => ({
      month: monthLabel(m),
      revenue: calculations.monthlyRevenue[m] || 0,
      expenses: calculations.monthlyExpensesExGst[m] || 0,
      cogs: calculations.monthlyCOGS[m] || 0,
      grossProfit: calculations.monthlyGrossProfit[m] || 0,
      netProfit: calculations.monthlyNetProfit[m] || 0,
    })),
    [months, calculations]
  );

  const pieData = useMemo(() =>
    data.categories
      .filter(cat => (calculations.categoryTotals[cat.id] || 0) > 0)
      .sort((a, b) => (calculations.categoryTotals[b.id] || 0) - (calculations.categoryTotals[a.id] || 0))
      .map(cat => ({ name: cat.name, value: Math.round(calculations.categoryTotals[cat.id] || 0) })),
    [data.categories, calculations.categoryTotals]
  );

  /* ─── Import from accounting push history ─── */
  const importFromAccounting = useCallback(async () => {
    setImportingAccounting(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) {
        toast.error("Please sign in to import accounting data");
        return;
      }

      const { data: history, error } = await supabase
        .from("accounting_push_history")
        .select("*")
        .eq("user_id", session.session.user.id)
        .eq("status", "pushed");

      if (error) throw error;
      if (!history || history.length === 0) {
        toast.info("No pushed invoices found to import");
        return;
      }

      let imported = 0;
      const updated = { ...data };

      history.forEach((h) => {
        const invoiceDate = h.invoice_date;
        if (!invoiceDate) return;
        const mk = invoiceDate.slice(0, 7); // "2024-01"
        if (!months.includes(mk)) return;

        // Classify by supplier/category
        const catId = classifyExpense(
          h.category || h.supplier_name || "",
          data.customMappings
        );
        const targetCat = updated.categories.find(c => c.id === catId)
          || updated.categories[updated.categories.length - 1];

        const supplierKey = (h.supplier_name || "Unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30);
        let item = targetCat.items.find(i => i.id === supplierKey);
        if (!item) {
          item = {
            id: supplierKey,
            name: h.supplier_name || "Unknown",
            type: "variable",
            gstInclusive: true,
            gstRate: data.gstRate,
            monthlyAmounts: {},
          };
          targetCat.items.push(item);
        }

        const totalIncGst = Number(h.total_inc_gst) || 0;
        item.monthlyAmounts[mk] = (item.monthlyAmounts[mk] || 0) + totalIncGst;
        imported++;
      });

      if (imported > 0) {
        setData({ ...updated });
        toast.success(`Imported ${imported} entries from accounting history`);
      } else {
        toast.info("No entries matched the selected date range");
      }
    } catch (err: any) {
      toast.error("Failed to import: " + (err.message || "Unknown error"));
    } finally {
      setImportingAccounting(false);
    }
  }, [data, months]);

  /* ─── CRUD ─── */
  const updateAmount = (catId: string, itemId: string, month: string, value: number) => {
    setData(prev => ({
      ...prev,
      categories: prev.categories.map(c => c.id === catId ? {
        ...c,
        items: c.items.map(i => i.id === itemId ? {
          ...i,
          monthlyAmounts: { ...i.monthlyAmounts, [month]: value }
        } : i)
      } : c)
    }));
  };

  const toggleGstInclusive = (catId: string, itemId: string) => {
    setData(prev => ({
      ...prev,
      categories: prev.categories.map(c => c.id === catId ? {
        ...c,
        items: c.items.map(i => i.id === itemId ? { ...i, gstInclusive: !i.gstInclusive } : i)
      } : c)
    }));
  };

  const updateGstRate = (catId: string, itemId: string, rate: number) => {
    setData(prev => ({
      ...prev,
      categories: prev.categories.map(c => c.id === catId ? {
        ...c,
        items: c.items.map(i => i.id === itemId ? { ...i, gstRate: rate } : i)
      } : c)
    }));
  };

  const addItem = (catId: string) => {
    if (!newItemName.trim()) return;
    const id = newItemName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    setData(prev => ({
      ...prev,
      categories: prev.categories.map(c => c.id === catId ? {
        ...c,
        items: [...c.items, { id, name: newItemName.trim(), type: "fixed" as const, gstInclusive: true, gstRate: data.gstRate, monthlyAmounts: {} }]
      } : c)
    }));
    setNewItemName("");
    setAddingToCategory(null);
  };

  const removeItem = (catId: string, itemId: string) => {
    setData(prev => ({
      ...prev,
      categories: prev.categories.map(c => c.id === catId ? {
        ...c,
        items: c.items.filter(i => i.id !== itemId)
      } : c)
    }));
  };

  const addCategory = () => {
    if (!newCategoryName.trim()) return;
    const id = newCategoryName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    setData(prev => ({
      ...prev,
      categories: [...prev.categories, { id, name: newCategoryName.trim(), icon: "📋", accountCode: "", items: [] }]
    }));
    setNewCategoryName("");
    setAddingCategory(false);
  };

  const removeCategory = (catId: string) => {
    setData(prev => ({ ...prev, categories: prev.categories.filter(c => c.id !== catId) }));
  };

  const updateRevenue = (month: string, field: keyof RevenueEntry, value: number) => {
    setData(prev => {
      const existing = prev.revenue.find(r => r.month === month);
      if (existing) {
        return { ...prev, revenue: prev.revenue.map(r => r.month === month ? { ...r, [field]: value } : r) };
      }
      return { ...prev, revenue: [...prev.revenue, { month, gross: 0, cogs: 0, shipping_collected: 0, refunds: 0, gst_collected: 0, [field]: value }] };
    });
  };

  const addMapping = () => {
    if (!newMappingKeyword.trim() || !newMappingCategory) return;
    setData(prev => ({
      ...prev,
      customMappings: [...prev.customMappings, { keyword: newMappingKeyword.trim(), categoryId: newMappingCategory }]
    }));
    setNewMappingKeyword("");
    setNewMappingCategory("");
    toast.success("Category mapping saved");
  };

  const removeMapping = (idx: number) => {
    setData(prev => ({
      ...prev,
      customMappings: prev.customMappings.filter((_, i) => i !== idx)
    }));
  };

  /* ─── CSV Import ─── */
  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: false,
      complete: (results) => {
        const rows = results.data as string[][];
        if (rows.length < 3) return;

        const headerRow = rows.find(r => r.some(cell => cell && /\d{4}/.test(String(cell))));
        if (!headerRow) return;

        const monthCols: { col: number; key: string }[] = [];
        headerRow.forEach((cell, col) => {
          if (!cell) return;
          const d = new Date(cell);
          if (!isNaN(d.getTime())) {
            monthCols.push({ col, key: monthKey(d) });
          }
        });

        const newCategories = [...data.categories];
        const otherCat = newCategories.find(c => c.id === "other") || newCategories[newCategories.length - 1];

        rows.forEach(row => {
          const name = String(row[0] || "").trim();
          if (!name || name === "EXPENSES" || /^(total|net|gross|revenue)/i.test(name)) return;

          const amounts: Record<string, number> = {};
          let hasData = false;
          monthCols.forEach(({ col, key }) => {
            const val = parseFloat(String(row[col] || "0").replace(/[$,]/g, ""));
            if (!isNaN(val) && val !== 0) {
              amounts[key] = val;
              hasData = true;
            }
          });
          if (!hasData) return;

          let found = false;
          for (const cat of newCategories) {
            const item = cat.items.find(i =>
              i.name.toLowerCase() === name.toLowerCase() ||
              i.name.toLowerCase().includes(name.toLowerCase()) ||
              name.toLowerCase().includes(i.name.toLowerCase())
            );
            if (item) {
              item.monthlyAmounts = { ...item.monthlyAmounts, ...amounts };
              found = true;
              break;
            }
          }

          if (!found) {
            const category = classifyExpense(name, data.customMappings);
            const targetCat = newCategories.find(c => c.id === category) || otherCat;
            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30);
            targetCat.items.push({ id, name, type: "fixed", gstInclusive: true, gstRate: data.gstRate, monthlyAmounts: amounts });
          }
        });

        setData(prev => ({ ...prev, categories: newCategories }));
        toast.success("CSV data imported successfully");
      }
    });
    e.target.value = "";
  };

  /* ─── Export CSV ─── */
  const handleExportCSV = () => {
    const header = ["Category", "Expense", "GST Rate", ...months.map(monthLabel), "Total Ex GST", "Total GST"];
    const rows: string[][] = [];

    data.categories.forEach(cat => {
      cat.items.forEach(item => {
        const totalRaw = months.reduce((s, m) => s + (item.monthlyAmounts[m] || 0), 0);
        const totalExGst = calcExGst(totalRaw, item.gstInclusive, item.gstRate);
        const totalGst = calcGst(totalRaw, item.gstInclusive, item.gstRate);
        rows.push([
          cat.name, item.name, `${(item.gstRate * 100).toFixed(0)}%`,
          ...months.map(m => (item.monthlyAmounts[m] || 0).toFixed(2)),
          totalExGst.toFixed(2), totalGst.toFixed(2)
        ]);
      });
    });

    rows.push([]);
    rows.push(["REVENUE", "Gross Sales", "", ...months.map(m => {
      const r = data.revenue.find(rv => rv.month === m);
      return (r?.gross || 0).toFixed(2);
    }), calculations.totalRevenue.toFixed(2), ""]);
    rows.push(["", "COGS", "", ...months.map(m => (calculations.monthlyCOGS[m] || 0).toFixed(2)), calculations.totalCOGS.toFixed(2), ""]);
    rows.push(["", "Total Expenses (Ex GST)", "", ...months.map(m => (calculations.monthlyExpensesExGst[m] || 0).toFixed(2)), calculations.totalExpenses.toFixed(2), calculations.totalGstPaid.toFixed(2)]);
    rows.push(["", "Net Profit", "", ...months.map(m => (calculations.monthlyNetProfit[m] || 0).toFixed(2)), calculations.netProfit.toFixed(2), ""]);
    rows.push([]);
    rows.push(["GST SUMMARY", "GST Collected", "", ...months.map(m => (calculations.monthlyGstCollected[m] || 0).toFixed(2)), calculations.totalGstCollected.toFixed(2), ""]);
    rows.push(["", "GST Paid on Expenses", "", ...months.map(m => (calculations.monthlyGstPaid[m] || 0).toFixed(2)), calculations.totalGstPaid.toFixed(2), ""]);
    rows.push(["", "BAS Owing / (Refund)", "", ...months.map(m => ((calculations.monthlyGstCollected[m] || 0) - (calculations.monthlyGstPaid[m] || 0)).toFixed(2)), calculations.basOwing.toFixed(2), ""]);

    const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `profit_loss_${format(dateFrom, "yyyyMM")}_${format(dateTo, "yyyyMM")}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  /* ─── Overview View ─── */
  const renderOverview = () => (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Revenue</p>
          <p className="text-lg font-bold font-mono-data text-primary">{fmt(calculations.totalRevenue)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">COGS</p>
          <p className="text-lg font-bold font-mono-data text-warning">{fmt(calculations.totalCOGS)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Gross Profit</p>
          <p className="text-lg font-bold font-mono-data text-primary">{fmt(calculations.grossProfit)}</p>
          <p className="text-[10px] text-muted-foreground">{calculations.totalRevenue > 0 ? ((calculations.grossProfit / calculations.totalRevenue) * 100).toFixed(1) : 0}% margin</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Operating Expenses</p>
          <p className="text-lg font-bold font-mono-data text-destructive">{fmt(calculations.totalExpenses)}</p>
          <p className="text-[10px] text-muted-foreground">Ex GST</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Net Profit</p>
          <div className="flex items-center gap-1.5">
            {calculations.netProfit >= 0 ? <TrendingUp className="w-4 h-4 text-success" /> : <TrendingDown className="w-4 h-4 text-destructive" />}
            <p className={cn("text-lg font-bold font-mono-data", calculations.netProfit >= 0 ? "text-success" : "text-destructive")}>
              {fmtSigned(calculations.netProfit)}
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground">{calculations.profitMargin.toFixed(1)}% net margin</p>
        </Card>
      </div>

      {/* GST Summary Card */}
      <Card className="p-4 border-l-4 border-l-warning">
        <div className="flex items-center gap-2 mb-2">
          <Receipt className="w-4 h-4 text-warning" />
          <h3 className="text-sm font-semibold">GST / BAS Summary</h3>
        </div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">GST Collected</p>
            <p className="font-mono-data font-semibold">{fmt(calculations.totalGstCollected)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">GST Paid (Expenses)</p>
            <p className="font-mono-data font-semibold">{fmt(calculations.totalGstPaid)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">BAS {calculations.basOwing >= 0 ? "Owing" : "Refund"}</p>
            <p className={cn("font-mono-data font-bold", calculations.basOwing >= 0 ? "text-destructive" : "text-success")}>
              {fmtSigned(calculations.basOwing)}
            </p>
          </div>
        </div>
      </Card>

      {/* P&L Chart */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Monthly Profit & Loss</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" name="Revenue" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
              <Bar dataKey="cogs" name="COGS" fill="hsl(var(--warning))" radius={[2, 2, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill="hsl(var(--destructive))" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Net Profit Trend */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Net Profit Trend</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Line type="monotone" dataKey="netProfit" name="Net Profit" stroke="hsl(var(--success))" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="grossProfit" name="Gross Profit" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Expense Breakdown Pie + Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Expense Breakdown</h3>
          {pieData.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={9}>
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic py-8 text-center">No expenses entered yet</p>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">By Category</h3>
          <div className="space-y-2">
            {data.categories
              .filter(cat => (calculations.categoryTotals[cat.id] || 0) > 0)
              .sort((a, b) => (calculations.categoryTotals[b.id] || 0) - (calculations.categoryTotals[a.id] || 0))
              .map(cat => {
                const total = calculations.categoryTotals[cat.id] || 0;
                const gst = calculations.categoryGst[cat.id] || 0;
                const pct = calculations.totalExpenses > 0 ? (total / calculations.totalExpenses) * 100 : 0;
                return (
                  <div key={cat.id} className="flex items-center gap-3">
                    <span className="text-lg">{cat.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium truncate">{cat.name}</span>
                        <span className="font-mono-data font-semibold">{fmt(total)}</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                        <div className="bg-primary rounded-full h-1.5 transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{pct.toFixed(1)}% • GST: {fmt(gst)}</p>
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>
      </div>

      {/* P&L Summary Table */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Profit & Loss Summary</h3>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4 font-semibold min-w-[140px]">Line Item</th>
                {months.map(m => <th key={m} className="text-right py-2 px-2 font-semibold whitespace-nowrap">{monthLabel(m)}</th>)}
                <th className="text-right py-2 pl-4 font-bold whitespace-nowrap">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-primary/5 font-semibold">
                <td className="py-1.5 pr-4">Revenue</td>
                {months.map(m => <td key={m} className="text-right px-2 font-mono-data">{fmt(calculations.monthlyRevenue[m] || 0)}</td>)}
                <td className="text-right pl-4 font-mono-data font-bold">{fmt(calculations.totalRevenue)}</td>
              </tr>
              <tr className="text-warning">
                <td className="py-1 pr-4 pl-4">− COGS</td>
                {months.map(m => <td key={m} className="text-right px-2 font-mono-data">{fmt(calculations.monthlyCOGS[m] || 0)}</td>)}
                <td className="text-right pl-4 font-mono-data">{fmt(calculations.totalCOGS)}</td>
              </tr>
              <tr className="border-b border-border font-semibold">
                <td className="py-1.5 pr-4">Gross Profit</td>
                {months.map(m => <td key={m} className="text-right px-2 font-mono-data">{fmt(calculations.monthlyGrossProfit[m] || 0)}</td>)}
                <td className="text-right pl-4 font-mono-data font-bold">{fmt(calculations.grossProfit)}</td>
              </tr>
              {data.categories.map(cat => (
                <tbody key={cat.id}>
                  <tr className="bg-muted/30">
                    <td className="py-1.5 pr-4 font-semibold" colSpan={months.length + 2}>
                      {cat.icon} {cat.name}
                    </td>
                  </tr>
                  {cat.items.map(item => {
                    const itemTotal = months.reduce((s, m) => {
                      const raw = item.monthlyAmounts[m] || 0;
                      return s + calcExGst(raw, item.gstInclusive, item.gstRate);
                    }, 0);
                    return (
                      <tr key={item.id} className="hover:bg-muted/20">
                        <td className="py-1 pr-4 pl-6 text-muted-foreground">{item.name}</td>
                        {months.map(m => {
                          const raw = item.monthlyAmounts[m] || 0;
                          const exGst = calcExGst(raw, item.gstInclusive, item.gstRate);
                          return (
                            <td key={m} className="text-right px-2 font-mono-data text-destructive/80">
                              {exGst > 0 ? fmt(exGst) : "—"}
                            </td>
                          );
                        })}
                        <td className="text-right pl-4 font-mono-data text-destructive">{fmt(itemTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
              <tr className="border-t border-border font-semibold text-destructive">
                <td className="py-1.5 pr-4">Total Operating Expenses</td>
                {months.map(m => <td key={m} className="text-right px-2 font-mono-data">{fmt(calculations.monthlyExpensesExGst[m] || 0)}</td>)}
                <td className="text-right pl-4 font-mono-data font-bold">{fmt(calculations.totalExpenses)}</td>
              </tr>
              <tr className={cn("border-t-2 border-border font-bold text-base", calculations.netProfit >= 0 ? "text-success" : "text-destructive")}>
                <td className="py-2 pr-4">Net Profit</td>
                {months.map(m => <td key={m} className="text-right px-2 font-mono-data">{fmtSigned(calculations.monthlyNetProfit[m] || 0)}</td>)}
                <td className="text-right pl-4 font-mono-data font-bold">{fmtSigned(calculations.netProfit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  /* ─── Expenses Editor ─── */
  const renderExpenses = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">Manage expense categories and monthly amounts. GST is calculated automatically.</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={importFromAccounting} disabled={importingAccounting}>
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", importingAccounting && "animate-spin")} />
            Import from Accounting
          </Button>
          <label className="cursor-pointer">
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleImportCSV} />
            <Button variant="outline" size="sm" asChild>
              <span><Upload className="w-3.5 h-3.5 mr-1.5" /> Import CSV</span>
            </Button>
          </label>
        </div>
      </div>

      {data.categories.map(cat => (
        <Card key={cat.id} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <span>{cat.icon}</span> {cat.name}
              {cat.accountCode && <span className="text-[10px] font-mono-data text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{cat.accountCode}</span>}
              <span className="text-xs font-mono-data text-muted-foreground">({fmt(calculations.categoryTotals[cat.id] || 0)})</span>
            </h3>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAddingToCategory(cat.id)}>
                <Plus className="w-3 h-3 mr-1" /> Add
              </Button>
              {cat.items.length === 0 && !["advertising", "apps", "shipping"].includes(cat.id) && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => removeCategory(cat.id)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>

          {addingToCategory === cat.id && (
            <div className="flex gap-2 mb-3">
              <Input placeholder="Expense name" value={newItemName} onChange={e => setNewItemName(e.target.value)} onKeyDown={e => e.key === "Enter" && addItem(cat.id)} className="h-8 text-sm" autoFocus />
              <Button size="sm" className="h-8" onClick={() => addItem(cat.id)}><Check className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => { setAddingToCategory(null); setNewItemName(""); }}><X className="w-3.5 h-3.5" /></Button>
            </div>
          )}

          {cat.items.length > 0 && (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 pr-2 font-medium min-w-[120px]">Expense</th>
                    <th className="text-center py-1.5 px-1 font-medium w-16">GST</th>
                    {months.map(m => <th key={m} className="text-right py-1.5 px-1 font-medium whitespace-nowrap min-w-[70px]">{monthLabel(m)}</th>)}
                    <th className="text-right py-1.5 pl-2 font-semibold">Ex GST</th>
                    <th className="text-right py-1.5 pl-1 font-semibold text-muted-foreground">GST</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {cat.items.map(item => {
                    const totalRaw = months.reduce((s, m) => s + (item.monthlyAmounts[m] || 0), 0);
                    const totalExGst = calcExGst(totalRaw, item.gstInclusive, item.gstRate);
                    const totalGst = calcGst(totalRaw, item.gstInclusive, item.gstRate);
                    return (
                      <tr key={item.id} className="hover:bg-muted/20">
                        <td className="py-1 pr-2 text-sm truncate max-w-[140px]">{item.name}</td>
                        <td className="text-center px-1">
                          <button
                            onClick={() => toggleGstInclusive(cat.id, item.id)}
                            className={cn("text-[10px] px-1.5 py-0.5 rounded", item.gstRate > 0 ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground")}
                            title={item.gstInclusive ? "Inc GST" : "Ex GST"}
                          >
                            {item.gstRate > 0 ? `${(item.gstRate * 100).toFixed(0)}%` : "Free"}
                          </button>
                        </td>
                        {months.map(m => (
                          <td key={m} className="text-right px-1">
                            <Input type="number" step="0.01" min="0" value={item.monthlyAmounts[m] || ""} onChange={e => updateAmount(cat.id, item.id, m, parseFloat(e.target.value) || 0)} className="h-6 text-xs text-right font-mono-data w-[70px] px-1" placeholder="0.00" />
                          </td>
                        ))}
                        <td className="text-right pl-2 font-mono-data font-semibold text-xs">{fmt(totalExGst)}</td>
                        <td className="text-right pl-1 font-mono-data text-xs text-muted-foreground">{fmt(totalGst)}</td>
                        <td className="text-center">
                          <button onClick={() => removeItem(cat.id, item.id)} className="text-muted-foreground hover:text-destructive p-0.5"><Trash2 className="w-3 h-3" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {cat.items.length === 0 && addingToCategory !== cat.id && (
            <p className="text-xs text-muted-foreground italic">No expenses yet — click "Add" to start tracking</p>
          )}
        </Card>
      ))}

      {addingCategory ? (
        <Card className="p-4">
          <div className="flex gap-2">
            <Input placeholder="Category name, e.g. 'Insurance'" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} onKeyDown={e => e.key === "Enter" && addCategory()} className="h-9" autoFocus />
            <Button onClick={addCategory}><Check className="w-4 h-4" /></Button>
            <Button variant="ghost" onClick={() => { setAddingCategory(false); setNewCategoryName(""); }}><X className="w-4 h-4" /></Button>
          </div>
        </Card>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => setAddingCategory(true)}>
          <Plus className="w-4 h-4 mr-2" /> Add expense category
        </Button>
      )}
    </div>
  );

  /* ─── Revenue Editor ─── */
  const renderRevenue = () => (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Enter monthly revenue including GST collected. The engine splits GST automatically for BAS reporting.
      </p>
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Monthly Revenue</h3>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4 font-semibold min-w-[100px]">Month</th>
                <th className="text-right py-2 px-2 font-semibold min-w-[90px]">Gross Sales</th>
                <th className="text-right py-2 px-2 font-semibold min-w-[90px]">COGS</th>
                <th className="text-right py-2 px-2 font-semibold min-w-[90px]">Shipping</th>
                <th className="text-right py-2 px-2 font-semibold min-w-[90px]">Refunds</th>
                <th className="text-right py-2 px-2 font-semibold min-w-[90px]">GST Collected</th>
                <th className="text-right py-2 pl-4 font-bold">Net Revenue</th>
              </tr>
            </thead>
            <tbody>
              {months.map(m => {
                const rev = data.revenue.find(r => r.month === m) || { month: m, gross: 0, cogs: 0, shipping_collected: 0, refunds: 0, gst_collected: 0 };
                const net = rev.gross + rev.shipping_collected - rev.refunds;
                return (
                  <tr key={m} className="hover:bg-muted/20">
                    <td className="py-1.5 pr-4 font-medium">{monthLabel(m)}</td>
                    <td className="text-right px-2"><Input type="number" step="0.01" min="0" value={rev.gross || ""} onChange={e => updateRevenue(m, "gross", parseFloat(e.target.value) || 0)} className="h-6 text-xs text-right font-mono-data w-[90px] px-1" placeholder="0.00" /></td>
                    <td className="text-right px-2"><Input type="number" step="0.01" min="0" value={rev.cogs || ""} onChange={e => updateRevenue(m, "cogs", parseFloat(e.target.value) || 0)} className="h-6 text-xs text-right font-mono-data w-[90px] px-1" placeholder="0.00" /></td>
                    <td className="text-right px-2"><Input type="number" step="0.01" min="0" value={rev.shipping_collected || ""} onChange={e => updateRevenue(m, "shipping_collected", parseFloat(e.target.value) || 0)} className="h-6 text-xs text-right font-mono-data w-[90px] px-1" placeholder="0.00" /></td>
                    <td className="text-right px-2"><Input type="number" step="0.01" min="0" value={rev.refunds || ""} onChange={e => updateRevenue(m, "refunds", parseFloat(e.target.value) || 0)} className="h-6 text-xs text-right font-mono-data w-[90px] px-1" placeholder="0.00" /></td>
                    <td className="text-right px-2"><Input type="number" step="0.01" min="0" value={rev.gst_collected || ""} onChange={e => updateRevenue(m, "gst_collected", parseFloat(e.target.value) || 0)} className="h-6 text-xs text-right font-mono-data w-[90px] px-1" placeholder="0.00" /></td>
                    <td className="text-right pl-4 font-mono-data font-semibold">{fmt(net)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  /* ─── GST View ─── */
  const renderGst = () => (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Receipt className="w-4 h-4" /> BAS / GST Report
        </h3>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4 font-semibold min-w-[160px]">Item</th>
                {months.map(m => <th key={m} className="text-right py-2 px-2 font-semibold whitespace-nowrap">{monthLabel(m)}</th>)}
                <th className="text-right py-2 pl-4 font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-primary/5">
                <td className="py-1.5 pr-4 font-semibold">GST Collected on Sales</td>
                {months.map(m => <td key={m} className="text-right px-2 font-mono-data">{fmt(calculations.monthlyGstCollected[m] || 0)}</td>)}
                <td className="text-right pl-4 font-mono-data font-bold">{fmt(calculations.totalGstCollected)}</td>
              </tr>
              <tr>
                <td className="py-1.5 pr-4 font-semibold">GST Paid on Expenses</td>
                {months.map(m => <td key={m} className="text-right px-2 font-mono-data">{fmt(calculations.monthlyGstPaid[m] || 0)}</td>)}
                <td className="text-right pl-4 font-mono-data font-bold">{fmt(calculations.totalGstPaid)}</td>
              </tr>
              {data.categories.filter(c => (calculations.categoryGst[c.id] || 0) > 0).map(cat => (
                <tr key={cat.id} className="text-muted-foreground">
                  <td className="py-1 pr-4 pl-6">{cat.icon} {cat.name}</td>
                  {months.map(m => {
                    let catGst = 0;
                    cat.items.forEach(item => { catGst += calcGst(item.monthlyAmounts[m] || 0, item.gstInclusive, item.gstRate); });
                    return <td key={m} className="text-right px-2 font-mono-data">{catGst > 0 ? fmt(catGst) : "—"}</td>;
                  })}
                  <td className="text-right pl-4 font-mono-data">{fmt(calculations.categoryGst[cat.id] || 0)}</td>
                </tr>
              ))}
              <tr className={cn("border-t-2 border-border font-bold", calculations.basOwing >= 0 ? "text-destructive" : "text-success")}>
                <td className="py-2 pr-4">BAS {calculations.basOwing >= 0 ? "Owing" : "Refund"}</td>
                {months.map(m => {
                  const owing = (calculations.monthlyGstCollected[m] || 0) - (calculations.monthlyGstPaid[m] || 0);
                  return <td key={m} className="text-right px-2 font-mono-data">{fmtSigned(owing)}</td>;
                })}
                <td className="text-right pl-4 font-mono-data font-bold">{fmtSigned(calculations.basOwing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-warning" />
          <p className="text-xs text-muted-foreground">
            This is an estimate only. GST amounts depend on correct GST rates being set per expense item.
            Please verify with your accountant before lodging your BAS.
          </p>
        </div>
      </Card>
    </div>
  );

  /* ─── Settings View (Category Mappings) ─── */
  const renderSettings = () => (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">Default GST Rate</h3>
        <div className="flex items-center gap-3">
          <Input
            type="number" step="1" min="0" max="100"
            value={(data.gstRate * 100).toFixed(0)}
            onChange={e => setData(prev => ({ ...prev, gstRate: (parseFloat(e.target.value) || 0) / 100 }))}
            className="h-8 w-20 text-sm"
          />
          <span className="text-sm text-muted-foreground">% — applied to new expense items</span>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Custom Category Mappings</h3>
        <p className="text-xs text-muted-foreground mb-3">
          When importing CSV data, expenses containing these keywords will be auto-assigned to the chosen category.
        </p>

        {data.customMappings.length > 0 && (
          <div className="space-y-2 mb-4">
            {data.customMappings.map((m, idx) => {
              const cat = data.categories.find(c => c.id === m.categoryId);
              return (
                <div key={idx} className="flex items-center gap-2 text-sm">
                  <span className="font-mono-data bg-muted px-2 py-0.5 rounded text-xs">{m.keyword}</span>
                  <span className="text-muted-foreground">→</span>
                  <span>{cat?.icon} {cat?.name || m.categoryId}</span>
                  <button onClick={() => removeMapping(idx)} className="ml-auto text-muted-foreground hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-2">
          <Input placeholder="Keyword, e.g. 'Canva'" value={newMappingKeyword} onChange={e => setNewMappingKeyword(e.target.value)} className="h-8 text-sm flex-1" />
          <select
            value={newMappingCategory}
            onChange={e => setNewMappingCategory(e.target.value)}
            className="h-8 text-sm rounded-md border border-input bg-background px-2"
          >
            <option value="">Category…</option>
            {data.categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
          <Button size="sm" className="h-8" onClick={addMapping} disabled={!newMappingKeyword.trim() || !newMappingCategory}>
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">Reset Data</h3>
        <p className="text-xs text-muted-foreground mb-3">Clear all P&L data and start fresh with default categories.</p>
        <Button variant="destructive" size="sm" onClick={() => {
          if (confirm("Reset all P&L data? This cannot be undone.")) {
            localStorage.removeItem(STORAGE_KEY);
            setData(loadPLData());
            toast.success("P&L data reset");
          }
        }}>
          <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Reset All Data
        </Button>
      </Card>
    </div>
  );

  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold font-display">Profit & Loss</h2>
          <p className="text-xs text-muted-foreground">True P&L with GST-aware calculations — not just product margin</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExportCSV}>
          <Download className="w-3.5 h-3.5 mr-1.5" /> Export
        </Button>
      </div>

      {/* Date Range Picker */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs font-mono-data">{format(dateFrom, "MMM yyyy")}</Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarWidget mode="single" selected={dateFrom} onSelect={d => d && setDateFrom(startOfMonth(d))} className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>
          <span className="text-muted-foreground">to</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs font-mono-data">{format(dateTo, "MMM yyyy")}</Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarWidget mode="single" selected={dateTo} onSelect={d => d && setDateTo(endOfMonth(d))} className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex gap-1 ml-auto">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setDateFrom(subMonths(startOfMonth(new Date()), 2)); setDateTo(endOfMonth(new Date())); }}>3M</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setDateFrom(subMonths(startOfMonth(new Date()), 5)); setDateTo(endOfMonth(new Date())); }}>6M</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setDateFrom(subMonths(startOfMonth(new Date()), 11)); setDateTo(endOfMonth(new Date())); }}>12M</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setDateFrom(new Date(new Date().getFullYear(), 0, 1)); setDateTo(endOfMonth(new Date())); }}>YTD</Button>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border pb-2 overflow-x-auto">
        {([
          { id: "overview", label: "Overview", icon: <BarChart3 className="w-3.5 h-3.5" /> },
          { id: "expenses", label: "Expenses", icon: <DollarSign className="w-3.5 h-3.5" /> },
          { id: "revenue", label: "Revenue", icon: <TrendingUp className="w-3.5 h-3.5" /> },
          { id: "gst", label: "GST / BAS", icon: <Receipt className="w-3.5 h-3.5" /> },
          { id: "settings", label: "Settings", icon: <Settings2 className="w-3.5 h-3.5" /> },
        ] as { id: View; label: string; icon: React.ReactNode }[]).map(tab => (
          <Button key={tab.id} variant={view === tab.id ? "default" : "ghost"} size="sm" className="h-8 text-xs whitespace-nowrap" onClick={() => setView(tab.id)}>
            {tab.icon}
            <span className="ml-1.5">{tab.label}</span>
          </Button>
        ))}
      </div>

      {view === "overview" && renderOverview()}
      {view === "expenses" && renderExpenses()}
      {view === "revenue" && renderRevenue()}
      {view === "gst" && renderGst()}
      {view === "settings" && renderSettings()}
    </div>
  );
};

export default ProfitLossPanel;
