import { useState } from "react";
import { Tag, Search, Globe, Bot, ChevronLeft, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import PriceLookup from "@/components/PriceLookup";
import { getStoreConfig, getIndustryConfig } from "@/lib/prompt-builder";
import {
  generateSeo, SEO_TITLE_PRESETS, type SeoProduct,
} from "@/lib/seo-engine";

const tools = [
  { id: "price_lookup", icon: DollarSign, label: "Price lookup", desc: "Look up retail prices via APIs", color: "text-success" },
  { id: "tags", icon: Tag, label: "Tag builder", desc: "Build Shopify tags manually", color: "text-primary" },
  { id: "seo", icon: Search, label: "SEO writer", desc: "Generate SEO title + meta description", color: "text-primary" },
  { id: "brands", icon: Globe, label: "Brand reference", desc: "Brand website directory", color: "text-primary" },
  { id: "ai", icon: Bot, label: "AI instructions", desc: "Custom rules for your invoices", color: "text-secondary" },
];

const quickInserts = [
  { label: "+ Brand prefix", text: "Add [BRAND NAME] at the start of every product name." },
  { label: "+ Title case", text: "Title case all product names (capitalise each word)." },
  { label: "+ Map price cols", text: "QTY column means quantity. First price = cost, second = retail." },
  { label: "+ Abbreviation", text: "Replace '[ABBR]' with '[FULL WORD]' in all names." },
];

// ── SEO Writer Panel ───────────────────────────────────────
function SeoWriterPanel({ onBack }: { onBack: () => void }) {
  const store = getStoreConfig();
  const industry = getIndustryConfig(store.industry);
  const [productName, setProductName] = useState("");
  const [brand, setBrand] = useState("");
  const [productType, setProductType] = useState(industry.defaultType);

  const product: SeoProduct = { title: productName, brand, type: productType };
  const seo = generateSeo(product, store, 0);

  const titleColor = seo.titleLength > 70 ? "text-destructive" : seo.titleLength > 55 ? "text-warning" : "text-success";
  const descColor = seo.descLength > 160 ? "text-destructive" : seo.descLength > 130 ? "text-warning" : "text-success";

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold font-display">SEO writer</h2>
      </div>

      {/* Template info */}
      <div className="bg-muted/50 rounded-lg p-3 border border-border mb-4">
        <p className="text-xs text-muted-foreground">
          Using template: <span className="font-mono text-foreground text-xs">{store.seoTitleTemplate || '{product} | {brand} | {store}'}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">Store: <span className="font-medium text-foreground">{store.name || 'Not set'}</span> · Industry: {industry.displayName}</p>
      </div>

      {/* Inputs */}
      <div className="space-y-3 mb-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Product name</label>
          <input value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. Mara One Piece"
            className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Brand</label>
            <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Bond Eye"
              className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Product type</label>
            <select value={productType} onChange={e => setProductType(e.target.value)}
              className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm text-foreground">
              {industry.productTypes.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Live Preview — Google snippet */}
      {productName && brand && (
        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-2 font-medium">Google preview</p>
          <div className="bg-background rounded-lg border border-border p-4">
            <p className="text-primary text-base leading-snug truncate" style={{ fontFamily: 'Arial, sans-serif' }}>
              {seo.seoTitle || 'SEO Title'}
            </p>
            <p className="text-success text-xs mt-0.5 truncate" style={{ fontFamily: 'Arial, sans-serif' }}>
              {store.url || 'yourstore.com'} › products
            </p>
            <p className="text-muted-foreground text-xs mt-1 leading-relaxed line-clamp-2" style={{ fontFamily: 'Arial, sans-serif' }}>
              {seo.seoDescription || 'Meta description will appear here...'}
            </p>
          </div>
          {/* Char counts */}
          <div className="flex gap-4 mt-2">
            <span className={`text-xs font-mono ${titleColor}`}>Title: {seo.titleLength}/70</span>
            <span className={`text-xs font-mono ${descColor}`}>Desc: {seo.descLength}/160</span>
          </div>
        </div>
      )}

      {/* Output fields */}
      {productName && brand && (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">SEO Title</label>
            <div className="bg-muted rounded-md px-3 py-2 text-sm font-mono-data break-all">{seo.seoTitle}</div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Meta Description</label>
            <div className="bg-muted rounded-md px-3 py-2 text-sm font-mono-data break-all">{seo.seoDescription}</div>
          </div>
          <Button variant="outline" className="w-full" onClick={() => {
            navigator.clipboard.writeText(`${seo.seoTitle}\n${seo.seoDescription}`);
          }}>
            Copy to clipboard
          </Button>
        </div>
      )}
    </div>
  );
}

const ToolsScreen = () => {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");

  if (activeTool === "price_lookup") {
    return <PriceLookup onBack={() => setActiveTool(null)} />;
  }

  if (activeTool === "seo") {
    return <SeoWriterPanel onBack={() => setActiveTool(null)} />;
  }

  if (activeTool === "ai") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setActiveTool(null)} className="text-muted-foreground">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-semibold font-display">AI instructions</h2>
        </div>

        <p className="text-sm text-muted-foreground mb-3">
          Tell SupplierSync exactly how to process your invoices. These rules override all defaults.
        </p>

        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={8}
          placeholder={`Examples:\n• QTY means quantity, first price is cost, second is retail\n• Add my brand name at the start of every product name\n• Replace 'nk' with Necklace, 'br' with Bracelet\n• All names should have first letter capitalised only\n• The SKU column is called 'Style No' in this invoice`}
          className="w-full rounded-lg bg-input border border-border px-4 py-3 text-sm resize-none leading-relaxed placeholder:text-muted-foreground/50"
        />

        <div className="flex flex-wrap gap-2 mt-3">
          {quickInserts.map((qi) => (
            <button
              key={qi.label}
              onClick={() => setInstructions((prev) => (prev ? prev + "\n" : "") + qi.text)}
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-muted text-muted-foreground active:bg-accent"
            >
              {qi.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-4">
          <input type="checkbox" id="save-all" className="w-4 h-4 rounded border-border" />
          <label htmlFor="save-all" className="text-sm text-muted-foreground">Save for all future invoices from this supplier</label>
        </div>

        <Button variant="teal" className="w-full mt-6 h-12 text-base">Save instructions</Button>
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <h1 className="text-2xl font-bold font-display mb-1">Tools</h1>
      <p className="text-muted-foreground text-sm mb-6">Power user features</p>

      <div className="grid grid-cols-2 gap-3">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              className="bg-card rounded-lg border border-border p-4 text-left active:bg-muted transition-colors"
            >
              <Icon className={`w-6 h-6 ${tool.color} mb-3`} />
              <p className="text-sm font-semibold">{tool.label}</p>
              <p className="text-xs text-muted-foreground mt-1">{tool.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ToolsScreen;
