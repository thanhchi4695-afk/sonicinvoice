import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  ArrowLeft, ArrowRight, Check, AlertTriangle, Zap,
  BarChart3, ShoppingBag, Rocket, TrendingUp, Target, Copy, ExternalLink,
  Shield, DollarSign, Eye, Image, Video, Users, X, Layers, PenTool, RefreshCw
} from "lucide-react";

const STORAGE_KEY = "skuPilot_metaAdsSetup";

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
    objective: string;
    budget: string;
    audienceType: string;
    selectedProducts: boolean[];
  };
  creative: {
    primaryText: string;
    headline: string;
    hookVariations: string[];
    format: string;
  };
  tracking: {
    roas: number;
    spend: number;
    revenue: number;
    purchases: number;
    cpa: number;
  };
  weeklyChecklist: boolean[];
  advantagePlus: boolean;
  scalingBudget: string;
  scalingChecklist: boolean[];
  creativeFatigueChecklist: boolean[];
  retargetingChecklist: boolean[];
}

const defaultState: SetupState = {
  step: 0,
  business: { sells: "", bestSellers: "", avgPrice: "", cost: "", targetCustomer: "" },
  accountChecklist: [false, false, false, false, false],
  campaign: {
    objective: "Sales",
    budget: "30",
    audienceType: "advantage_plus",
    selectedProducts: [true, true, false],
  },
  creative: {
    primaryText: "Finally — sun protection that actually looks good. Our UPF 50+ rashguards are selling fast this summer. Shop now + free shipping over $75 🌊",
    headline: "UPF 50+ Rashguards — Australian Made",
    hookVariations: [
      "POV: You found the perfect beach cover-up",
      "The swimwear brand Darwin locals love",
      "Why 500+ women switched to UPF rashguards",
    ],
    format: "video",
  },
  tracking: { roas: 4.1, spend: 380, revenue: 1558, purchases: 22, cpa: 17.27 },
  weeklyChecklist: [false, false, false, false],
  advantagePlus: false,
  scalingBudget: "50",
  scalingChecklist: [false, false],
  creativeFatigueChecklist: [false, false, false],
  retargetingChecklist: [false, false, false],
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
  { label: "Meta Business Suite account created", guide: "Go to business.facebook.com → Click 'Create Account' → Enter your business name and details. Connect your Facebook Page." },
  { label: "Facebook Page connected", guide: "In Business Suite → Settings → Accounts → Pages → Add your Facebook business page." },
  { label: "Instagram account connected", guide: "In Business Suite → Settings → Accounts → Instagram accounts → Connect your Instagram professional account." },
  { label: "Meta Pixel installed", guide: "In Events Manager → Connect Data Sources → Web → Facebook Pixel → Install code on your website. Most Shopify themes have a built-in field for your Pixel ID." },
  { label: "Conversions API configured", guide: "In Events Manager → Settings → Conversions API → Set up via Shopify's native integration. This sends server-side events for more accurate tracking." },
];

const WEEKLY_ITEMS = [
  "Check ad frequency (pause if >2.5)",
  "Review cost per purchase trend",
  "Test new hook variation on top ad",
  "Check audience overlap between ad sets",
];

const SUGGESTED_PRODUCTS = ["Rashguard UPF50+", "Swim Shorts – Tropical", "Sun Hat – Wide Brim"];

