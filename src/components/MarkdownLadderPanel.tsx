import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Plus, Trash2, Play, Pause, SkipForward, RotateCcw, AlertTriangle, CheckCircle, Clock, ShieldAlert, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { checkMargin, getMarginSettings } from "@/lib/margin-protection";
import { addAuditEntry } from "@/lib/audit-log";

interface MarkdownLadderPanelProps {
  onBack: () => void;
}

interface LadderStage {
  stageNumber: number;
  discountPercent: number;
  triggerDays: number;
  minStockCondition: number | null;
  pauseIfSoldRecently: boolean;
}

interface Ladder {
  id: string;
  name: string;
  triggerType: "time" | "inventory" | "combined";
  selectionType: "products" | "collection" | "vendor" | "tag" | "dead_stock";
  selectionValue: string;
  stages: LadderStage[];
  status: "scheduled" | "active" | "paused" | "completed";
  createdAt: string;
  autoRollback: boolean;
  rollbackDays: number | null;
  checkFrequency: "daily" | "weekly";
}

interface ProductLadderState {
  productId: string;
  title: string;
  handle: string;
  originalPrice: number;
  currentPrice: number;
  cost: number | null;
  currentStage: number;
  nextStage: number | null;
  nextTriggerDate: string | null;
  status: "scheduled" | "active" | "paused" | "completed" | "blocked" | "sold_through";
  marginPercentage: number | null;
  blocked: boolean;
  blockReason: string;
  daysSinceLastSale: number;
  ladderId: string;
}

const LADDERS_KEY = "markdown_ladders";
const LADDER_PRODUCTS_KEY = "markdown_ladder_products";
const LADDER_AUDIT_KEY = "markdown_ladder_audit";

function getLadders(): Ladder[] {
  try { return JSON.parse(localStorage.getItem(LADDERS_KEY) || "[]"); } catch { return []; }
}
function saveLadders(l: Ladder[]) { localStorage.setItem(LADDERS_KEY, JSON.stringify(l)); }

function getLadderProducts(): ProductLadderState[] {
  try { return JSON.parse(localStorage.getItem(LADDER_PRODUCTS_KEY) || "[]"); } catch { return []; }
}
function saveLadderProducts(p: ProductLadderState[]) { localStorage.setItem(LADDER_PRODUCTS_KEY, JSON.stringify(p)); }

function getLadderAudit(): any[] {
  try { return JSON.parse(localStorage.getItem(LADDER_AUDIT_KEY) || "[]"); } catch { return []; }
}
function addLadderAudit(entry: any) {
  const log = getLadderAudit();
  log.unshift({ ...entry, timestamp: new Date().toISOString() });
  if (log.length > 500) log.length = 500;
  localStorage.setItem(LADDER_AUDIT_KEY, JSON.stringify(log));
}

const statusColors: Record<string, string> = {
  scheduled: "bg-muted text-muted-foreground",
  active: "bg-primary/15 text-primary",
  paused: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  blocked: "bg-destructive/15 text-destructive",
  sold_through: "bg-success/15 text-success",
};

