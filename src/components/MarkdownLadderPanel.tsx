import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft, Plus, Trash2, Play, Pause, SkipForward, RotateCcw,
  AlertTriangle, Clock, ShieldAlert, ChevronRight, Loader2, RefreshCw,
  Tag, Sparkles, BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { checkMargin, getMarginSettings } from "@/lib/margin-protection";
import { addAuditEntry } from "@/lib/audit-log";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

interface LadderStage {
  stageNumber: number;
  discountPercent: number;
  triggerDays: number;
}

interface Ladder {
  id: string;
  name: string;
  trigger_type: string;
  selection_type: string;
  selection_value: string;
  stages: LadderStage[];
  status: string;
  auto_rollback: boolean;
  rollback_days: number | null;
  check_frequency: string;
  min_margin_pct: number;
  created_at: string;
}

interface LadderItem {
  id: string;
  ladder_id: string;
  variant_id: string | null;
  product_title: string;
  variant_info: string | null;
  original_price: number;
  current_price: number;
  cost: number | null;
  current_stage: number;
  status: string;
  block_reason: string | null;
  margin_pct: number | null;
  days_since_last_sale: number;
  stage_applied_at: string | null;
}

interface Props { onBack: () => void; }

const statusColors: Record<string, string> = {
  scheduled: "bg-muted text-muted-foreground",
  active: "bg-primary/15 text-primary",
  paused: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  blocked: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  sold_through: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ─── Component ─── */

const MarkdownLadderPanel = ({ onBack }: Props) => {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [ladders, setLadders] = useState<Ladder[]>([]);
  const [ladderItems, setLadderItems] = useState<LadderItem[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Available products from DB
  const [availableProducts, setAvailableProducts] = useState<
    { variantId: string; productTitle: string; vendor: string | null; sku: string | null; color: string | null; size: string | null; retailPrice: number; cost: number; lastSaleAt: string | null; daysSinceLastSale: number }[]
  >([]);

  // Wizard state
  const [newLadder, setNewLadder] = useState({
    name: "",
    trigger_type: "time" as string,
    selection_type: "dead_stock" as string,
    selection_value: "",
    stages: [
      { stageNumber: 1, discountPercent: 20, triggerDays: 30 },
      { stageNumber: 2, discountPercent: 35, triggerDays: 60 },
      { stageNumber: 3, discountPercent: 50, triggerDays: 90 },
    ] as LadderStage[],
    auto_rollback: false,
    rollback_days: 14,
    check_frequency: "daily",
    min_margin_pct: 30,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const [laddersRes, itemsRes, variantsRes, productsRes, salesRes] = await Promise.all([
        supabase.from("markdown_ladders").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("markdown_ladder_items").select("*").eq("user_id", user.id),
        supabase.from("variants").select("id, product_id, sku, color, size, cost, retail_price").eq("user_id", user.id),
        supabase.from("products").select("id, title, vendor").eq("user_id", user.id),
        supabase.from("sales_data").select("variant_id, sold_at, quantity_sold").eq("user_id", user.id).order("sold_at", { ascending: false }),
      ]);

      const ladderData = (laddersRes.data || []).map(l => ({
        ...l,
        stages: (Array.isArray(l.stages) ? l.stages : JSON.parse(l.stages as string || "[]")) as LadderStage[],
      })) as Ladder[];
      setLadders(ladderData);
      setLadderItems((itemsRes.data || []) as LadderItem[]);

      // Build available products with sales data
      const productMap = new Map((productsRes.data || []).map(p => [p.id, p]));
      const salesByVariant = new Map<string, string>();
      for (const s of (salesRes.data || [])) {
        if (!salesByVariant.has(s.variant_id)) {
          salesByVariant.set(s.variant_id, s.sold_at);
        }
      }

      const now = Date.now();
      setAvailableProducts((variantsRes.data || []).map(v => {
        const prod = productMap.get(v.product_id);
        const lastSale = salesByVariant.get(v.id) || null;
        const daysSinceLastSale = lastSale
          ? Math.floor((now - new Date(lastSale).getTime()) / 86400000) : 999;
        return {
          variantId: v.id,
          productTitle: prod?.title || "Unknown",
          vendor: prod?.vendor || null,
          sku: v.sku,
          color: v.color,
          size: v.size,
          retailPrice: Number(v.retail_price) || 0,
          cost: Number(v.cost) || 0,
          lastSaleAt: lastSale,
          daysSinceLastSale,
        };
      }));
    } catch (e) {
      console.error("Load ladders error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ─── Product selection for wizard ─── */

  const selectedProducts = useMemo(() => {
    const { selection_type, selection_value } = newLadder;
    if (selection_type === "dead_stock") {
      return availableProducts.filter(p => p.daysSinceLastSale >= 60 && p.retailPrice > 0);
    }
    if (selection_type === "vendor" && selection_value) {
      return availableProducts.filter(p => p.vendor?.toLowerCase() === selection_value.toLowerCase());
    }
    return availableProducts.filter(p => p.retailPrice > 0);
  }, [newLadder.selection_type, newLadder.selection_value, availableProducts]);

  /* ─── Margin check helper ─── */

  const checkStageMargin = (discountPct: number, price: number, cost: number | null) => {
    if (!cost || cost <= 0 || price <= 0) return { safe: true, maxDiscount: 100 };
    const salePrice = price * (1 - discountPct / 100);
    const result = checkMargin(salePrice, { cost, source: "invoice" });
    const settings = getMarginSettings();
    const maxSafe = Math.floor((1 - (cost / (1 - settings.globalMinMargin / 100)) / price) * 100);
    return { safe: result.status !== "blocked", blocked: result.status === "blocked", maxDiscount: Math.max(0, maxSafe), marginAfter: result.margin_percentage };
  };

  /* ─── Create ladder ─── */

  const createLadder = async () => {
    if (selectedProducts.length === 0) {
      toast.error("No products match this selection");
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Insert ladder
      const { data: ladder, error: ladderErr } = await supabase
        .from("markdown_ladders")
        .insert({
          user_id: user.id,
          name: newLadder.name || `Markdown ${new Date().toLocaleDateString()}`,
          trigger_type: newLadder.trigger_type,
          selection_type: newLadder.selection_type,
          selection_value: newLadder.selection_value,
          stages: newLadder.stages as any,
          status: "active",
          auto_rollback: newLadder.auto_rollback,
          rollback_days: newLadder.auto_rollback ? newLadder.rollback_days : null,
          check_frequency: newLadder.check_frequency,
          min_margin_pct: newLadder.min_margin_pct,
        })
        .select()
        .single();

      if (ladderErr || !ladder) throw ladderErr;

      // Insert items
      const items = selectedProducts.map(p => {
        const margin = p.cost > 0 ? ((p.retailPrice - p.cost) / p.retailPrice) * 100 : null;
        return {
          user_id: user.id,
          ladder_id: ladder.id,
          variant_id: p.variantId,
          product_title: p.productTitle,
          variant_info: [p.color, p.size, p.sku].filter(Boolean).join(" / "),
          original_price: p.retailPrice,
          current_price: p.retailPrice,
          cost: p.cost > 0 ? p.cost : null,
          current_stage: 0,
          status: "active",
          margin_pct: margin,
          days_since_last_sale: p.daysSinceLastSale,
          last_sale_at: p.lastSaleAt,
        };
      });

      const { error: itemsErr } = await supabase
        .from("markdown_ladder_items")
        .insert(items as any);

      if (itemsErr) throw itemsErr;

      addAuditEntry("Markdown", `Created ladder "${ladder.name}" with ${items.length} products, ${newLadder.stages.length} stages`);
      toast.success(`Ladder created with ${items.length} products`);

      setShowWizard(false);
      setWizardStep(0);
      fetchData();
    } catch (e: any) {
      toast.error(e.message || "Failed to create ladder");
    } finally {
      setSaving(false);
    }
  };

  /* ─── Apply next stage ─── */

  const applyNextStage = async (item: LadderItem) => {
    const ladder = ladders.find(l => l.id === item.ladder_id);
    if (!ladder) return;
    const nextStageNum = item.current_stage + 1;
    const stage = ladder.stages.find(s => s.stageNumber === nextStageNum);
    if (!stage) return;

    const newPrice = +(item.original_price * (1 - stage.discountPercent / 100)).toFixed(2);

    // Margin check
    if (item.cost && item.cost > 0) {
      const result = checkMargin(newPrice, { cost: item.cost, source: "invoice" });
      if (result.status === "blocked") {
        await supabase.from("markdown_ladder_items").update({
          status: "blocked",
          block_reason: `Stage ${nextStageNum} (-${stage.discountPercent}%) would breach margin floor. ${result.reason}`,
        }).eq("id", item.id);
        toast.error(`Blocked: margin protection prevents -${stage.discountPercent}%`);
        fetchData();
        return;
      }
    }

    const margin = item.cost && item.cost > 0
      ? ((newPrice - item.cost) / newPrice) * 100 : null;
    const isLast = nextStageNum >= ladder.stages.length;

    await supabase.from("markdown_ladder_items").update({
      current_price: newPrice,
      current_stage: nextStageNum,
      status: isLast ? "completed" : "active",
      margin_pct: margin,
      stage_applied_at: new Date().toISOString(),
      block_reason: null,
    }).eq("id", item.id);

    addAuditEntry("Markdown", `Applied stage ${nextStageNum} (-${stage.discountPercent}%) to ${item.product_title}: ${fmt(item.current_price)} → ${fmt(newPrice)}`);
    toast.success(`Stage ${nextStageNum} applied: ${fmt(newPrice)}`);
    fetchData();
  };

  /* ─── Revert ─── */

  const revertItem = async (item: LadderItem) => {
    await supabase.from("markdown_ladder_items").update({
      current_price: item.original_price,
      current_stage: 0,
      status: "active",
      block_reason: null,
      margin_pct: item.cost && item.cost > 0 ? ((item.original_price - item.cost) / item.original_price) * 100 : null,
    }).eq("id", item.id);
    addAuditEntry("Markdown", `Reverted ${item.product_title} to ${fmt(item.original_price)}`);
    toast.success("Reverted to original price");
    fetchData();
  };

  /* ─── Toggle/delete ladder ─── */

  const toggleLadder = async (id: string) => {
    const ladder = ladders.find(l => l.id === id);
    if (!ladder) return;
    const newStatus = ladder.status === "active" ? "paused" : "active";
    await supabase.from("markdown_ladders").update({ status: newStatus }).eq("id", id);
    toast.info(`Ladder ${newStatus}`);
    fetchData();
  };

  const deleteLadder = async (id: string) => {
    await supabase.from("markdown_ladders").delete().eq("id", id);
    toast.success("Ladder deleted");
    fetchData();
  };

  /* ─── Wizard stage helpers ─── */

  const addStage = () => {
    const stages = [...newLadder.stages];
    const last = stages[stages.length - 1];
    stages.push({
      stageNumber: stages.length + 1,
      discountPercent: Math.min((last?.discountPercent || 20) + 15, 80),
      triggerDays: (last?.triggerDays || 30) + 30,
    });
    setNewLadder({ ...newLadder, stages });
  };

  const removeStage = (idx: number) => {
    const stages = newLadder.stages.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stageNumber: i + 1 }));
    setNewLadder({ ...newLadder, stages });
  };

  const updateStage = (idx: number, field: string, value: number) => {
    const stages = [...newLadder.stages];
    stages[idx] = { ...stages[idx], [field]: value };
    setNewLadder({ ...newLadder, stages });
  };

  /* ─── Stats ─── */

  const activeItems = ladderItems.filter(p => p.status === "active");
  const blockedItems = ladderItems.filter(p => p.status === "blocked");
  const completedItems = ladderItems.filter(p => p.status === "completed" || p.status === "sold_through");
  const totalSavings = ladderItems.reduce((s, p) => s + (p.original_price - p.current_price), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  /* ─── Wizard ─── */

  if (showWizard) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <button onClick={() => setShowWizard(false)} className="flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <h1 className="text-xl font-bold font-display mb-1">Create Markdown Ladder</h1>
        <p className="text-sm text-muted-foreground mb-6">Staged automatic discounts for slow-moving stock</p>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-6">
          {["Select", "Trigger", "Stages", "Review"].map((label, i) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-1">
              <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
                wizardStep >= i ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>{i + 1}</div>
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>

        {/* Step 1: Selection */}
        {wizardStep === 0 && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Ladder name</label>
              <Input value={newLadder.name} onChange={e => setNewLadder({ ...newLadder, name: e.target.value })} placeholder="e.g. Winter clearance 2026" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Apply to</label>
              <Select value={newLadder.selection_type} onValueChange={v => setNewLadder({ ...newLadder, selection_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dead_stock">Dead stock (no sales in 60+ days)</SelectItem>
                  <SelectItem value="vendor">Vendor</SelectItem>
                  <SelectItem value="tag">Products with tag</SelectItem>
                  <SelectItem value="all">All products</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(newLadder.selection_type === "vendor" || newLadder.selection_type === "tag") && (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {newLadder.selection_type === "vendor" ? "Vendor name" : "Tag name"}
                </label>
                <Input value={newLadder.selection_value} onChange={e => setNewLadder({ ...newLadder, selection_value: e.target.value })} />
              </div>
            )}
            <Card className="p-3 bg-muted/50">
              <p className="text-xs text-muted-foreground">
                <strong>{selectedProducts.length}</strong> products match this selection
              </p>
              {selectedProducts.slice(0, 3).map(p => (
                <p key={p.variantId} className="text-xs truncate mt-1">
                  {p.productTitle} — {fmt(p.retailPrice)} — {p.daysSinceLastSale}d since sale
                </p>
              ))}
              {selectedProducts.length > 3 && (
                <p className="text-[10px] text-muted-foreground mt-1">+{selectedProducts.length - 3} more</p>
              )}
            </Card>
            <Button className="w-full" onClick={() => setWizardStep(1)} disabled={selectedProducts.length === 0}>
              Next: Choose trigger <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Step 2: Trigger */}
        {wizardStep === 1 && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Trigger type</label>
              <Select value={newLadder.trigger_type} onValueChange={v => setNewLadder({ ...newLadder, trigger_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="time">Time-based (no sale in X days)</SelectItem>
                  <SelectItem value="inventory">Inventory-based (sell-through rate)</SelectItem>
                  <SelectItem value="combined">Combined (time + inventory)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Card className="p-3 bg-muted/50 text-xs text-muted-foreground">
              {newLadder.trigger_type === "time" && "Products advance to the next stage if they haven't sold within the configured days."}
              {newLadder.trigger_type === "inventory" && "Products advance based on sell-through rate and stock levels."}
              {newLadder.trigger_type === "combined" && "Both time AND inventory conditions must be met."}
            </Card>
            <div>
              <label className="text-sm font-medium mb-1 block">Check frequency</label>
              <Select value={newLadder.check_frequency} onValueChange={v => setNewLadder({ ...newLadder, check_frequency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Minimum margin floor (%)</label>
              <Input type="number" value={newLadder.min_margin_pct} onChange={e => setNewLadder({ ...newLadder, min_margin_pct: parseInt(e.target.value) || 0 })} />
              <p className="text-[10px] text-muted-foreground mt-1">Stages that breach this margin will be blocked automatically.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setWizardStep(0)}>Back</Button>
              <Button className="flex-1" onClick={() => setWizardStep(2)}>Next: Set stages <ChevronRight className="w-4 h-4 ml-1" /></Button>
            </div>
          </div>
        )}

        {/* Step 3: Stages */}
        {wizardStep === 2 && (
          <div className="space-y-4">
            {newLadder.stages.map((stage, idx) => {
              const sampleCost = selectedProducts.length > 0 ? selectedProducts[0].cost : 0;
              const samplePrice = selectedProducts.length > 0 ? selectedProducts[0].retailPrice : 100;
              const marginCheck = sampleCost > 0 ? checkStageMargin(stage.discountPercent, samplePrice, sampleCost) : null;

              return (
                <Card key={idx} className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold">Stage {stage.stageNumber}</span>
                    {newLadder.stages.length > 1 && (
                      <button onClick={() => removeStage(idx)} className="text-destructive hover:text-destructive/80">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground">Discount %</label>
                      <Input type="number" value={stage.discountPercent} onChange={e => updateStage(idx, "discountPercent", parseInt(e.target.value) || 0)} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">After days without sale</label>
                      <Input type="number" value={stage.triggerDays} onChange={e => updateStage(idx, "triggerDays", parseInt(e.target.value) || 0)} />
                    </div>
                  </div>
                  {marginCheck?.blocked && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-destructive">
                      <ShieldAlert className="w-3 h-3" /> {stage.discountPercent}% discount breaches margin. Max safe: {marginCheck.maxDiscount}%
                    </div>
                  )}
                </Card>
              );
            })}
            <Button variant="outline" className="w-full" onClick={addStage}>
              <Plus className="w-4 h-4 mr-1" /> Add stage
            </Button>

            <div className="flex items-center gap-3 bg-muted/50 rounded-lg p-3">
              <Switch checked={newLadder.auto_rollback} onCheckedChange={v => setNewLadder({ ...newLadder, auto_rollback: v })} />
              <div>
                <p className="text-sm font-medium">Auto-rollback</p>
                <p className="text-xs text-muted-foreground">Revert to original price after ladder completes</p>
              </div>
            </div>

            {newLadder.auto_rollback && (
              <div>
                <label className="text-xs text-muted-foreground">Rollback after (days from final stage)</label>
                <Input type="number" value={newLadder.rollback_days} onChange={e => setNewLadder({ ...newLadder, rollback_days: parseInt(e.target.value) || 14 })} />
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setWizardStep(1)}>Back</Button>
              <Button className="flex-1" onClick={() => setWizardStep(3)}>Next: Review & Activate <ChevronRight className="w-4 h-4 ml-1" /></Button>
            </div>
          </div>
        )}

        {/* Step 4: Review & Activate */}
        {wizardStep === 3 && (
          <div className="space-y-4">
            <Card className="p-4 space-y-3">
              <h3 className="font-semibold text-sm">Ladder Summary</h3>
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <span className="text-muted-foreground">Name:</span><span className="font-medium">{newLadder.name || "Untitled"}</span>
                <span className="text-muted-foreground">Products:</span><span className="font-medium">{selectedProducts.length}</span>
                <span className="text-muted-foreground">Trigger:</span><span className="font-medium">{newLadder.trigger_type}</span>
                <span className="text-muted-foreground">Stages:</span><span className="font-medium">{newLadder.stages.length}</span>
                <span className="text-muted-foreground">Frequency:</span><span className="font-medium">{newLadder.check_frequency}</span>
                <span className="text-muted-foreground">Min margin:</span><span className="font-medium">{newLadder.min_margin_pct}%</span>
                <span className="text-muted-foreground">Auto-rollback:</span><span className="font-medium">{newLadder.auto_rollback ? `${newLadder.rollback_days}d` : "No"}</span>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold text-sm mb-2">Discount Schedule</h3>
              {newLadder.stages.map(s => (
                <div key={s.stageNumber} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                  <Badge variant="outline" className="text-xs">Stage {s.stageNumber}</Badge>
                  <span className="text-sm font-medium text-destructive">-{s.discountPercent}%</span>
                  <span className="text-xs text-muted-foreground flex-1">after {s.triggerDays} days</span>
                </div>
              ))}
            </Card>

            <Card className="p-3 border-l-4 border-l-yellow-500">
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert className="w-4 h-4 text-yellow-600" />
                <span className="text-sm font-medium">Margin protection active</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Stages that would push margin below {newLadder.min_margin_pct}% will be blocked automatically.
              </p>
            </Card>

            <Card className="p-3">
              <p className="text-xs font-medium mb-2">Products ({selectedProducts.length})</p>
              {selectedProducts.slice(0, 5).map(p => (
                <div key={p.variantId} className="flex items-center justify-between py-1 text-xs">
                  <span className="truncate flex-1">{p.productTitle}</span>
                  <span className="font-mono text-muted-foreground">{fmt(p.retailPrice)}</span>
                </div>
              ))}
              {selectedProducts.length > 5 && <p className="text-[10px] text-muted-foreground mt-1">+{selectedProducts.length - 5} more</p>}
            </Card>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setWizardStep(2)}>Back</Button>
              <Button className="flex-1" onClick={createLadder} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Play className="w-4 h-4 mr-1" />}
                Activate Ladder
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ─── Main View ─── */

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold font-display flex items-center gap-2">
            <Tag className="w-5 h-5 text-primary" /> Markdown Ladders
          </h1>
          <p className="text-sm text-muted-foreground">Automated staged discounts for slow-moving stock</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={fetchData}><RefreshCw className="w-4 h-4" /></Button>
          <Button size="sm" onClick={() => { setShowWizard(true); setWizardStep(0); }}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full mb-4">
          <TabsTrigger value="dashboard" className="flex-1 text-xs">Dashboard</TabsTrigger>
          <TabsTrigger value="products" className="flex-1 text-xs">
            Products
            {blockedItems.length > 0 && <Badge variant="destructive" className="ml-1 text-[9px] px-1">{blockedItems.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* Dashboard */}
        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Active", value: activeItems.length, color: "text-primary" },
              { label: "Blocked", value: blockedItems.length, color: "text-destructive" },
              { label: "Done", value: completedItems.length, color: "text-green-600" },
              { label: "Ladders", value: ladders.length, color: "text-foreground" },
            ].map(s => (
              <Card key={s.label} className="p-3 text-center">
                <p className={cn("text-lg font-bold font-mono", s.color)}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </Card>
            ))}
          </div>

          {ladders.length === 0 ? (
            <Card className="p-8 text-center">
              <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold mb-1">No ladders yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first markdown ladder to automatically clear slow-moving stock.
              </p>
              <Button onClick={() => { setShowWizard(true); setWizardStep(0); }}>
                <Plus className="w-4 h-4 mr-1" /> Create ladder
              </Button>
            </Card>
          ) : (
            ladders.map(ladder => {
              const items = ladderItems.filter(p => p.ladder_id === ladder.id);
              const active = items.filter(p => p.status === "active").length;
              const blocked = items.filter(p => p.status === "blocked").length;
              const completed = items.filter(p => p.status === "completed" || p.status === "sold_through").length;
              const progress = items.length > 0 ? Math.round((completed / items.length) * 100) : 0;
              const stages = ladder.stages as LadderStage[];

              return (
                <Card key={ladder.id} className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{ladder.name}</h3>
                      <Badge className={cn("text-[10px]", statusColors[ladder.status])}>{ladder.status}</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => toggleLadder(ladder.id)} className="p-1.5 rounded hover:bg-muted" title={ladder.status === "active" ? "Pause" : "Resume"}>
                        {ladder.status === "active" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <button onClick={() => deleteLadder(ladder.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                    <span>{items.length} products</span>
                    <span>{stages.length} stages</span>
                    <span>{ladder.check_frequency}</span>
                    <span>Min {ladder.min_margin_pct}% margin</span>
                  </div>

                  <div className="flex items-center gap-3 text-xs mb-2">
                    <span className="text-primary">{active} active</span>
                    {blocked > 0 && <span className="text-destructive">{blocked} blocked</span>}
                    <span className="text-green-600">{completed} done</span>
                  </div>

                  <Progress value={progress} className="h-1.5" />
                  <p className="text-[10px] text-muted-foreground mt-1">{progress}% clearance progress</p>

                  <div className="flex gap-1 mt-3 flex-wrap">
                    {stages.map(s => (
                      <Badge key={s.stageNumber} variant="outline" className="text-[10px]">
                        -{s.discountPercent}% @ {s.triggerDays}d
                      </Badge>
                    ))}
                  </div>
                </Card>
              );
            })
          )}

          {/* Automation info */}
          <Card className="p-4 bg-primary/5 border-primary/20">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-primary shrink-0" />
              <div>
                <p className="text-sm font-semibold">Automated Processing</p>
                <p className="text-xs text-muted-foreground">
                  Active ladders are processed automatically. Products advance to the next discount stage
                  when they exceed the trigger days without a sale. Margin protection blocks any stage
                  that would breach your minimum margin.
                </p>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Products */}
        <TabsContent value="products" className="space-y-2">
          {ladderItems.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-sm text-muted-foreground">No products in any ladder yet.</p>
            </Card>
          ) : (
            ladderItems.map(item => {
              const ladder = ladders.find(l => l.id === item.ladder_id);
              const stages = ladder?.stages as LadderStage[] | undefined;
              const discountPct = item.original_price > 0
                ? Math.round((1 - item.current_price / item.original_price) * 100) : 0;

              return (
                <Card key={item.id} className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium truncate flex-1 mr-2">{item.product_title}</span>
                    <Badge className={cn("text-[10px]", statusColors[item.status])}>{item.status}</Badge>
                  </div>
                  {item.variant_info && (
                    <p className="text-[10px] text-muted-foreground mb-2">{item.variant_info}</p>
                  )}
                  <div className="grid grid-cols-4 gap-2 text-xs mb-2">
                    <div>
                      <p className="text-muted-foreground">Original</p>
                      <p className="font-mono">{fmt(item.original_price)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Current</p>
                      <p className={cn("font-mono", discountPct > 0 && "text-destructive")}>
                        {fmt(item.current_price)}
                        {discountPct > 0 && <span className="text-[10px]"> (-{discountPct}%)</span>}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Stage</p>
                      <p className="font-mono">{item.current_stage}/{stages?.length || "?"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Margin</p>
                      <p className={cn("font-mono",
                        (item.margin_pct || 0) < 30 ? "text-destructive" : "text-green-600"
                      )}>
                        {item.margin_pct != null ? `${item.margin_pct.toFixed(0)}%` : "—"}
                      </p>
                    </div>
                  </div>

                  {item.block_reason && (
                    <div className="flex items-center gap-1 text-xs text-destructive mb-2">
                      <ShieldAlert className="w-3 h-3" /> {item.block_reason}
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <Clock className="w-3 h-3" /> {item.days_since_last_sale}d since last sale
                  </div>

                  <div className="flex gap-1">
                    {item.status === "active" && item.current_stage < (stages?.length || 0) && (
                      <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => applyNextStage(item)}>
                        <SkipForward className="w-3 h-3 mr-1" /> Apply next
                      </Button>
                    )}
                    {item.current_stage > 0 && (
                      <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => revertItem(item)}>
                        <RotateCcw className="w-3 h-3 mr-1" /> Revert
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MarkdownLadderPanel;
