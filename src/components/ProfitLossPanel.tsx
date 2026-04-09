import { useState, useEffect, useMemo } from "react";
import {
  ChevronLeft, Plus, Trash2, Upload, Download, TrendingUp, TrendingDown,
  DollarSign, BarChart3, Calendar, Edit2, Check, X, FileSpreadsheet
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, LineChart, Line
} from "recharts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarWidget } from "@/components/ui/calendar";
import { format, startOfMonth, endOfMonth, eachMonthOfInterval, isWithinInterval, subMonths } from "date-fns";
import { cn } from "@/lib/utils";
import Papa from "papaparse";

/* ─── Types ─── */
interface ExpenseCategory {
  id: string;
  name: string;
  icon: string;
  items: ExpenseItem[];
}

interface ExpenseItem {
  id: string;
  name: string;
  type: "fixed" | "variable" | "one-off";
  monthlyAmounts: Record<string, number>; // "2024-01" → amount
}

interface RevenueEntry {
  month: string; // "2024-01"
  gross: number;
  cogs: number;
  shipping_collected: number;
  refunds: number;
}

interface PLData {
  categories: ExpenseCategory[];
  revenue: RevenueEntry[];
  currency: string;
  updatedAt: string;
}

/* ─── Default expense categories based on Splash Swimwear P&L ─── */
const DEFAULT_CATEGORIES: ExpenseCategory[] = [
  {
    id: "advertising",
    name: "Advertising & Marketing",
    icon: "📢",
    items: [
      { id: "google_ads", name: "Google Advertising", type: "variable", monthlyAmounts: {} },
      { id: "facebook_ads", name: "Facebook / Meta Advertising", type: "variable", monthlyAmounts: {} },
      { id: "microsoft_ads", name: "Microsoft Advertising", type: "variable", monthlyAmounts: {} },
    ],
  },
  {
    id: "apps",
    name: "App Subscriptions",
    icon: "📱",
    items: [
      { id: "shopify_fees", name: "Shopify Fees", type: "fixed", monthlyAmounts: {} },
      { id: "post_co", name: "Post Co App", type: "fixed", monthlyAmounts: {} },
      { id: "growave", name: "Growave", type: "fixed", monthlyAmounts: {} },
      { id: "simprosys", name: "Simprosys", type: "fixed", monthlyAmounts: {} },
      { id: "auto_currency", name: "Auto Currency", type: "fixed", monthlyAmounts: {} },
      { id: "image_zoom", name: "Image Zoom", type: "fixed", monthlyAmounts: {} },
      { id: "multi_label", name: "Multi Label App", type: "fixed", monthlyAmounts: {} },
      { id: "linktree", name: "Linktree", type: "fixed", monthlyAmounts: {} },
    ],
  },
  {
    id: "shipping",
    name: "Shipping & Postage",
    icon: "📦",
    items: [
      { id: "postage", name: "Postage / Shipping Costs", type: "variable", monthlyAmounts: {} },
      { id: "australia_post", name: "Australia Post Account", type: "fixed", monthlyAmounts: {} },
    ],
  },
  {
    id: "staff",
    name: "Staff & Wages",
    icon: "👥",
    items: [],
  },
  {
    id: "rent",
    name: "Rent & Utilities",
    icon: "🏪",
    items: [],
  },
  {
    id: "other",
    name: "Other Expenses",
    icon: "📋",
    items: [],
  },
];

/* ─── Storage ─── */
const STORAGE_KEY = "pl_dashboard_data";

function loadPLData(): PLData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { categories: DEFAULT_CATEGORIES, revenue: [], currency: "AUD", updatedAt: new Date().toISOString() };
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

interface Props {
  onBack: () => void;
}

type View = "overview" | "expenses" | "revenue" | "import";