const MetaAdsSetupWizard = ({ onBack }: Props) => {
  const [state, setState] = useState<SetupState>(loadState);
  const [guideModal, setGuideModal] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { saveState(state); }, [state]);

  const update = (patch: Partial<SetupState>) => setState(prev => ({ ...prev, ...patch }));
  const setStep = (step: number) => update({ step });

  const margin = state.business.avgPrice && state.business.cost
    ? Math.round(((parseFloat(state.business.avgPrice) - parseFloat(state.business.cost)) / parseFloat(state.business.avgPrice)) * 100)
    : null;

  const pixelInstalled = state.accountChecklist[3];
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
      <div className="w-20 h-20 rounded-2xl bg-[hsl(var(--primary))]/15 flex items-center justify-center mb-6">
        <Eye className="w-10 h-10 text-primary" />
      </div>
      <h1 className="text-2xl font-bold font-display mb-2">Let's set up your Meta Ads properly</h1>
      <p className="text-muted-foreground mb-8">Facebook + Instagram ads — from zero → profitable campaigns</p>
      <div className="space-y-3 text-left w-full mb-8">
        {[
          { icon: "⏱", text: "Takes ~20–30 minutes" },
          { icon: "📸", text: "Visual-first ads that convert" },
          { icon: "🤖", text: "Let Meta's AI find your customers" },
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
      <p className="text-sm text-muted-foreground mb-6">Tell us about your business so we can craft the right creative and targeting.</p>
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
          <Input value={state.business.targetCustomer} onChange={e => update({ business: { ...state.business, targetCustomer: e.target.value } })} placeholder="e.g. Women 25-55 who love beach lifestyle" />
        </div>
      </div>

      {margin !== null && !isNaN(margin) && (
        <div className={`mt-6 rounded-lg p-4 border ${margin >= 40 ? "bg-success/10 border-success/30" : margin >= 30 ? "bg-secondary/10 border-secondary/30" : "bg-destructive/10 border-destructive/30"}`}>
          <p className="text-sm font-semibold mb-1">⚠️ Margin check</p>
          <p className="text-sm">Your margin is <span className="font-bold">{margin}%</span> → {margin >= 40 ? "Great for Meta Ads ✅" : margin >= 30 ? "Borderline — aim for 40–60%" : "Too low for profitable ads"}</p>
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
        <h2 className="text-xl font-bold font-display mb-1">Connect your Meta ecosystem</h2>
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

        {!pixelInstalled && (
          <div className="mt-4 bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive font-medium">You cannot continue without the Meta Pixel installed. Complete step 4 first.</p>
          </div>
        )}

        <div className="flex gap-2 mt-6 flex-wrap">
          <a href="https://business.facebook.com" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm"><ExternalLink className="w-3 h-3 mr-1" /> Business Suite</Button>
          </a>
          <a href="https://www.facebook.com/events_manager2" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm"><ExternalLink className="w-3 h-3 mr-1" /> Events Manager</Button>
          </a>
          <a href="https://adsmanager.facebook.com" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm"><ExternalLink className="w-3 h-3 mr-1" /> Ads Manager</Button>
          </a>
        </div>

        <Button variant="teal" className="w-full h-12 text-base mt-6" onClick={() => setStep(3)} disabled={!pixelInstalled}>
          Continue <ArrowRight className="w-4 h-4 ml-1" />
        </Button>

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

  // ─── SCREEN 3: Campaign Structure ───
  const renderCampaignSetup = () => (
    <div className="px-4 py-6 max-w-lg mx-auto animate-fade-in">
      <h2 className="text-xl font-bold font-display mb-1">Create your first campaign</h2>
      <p className="text-sm text-muted-foreground mb-6">One ad set, not many — consolidate data for Meta's AI.</p>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card rounded-lg border border-border p-3">
            <p className="text-[10px] text-muted-foreground mb-1">Objective</p>
            <p className="text-sm font-semibold flex items-center gap-1"><DollarSign className="w-3 h-3" /> Sales <Check className="w-3 h-3 text-success" /></p>
          </div>
          <div className="bg-card rounded-lg border border-border p-3">
            <p className="text-[10px] text-muted-foreground mb-1">Audience</p>
            <p className="text-sm font-semibold flex items-center gap-1"><Users className="w-3 h-3" /> Advantage+ <Check className="w-3 h-3 text-success" /></p>
          </div>
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
          <p className="text-xs font-semibold mb-1">💡 Why Advantage+ Audience?</p>
          <p className="text-xs text-muted-foreground">Let Meta handle targeting. Stop fighting it with interests. Meta's AI finds buyers better than manual targeting in 2026.</p>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Daily budget ($)</label>
          <Input type="number" value={state.campaign.budget} onChange={e => update({ campaign: { ...state.campaign, budget: e.target.value } })} />
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Products to feature in ads</p>
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

        <div className="bg-secondary/10 border border-secondary/30 rounded-lg p-3">
          <p className="text-xs font-semibold mb-1">⚠️ Key rule: ONE ad set</p>
          <p className="text-xs text-muted-foreground">Don't split into multiple ad sets. One campaign → one ad set → 3–5 creatives. This gives Meta enough data to optimise.</p>
        </div>
      </div>

      <Button variant="teal" className="w-full h-12 text-base mt-6" onClick={() => setStep(4)}>
        Create Ad Creative <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );

  // ─── SCREEN 4: Creative & Hooks ───
  const renderCreative = () => (
    <div className="px-4 py-6 max-w-lg mx-auto animate-fade-in">
      <h2 className="text-xl font-bold font-display mb-1">Your ad creative (AI-generated)</h2>
      <p className="text-sm text-muted-foreground mb-6">UGC-style video outperforms studio photography. Copy these into Ads Manager.</p>

      <Card className="mb-4">
        <CardContent className="p-4 space-y-3">
          <div>
            <p className="text-[10px] text-muted-foreground">Primary Text</p>
            <p className="text-sm">{state.creative.primaryText}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Headline</p>
            <p className="text-sm font-semibold text-primary">{state.creative.headline}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Recommended Format</p>
            <p className="text-sm flex items-center gap-1"><Video className="w-3 h-3" /> UGC Video (9:16 for Reels/Stories)</p>
          </div>
        </CardContent>
      </Card>

      <Button
        variant="outline"
        className="w-full mb-4"
        onClick={() => copyToClipboard(`${state.creative.primaryText}\n\n${state.creative.headline}`)}
      >
        <Copy className="w-4 h-4 mr-1" /> {copied ? "Copied!" : "Copy ad text"}
      </Button>

      <div className="mb-6">
        <p className="text-xs font-medium text-muted-foreground mb-2">🔥 Hook variations (don't make new ads — change the hook)</p>
        {state.creative.hookVariations.map((hook, i) => (
          <div key={i} className="bg-card rounded-lg border border-border p-3 mb-2 flex items-center justify-between">
            <span className="text-sm flex-1">{hook}</span>
            <button onClick={() => copyToClipboard(hook)} className="text-primary hover:text-primary/80 ml-2">
              <Copy className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-6">
        <p className="text-xs text-muted-foreground">💡 <span className="font-semibold">Pro tip:</span> Hook variations — not new ads — are how you combat creative fatigue at scale. Same body, different first 3 seconds.</p>
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
        <p className="text-sm text-muted-foreground mb-6">Enter your Meta Ads stats to get recommendations.</p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          {[
            { label: "ROAS", value: `${state.tracking.roas}x`, icon: TrendingUp, color: "text-success" },
            { label: "Spend", value: `$${state.tracking.spend}`, icon: DollarSign, color: "text-destructive" },
            { label: "Revenue", value: `$${state.tracking.revenue.toLocaleString()}`, icon: BarChart3, color: "text-primary" },
            { label: "Purchases", value: `${state.tracking.purchases}`, icon: ShoppingBag, color: "text-secondary" },
          ].map((m, i) => (
            <div key={i} className="bg-card rounded-lg border border-border p-4 text-center">
              <m.icon className={`w-5 h-5 mx-auto mb-1 ${m.color}`} />
              <p className="text-xl font-bold font-display">{m.value}</p>
              <p className="text-[10px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>

        <div className="bg-card rounded-lg border border-border p-4 text-center mb-4">
          <p className="text-[10px] text-muted-foreground">Cost Per Acquisition</p>
          <p className="text-xl font-bold font-display">${state.tracking.cpa.toFixed(2)}</p>
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
      <p className="text-sm text-muted-foreground mb-6">Complete these tasks every week to keep ads profitable.</p>

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
        <p className="text-xs font-semibold mb-1">⚠️ Creative fatigue alert</p>
        <p className="text-xs text-muted-foreground">If frequency &gt; 2.5 and CTR is dropping → add a new hook variation, not a new ad</p>
        <p className="text-xs text-primary mt-1">→ Recommend: Duplicate top ad, change first 3 seconds</p>
      </div>

      <Button variant="teal" className="w-full h-12 text-base" onClick={() => setStep(7)}>
        Creative Refresh <ArrowRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );

  // ─── SCREEN 7: Creative Fatigue & UGC ───
  const renderCreativeFatigue = () => {
    const fatigueItems = [
      { label: "Film 3 new UGC videos (phone is fine)", icon: Video },
      { label: "Create 3 hook variations of your best ad", icon: RefreshCw },
      { label: "Test carousel vs single image vs video", icon: Layers },
    ];
    return (
      <div className="px-4 py-6 max-w-lg mx-auto animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-4">
          <PenTool className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-xl font-bold font-display mb-1 text-center">Beat creative fatigue</h2>
        <p className="text-sm text-muted-foreground mb-6 text-center">UGC and influencer creative outperforms studio photography every time.</p>

        <div className="space-y-2 mb-6">
          {fatigueItems.map((item, i) => (
            <div key={i} className="bg-card rounded-lg border border-border p-3 flex items-center gap-3">
              <Checkbox
                checked={state.creativeFatigueChecklist[i]}
                onCheckedChange={(v) => {
                  const next = [...state.creativeFatigueChecklist];
                  next[i] = !!v;
                  update({ creativeFatigueChecklist: next });
                }}
              />
              <item.icon className="w-4 h-4 text-muted-foreground" />
              <span className={`text-sm ${state.creativeFatigueChecklist[i] ? "line-through text-muted-foreground" : ""}`}>{item.label}</span>
            </div>
          ))}
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-6">
          <p className="text-xs text-muted-foreground">💡 <span className="font-semibold">2026 rule:</span> Don't make new ads — make hook variations. Same body, different opening. This is how top brands scale creative without burning out.</p>
        </div>

        <Button variant="teal" className="w-full h-12 text-base" onClick={() => setStep(8)}>
          Advantage+ Shopping <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    );
  };

  // ─── SCREEN 8: Advantage+ Shopping Campaigns ───
  const renderAdvantage = () => (
    <div className="px-4 py-6 max-w-lg mx-auto animate-fade-in">
      <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-4">
        <Rocket className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-bold font-display mb-1 text-center">Advantage+ Shopping Campaigns</h2>
      <p className="text-sm text-muted-foreground mb-6 text-center">The ecommerce scaling weapon once you have proven ads.</p>

      {state.tracking.purchases < 10 && (
        <div className="bg-secondary/10 border border-secondary/30 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
          <p className="text-xs">We recommend getting at least 10 purchases from standard campaigns before launching Advantage+. This gives Meta enough conversion data.</p>
        </div>
      )}

      <div className="space-y-3 mb-6">
        {[
          "Meta's AI handles all targeting automatically",
          "Tests up to 150 creative combinations",
          "Optimises placement across FB, IG, Messenger, Audience Network",
          "Best for stores with 50+ conversions/month",
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
            <span className="text-sm">{item}</span>
          </div>
        ))}
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-6">
        <p className="text-xs font-semibold mb-1">💡 Setup tip</p>
        <p className="text-xs text-muted-foreground">In Ads Manager → Create → Sales → Advantage+ Shopping Campaign. Upload your best 5 creatives. Set budget at $50–100/day to start.</p>
      </div>

      <Button variant="teal" className="w-full h-12 text-base" onClick={() => { update({ advantagePlus: true }); setStep(9); }}>
        Launch Advantage+ <Rocket className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );

  // ─── SCREEN 9: Scaling & Retargeting ───
  const renderScaling = () => {
    const currentBudget = parseFloat(state.scalingBudget) || 50;
    const recommended = Math.round(currentBudget * 1.2);
    const retargetingItems = [
      "Set up website visitors retargeting (last 30 days)",
      "Create lookalike audience from purchasers",
      "Add to cart but didn't buy retargeting",
    ];

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
          <p className="text-xs text-muted-foreground mt-1">Wait 3–5 days before next increase (Meta's learning phase)</p>
        </div>

        <div className="space-y-2 mb-6">
          <p className="text-xs font-medium text-muted-foreground">Retargeting setup</p>
          {retargetingItems.map((item, i) => (
            <div key={i} className="bg-card rounded-lg border border-border p-3 flex items-center gap-3">
              <Checkbox
                checked={state.retargetingChecklist[i]}
                onCheckedChange={(v) => {
                  const next = [...state.retargetingChecklist];
                  next[i] = !!v;
                  update({ retargetingChecklist: next });
                }}
              />
              <span className="text-sm">{item}</span>
            </div>
          ))}
        </div>

        {/* Error prevention alerts */}
        <div className="space-y-2 mb-6">
          <p className="text-xs font-medium text-muted-foreground">🧠 Smart checks</p>
          {!pixelInstalled && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-start gap-2">
              <Shield className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs">🚫 No Pixel/CAPI detected → Go back and set it up first</p>
            </div>
          )}
          {parseFloat(state.campaign.budget) < 20 && (
            <div className="bg-secondary/10 border border-secondary/30 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
              <p className="text-xs">🚫 Budget too low → Meta needs at least $20/day to exit learning phase</p>
            </div>
          )}
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 text-center">
          <p className="text-sm font-semibold mb-1">🎉 Setup complete!</p>
          <p className="text-xs text-muted-foreground">You've set up Meta Ads from scratch. Return to this wizard anytime to review your progress.</p>
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
    renderCreative,
    renderTracking,
    renderWeekly,
    renderCreativeFatigue,
    renderAdvantage,
    renderScaling,
  ];

  const screenTitles = [
    "Welcome", "Business Check", "Account Setup", "Campaign Setup",
    "Ad Creative", "Tracking", "Weekly Optimisation", "Creative Refresh",
    "Advantage+ Shopping", "Scaling"
  ];

  return (
    <div className="min-h-screen pb-24">
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

export default MetaAdsSetupWizard;