const MarkdownLadderPanel = ({ onBack }: MarkdownLadderPanelProps) => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [ladders, setLadders] = useState<Ladder[]>(getLadders());
  const [ladderProducts, setLadderProducts] = useState<ProductLadderState[]>(getLadderProducts());
  const [wizardStep, setWizardStep] = useState(0);
  const [showWizard, setShowWizard] = useState(false);

  // Wizard state
  const [newLadder, setNewLadder] = useState<Partial<Ladder>>({
    name: "",
    triggerType: "time",
    selectionType: "tag",
    selectionValue: "",
    stages: [
      { stageNumber: 1, discountPercent: 20, triggerDays: 30, minStockCondition: null, pauseIfSoldRecently: false },
      { stageNumber: 2, discountPercent: 35, triggerDays: 60, minStockCondition: null, pauseIfSoldRecently: false },
      { stageNumber: 3, discountPercent: 50, triggerDays: 90, minStockCondition: null, pauseIfSoldRecently: false },
    ],
    autoRollback: false,
    rollbackDays: null,
    checkFrequency: "daily",
  });

  useEffect(() => { saveLadders(ladders); }, [ladders]);
  useEffect(() => { saveLadderProducts(ladderProducts); }, [ladderProducts]);

  // Demo products for preview
  const getDemoProducts = (): ProductLadderState[] => {
    const lines = JSON.parse(localStorage.getItem("last_lines") || "[]");
    if (lines.length === 0) {
      return [
        { productId: "demo-1", title: "Seafolly Active Bikini Top", handle: "seafolly-active-bikini", originalPrice: 89.95, currentPrice: 89.95, cost: 36, currentStage: 0, nextStage: 1, nextTriggerDate: null, status: "scheduled", marginPercentage: 60, blocked: false, blockReason: "", daysSinceLastSale: 45, ladderId: "" },
        { productId: "demo-2", title: "Tigerlily Wrap Dress", handle: "tigerlily-wrap-dress", originalPrice: 229, currentPrice: 229, cost: 92, currentStage: 0, nextStage: 1, nextTriggerDate: null, status: "scheduled", marginPercentage: 60, blocked: false, blockReason: "", daysSinceLastSale: 60, ladderId: "" },
        { productId: "demo-3", title: "Funkita Training Jammer", handle: "funkita-training-jammer", originalPrice: 59.95, currentPrice: 59.95, cost: 28, currentStage: 0, nextStage: 1, nextTriggerDate: null, status: "scheduled", marginPercentage: 53, blocked: false, blockReason: "", daysSinceLastSale: 38, ladderId: "" },
      ];
    }
    return lines.slice(0, 10).map((l: any, i: number) => ({
      productId: `line-${i}`,
      title: l.title || l.product_title || `Product ${i + 1}`,
      handle: (l.handle || l.title || "").toLowerCase().replace(/\s+/g, "-"),
      originalPrice: parseFloat(l.price || l.retail || "0") || 79.95,
      currentPrice: parseFloat(l.price || l.retail || "0") || 79.95,
      cost: parseFloat(l.cost || "0") || null,
      currentStage: 0,
      nextStage: 1,
      nextTriggerDate: null,
      status: "scheduled" as const,
      marginPercentage: null,
      blocked: false,
      blockReason: "",
      daysSinceLastSale: Math.floor(Math.random() * 90) + 15,
      ladderId: "",
    }));
  };

  const addStage = () => {
    const stages = [...(newLadder.stages || [])];
    const lastStage = stages[stages.length - 1];
    stages.push({
      stageNumber: stages.length + 1,
      discountPercent: Math.min((lastStage?.discountPercent || 20) + 15, 80),
      triggerDays: (lastStage?.triggerDays || 30) + 30,
      minStockCondition: null,
      pauseIfSoldRecently: false,
    });
    setNewLadder({ ...newLadder, stages });
  };

  const removeStage = (idx: number) => {
    const stages = (newLadder.stages || []).filter((_, i) => i !== idx).map((s, i) => ({ ...s, stageNumber: i + 1 }));
    setNewLadder({ ...newLadder, stages });
  };

  const updateStage = (idx: number, field: string, value: any) => {
    const stages = [...(newLadder.stages || [])];
    stages[idx] = { ...stages[idx], [field]: value };
    setNewLadder({ ...newLadder, stages });
  };

  const checkStageMarginSafety = (stage: LadderStage, price: number, cost: number | null) => {
    if (!cost || cost <= 0) return { safe: true, maxDiscount: 100, reason: "No cost data" };
    const salePrice = price * (1 - stage.discountPercent / 100);
    const result = checkMargin(salePrice, cost, "invoice");
    const settings = getMarginSettings();
    const maxSafeDiscount = Math.floor((1 - (cost / (1 - settings.globalMinMargin / 100)) / price) * 100);
    return {
      safe: result.status === "safe" || result.status === "warning",
      blocked: result.status === "blocked",
      maxDiscount: Math.max(0, maxSafeDiscount),
      reason: result.reason,
      marginAfter: result.margin_percentage,
    };
  };

  const createLadder = () => {
    const ladder: Ladder = {
      id: `ladder-${Date.now()}`,
      name: newLadder.name || `Markdown ${new Date().toLocaleDateString()}`,
      triggerType: newLadder.triggerType || "time",
      selectionType: newLadder.selectionType || "tag",
      selectionValue: newLadder.selectionValue || "",
      stages: newLadder.stages || [],
      status: "active",
      createdAt: new Date().toISOString(),
      autoRollback: newLadder.autoRollback || false,
      rollbackDays: newLadder.rollbackDays || null,
      checkFrequency: newLadder.checkFrequency || "daily",
    };

    const products = getDemoProducts().map(p => ({ ...p, ladderId: ladder.id, status: "active" as const }));

    setLadders([...ladders, ladder]);
    setLadderProducts([...ladderProducts, ...products]);

    addAuditEntry("Markdown", `Created ladder "${ladder.name}" with ${ladder.stages.length} stages, ${products.length} products`);
    addLadderAudit({ action: "ladder_created", ladderName: ladder.name, productCount: products.length, stages: ladder.stages.length });

    toast.success(`Ladder "${ladder.name}" created with ${products.length} products`);
    setShowWizard(false);
    setWizardStep(0);
    setActiveTab("dashboard");
  };

  const toggleLadder = (id: string) => {
    setLadders(ladders.map(l => {
      if (l.id !== id) return l;
      const newStatus = l.status === "active" ? "paused" : "active";
      addLadderAudit({ action: newStatus === "paused" ? "ladder_paused" : "ladder_resumed", ladderName: l.name });
      toast.info(`Ladder "${l.name}" ${newStatus}`);
      return { ...l, status: newStatus };
    }));
  };

  const applyNextStage = (productId: string) => {
    setLadderProducts(ladderProducts.map(p => {
      if (p.productId !== productId) return p;
      const ladder = ladders.find(l => l.id === p.ladderId);
      if (!ladder) return p;
      const nextStage = ladder.stages.find(s => s.stageNumber === (p.currentStage + 1));
      if (!nextStage) return { ...p, status: "completed" };

      const newPrice = +(p.originalPrice * (1 - nextStage.discountPercent / 100)).toFixed(2);
      const marginCheck = p.cost ? checkMargin(newPrice, p.cost, "invoice") : null;

      if (marginCheck?.status === "blocked") {
        toast.error(`Blocked: ${p.title} — markdown would breach minimum margin`);
        return { ...p, blocked: true, blockReason: marginCheck.reason, status: "blocked" };
      }

      addLadderAudit({
        action: "stage_applied",
        product: p.title,
        ladderName: ladder.name,
        oldPrice: p.currentPrice,
        newPrice,
        discountPercent: nextStage.discountPercent,
        stage: nextStage.stageNumber,
        marginBefore: p.marginPercentage,
        marginAfter: marginCheck?.margin_percentage,
      });

      const isLast = nextStage.stageNumber === ladder.stages.length;
      return {
        ...p,
        currentPrice: newPrice,
        currentStage: nextStage.stageNumber,
        nextStage: isLast ? null : nextStage.stageNumber + 1,
        status: isLast ? "completed" : "active",
        marginPercentage: marginCheck?.margin_percentage ?? p.marginPercentage,
      };
    }));
    toast.success("Stage applied");
  };

  const revertProduct = (productId: string) => {
    setLadderProducts(ladderProducts.map(p => {
      if (p.productId !== productId) return p;
      addLadderAudit({ action: "reverted", product: p.title, from: p.currentPrice, to: p.originalPrice });
      return { ...p, currentPrice: p.originalPrice, currentStage: 0, nextStage: 1, status: "scheduled", blocked: false, blockReason: "" };
    }));
    toast.success("Reverted to original price");
  };

  const removeLadder = (id: string) => {
    const ladder = ladders.find(l => l.id === id);
    setLadders(ladders.filter(l => l.id !== id));
    setLadderProducts(ladderProducts.filter(p => p.ladderId !== id));
    if (ladder) toast.success(`Removed ladder "${ladder.name}"`);
  };

  // Summary stats
  const activeProducts = ladderProducts.filter(p => p.status === "active");
  const blockedProducts = ladderProducts.filter(p => p.status === "blocked");
  const completedProducts = ladderProducts.filter(p => p.status === "completed" || p.status === "sold_through");

  if (showWizard) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <button onClick={() => setShowWizard(false)} className="flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <h1 className="text-xl font-bold font-display mb-1">Create markdown ladder</h1>
        <p className="text-sm text-muted-foreground mb-6">Staged automatic discounts for slow-moving stock</p>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-6">
          {["Select", "Trigger", "Stages", "Review", "Activate"].map((label, i) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${wizardStep >= i ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}</div>
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>

        {/* Step 1: Select products */}
        {wizardStep === 0 && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Ladder name</label>
              <Input value={newLadder.name || ""} onChange={e => setNewLadder({ ...newLadder, name: e.target.value })} placeholder="e.g. Winter clearance 2026" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Apply to</label>
              <Select value={newLadder.selectionType} onValueChange={v => setNewLadder({ ...newLadder, selectionType: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tag">Products with tag</SelectItem>
                  <SelectItem value="vendor">Vendor</SelectItem>
                  <SelectItem value="collection">Collection</SelectItem>
                  <SelectItem value="dead_stock">Dead stock (red score)</SelectItem>
                  <SelectItem value="products">Selected products</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newLadder.selectionType !== "dead_stock" && (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {newLadder.selectionType === "tag" ? "Tag name" : newLadder.selectionType === "vendor" ? "Vendor name" : newLadder.selectionType === "collection" ? "Collection name" : "Product handles (comma-separated)"}
                </label>
                <Input value={newLadder.selectionValue || ""} onChange={e => setNewLadder({ ...newLadder, selectionValue: e.target.value })} placeholder={newLadder.selectionType === "tag" ? "e.g. sale-ladder" : newLadder.selectionType === "vendor" ? "e.g. Alemais" : "e.g. Winter Dresses"} />
              </div>
            )}
            <Button className="w-full" onClick={() => setWizardStep(1)}>Next: Choose trigger <ChevronRight className="w-4 h-4 ml-1" /></Button>
          </div>
        )}

        {/* Step 2: Trigger */}
        {wizardStep === 1 && (
          <div className="space-y-4">
            <label className="text-sm font-medium mb-1 block">Trigger type</label>
            <Select value={newLadder.triggerType} onValueChange={v => setNewLadder({ ...newLadder, triggerType: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="time">Time-based (no sale in X days)</SelectItem>
                <SelectItem value="inventory">Inventory health (low sell-through)</SelectItem>
                <SelectItem value="combined">Combined (time + inventory)</SelectItem>
              </SelectContent>
            </Select>
            <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
              {newLadder.triggerType === "time" && "Products will advance to the next markdown stage if they haven't sold within the configured number of days."}
              {newLadder.triggerType === "inventory" && "Products will advance based on sell-through rate and stock levels relative to sales velocity."}
              {newLadder.triggerType === "combined" && "Products must meet both time AND inventory conditions to advance."}
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Check frequency</label>
              <Select value={newLadder.checkFrequency} onValueChange={v => setNewLadder({ ...newLadder, checkFrequency: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
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
            {(newLadder.stages || []).map((stage, idx) => (
              <div key={idx} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold">Stage {stage.stageNumber}</span>
                  {(newLadder.stages || []).length > 1 && (
                    <button onClick={() => removeStage(idx)} className="text-destructive hover:text-destructive/80"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Discount %</label>
                    <Input type="number" value={stage.discountPercent} onChange={e => updateStage(idx, "discountPercent", parseInt(e.target.value) || 0)} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">After days</label>
                    <Input type="number" value={stage.triggerDays} onChange={e => updateStage(idx, "triggerDays", parseInt(e.target.value) || 0)} />
                  </div>
                </div>
                {/* Margin safety preview */}
                {(() => {
                  const check = checkStageMarginSafety(stage, 100, 40);
                  return check.blocked ? (
                    <div className="mt-2 flex items-center gap-1 text-xs text-destructive">
                      <ShieldAlert className="w-3 h-3" /> {stage.discountPercent}% discount may breach margin. Max safe: {check.maxDiscount}%
                    </div>
                  ) : null;
                })()}
              </div>
            ))}
            <Button variant="outline" className="w-full" onClick={addStage}><Plus className="w-4 h-4 mr-1" /> Add stage</Button>

            <div className="flex items-center gap-3 bg-muted/50 rounded-lg p-3">
              <Switch checked={newLadder.autoRollback || false} onCheckedChange={v => setNewLadder({ ...newLadder, autoRollback: v })} />
              <div>
                <p className="text-sm font-medium">Auto-rollback</p>
                <p className="text-xs text-muted-foreground">Revert to original price after ladder completes</p>
              </div>
            </div>

            {newLadder.autoRollback && (
              <div>
                <label className="text-xs text-muted-foreground">Rollback after (days from final stage)</label>
                <Input type="number" value={newLadder.rollbackDays || 14} onChange={e => setNewLadder({ ...newLadder, rollbackDays: parseInt(e.target.value) || 14 })} />
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setWizardStep(1)}>Back</Button>
              <Button className="flex-1" onClick={() => setWizardStep(3)}>Next: Review <ChevronRight className="w-4 h-4 ml-1" /></Button>
            </div>
          </div>
        )}

        {/* Step 4: Review */}
        {wizardStep === 3 && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-sm">Ladder summary</h3>
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <span className="text-muted-foreground">Name:</span><span className="font-medium">{newLadder.name || "Untitled"}</span>
                <span className="text-muted-foreground">Apply to:</span><span className="font-medium">{newLadder.selectionType} = {newLadder.selectionValue || "all"}</span>
                <span className="text-muted-foreground">Trigger:</span><span className="font-medium">{newLadder.triggerType}</span>
                <span className="text-muted-foreground">Stages:</span><span className="font-medium">{(newLadder.stages || []).length}</span>
                <span className="text-muted-foreground">Frequency:</span><span className="font-medium">{newLadder.checkFrequency}</span>
                <span className="text-muted-foreground">Auto-rollback:</span><span className="font-medium">{newLadder.autoRollback ? `Yes (${newLadder.rollbackDays || 14}d)` : "No"}</span>
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="font-semibold text-sm mb-2">Stage schedule</h3>
              {(newLadder.stages || []).map(s => (
                <div key={s.stageNumber} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                  <Badge variant="outline" className="text-xs">Stage {s.stageNumber}</Badge>
                  <span className="text-sm font-medium text-destructive">-{s.discountPercent}%</span>
                  <span className="text-xs text-muted-foreground flex-1">after {s.triggerDays} days</span>
                </div>
              ))}
            </div>

            {/* Bulk safety preview */}
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-warning" />
                <span className="text-sm font-medium">Margin protection active</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Products will be checked against your minimum margin threshold before each stage is applied.
                Any stage that would breach the margin floor will be blocked automatically.
              </p>
            </div>

            <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">📢 Google Shopping note</p>
              Markdown ladders use sale pricing visible to Google Shopping. Discounts appear as compare-at pricing, not discount codes.
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setWizardStep(2)}>Back</Button>
              <Button className="flex-1" onClick={() => setWizardStep(4)}>Next: Activate <ChevronRight className="w-4 h-4 ml-1" /></Button>
            </div>
          </div>
        )}

        {/* Step 5: Activate */}
        {wizardStep === 4 && (
          <div className="space-y-4 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-primary/15 flex items-center justify-center">
              <Play className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-lg font-bold">Ready to activate</h2>
            <p className="text-sm text-muted-foreground">
              {getDemoProducts().length} products will enter the markdown ladder.
              The system will check {newLadder.checkFrequency === "daily" ? "every day" : "every week"} and apply stages automatically.
            </p>

            <div className="bg-card border border-border rounded-lg p-3 text-left">
              <p className="text-xs font-medium mb-2">Products affected:</p>
              {getDemoProducts().slice(0, 5).map((p, i) => (
                <div key={i} className="flex items-center justify-between py-1 text-xs">
                  <span className="truncate flex-1">{p.title}</span>
                  <span className="font-mono-data text-muted-foreground">${p.originalPrice}</span>
                </div>
              ))}
              {getDemoProducts().length > 5 && <p className="text-xs text-muted-foreground mt-1">+{getDemoProducts().length - 5} more</p>}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setWizardStep(3)}>Back</Button>
              <Button className="flex-1 bg-primary text-primary-foreground" onClick={createLadder}>
                Activate ladder <Play className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-4 hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold font-display">Markdown Ladders</h1>
          <p className="text-sm text-muted-foreground">Automated staged discounts for slow-moving stock</p>
        </div>
        <Button size="sm" onClick={() => { setShowWizard(true); setWizardStep(0); }}>
          <Plus className="w-4 h-4 mr-1" /> New ladder
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full mb-4">
          <TabsTrigger value="dashboard" className="flex-1 text-xs">Dashboard</TabsTrigger>
          <TabsTrigger value="products" className="flex-1 text-xs">Products</TabsTrigger>
          <TabsTrigger value="audit" className="flex-1 text-xs">Audit log</TabsTrigger>
        </TabsList>

        {/* Dashboard */}
        <TabsContent value="dashboard" className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Active", value: activeProducts.length, color: "text-primary" },
              { label: "Blocked", value: blockedProducts.length, color: "text-destructive" },
              { label: "Completed", value: completedProducts.length, color: "text-success" },
              { label: "Ladders", value: ladders.length, color: "text-foreground" },
            ].map(s => (
              <div key={s.label} className="bg-card border border-border rounded-lg p-3 text-center">
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          {ladders.length === 0 ? (
            <div className="text-center py-12 bg-card border border-border rounded-lg">
              <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold mb-1">No ladders yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Create your first markdown ladder to start clearing slow stock automatically.</p>
              <Button onClick={() => { setShowWizard(true); setWizardStep(0); }}>
                <Plus className="w-4 h-4 mr-1" /> Create ladder
              </Button>
            </div>
          ) : (
            ladders.map(ladder => {
              const lProducts = ladderProducts.filter(p => p.ladderId === ladder.id);
              const lActive = lProducts.filter(p => p.status === "active").length;
              const lBlocked = lProducts.filter(p => p.status === "blocked").length;
              const lCompleted = lProducts.filter(p => p.status === "completed" || p.status === "sold_through").length;
              const progress = lProducts.length > 0 ? Math.round((lCompleted / lProducts.length) * 100) : 0;

              return (
                <div key={ladder.id} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{ladder.name}</h3>
                      <Badge className={`text-[10px] ${statusColors[ladder.status]}`}>{ladder.status}</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => toggleLadder(ladder.id)} className="p-1.5 rounded hover:bg-muted" title={ladder.status === "active" ? "Pause" : "Resume"}>
                        {ladder.status === "active" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <button onClick={() => removeLadder(ladder.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                    <span>{lProducts.length} products</span>
                    <span>{ladder.stages.length} stages</span>
                    <span>{ladder.checkFrequency}</span>
                  </div>

                  <div className="flex items-center gap-3 text-xs mb-2">
                    <span className="text-primary">{lActive} active</span>
                    {lBlocked > 0 && <span className="text-destructive">{lBlocked} blocked</span>}
                    <span className="text-success">{lCompleted} done</span>
                  </div>

                  <Progress value={progress} className="h-1.5" />
                  <p className="text-[10px] text-muted-foreground mt-1">{progress}% clearance progress</p>

                  <div className="flex gap-1 mt-3">
                    {ladder.stages.map(s => (
                      <Badge key={s.stageNumber} variant="outline" className="text-[10px]">-{s.discountPercent}% @ {s.triggerDays}d</Badge>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </TabsContent>

        {/* Products tab */}
        <TabsContent value="products" className="space-y-2">
          {ladderProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No products in any ladder yet.</p>
          ) : (
            ladderProducts.map(p => {
              const ladder = ladders.find(l => l.id === p.ladderId);
              return (
                <div key={p.productId} className="bg-card border border-border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium truncate flex-1 mr-2">{p.title}</span>
                    <Badge className={`text-[10px] ${statusColors[p.status]}`}>{p.status}</Badge>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs mb-2">
                    <div>
                      <p className="text-muted-foreground">Original</p>
                      <p className="font-mono-data">${p.originalPrice}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Current</p>
                      <p className={`font-mono-data ${p.currentPrice < p.originalPrice ? "text-destructive" : ""}`}>${p.currentPrice}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Stage</p>
                      <p className="font-mono-data">{p.currentStage}/{ladder?.stages.length || "?"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Margin</p>
                      <p className={`font-mono-data ${(p.marginPercentage || 0) < 30 ? "text-destructive" : "text-success"}`}>
                        {p.marginPercentage != null ? `${p.marginPercentage}%` : "—"}
                      </p>
                    </div>
                  </div>

                  {p.blocked && (
                    <div className="flex items-center gap-1 text-xs text-destructive mb-2">
                      <ShieldAlert className="w-3 h-3" /> {p.blockReason}
                    </div>
                  )}

                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                    <Clock className="w-3 h-3" /> {p.daysSinceLastSale}d since last sale
                  </div>

                  <div className="flex gap-1">
                    {p.status === "active" && p.nextStage && (
                      <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => applyNextStage(p.productId)}>
                        <SkipForward className="w-3 h-3 mr-1" /> Apply next
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => revertProduct(p.productId)}>
                      <RotateCcw className="w-3 h-3 mr-1" /> Revert
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </TabsContent>

        {/* Audit tab */}
        <TabsContent value="audit" className="space-y-1">
          {getLadderAudit().length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No audit entries yet.</p>
          ) : (
            getLadderAudit().slice(0, 50).map((entry, i) => (
              <div key={i} className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
                <Badge variant="outline" className="text-[10px] shrink-0">{entry.action}</Badge>
                <span className="text-xs flex-1 truncate">
                  {entry.product || entry.ladderName || ""}
                  {entry.oldPrice != null && ` $${entry.oldPrice} → $${entry.newPrice}`}
                  {entry.discountPercent != null && ` (-${entry.discountPercent}%)`}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono-data shrink-0">
                  {new Date(entry.timestamp).toLocaleDateString()}
                </span>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MarkdownLadderPanel;