const ProfitLossPanel = ({ onBack }: Props) => {
  const [data, setData] = useState<PLData>(loadPLData);
  const [view, setView] = useState<View>("overview");
  const [dateFrom, setDateFrom] = useState<Date>(() => subMonths(startOfMonth(new Date()), 11));
  const [dateTo, setDateTo] = useState<Date>(() => endOfMonth(new Date()));
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);

  // Save on change
  useEffect(() => { savePLData(data); }, [data]);

  // Generate month range
  const months = useMemo(() => {
    const start = startOfMonth(dateFrom);
    const end = startOfMonth(dateTo);
    return eachMonthOfInterval({ start, end }).map(d => monthKey(d));
  }, [dateFrom, dateTo]);

  // Calculate totals
  const calculations = useMemo(() => {
    const monthlyExpenses: Record<string, number> = {};
    const monthlyRevenue: Record<string, number> = {};
    const monthlyCOGS: Record<string, number> = {};
    const monthlyGrossProfit: Record<string, number> = {};
    const monthlyNetProfit: Record<string, number> = {};
    const categoryTotals: Record<string, number> = {};

    months.forEach(m => {
      let totalExp = 0;
      data.categories.forEach(cat => {
        let catTotal = 0;
        cat.items.forEach(item => {
          const amt = item.monthlyAmounts[m] || 0;
          totalExp += amt;
          catTotal += amt;
        });
        categoryTotals[cat.id] = (categoryTotals[cat.id] || 0) + catTotal;
      });
      monthlyExpenses[m] = totalExp;

      const rev = data.revenue.find(r => r.month === m);
      const gross = rev?.gross || 0;
      const cogs = rev?.cogs || 0;
      const shippingCollected = rev?.shipping_collected || 0;
      const refunds = rev?.refunds || 0;
      monthlyRevenue[m] = gross + shippingCollected - refunds;
      monthlyCOGS[m] = cogs;
      monthlyGrossProfit[m] = monthlyRevenue[m] - cogs;
      monthlyNetProfit[m] = monthlyGrossProfit[m] - totalExp;
    });

    const totalRevenue = Object.values(monthlyRevenue).reduce((s, v) => s + v, 0);
    const totalCOGS = Object.values(monthlyCOGS).reduce((s, v) => s + v, 0);
    const totalExpenses = Object.values(monthlyExpenses).reduce((s, v) => s + v, 0);
    const grossProfit = totalRevenue - totalCOGS;
    const netProfit = grossProfit - totalExpenses;
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    return {
      monthlyExpenses, monthlyRevenue, monthlyCOGS, monthlyGrossProfit, monthlyNetProfit,
      categoryTotals, totalRevenue, totalCOGS, totalExpenses, grossProfit, netProfit, profitMargin,
    };
  }, [data, months]);

  // Chart data
  const chartData = useMemo(() =>
    months.map(m => ({
      month: monthLabel(m),
      revenue: calculations.monthlyRevenue[m] || 0,
      expenses: calculations.monthlyExpenses[m] || 0,
      cogs: calculations.monthlyCOGS[m] || 0,
      grossProfit: calculations.monthlyGrossProfit[m] || 0,
      netProfit: calculations.monthlyNetProfit[m] || 0,
    })),
    [months, calculations]
  );

  // ── Expense item CRUD ──
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

  const addItem = (catId: string) => {
    if (!newItemName.trim()) return;
    const id = newItemName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    setData(prev => ({
      ...prev,
      categories: prev.categories.map(c => c.id === catId ? {
        ...c,
        items: [...c.items, { id, name: newItemName.trim(), type: "fixed", monthlyAmounts: {} }]
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
      categories: [...prev.categories, { id, name: newCategoryName.trim(), icon: "📋", items: [] }]
    }));
    setNewCategoryName("");
    setAddingCategory(false);
  };

  const removeCategory = (catId: string) => {
    setData(prev => ({ ...prev, categories: prev.categories.filter(c => c.id !== catId) }));
  };

  // ── Revenue CRUD ──
  const updateRevenue = (month: string, field: keyof RevenueEntry, value: number) => {
    setData(prev => {
      const existing = prev.revenue.find(r => r.month === month);
      if (existing) {
        return {
          ...prev,
          revenue: prev.revenue.map(r => r.month === month ? { ...r, [field]: value } : r)
        };
      }
      return {
        ...prev,
        revenue: [...prev.revenue, { month, gross: 0, cogs: 0, shipping_collected: 0, refunds: 0, [field]: value }]
      };
    });
  };

  // ── Import CSV ──
  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: false,
      complete: (results) => {
        const rows = results.data as string[][];
        if (rows.length < 3) return;

        // Try to detect month headers in row index 2 (0-based)
        const headerRow = rows.find(r => r.some(cell => cell && /\d{4}/.test(String(cell))));
        if (!headerRow) return;

        // Find month columns
        const monthCols: { col: number; key: string }[] = [];
        headerRow.forEach((cell, col) => {
          if (!cell) return;
          const d = new Date(cell);
          if (!isNaN(d.getTime())) {
            monthCols.push({ col, key: monthKey(d) });
          }
        });

        // Parse expense rows
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

          // Find or create item in matching category
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
            // AI classify into category
            const category = classifyExpense(name);
            const targetCat = newCategories.find(c => c.id === category) || otherCat;
            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30);
            targetCat.items.push({ id, name, type: "fixed", monthlyAmounts: amounts });
          }
        });

        setData(prev => ({ ...prev, categories: newCategories }));
      }
    });
    e.target.value = "";
  };

  // ── AI expense classifier ──
  function classifyExpense(name: string): string {
    const lower = name.toLowerCase();
    if (/advertis|ads|google|facebook|meta|microsoft|bing|tiktok|marketing|campaign|promo/i.test(lower)) return "advertising";
    if (/app|shopify|plugin|subscription|saas|software|simprosys|growave|linktree|currency|zoom|label/i.test(lower)) return "apps";
    if (/post|ship|freight|delivery|courier|auspost|sendle|aramex|dhl|ups|fedex/i.test(lower)) return "shipping";
    if (/wage|salary|staff|employee|super|payroll|worker|casual/i.test(lower)) return "staff";
    if (/rent|lease|power|electric|water|internet|phone|utility|insurance/i.test(lower)) return "rent";
    return "other";
  }

  // ── Export P&L CSV ──
  const handleExportCSV = () => {
    const header = ["Category", "Expense", ...months.map(monthLabel), "Total"];
    const rows: string[][] = [];

    data.categories.forEach(cat => {
      cat.items.forEach(item => {
        const total = months.reduce((s, m) => s + (item.monthlyAmounts[m] || 0), 0);
        rows.push([
          cat.name, item.name,
          ...months.map(m => (item.monthlyAmounts[m] || 0).toFixed(2)),
          total.toFixed(2)
        ]);
      });
    });

    // Add revenue rows
    rows.push([]);
    rows.push(["REVENUE", "Gross Sales", ...months.map(m => {
      const r = data.revenue.find(rv => rv.month === m);
      return (r?.gross || 0).toFixed(2);
    }), calculations.totalRevenue.toFixed(2)]);
    rows.push(["", "COGS", ...months.map(m => (calculations.monthlyCOGS[m] || 0).toFixed(2)), calculations.totalCOGS.toFixed(2)]);
    rows.push(["", "Total Expenses", ...months.map(m => (calculations.monthlyExpenses[m] || 0).toFixed(2)), calculations.totalExpenses.toFixed(2)]);
    rows.push(["", "Net Profit", ...months.map(m => (calculations.monthlyNetProfit[m] || 0).toFixed(2)), calculations.netProfit.toFixed(2)]);

    const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `profit_loss_${format(dateFrom, "yyyyMM")}_${format(dateTo, "yyyyMM")}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Overview View ───
  const renderOverview = () => (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Revenue</p>
          <p className="text-lg font-bold font-mono-data text-primary">{fmt(calculations.totalRevenue)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">COGS</p>
          <p className="text-lg font-bold font-mono-data text-warning">{fmt(calculations.totalCOGS)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total Expenses</p>
          <p className="text-lg font-bold font-mono-data text-destructive">{fmt(calculations.totalExpenses)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Net Profit</p>
          <div className="flex items-center gap-1.5">
            {calculations.netProfit >= 0
              ? <TrendingUp className="w-4 h-4 text-success" />
              : <TrendingDown className="w-4 h-4 text-destructive" />}
            <p className={cn("text-lg font-bold font-mono-data", calculations.netProfit >= 0 ? "text-success" : "text-destructive")}>
              {fmtSigned(calculations.netProfit)}
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">{calculations.profitMargin.toFixed(1)}% margin</p>
        </Card>
      </div>

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

      {/* Expense Breakdown by Category */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Expense Breakdown</h3>
        <div className="space-y-2">
          {data.categories
            .filter(cat => (calculations.categoryTotals[cat.id] || 0) > 0)
            .sort((a, b) => (calculations.categoryTotals[b.id] || 0) - (calculations.categoryTotals[a.id] || 0))
            .map(cat => {
              const total = calculations.categoryTotals[cat.id] || 0;
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
                    <p className="text-[10px] text-muted-foreground mt-0.5">{pct.toFixed(1)}% of total expenses</p>
                  </div>
                </div>
              );
            })}
        </div>
      </Card>

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
              {/* Revenue */}
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

              {/* Expenses by category */}
              {data.categories.map(cat => (
                <>
                  <tr key={cat.id} className="bg-muted/30">
                    <td className="py-1.5 pr-4 font-semibold" colSpan={months.length + 2}>
                      {cat.icon} {cat.name}
                    </td>
                  </tr>
                  {cat.items.map(item => (
                    <tr key={item.id} className="hover:bg-muted/20">
                      <td className="py-1 pr-4 pl-6 text-muted-foreground">{item.name}</td>
                      {months.map(m => (
                        <td key={m} className="text-right px-2 font-mono-data text-destructive/80">
                          {(item.monthlyAmounts[m] || 0) > 0 ? fmt(item.monthlyAmounts[m]) : "—"}
                        </td>
                      ))}
                      <td className="text-right pl-4 font-mono-data text-destructive">
                        {fmt(months.reduce((s, m) => s + (item.monthlyAmounts[m] || 0), 0))}
                      </td>
                    </tr>
                  ))}
                </>
              ))}

              {/* Total Expenses */}
              <tr className="border-t border-border font-semibold text-destructive">
                <td className="py-1.5 pr-4">Total Expenses</td>
                {months.map(m => <td key={m} className="text-right px-2 font-mono-data">{fmt(calculations.monthlyExpenses[m] || 0)}</td>)}
                <td className="text-right pl-4 font-mono-data font-bold">{fmt(calculations.totalExpenses)}</td>
              </tr>

              {/* Net Profit */}
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

  // ─── Expenses Editor ───
  const renderExpenses = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Add, edit, or remove expense line items. Amounts are per month.</p>
        <label className="cursor-pointer">
          <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleImportCSV} />
          <Button variant="outline" size="sm" asChild>
            <span><Upload className="w-3.5 h-3.5 mr-1.5" /> Import from CSV</span>
          </Button>
        </label>
      </div>

      {data.categories.map(cat => (
        <Card key={cat.id} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <span>{cat.icon}</span> {cat.name}
              <span className="text-xs font-mono-data text-muted-foreground">
                ({fmt(calculations.categoryTotals[cat.id] || 0)})
              </span>
            </h3>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAddingToCategory(cat.id)}>
                <Plus className="w-3 h-3 mr-1" /> Add item
              </Button>
              {cat.items.length === 0 && !["advertising", "apps", "shipping"].includes(cat.id) && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => removeCategory(cat.id)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              )}
            </div>
          </div>

          {/* Add item form */}
          {addingToCategory === cat.id && (
            <div className="flex gap-2 mb-3">
              <Input
                placeholder="Expense name, e.g. 'Canva Pro'"
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addItem(cat.id)}
                className="h-8 text-sm"
                autoFocus
              />
              <Button size="sm" className="h-8" onClick={() => addItem(cat.id)}><Check className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => { setAddingToCategory(null); setNewItemName(""); }}><X className="w-3.5 h-3.5" /></Button>
            </div>
          )}

          {/* Items table */}
          {cat.items.length > 0 && (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 pr-2 font-medium min-w-[120px]">Expense</th>
                    {months.map(m => <th key={m} className="text-right py-1.5 px-1 font-medium whitespace-nowrap min-w-[70px]">{monthLabel(m)}</th>)}
                    <th className="text-right py-1.5 pl-2 font-semibold">Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {cat.items.map(item => (
                    <tr key={item.id} className="hover:bg-muted/20">
                      <td className="py-1 pr-2 text-sm truncate max-w-[140px]">{item.name}</td>
                      {months.map(m => (
                        <td key={m} className="text-right px-1">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.monthlyAmounts[m] || ""}
                            onChange={e => updateAmount(cat.id, item.id, m, parseFloat(e.target.value) || 0)}
                            className="h-6 text-xs text-right font-mono-data w-[70px] px-1"
                            placeholder="0.00"
                          />
                        </td>
                      ))}
                      <td className="text-right pl-2 font-mono-data font-semibold text-xs">
                        {fmt(months.reduce((s, m) => s + (item.monthlyAmounts[m] || 0), 0))}
                      </td>
                      <td className="text-center">
                        <button onClick={() => removeItem(cat.id, item.id)} className="text-muted-foreground hover:text-destructive p-0.5">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {cat.items.length === 0 && addingToCategory !== cat.id && (
            <p className="text-xs text-muted-foreground italic">No expenses yet — click "Add item" to start tracking</p>
          )}
        </Card>
      ))}

      {/* Add new category */}
      {addingCategory ? (
        <Card className="p-4">
          <div className="flex gap-2">
            <Input
              placeholder="Category name, e.g. 'Insurance'"
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addCategory()}
              className="h-9"
              autoFocus
            />
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

  // ─── Revenue Editor ───
  const renderRevenue = () => (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Enter your monthly revenue from Shopify or your POS. Include gross sales, cost of goods sold (COGS),
        shipping collected, and refunds.
      </p>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Monthly Revenue</h3>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4 font-semibold min-w-[100px]">Month</th>
                <th className="text-right py-2 px-2 font-semibold min-w-[100px]">Gross Sales</th>
                <th className="text-right py-2 px-2 font-semibold min-w-[100px]">COGS</th>
                <th className="text-right py-2 px-2 font-semibold min-w-[100px]">Shipping Collected</th>
                <th className="text-right py-2 px-2 font-semibold min-w-[100px]">Refunds</th>
                <th className="text-right py-2 pl-4 font-bold">Net Revenue</th>
              </tr>
            </thead>
            <tbody>
              {months.map(m => {
                const rev = data.revenue.find(r => r.month === m) || { month: m, gross: 0, cogs: 0, shipping_collected: 0, refunds: 0 };
                const net = rev.gross + rev.shipping_collected - rev.refunds;
                return (
                  <tr key={m} className="hover:bg-muted/20">
                    <td className="py-1.5 pr-4 font-medium">{monthLabel(m)}</td>
                    <td className="text-right px-2">
                      <Input type="number" step="0.01" min="0" value={rev.gross || ""} onChange={e => updateRevenue(m, "gross", parseFloat(e.target.value) || 0)} className="h-6 text-xs text-right font-mono-data w-[100px] px-1" placeholder="0.00" />
                    </td>
                    <td className="text-right px-2">
                      <Input type="number" step="0.01" min="0" value={rev.cogs || ""} onChange={e => updateRevenue(m, "cogs", parseFloat(e.target.value) || 0)} className="h-6 text-xs text-right font-mono-data w-[100px] px-1" placeholder="0.00" />
                    </td>
                    <td className="text-right px-2">
                      <Input type="number" step="0.01" min="0" value={rev.shipping_collected || ""} onChange={e => updateRevenue(m, "shipping_collected", parseFloat(e.target.value) || 0)} className="h-6 text-xs text-right font-mono-data w-[100px] px-1" placeholder="0.00" />
                    </td>
                    <td className="text-right px-2">
                      <Input type="number" step="0.01" min="0" value={rev.refunds || ""} onChange={e => updateRevenue(m, "refunds", parseFloat(e.target.value) || 0)} className="h-6 text-xs text-right font-mono-data w-[100px] px-1" placeholder="0.00" />
                    </td>
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

  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold font-display">Profit & Loss</h2>
          <p className="text-xs text-muted-foreground">True P&L with all expenses — not just product margin</p>
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
              <Button variant="outline" size="sm" className="h-8 text-xs font-mono-data">
                {format(dateFrom, "MMM yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarWidget mode="single" selected={dateFrom} onSelect={d => d && setDateFrom(startOfMonth(d))} className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>
          <span className="text-muted-foreground">to</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs font-mono-data">
                {format(dateTo, "MMM yyyy")}
              </Button>
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
      <div className="flex gap-1 mb-4 border-b border-border pb-2">
        {([
          { id: "overview", label: "Overview", icon: <BarChart3 className="w-3.5 h-3.5" /> },
          { id: "expenses", label: "Expenses", icon: <DollarSign className="w-3.5 h-3.5" /> },
          { id: "revenue", label: "Revenue", icon: <TrendingUp className="w-3.5 h-3.5" /> },
        ] as { id: View; label: string; icon: React.ReactNode }[]).map(tab => (
          <Button
            key={tab.id}
            variant={view === tab.id ? "default" : "ghost"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setView(tab.id)}
          >
            {tab.icon}
            <span className="ml-1.5">{tab.label}</span>
          </Button>
        ))}
      </div>

      {/* Content */}
      {view === "overview" && renderOverview()}
      {view === "expenses" && renderExpenses()}
      {view === "revenue" && renderRevenue()}
    </div>
  );
};

export default ProfitLossPanel;
