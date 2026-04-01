import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  ArrowLeft, ArrowRight, ChevronRight, Check, AlertTriangle, Zap,
  BarChart3, ShoppingBag, Rocket, TrendingUp, Target, Copy, ExternalLink,
  Shield, DollarSign, Eye, Search, Image, Video, Users, X
} from "lucide-react";

const STORAGE_KEY = "skuPilot_googleAdsSetup";

interface SetupState {
  step: number;
  business: {
    sells: string;
    bestSellers: string;
    avgPrice: string;
    cost: string;
    targetCustomer: string;
  };
  accountChecklist: boolean[];
  campaign: {
    location: string;
    budget: string;
    selectedProducts: boolean[];
    keywords: string[];
    negativeKeywords: string[];
  };
  ads: {
    headlines: string[];
    description: string;
  };
  tracking: {
    roas: number;
    spend: number;
    revenue: number;
    conversions: number;
  };
  weeklyChecklist: boolean[];
  shoppingUnlocked: boolean;
  pmaxChecklist: boolean[];
  scalingBudget: string;
  scalingChecklist: boolean[];
}

const defaultState: SetupState = {
  step: 0,
  business: { sells: "", bestSellers: "", avgPrice: "", cost: "", targetCustomer: "" },
  accountChecklist: [false, false, false, false, false],
  campaign: {
    location: "Australia",
    budget: "30",
    selectedProducts: [true, true, false],
    keywords: [
      '"buy rashguard australia"',
      "[rashguard long sleeve]",
      '"upf swimwear women"',
      '"sun protection clothing"',
      "[swim shirts australia]",
    ],
    negativeKeywords: ["free", "cheap", "used", "DIY", "jobs"],
  },
  ads: {
    headlines: [
      "UPF 50+ Rashguards Australia",
      "Free Shipping Over $75",
      "500+ 5-Star Reviews",
    ],
    description: "Shop premium sun protection swimwear. Australian owned. Free returns on all orders.",
  },
  tracking: { roas: 3.2, spend: 420, revenue: 1344, conversions: 18 },
  weeklyChecklist: [false, false, false, false],
  shoppingUnlocked: false,
  pmaxChecklist: [false, false, false],
  scalingBudget: "50",
  scalingChecklist: [false, false],
};

const loadState = (): SetupState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultState, ...JSON.parse(raw) };
  } catch {}
  return { ...defaultState };
};

const saveState = (s: SetupState) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
};

interface Props {
  onBack: () => void;
}

const ACCOUNT_ITEMS = [
  { label: "Google Ads account created", guide: "Go to ads.google.com → Click 'Start now' → Follow the prompts to create a new account. Use your business email." },
  { label: "Google Merchant Center created", guide: "Go to merchants.google.com → Sign in → Enter your store details, website URL, and business information." },
  { label: "Merchant Center linked to Google Ads", guide: "In Merchant Center → Settings → Linked accounts → Find your Google Ads ID and click 'Link'." },
  { label: "Conversion tracking installed", guide: "In Google Ads → Tools → Conversions → New conversion action → Website → Set to 'Purchase' → Install the global site tag + event snippet on your checkout confirmation page." },
  { label: "Test purchase recorded", guide: "Place a test order on your store. Within 24 hours you should see '1 conversion' recorded in Google Ads → Tools → Conversions." },
];

const WEEKLY_ITEMS = [
  "Add negative keywords from search terms report",
  "Pause keywords that spent $50+ with no sales",
  "Test new ad copy variation",
  "Check and improve landing page speed",
];

const SUGGESTED_PRODUCTS = ["Rashguard UPF50+", "Swim Shorts – Tropical", "Sun Hat – Wide Brim"];

