import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft, Check, Upload } from "lucide-react";
import { saveStoreConfig, getIndustryConfig } from "@/lib/prompt-builder";
import { CURRENCIES, LOCALES } from "@/lib/i18n";

interface OnboardingFlowProps {
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5;

const industries = [
  { id: "swimwear", emoji: "🩱", name: "Swimwear", desc: "Beach & resort", placeholder: "e.g. Coral Bay Swimwear" },
  { id: "fashion", emoji: "👗", name: "Clothing", desc: "Fashion & apparel", placeholder: "e.g. The Style Collective" },
  { id: "beauty", emoji: "💄", name: "Beauty", desc: "Skincare & makeup", placeholder: "e.g. Glow Beauty Co." },
  { id: "health", emoji: "💊", name: "Health", desc: "Supplements & wellness", placeholder: "e.g. VitalLife Nutrition" },
  { id: "electronics", emoji: "📱", name: "Electronics", desc: "Gadgets & tech", placeholder: "e.g. TechHub Darwin" },
  { id: "home", emoji: "🏠", name: "Home & Living", desc: "Decor & living", placeholder: "e.g. Coastal Living Co." },
  { id: "sports", emoji: "⚽", name: "Sports", desc: "Outdoor & active", placeholder: "e.g. Peak Performance" },
  { id: "kids", emoji: "👶", name: "Kids", desc: "Baby & children", placeholder: "e.g. Little Ones Boutique" },
  { id: "general", emoji: "🛍️", name: "General Retail", desc: "Other products", placeholder: "e.g. My Boutique" },
];

const posOptions = [
  { id: "shopify", emoji: "🛍️", name: "Shopify only", desc: "I use Shopify directly" },
  { id: "lightspeed_shopify", emoji: "🖥️", name: "Lightspeed + Shopify", desc: "I use Lightspeed POS — it syncs to Shopify" },
  { id: "lightspeed", emoji: "🖥️", name: "Lightspeed only", desc: "I use Lightspeed — no online store yet" },
  { id: "other", emoji: "📦", name: "Other / Not sure", desc: "I'll figure this out later" },
];

const sampleInvoices: Record<string, { vendor: string; lines: { name: string; variant?: string; qty: number; cost: number }[] }> = {
  swimwear: {
    vendor: "Jantzen",
    lines: [
      { name: "Jantzen Retro Racerback One Piece", variant: "Coral · 8,10,12,14", qty: 4, cost: 65.00 },
      { name: "Bond Eye Mara One Piece", variant: "Black · 8,10,12", qty: 3, cost: 89.95 },
      { name: "Seafolly Collective Bikini Top", variant: "Navy · 8,10,12", qty: 6, cost: 45.00 },
      { name: "Baku Riviera High Waist Pant", variant: "Ivory · 8,10,12,14", qty: 4, cost: 38.00 },
      { name: "Jantzen Sahara Kaftan", variant: "Khaki · S,M,L", qty: 3, cost: 48.00 },
    ],
  },
  beauty: {
    vendor: "L'Oreal",
    lines: [
      { name: "L'Oreal True Match Foundation", variant: "Shade W2", qty: 6, cost: 18.50 },
      { name: "Maybelline Sky High Mascara", variant: "Black", qty: 8, cost: 12.00 },
      { name: "NYX Setting Spray", variant: "130ml", qty: 4, cost: 14.50 },
      { name: "MAC Studio Fix Powder", variant: "NW20", qty: 3, cost: 38.00 },
      { name: "Charlotte Tilbury Pillow Talk Lip Liner", qty: 4, cost: 32.00 },
    ],
  },
  fashion: {
    vendor: "Country Road",
    lines: [
      { name: "Country Road Linen Shirt", variant: "White · S,M,L,XL", qty: 4, cost: 38.00 },
      { name: "Assembly Label Wide Leg Pant", variant: "Black · 6,8,10,12", qty: 4, cost: 45.00 },
      { name: "DISSH Floral Midi Dress", variant: "Navy Print · 8,10,12", qty: 3, cost: 52.00 },
      { name: "Seed Heritage T-Shirt", variant: "White · XS,S,M,L", qty: 6, cost: 22.00 },
      { name: "Aje Relaxed Blazer", variant: "Ivory · 6,8,10,12", qty: 3, cost: 85.00 },
    ],
  },
  electronics: {
    vendor: "Samsung",
    lines: [
      { name: "Samsung Galaxy Buds3", variant: "White", qty: 5, cost: 95.00 },
      { name: "Anker 65W USB-C Charger", qty: 10, cost: 22.00 },
      { name: "Apple MagSafe Case iPhone 15", variant: "Black", qty: 6, cost: 28.00 },
      { name: "JBL Flip 6 Speaker", variant: "Blue", qty: 3, cost: 78.00 },
      { name: "Logitech MX Keys Keyboard", qty: 4, cost: 95.00 },
    ],
  },
  health: {
    vendor: "Optimum Nutrition",
    lines: [
      { name: "Optimum Nutrition Gold Standard Whey", variant: "Chocolate 1kg", qty: 6, cost: 38.00 },
      { name: "Garden of Life Vitamin D3", variant: "2000 IU 60 caps", qty: 8, cost: 18.00 },
      { name: "BSC Hydroxy Burn", variant: "Vanilla 500g", qty: 4, cost: 42.00 },
      { name: "Blackmores Fish Oil", variant: "1000mg 400 caps", qty: 5, cost: 22.00 },
      { name: "Vital Proteins Collagen Peptides", variant: "Unflavoured 284g", qty: 6, cost: 35.00 },
    ],
  },
  home: {
    vendor: "Aura Home",
    lines: [
      { name: "Aura Home Linen Cushion", variant: "Sand · 50x50cm", qty: 4, cost: 28.00 },
      { name: "Glasshouse Soy Candle", variant: "Kyoto · 380g", qty: 6, cost: 22.00 },
      { name: "Renwil Ceramic Vase", variant: "White · Medium", qty: 3, cost: 35.00 },
      { name: "Sheridan Cotton Throw", variant: "Oatmeal", qty: 4, cost: 45.00 },
      { name: "Pillow Talk Photo Frame", variant: "Gold · 5x7", qty: 8, cost: 12.00 },
    ],
  },
  general: {
    vendor: "Mixed Supplier",
    lines: [
      { name: "Stainless Steel Water Bottle", variant: "Black 750ml", qty: 10, cost: 12.00 },
      { name: "Bamboo Serving Board", variant: "Large", qty: 6, cost: 18.00 },
      { name: "Scented Soy Candle", variant: "Vanilla 300g", qty: 8, cost: 15.00 },
      { name: "Cotton Tote Bag", variant: "Natural", qty: 12, cost: 8.00 },
      { name: "Ceramic Mug Set", variant: "Speckled White", qty: 6, cost: 22.00 },
    ],
  },
};

const doneMessages: Record<string, { emoji: string; text: string }> = {
  swimwear: { emoji: "🏄", text: "Sonic Invoice knows your brands, your tags, and your pricing sources. Let's go." },
  beauty: { emoji: "✨", text: "Sonic Invoice knows your shades, your formulas, and your beauty brands. Let's go." },
  fashion: { emoji: "👗", text: "Sonic Invoice knows your sizing, your styles, and your fashion brands. Let's go." },
  electronics: { emoji: "📱", text: "Sonic Invoice knows your specs, your models, and your tech brands. Let's go." },
  health: { emoji: "💪", text: "Sonic Invoice knows your supplements, your ingredients, and your health brands. Let's go." },
  home: { emoji: "🏠", text: "Sonic Invoice knows your décor styles, your materials, and your home brands. Let's go." },
  general: { emoji: "🛍️", text: "Sonic Invoice is configured for your store. Process your first invoice to get started." },
};

const OnboardingFlow = ({ onComplete }: OnboardingFlowProps) => {
  const [step, setStepRaw] = useState<Step>(() => {
    const saved = localStorage.getItem("onboarding_step");
    return saved ? Math.min(parseInt(saved), 5) as Step : 1;
  });
  const setStep = (s: Step) => {
    localStorage.setItem("onboarding_step", String(s));
    setStepRaw(s);
  };
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [currency, setCurrency] = useState("AUD");
  const [locale, setLocale] = useState("AU");
  const [selectedPos, setSelectedPos] = useState<string | null>(null);

  const industryObj = industries.find(i => i.id === selectedIndustry);
  const placeholder = industryObj?.placeholder || "e.g. My Boutique";

  const handleFinish = () => {
    saveStoreConfig({
      name: storeName || "My Store",
      url: storeUrl,
      currency,
      locale: locale as any,
      industry: selectedIndustry || "general",
      storeType: (selectedPos as any) || "shopify",
    });
    localStorage.setItem("onboarding_complete", "true");
    onComplete();
  };

  return (
    <div className="min-h-screen flex flex-col animate-fade-in">
      {/* Progress dots */}
      <div className="flex items-center justify-center gap-2 pt-6 pb-2">
        {[1, 2, 3, 4, 5].map(s => (
          <div key={s} className={`w-2 h-2 rounded-full transition-colors ${s <= step ? 'bg-primary' : 'bg-muted'}`} />
        ))}
      </div>

      <div className="flex-1 px-5 pb-8 overflow-y-auto">
        {/* ── Step 1: Industry ──────────────────────────── */}
        {step === 1 && (
          <div className="pt-4">
            <h1 className="text-2xl font-bold font-display text-center mb-1">Welcome to Sonic Invoice 👋</h1>
            <p className="text-muted-foreground text-sm text-center mb-6">What kind of store do you run?</p>
            <div className="grid grid-cols-3 gap-2.5">
              {industries.map(ind => (
                <button
                  key={ind.id}
                  onClick={() => setSelectedIndustry(ind.id)}
                  className={`rounded-xl border-2 p-3 text-center transition-all active:scale-95 ${
                    selectedIndustry === ind.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-card'
                  }`}
                >
                  <span className="text-2xl block mb-1">{ind.emoji}</span>
                  <p className="text-xs font-semibold leading-tight">{ind.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{ind.desc}</p>
                  {selectedIndustry === ind.id && (
                    <Check className="w-3.5 h-3.5 text-primary mx-auto mt-1" />
                  )}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center mt-4">
              Not sure? Choose General Retail — you can change this later.
            </p>
            <Button variant="teal" className="w-full h-12 text-base mt-4" disabled={!selectedIndustry}
              onClick={() => setStep(2)}>
              Continue <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ── Step 2: Store Identity ────────────────────── */}
        {step === 2 && (
          <div className="pt-4">
            <button onClick={() => setStep(1)} className="text-muted-foreground mb-4"><ChevronLeft className="w-5 h-5" /></button>
            <h2 className="text-xl font-bold font-display mb-1">Tell us about your store</h2>
            <p className="text-muted-foreground text-sm mb-5">We'll personalise everything for you.</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Store name *</label>
                <input value={storeName} onChange={e => setStoreName(e.target.value)} placeholder={placeholder}
                  className="w-full h-11 rounded-lg bg-input border border-border px-3 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Store website</label>
                <input value={storeUrl} onChange={e => setStoreUrl(e.target.value)} placeholder="e.g. mystore.com"
                  className="w-full h-11 rounded-lg bg-input border border-border px-3 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Currency</label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)}
                    className="w-full h-11 rounded-lg bg-input border border-border px-3 text-sm text-foreground">
                    {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code} ({c.symbol})</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Locale</label>
                  <select value={locale} onChange={e => setLocale(e.target.value)}
                    className="w-full h-11 rounded-lg bg-input border border-border px-3 text-sm text-foreground">
                    {LOCALES.map(l => <option key={l.id} value={l.id}>{l.flag} {l.country}</option>)}
                  </select>
                </div>
              </div>
            </div>
            {/* SEO preview */}
            {storeName && (
              <div className="bg-muted/50 rounded-lg p-3 mt-4">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">SEO Title Preview</p>
                <p className="text-xs text-foreground truncate">Product Name | Brand | {storeName}</p>
              </div>
            )}
            <Button variant="teal" className="w-full h-12 text-base mt-5" disabled={!storeName.trim()}
              onClick={() => setStep(3)}>
              Continue <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ── Step 3: POS System ────────────────────────── */}
        {step === 3 && (
          <div className="pt-4">
            <button onClick={() => setStep(2)} className="text-muted-foreground mb-4"><ChevronLeft className="w-5 h-5" /></button>
            <h2 className="text-xl font-bold font-display mb-1">How do you sell online?</h2>
            <p className="text-muted-foreground text-sm mb-5">We'll optimise your export format.</p>
            <div className="space-y-2.5">
              {posOptions.map(pos => (
                <button
                  key={pos.id}
                  onClick={() => setSelectedPos(pos.id)}
                  className={`w-full rounded-xl border-2 p-4 text-left transition-all flex items-center gap-3 ${
                    selectedPos === pos.id ? 'border-primary bg-primary/10' : 'border-border bg-card'
                  }`}
                >
                  <span className="text-xl">{pos.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{pos.name}</p>
                    <p className="text-xs text-muted-foreground">{pos.desc}</p>
                  </div>
                  {selectedPos === pos.id && <Check className="w-4 h-4 text-primary shrink-0" />}
                </button>
              ))}
            </div>
            <Button variant="teal" className="w-full h-12 text-base mt-5" disabled={!selectedPos}
              onClick={() => setStep(4)}>
              Continue <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ── Step 4: First Invoice ─────────────────────── */}
        {step === 4 && (
          <div className="pt-4">
            <button onClick={() => setStep(3)} className="text-muted-foreground mb-4"><ChevronLeft className="w-5 h-5" /></button>
            <h2 className="text-xl font-bold font-display mb-1">Process your first invoice</h2>
            <p className="text-muted-foreground text-sm mb-5">Try a sample or upload your own.</p>

            {/* Sample invoice */}
            {(() => {
              const key = selectedIndustry && sampleInvoices[selectedIndustry] ? selectedIndustry : 'general';
              const sample = sampleInvoices[key]!;
              return (
                <div className="bg-card rounded-xl border border-border p-4 mb-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Sample {industryObj?.name || 'Retail'} Invoice — {sample.vendor}
                  </p>
                  <div className="space-y-1.5">
                    {sample.lines.map((line, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex-1 min-w-0">
                          <span className="text-foreground truncate block">{line.name}</span>
                          {line.variant && <span className="text-muted-foreground">{line.variant}</span>}
                        </div>
                        <span className="text-muted-foreground shrink-0 ml-2 font-mono-data">
                          ×{line.qty} · ${line.cost.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="teal"
                    className="w-full h-11 text-sm mt-4"
                    onClick={() => {
                      try {
                        localStorage.setItem(
                          "pending_sample_invoice",
                          JSON.stringify({ industry: key, ...sample }),
                        );
                      } catch {}
                      handleFinish();
                    }}
                  >
                    Use this sample invoice <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              );
            })()}

            <div className="text-center text-xs text-muted-foreground mb-3">or</div>

            <button
              onClick={handleFinish}
              className="w-full h-12 rounded-xl border-2 border-dashed border-border bg-card flex items-center justify-center gap-2 text-sm active:bg-muted"
            >
              <Upload className="w-4 h-4 text-primary" /> Upload your own invoice
            </button>

            <button onClick={handleFinish} className="w-full mt-4 text-xs text-muted-foreground text-center">
              Skip — I'll do this later →
            </button>
          </div>
        )}

        {/* ── Step 5: Done ──────────────────────────────── */}
        {step === 5 && (
          <div className="flex flex-col items-center justify-center pt-16 text-center">
            {(() => {
              const key = selectedIndustry && doneMessages[selectedIndustry] ? selectedIndustry : 'general';
              const msg = doneMessages[key]!;
              return (
                <>
                  <div className="w-20 h-20 rounded-full bg-success/15 flex items-center justify-center mb-5">
                    <span className="text-4xl">{msg.emoji}</span>
                  </div>
                  <h2 className="text-xl font-bold font-display mb-2">You're all set!</h2>
                  <p className="text-sm text-muted-foreground max-w-xs mb-8">{msg.text}</p>
                </>
              );
            })()}
            <Button variant="teal" className="w-full max-w-xs h-14 text-base" onClick={handleFinish}>
              Go to dashboard <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default OnboardingFlow;