const GoogleAdsSetupWizard = ({ onBack }: Props) => {
  const [state, setState] = useState<SetupState>(loadState);
  const [guideModal, setGuideModal] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { saveState(state); }, [state]);

  const update = (patch: Partial<SetupState>) => setState(prev => ({ ...prev, ...patch }));
  const setStep = (step: number) => update({ step });

  const margin = state.business.avgPrice && state.business.cost
    ? Math.round(((parseFloat(state.business.avgPrice) - parseFloat(state.business.cost)) / parseFloat(state.business.avgPrice)) * 100)
    : null;

  const conversionTrackingDone = state.accountChecklist[3];
  const hasConversions = state.tracking.conversions > 0;
  const totalSteps = 10;
  const progress = Math.round((state.step / (totalSteps - 1)) * 100);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── SCREEN 0: Onboarding ───
  const renderOnboarding = () => (
    <div className="flex flex-col items-center text-center px-4 py-12 max-w-lg mx-auto animate-fade-in">
      <div className="w-20 h-20 rounded-2xl bg-primary/15 flex items-center justify-center mb-6">
        <Target className="w-10 h-10 text-primary" />
      </div>
      <h1 className="text-2xl font-bold font-display mb-2">Let's set up your Google Ads properly</h1>
      <p className="text-muted-foreground mb-8">We'll guide you from zero → profitable campaigns</p>
      <div className="space-y-3 text-left w-full mb-8">
        {[
          { icon: "⏱", text: "Takes ~20–30 minutes" },
          { icon: "💰", text: "Avoid wasting ad spend" },
          { icon: "🧠", text: "Built for Shopify stores" },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-3 bg-card rounded-lg border border-border p-3">
            <span className="text-lg">{item.icon}</span>
            <span className="text-sm font-medium">{item.text}</span>
          </div>
        ))}
      </div>
      <Button variant="teal" className="w-full h-12 text-base" onClick={() => setStep(1)}>
        Start Setup <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );

  // ─── SCREEN 1: Business Check ───
  const renderBusinessCheck = () => (
    <div className="px-4 py-6 max-w-lg mx-auto animate-fade-in">
      <h2 className="text-xl font-bold font-display mb-1">Before we run ads</h2>
      <p className="text-sm text-muted-foreground mb-6">Tell us about your business so we can recommend the right products and strategy.</p>
      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">What do you sell?</label>
          <Input value={state.business.sells} onChange={e => update({ business: { ...state.business, sells: e.target.value } })} placeholder="e.g. Women's swimwear & resort wear" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Best-selling products</label>
          <Input value={state.business.bestSellers} onChange={e => update({ business: { ...state.business, bestSellers: e.target.value } })} placeholder="e.g. Rashguards, Bikini sets, Sun hats" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Average product price ($)</label>
            <Input type="number" value={state.business.avgPrice} onChange={e => update({ business: { ...state.business, avgPrice: e.target.value } })} placeholder="89" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Average cost ($, optional)</label>
            <Input type="number" value={state.business.cost} onChange={e => update({ business: { ...state.business, cost: e.target.value } })} placeholder="45" />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Target customer</label>
          <Input value={state.business.targetCustomer} onChange={e => update({ business: { ...state.business, targetCustomer: e.target.value } })} placeholder="e.g. Women 25-55 in tropical Australia" />
        </div>
      </div>

      {margin !== null && !isNaN(margin) && (
        <div className={`mt-6 rounded-lg p-4 border ${margin >= 40 ? "bg-success/10 border-success/30" : margin >= 30 ? "bg-secondary/10 border-secondary/30" : "bg-destructive/10 border-destructive/30"}`}>
          <p className="text-sm font-semibold mb-1">⚠️ Margin check</p>
          <p className="text-sm">Your margin is <span className="font-bold">{margin}%</span> → {margin >= 40 ? "Great for ads ✅" : margin >= 30 ? "Borderline — aim for 40–60%" : "Too low for profitable ads"}</p>
          {state.business.bestSellers && (
            <div className="mt-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">✅ Recommended products to advertise:</p>
              {state.business.bestSellers.split(",").map((p, i) => (
                <p key={i} className="text-xs ml-2">• {p.trim()}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <Button variant="teal" className="w-full h-12 text-base mt-6" onClick={() => setStep(2)} disabled={!state.business.sells}>
        Continue to Setup <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );

  // ─── SCREEN 2: Account Setup Tracker ───
  const renderAccountSetup = () => {
    const completedCount = state.accountChecklist.filter(Boolean).length;
    return (
      <div className="px-4 py-6 max-w-lg mx-auto animate-fade-in">
        <h2 className="text-xl font-bold font-display mb-1">Connect your Google ecosystem</h2>
        <p className="text-sm text-muted-foreground mb-2">{completedCount}/{ACCOUNT_ITEMS.length} completed</p>
        <Progress value={(completedCount / ACCOUNT_ITEMS.length) * 100} className="h-2 mb-6" />

        <div className="space-y-2">
          {ACCOUNT_ITEMS.map((item, i) => (
            <div key={i} className="bg-card rounded-lg border border-border p-3 flex items-start gap-3">
              <Checkbox
                checked={state.accountChecklist[i]}
                onCheckedChange={(v) => {
                  const next = [...state.accountChecklist];
                  next[i] = !!v;
                  update({ accountChecklist: next });
                }}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${state.accountChecklist[i] ? "line-through text-muted-foreground" : ""}`}>{item.label}</p>
                <button onClick={() => setGuideModal(i)} className="text-xs text-primary hover:underline mt-1">
                  How to do this →
                </button>
              </div>
              {state.accountChecklist[i] && <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />}
            </div>
          ))}
        </div>

        {!conversionTrackingDone && (
          <div className="mt-4 bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive font-medium">You cannot continue without conversion tracking. Complete step 4 first.</p>
          </div>
        )}

        <div className="flex gap-2 mt-6">
          <a href="https://ads.google.com" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm"><ExternalLink className="w-3 h-3 mr-1" /> Google Ads</Button>
          </a>
          <a href="https://merchants.google.com" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm"><ExternalLink className="w-3 h-3 mr-1" /> Merchant Center</Button>
          </a>
          <a href="https://tagmanager.google.com" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm"><ExternalLink className="w-3 h-3 mr-1" /> Tag Manager</Button>
          </a>
        </div>

        <Button variant="teal" className="w-full h-12 text-base mt-6" onClick={() => setStep(3)} disabled={!conversionTrackingDone}>
          Continue <ArrowRight className="w-4 h-4 ml-1" />
        </Button>

        {/* Guide modal */}
        <Dialog open={guideModal !== null} onOpenChange={() => setGuideModal(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-base">{guideModal !== null ? ACCOUNT_ITEMS[guideModal].label : ""}</DialogTitle>
              <DialogDescription className="text-sm mt-2 leading-relaxed whitespace-pre-line">
                {guideModal !== null ? ACCOUNT_ITEMS[guideModal].guide : ""}
              </DialogDescription>
            </DialogHeader>
            <Button variant="teal" className="mt-2" onClick={() => {
              if (guideModal !== null) {
                const next = [...state.accountChecklist];
                next[guideModal] = true;
                update({ accountChecklist: next });
              }
              setGuideModal(null);
            }}>
              Mark as done <Check className="w-4 h-4 ml-1" />
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    );
  };

  // ─── SCREEN 3: First Campaign Setup ───
  const renderCampaignSetup = () => (
    <div className="px-4 py-6 max-w-lg mx-auto animate-fade-in">
      <h2 className="text-xl font-bold font-display mb-1">Create your first campaign</h2>
      <p className="text-sm text-muted-foreground mb-6">We'll set up a Search campaign optimised for sales.</p>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card rounded-lg border border-border p-3">
            <p className="text-[10px] text-muted-foreground mb-1">Campaign Type</p>
            <p className="text-sm font-semibold flex items-center gap-1"><Search className="w-3 h-3" /> Search <Check className="w-3 h-3 text-success" /></p>
          </div>
          <div className="bg-card rounded-lg border border-border p-3">
            <p className="text-[10px] text-muted-foreground mb-1">Objective</p>
            <p className="text-sm font-semibold flex items-center gap-1"><DollarSign className="w-3 h-3" /> Sales <Check className="w-3 h-3 text-success" /></p>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Location</label>
          <Input value={state.campaign.location} onChange={e => update({ campaign: { ...state.campaign, location: e.target.value } })} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Daily budget ($)</label>
          <Input type="number" value={state.campaign.budget} onChange={e => update({ campaign: { ...state.campaign, budget: e.target.value } })} />
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Products to advertise</p>
          {SUGGESTED_PRODUCTS.map((p, i) => (
            <div key={i} className="flex items-center gap-2 mb-1.5">
              <Checkbox
                checked={state.campaign.selectedProducts[i] ?? false}
                onCheckedChange={(v) => {
                  const next = [...state.campaign.selectedProducts];
                  next[i] = !!v;
                  update({ campaign: { ...state.campaign, selectedProducts: next } });
                }}
              />
              <span className="text-sm">{p}</span>
            </div>
          ))}
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">🔥 Suggested keywords (auto-generated)</p>
          <div className="flex flex-wrap gap-1.5">
            {state.campaign.keywords.map((kw, i) => (
              <span key={i} className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-mono-data">{kw}</span>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Negative keywords (auto)</p>
          <div className="flex flex-wrap gap-1.5">
            {state.campaign.negativeKeywords.map((kw, i) => (
              <span key={i} className="text-xs bg-destructive/10 text-destructive px-2 py-1 rounded-full font-mono-data">{kw}</span>
            ))}
          </div>
        </div>
      </div>

      <Button variant="teal" className="w-full h-12 text-base mt-6" onClick={() => setStep(4)}>
        Generate Ads <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );

  // ─── SCREEN 4: Ad Creation ───
  const renderAdCreation = () => (
    <div className="px-4 py-6 max-w-lg mx-auto animate-fade-in">
      <h2 className="text-xl font-bold font-display mb-1">Your ads (AI-generated)</h2>
      <p className="text-sm text-muted-foreground mb-6">Copy these directly into Google Ads.</p>

      <Card className="mb-4">
        <CardContent className="p-4 space-y-3">
          {state.ads.headlines.map((h, i) => (
            <div key={i}>
              <p className="text-[10px] text-muted-foreground">Headline {i + 1}</p>
              <p className="text-sm font-semibold text-primary">{h}</p>
            </div>
          ))}
          <div>
            <p className="text-[10px] text-muted-foreground">Description</p>
            <p className="text-sm">{state.ads.description}</p>
          </div>
        </CardContent>
      </Card>

      <Button
        variant="outline"
        className="w-full mb-3"
        onClick={() => copyToClipboard(`${state.ads.headlines.join("\n")}\n\n${state.ads.description}`)}
      >
        <Copy className="w-4 h-4 mr-1" /> {copied ? "Copied!" : "Copy to clipboard"}
      </Button>

      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-6">
        <p className="text-xs text-muted-foreground">💡 <span className="font-semibold">Pro tip:</span> Paste into Google Ads → Responsive Search Ad. Add at least 10 headlines for best results.</p>
      </div>

      <Button variant="teal" className="w-full h-12 text-base" onClick={() => setStep(5)}>
        Continue to Tracking <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );

  // ─── SCREEN 5: Tracking Dashboard ───
  const renderTracking = () => {
    const breakEvenRoas = 2.0;
    const profitable = state.tracking.roas >= breakEvenRoas;
    return (
      <div className="px-4 py-6 max-w-lg mx-auto animate-fade-in">
        <h2 className="text-xl font-bold font-display mb-1">Your campaign performance</h2>
        <p className="text-sm text-muted-foreground mb-6">Enter your Google Ads stats to get recommendations.</p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          {[
            { label: "ROAS", value: `${state.tracking.roas}x`, icon: TrendingUp, color: "text-success" },
            { label: "Spend", value: `$${state.tracking.spend}`, icon: DollarSign, color: "text-destructive" },
            { label: "Revenue", value: `$${state.tracking.revenue.toLocaleString()}`, icon: BarChart3, color: "text-primary" },
            { label: "Conversions", value: `${state.tracking.conversions}`, icon: ShoppingBag, color: "text-secondary" },
          ].map((m, i) => (
            <div key={i} className="bg-card rounded-lg border border-border p-4 text-center">
              <m.icon className={`w-5 h-5 mx-auto mb-1 ${m.color}`} />
              <p className="text-xl font-bold font-display">{m.value}</p>
              <p className="text-[10px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>

        <div className={`rounded-lg p-4 border ${profitable ? "bg-success/10 border-success/30" : "bg-secondary/10 border-secondary/30"}`}>
          <p className="text-sm font-semibold">{profitable ? "💡 You're profitable" : "⚠️ Below break-even"}</p>
          <p className="text-xs text-muted-foreground mt-1">Break-even ROAS: {breakEvenRoas}x — Your ROAS: {state.tracking.roas}x</p>
        </div>

        <Button variant="teal" className="w-full h-12 text-base mt-6" onClick={() => setStep(6)}>
          Weekly Optimisation <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    );
  };

  // ─── SCREEN 6: Weekly Optimisation ───
  const renderWeekly = () => (
    <div className="px-4 py-6 max-w-lg mx-auto animate-fade-in">
      <h2 className="text-xl font-bold font-display mb-1">What to do this week</h2>
      <p className="text-sm text-muted-foreground mb-6">Complete these tasks every week to improve performance.</p>

      <div className="space-y-2 mb-6">
        {WEEKLY_ITEMS.map((item, i) => (
          <div key={i} className="bg-card rounded-lg border border-border p-3 flex items-start gap-3">
            <Checkbox
              checked={state.weeklyChecklist[i]}
              onCheckedChange={(v) => {
                const next = [...state.weeklyChecklist];
                next[i] = !!v;
                update({ weeklyChecklist: next });
              }}
              className="mt-0.5"
            />
            <span className={`text-sm ${state.weeklyChecklist[i] ? "line-through text-muted-foreground" : ""}`}>{item}</span>
          </div>
        ))}
      </div>

      <div className="bg-secondary/10 border border-secondary/30 rounded-lg p-3 mb-6">
        <p className="text-xs font-semibold mb-1">⚠️ Smart alert</p>
        <p className="text-xs text-muted-foreground">Keyword "swimwear cheap" spent $120 → no sales</p>
        <p className="text-xs text-primary mt-1">→ Recommend: Pause this keyword</p>
      </div>

      <Button variant="teal" className="w-full h-12 text-base" onClick={() => setStep(7)}>
        Shopping Ads <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );

  // ─── SCREEN 7: Unlock Shopping ───
  const renderShopping = () => (
    <div className="px-4 py-6 max-w-lg mx-auto animate-fade-in">
      <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-4">
        <ShoppingBag className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-bold font-display mb-1 text-center">Ready to scale with Shopping Ads</h2>
      <p className="text-sm text-muted-foreground mb-6 text-center">Show your products directly in Google search results with images and prices.</p>

      {!hasConversions && (
        <div className="bg-secondary/10 border border-secondary/30 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
          <p className="text-xs">We recommend getting at least a few conversions from Search campaigns before launching Shopping. Update your tracking data on the previous screen.</p>
        </div>
      )}

      <div className="space-y-2 mb-6">
        {[
          { label: "Merchant Center connected", done: state.accountChecklist[1] },
          { label: "Products synced to feed", done: state.accountChecklist[2] },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-2 bg-card rounded-lg border border-border p-3">
            {item.done ? <Check className="w-4 h-4 text-success" /> : <X className="w-4 h-4 text-muted-foreground" />}
            <span className="text-sm">{item.label}</span>
          </div>
        ))}
      </div>

      <Button variant="teal" className="w-full h-12 text-base" onClick={() => { update({ shoppingUnlocked: true }); setStep(8); }}>
        Launch Shopping Campaign <Rocket className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );

  // ─── SCREEN 8: Performance Max ───
  const renderPMax = () => {
    const pmaxItems = [
      { label: "Product images uploaded", icon: Image },
      { label: "Video asset added", icon: Video },
      { label: "Customer list uploaded", icon: Users },
    ];
    return (
      <div className="px-4 py-6 max-w-lg mx-auto animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-4">
          <Rocket className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-xl font-bold font-display mb-1 text-center">Scale across Google (AI campaigns)</h2>
        <p className="text-sm text-muted-foreground mb-6 text-center">Performance Max uses AI to show your products on Search, Shopping, YouTube, Display, and Gmail.</p>

        <div className="space-y-2 mb-6">
          {pmaxItems.map((item, i) => (
            <div key={i} className="bg-card rounded-lg border border-border p-3 flex items-center gap-3">
              <Checkbox
                checked={state.pmaxChecklist[i]}
                onCheckedChange={(v) => {
                  const next = [...state.pmaxChecklist];
                  next[i] = !!v;
                  update({ pmaxChecklist: next });
                }}
              />
              <item.icon className="w-4 h-4 text-muted-foreground" />
              <span className={`text-sm ${state.pmaxChecklist[i] ? "line-through text-muted-foreground" : ""}`}>{item.label}</span>
            </div>
          ))}
        </div>

        <Button variant="teal" className="w-full h-12 text-base" onClick={() => setStep(9)}>
          Launch Performance Max <Rocket className="w-4 h-4 ml-1" />
        </Button>
      </div>
    );
  };

  // ─── SCREEN 9: Scaling Engine ───
  const renderScaling = () => {
    const currentBudget = parseFloat(state.scalingBudget) || 50;
    const recommended = Math.round(currentBudget * 1.2);
    const scalingItems = ["Enable remarketing", "Separate new vs returning customers"];

    return (
      <div className="px-4 py-6 max-w-lg mx-auto animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-success/15 flex items-center justify-center mx-auto mb-4">
          <TrendingUp className="w-8 h-8 text-success" />
        </div>
        <h2 className="text-xl font-bold font-display mb-1 text-center">Scale safely</h2>
        <p className="text-sm text-muted-foreground mb-6 text-center">Increase spend gradually to maintain profitability.</p>

        <div className="bg-card rounded-lg border border-border p-4 mb-4">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Current daily budget ($)</label>
          <Input type="number" value={state.scalingBudget} onChange={e => update({ scalingBudget: e.target.value })} />
        </div>

        <div className="bg-success/10 border border-success/30 rounded-lg p-4 mb-4">
          <p className="text-sm font-semibold mb-1">✅ Recommended increase</p>
          <p className="text-sm">Increase to <span className="font-bold">${recommended}/day</span> (+20%)</p>
          <p className="text-xs text-muted-foreground mt-1">Wait 7 days before next increase</p>
        </div>

        <div className="space-y-2 mb-6">
          <p className="text-xs font-medium text-muted-foreground">Advanced options</p>
          {scalingItems.map((item, i) => (
            <div key={i} className="bg-card rounded-lg border border-border p-3 flex items-center gap-3">
              <Checkbox
                checked={state.scalingChecklist[i]}
                onCheckedChange={(v) => {
                  const next = [...state.scalingChecklist];
                  next[i] = !!v;
                  update({ scalingChecklist: next });
                }}
              />
              <span className="text-sm">{item}</span>
            </div>
          ))}
        </div>

        {/* Error prevention alerts */}
        <div className="space-y-2 mb-6">
          <p className="text-xs font-medium text-muted-foreground">🧠 Smart checks</p>
          {!conversionTrackingDone && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-start gap-2">
              <Shield className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs">🚫 No conversion tracking detected → Go back and set it up first</p>
            </div>
          )}
          {state.campaign.selectedProducts.filter(Boolean).length > 3 && (
            <div className="bg-secondary/10 border border-secondary/30 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
              <p className="text-xs">🚫 Too many products selected → Reduce to 3 for best results</p>
            </div>
          )}
          {parseFloat(state.campaign.budget) < 20 && (
            <div className="bg-secondary/10 border border-secondary/30 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
              <p className="text-xs">🚫 Budget too low → Suggest at least $20–30/day</p>
            </div>
          )}
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 text-center">
          <p className="text-sm font-semibold mb-1">🎉 Setup complete!</p>
          <p className="text-xs text-muted-foreground">You've set up Google Ads from scratch. Return to this wizard anytime to review your progress.</p>
        </div>

        <Button variant="outline" className="w-full h-12 text-base mt-4" onClick={onBack}>
          Back to Dashboard
        </Button>
      </div>
    );
  };

  const screens = [
    renderOnboarding,
    renderBusinessCheck,
    renderAccountSetup,
    renderCampaignSetup,
    renderAdCreation,
    renderTracking,
    renderWeekly,
    renderShopping,
    renderPMax,
    renderScaling,
  ];

  const screenTitles = [
    "Welcome", "Business Check", "Account Setup", "Campaign Setup",
    "Ad Creation", "Tracking", "Weekly Optimisation", "Shopping Ads",
    "Performance Max", "Scaling"
  ];

  return (
    <div className="min-h-screen pb-24">
      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <button onClick={() => state.step === 0 ? onBack() : setStep(state.step - 1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> {state.step === 0 ? "Back" : screenTitles[state.step - 1]}
          </button>
          <span className="text-xs text-muted-foreground font-mono-data">{state.step + 1}/{totalSteps}</span>
        </div>
        <Progress value={progress} className="h-1 mt-2 max-w-lg mx-auto" />
      </div>

      {screens[state.step]()}
    </div>
  );
};

export default GoogleAdsSetupWizard;
