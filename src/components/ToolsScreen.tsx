import { useState, useRef, lazy, Suspense } from "react";
import { Tag, Search, Globe, Bot, ChevronLeft, DollarSign, Plus, Trash2, ToggleLeft, ToggleRight, RotateCcw, Copy, Check, ExternalLink, Upload, Download, Monitor, Mail, CalendarDays, ShoppingCart, Image, Sparkles, Brain, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import PriceLookup from "@/components/PriceLookup";
import SupplierEmails from "@/components/SupplierEmails";
import SeasonManager from "@/components/SeasonManager";
import ExportCollections from "@/components/ExportCollections";
import ImportCollections from "@/components/ImportCollections";
import AutoCollectionBuilder from "@/components/AutoCollectionBuilder";
import CollectionSEOPanel from "@/components/CollectionSEOPanel";
import AIFeedOptimisation from "@/components/AIFeedOptimisation";
import FeedHealthPanel from "@/components/FeedHealthPanel";
import { getStoreConfig, getIndustryConfig, getIndustryList } from "@/lib/prompt-builder";
import { useStoreMode } from "@/hooks/use-store-mode";
import { generateSeo, type SeoProduct } from "@/lib/seo-engine";
import { generateGoogleFeedXML, generateGoogleFeedTSV, getSaleMeta, generatePromotionsFeed, getMarginFloor, setMarginFloor, getLocalStoreSettings, generateLocalInventoryFeed } from "@/lib/google-feed";
import {
  getTagConfig, saveTagConfig, resetTagConfig, getIndustryTagDefaults,
  generateTags, toTag,
  type TagConfig, type ProductTypeEntry, type TagLayer, type SpecialRule, type TagInput,
} from "@/lib/tag-engine";
import {
  getBrandDirectory, saveBrandDirectory, addBrand, deleteBrand,
  searchBrands, sortBrandsByIndustry, exportBrandsCSV, importBrandsCSV, getCSVTemplate,
  type BrandDirectoryEntry,
} from "@/lib/brand-directory";

const tools = [
  { id: "price_lookup", icon: DollarSign, label: "Price lookup", desc: "Look up retail prices via APIs", color: "text-success" },
  { id: "supplier_emails", icon: Mail, label: "Supplier emails", desc: "Email templates for suppliers", color: "text-primary" },
  { id: "seasons", icon: CalendarDays, label: "Seasons", desc: "Track brand drops by season", color: "text-primary" },
  { id: "tags", icon: Tag, label: "Tag builder", desc: "Build Shopify tags manually", color: "text-primary" },
  { id: "seo", icon: Search, label: "SEO writer", desc: "Generate SEO title + meta description", color: "text-primary" },
  { id: "brands", icon: Globe, label: "Brand reference", desc: "Brand website directory", color: "text-primary" },
  { id: "ai", icon: Bot, label: "AI instructions", desc: "Custom rules for your invoices", color: "text-secondary" },
  { id: "google_feed", icon: ShoppingCart, label: "Google feed preview", desc: "Preview & download Google Shopping feed", color: "text-success" },
  { id: "collab_seo", icon: Globe, label: "Collab SEO", desc: "View all campaigns and manage partner list", color: "text-primary" },
  { id: "lightspeed_convert", icon: Download, label: "Lightspeed converter", desc: "Convert Lightspeed product exports to Shopify-ready CSV format", color: "text-primary" },
  { id: "image_helper", icon: Image, label: "Image download helper", desc: "View and save enriched product images", color: "text-secondary" },
  { id: "export_collections", icon: Download, label: "Export collections", desc: "Export all Shopify collections to CSV", color: "text-success" },
  { id: "import_collections", icon: Upload, label: "Import collections", desc: "Create or update collections from CSV", color: "text-success" },
  { id: "auto_collections", icon: Sparkles, label: "Auto collections AI", desc: "AI-generate smart collections from products", color: "text-primary" },
  { id: "collection_seo", icon: Globe, label: "Collection SEO AI", desc: "SEO-optimize collections for Google rankings", color: "text-success" },
  { id: "feed_optimise", icon: Sparkles, label: "AI Feed Optimisation", desc: "Generate Google Shopping product_detail attributes", color: "text-primary" },
  { id: "feed_health", icon: Globe, label: "Google Feed Health", desc: "Fix gender, age_group, color — push to Shopify", color: "text-success" },
  { id: "learning_memory", icon: Brain, label: "Learning memory", desc: "View learned invoice patterns by supplier", color: "text-secondary" },
  { id: "image_optimise", icon: Image, label: "Image optimisation AI", desc: "Alt text, filenames, quality analysis", color: "text-primary" },
  { id: "collection_seo_export", icon: Globe, label: "Bulk Collection SEO", desc: "Export, optimize & import collection SEO", color: "text-success" },
  { id: "csv_seo", icon: Search, label: "CSV SEO Optimizer", desc: "Upload Shopify CSV, AI-optimize SEO fields, download ready-to-import file", color: "text-success" },
  // Marketing
  { id: "ads_guide", icon: Globe, label: "Ads & SEO guides", desc: "Google Ads, Meta Ads & SEO step-by-step guides", color: "text-primary" },
  { id: "google_ads_wizard", icon: ShoppingCart, label: "Google Ads setup", desc: "Set up Google Shopping campaigns with margin checks", color: "text-success" },
  { id: "meta_ads_wizard", icon: Globe, label: "Meta Ads setup", desc: "Set up Meta/Facebook ad campaigns", color: "text-primary" },
  { id: "performance_dash", icon: Monitor, label: "Ad performance", desc: "Track ROI, spend & ROAS across channels", color: "text-success" },
  { id: "organic_seo", icon: Search, label: "Organic SEO blog", desc: "Build topical authority with AI blog posts", color: "text-primary" },
  { id: "social_media", icon: Mail, label: "Social media", desc: "Auto-generate social captions & announcements", color: "text-secondary" },
  { id: "competitor_intel", icon: Bot, label: "Competitor intel", desc: "Analyse competitor pricing & positioning", color: "text-primary" },
  { id: "price_monitor", icon: DollarSign, label: "Price monitor", desc: "Monitor & match competitor prices in real-time", color: "text-success" },
  { id: "geo_agentic", icon: Globe, label: "Local SEO", desc: "Geo-targeted SEO for local store visibility", color: "text-success" },
];

const quickInserts = [
  { label: "+ Brand prefix", text: "Add [BRAND NAME] at the start of every product name." },
  { label: "+ Title case", text: "Title case all product names (capitalise each word)." },
  { label: "+ Map price cols", text: "QTY column means quantity. First price = cost, second = retail." },
  { label: "+ Abbreviation", text: "Replace '[ABBR]' with '[FULL WORD]' in all names." },
];

// ── Tag Builder Panel ──────────────────────────────────────
function TagBuilderPanel({ onBack }: { onBack: () => void }) {
  const [subPanel, setSubPanel] = useState<'preview' | 'types' | 'layers' | 'rules'>('preview');
  const [config, setConfig] = useState<TagConfig>(getTagConfig);
  const save = (c: TagConfig) => { setConfig(c); saveTagConfig(c); };

  if (subPanel === 'types') return <ProductTypeManager config={config} onSave={save} onBack={() => setSubPanel('preview')} />;
  if (subPanel === 'layers') return <LayerManager config={config} onSave={save} onBack={() => setSubPanel('preview')} />;
  if (subPanel === 'rules') return <SpecialRulesManager config={config} onSave={save} onBack={() => setSubPanel('preview')} />;
  return <TagPreview config={config} onBack={onBack} onNavigate={setSubPanel} onReset={() => { resetTagConfig(); setConfig(getIndustryTagDefaults()); }} />;
}

function TagPreview({ config, onBack, onNavigate, onReset }: {
  config: TagConfig; onBack: () => void;
  onNavigate: (p: 'types' | 'layers' | 'rules') => void;
  onReset: () => void;
}) {
  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [productType, setProductType] = useState(config.productTypes[0]?.name || '');
  const [gender, setGender] = useState('Womens');
  const [priceStatus, setPriceStatus] = useState<'full_price' | 'sale'>('full_price');
  const [copied, setCopied] = useState(false);

  const input: TagInput = { title, brand, productType, gender, priceStatus, description: title };
  const tags = generateTags(input, config);
  const activeLayers = config.layers.filter(l => l.active).sort((a, b) => a.order - b.order);

  const handleCopy = () => { navigator.clipboard.writeText(tags.join(', ')); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold font-display">🏷️ Tag Builder</h2>
      </div>

      {/* Lightspeed tag note */}
      {(() => { const m = getStoreConfig(); const isLS = m.storeType === 'lightspeed' || m.storeType === 'lightspeed_shopify'; return isLS ? (
        <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 mb-4 flex items-start gap-2">
          <Monitor className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">Tags generated here will appear in Lightspeed POS.{m.storeType === 'lightspeed_shopify' ? ' The same tags will sync to Shopify automatically.' : ''}</p>
        </div>
      ) : null; })()}

      <div className="flex gap-2 mb-4 overflow-x-auto">
        {([
          { key: 'types' as const, label: 'Product Types', count: config.productTypes.length },
          { key: 'layers' as const, label: 'Tag Layers', count: config.layers.filter(l => l.active).length },
          { key: 'rules' as const, label: 'Special Rules', count: config.specialRules.filter(r => r.active).length },
        ]).map(btn => (
          <button key={btn.key} onClick={() => onNavigate(btn.key)}
            className="px-3 py-2 rounded-lg bg-muted border border-border text-xs font-medium whitespace-nowrap active:bg-accent">
            {btn.label} <span className="text-muted-foreground">({btn.count})</span>
          </button>
        ))}
        <button onClick={onReset} className="px-3 py-2 rounded-lg bg-muted border border-border text-xs font-medium whitespace-nowrap text-destructive active:bg-accent">
          <RotateCcw className="w-3 h-3 inline mr-1" />Reset
        </button>
      </div>

      <div className="space-y-3 mb-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Product title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Mara One Piece"
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
              {config.productTypes.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Gender</label>
            <select value={gender} onChange={e => setGender(e.target.value)}
              className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm text-foreground">
              {(config.layers.find(l => l.name === 'Gender')?.values || ['Womens', 'Mens', 'Kids', 'Unisex']).map(v =>
                <option key={v} value={v}>{v}</option>
              )}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Price status</label>
            <select value={priceStatus} onChange={e => setPriceStatus(e.target.value as 'full_price' | 'sale')}
              className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm text-foreground">
              <option value="full_price">Full price</option>
              <option value="sale">On sale</option>
            </select>
          </div>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Generated Tags</h3>
            <button onClick={handleCopy} className="text-xs text-primary flex items-center gap-1">
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {tags.map((tag, i) => (
              <span key={i} className="px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">{tag}</span>
            ))}
          </div>
          <p className="text-xs font-mono-data text-muted-foreground break-all">{tags.join(', ')}</p>
        </div>
      )}

      <div className="bg-card rounded-lg border border-border p-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Layer breakdown</h4>
        <div className="space-y-1">
          {activeLayers.map((layer, i) => (
            <div key={layer.id} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">L{i + 1} — {layer.name}</span>
              <span className="font-mono-data text-foreground">{tags[i] || '—'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProductTypeManager({ config, onSave, onBack }: { config: TagConfig; onSave: (c: TagConfig) => void; onBack: () => void }) {
  const [newName, setNewName] = useState('');
  const [newTag, setNewTag] = useState('');
  const [newDept, setNewDept] = useState('');

  const add = () => {
    if (!newName.trim()) return;
    onSave({ ...config, productTypes: [...config.productTypes, { name: newName.trim(), tag: newTag.trim() || toTag(newName.trim()), department: newDept.trim() || undefined }] });
    setNewName(''); setNewTag(''); setNewDept('');
  };

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold font-display">Product Types</h2>
      </div>
      <div className="space-y-2 mb-4">
        {config.productTypes.map((pt, i) => (
          <div key={i} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2 border border-border">
            <div>
              <span className="text-sm font-medium">{pt.name}</span>
              <span className="text-xs text-muted-foreground ml-2 font-mono-data">{pt.tag}</span>
              {pt.department && <span className="text-xs text-muted-foreground ml-2">· {pt.department}</span>}
            </div>
            <button onClick={() => onSave({ ...config, productTypes: config.productTypes.filter((_, j) => j !== i) })} className="text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="bg-card rounded-lg border border-border p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Add product type</p>
        <input value={newName} onChange={e => { setNewName(e.target.value); setNewTag(toTag(e.target.value)); }}
          placeholder="Type name" className="w-full h-9 rounded-md bg-input border border-border px-3 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="Tag value" className="h-9 rounded-md bg-input border border-border px-3 text-xs font-mono-data" />
          <input value={newDept} onChange={e => setNewDept(e.target.value)} placeholder="Department" className="h-9 rounded-md bg-input border border-border px-3 text-xs" />
        </div>
        <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={add}><Plus className="w-3 h-3 mr-1" /> Add type</Button>
      </div>
    </div>
  );
}

function LayerManager({ config, onSave, onBack }: { config: TagConfig; onSave: (c: TagConfig) => void; onBack: () => void }) {
  const sorted = [...config.layers].sort((a, b) => a.order - b.order);
  const [addName, setAddName] = useState('');

  const toggleLayer = (id: string) => onSave({ ...config, layers: config.layers.map(l => l.id === id ? { ...l, active: !l.active } : l) });

  const moveLayer = (id: string, dir: -1 | 1) => {
    const idx = sorted.findIndex(l => l.id === id);
    if ((dir === -1 && idx === 0) || (dir === 1 && idx === sorted.length - 1)) return;
    const swapWith = sorted[idx + dir];
    onSave({ ...config, layers: config.layers.map(l => {
      if (l.id === id) return { ...l, order: swapWith.order };
      if (l.id === swapWith.id) return { ...l, order: sorted[idx].order };
      return l;
    }) });
  };

  const addLayer = () => {
    if (!addName.trim()) return;
    onSave({ ...config, layers: [...config.layers, { id: Math.random().toString(36).slice(2, 10), name: addName.trim(), description: '', type: 'auto', values: [], active: true, order: sorted.length + 1 }] });
    setAddName('');
  };

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold font-display">Tag Layers</h2>
      </div>
      <div className="space-y-2 mb-4">
        {sorted.map((layer, i) => (
          <div key={layer.id} className={`flex items-center gap-2 rounded-lg px-3 py-2.5 border ${layer.active ? 'bg-card border-border' : 'bg-muted/30 border-border/50 opacity-60'}`}>
            <div className="flex flex-col gap-0.5">
              <button onClick={() => moveLayer(layer.id, -1)} className="text-muted-foreground text-xs leading-none">▲</button>
              <button onClick={() => moveLayer(layer.id, 1)} className="text-muted-foreground text-xs leading-none">▼</button>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">L{i + 1} — {layer.name}</p>
              <p className="text-xs text-muted-foreground truncate">{layer.description || layer.type}</p>
            </div>
            <button onClick={() => toggleLayer(layer.id)}>
              {layer.active ? <ToggleRight className="w-5 h-5 text-success" /> : <ToggleLeft className="w-5 h-5 text-muted-foreground" />}
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="New layer name"
          className="flex-1 h-9 rounded-md bg-input border border-border px-3 text-sm" onKeyDown={e => e.key === 'Enter' && addLayer()} />
        <Button variant="outline" size="sm" className="h-9 text-xs" onClick={addLayer}><Plus className="w-3 h-3 mr-1" /> Add</Button>
      </div>
    </div>
  );
}

function SpecialRulesManager({ config, onSave, onBack }: { config: TagConfig; onSave: (c: TagConfig) => void; onBack: () => void }) {
  const [newKw, setNewKw] = useState('');
  const [newTag, setNewTag] = useState('');

  const addRule = () => {
    if (!newKw.trim()) return;
    onSave({ ...config, specialRules: [...config.specialRules, {
      id: Math.random().toString(36).slice(2, 10), keyword: newKw.trim(), tag: newTag.trim() || toTag(newKw.trim()),
      caseSensitive: false, matchType: 'contains', searchTitle: true, searchDescription: true, active: true,
    }] });
    setNewKw(''); setNewTag('');
  };

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold font-display">Special Properties</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-3">Keywords detected in product titles/descriptions that automatically add tags.</p>
      <div className="space-y-2 mb-4">
        {config.specialRules.map(rule => (
          <div key={rule.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${rule.active ? 'bg-card border-border' : 'bg-muted/30 border-border/50 opacity-60'}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">"{rule.keyword}"</span>
                <span className="text-xs text-muted-foreground">→</span>
                <span className="text-xs font-mono-data text-primary">{rule.tag}</span>
              </div>
              <p className="text-xs text-muted-foreground">{rule.matchType} · {rule.searchTitle && rule.searchDescription ? 'title + desc' : rule.searchTitle ? 'title' : 'desc'}</p>
            </div>
            <button onClick={() => onSave({ ...config, specialRules: config.specialRules.map(r => r.id === rule.id ? { ...r, active: !r.active } : r) })}>
              {rule.active ? <ToggleRight className="w-5 h-5 text-success" /> : <ToggleLeft className="w-5 h-5 text-muted-foreground" />}
            </button>
            <button onClick={() => onSave({ ...config, specialRules: config.specialRules.filter(r => r.id !== rule.id) })} className="text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="bg-card rounded-lg border border-border p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">Add rule</p>
        <div className="grid grid-cols-2 gap-2">
          <input value={newKw} onChange={e => { setNewKw(e.target.value); setNewTag(toTag(e.target.value)); }}
            placeholder="Keyword" className="h-9 rounded-md bg-input border border-border px-3 text-sm" />
          <input value={newTag} onChange={e => setNewTag(e.target.value)}
            placeholder="Tag to add" className="h-9 rounded-md bg-input border border-border px-3 text-xs font-mono-data" />
        </div>
        <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={addRule}><Plus className="w-3 h-3 mr-1" /> Add rule</Button>
      </div>
    </div>
  );
}

// ── Brand Directory Panel ──────────────────────────────────
function BrandDirectoryPanel({ onBack }: { onBack: () => void }) {
  const store = getStoreConfig();
  const [brands, setBrands] = useState<BrandDirectoryEntry[]>(() => sortBrandsByIndustry(getBrandDirectory(), store.industry));
  const [query, setQuery] = useState('');
  const [industryFilter, setIndustryFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => setBrands(sortBrandsByIndustry(getBrandDirectory(), store.industry));
  const filtered = searchBrands(brands, query, industryFilter, countryFilter, statusFilter);
  const industries = getIndustryList();
  const countries = [...new Set(brands.map(b => b.country))].sort();

  const handleDelete = (id: string) => { deleteBrand(id); refresh(); };
  const handleExport = () => {
    const csv = exportBrandsCSV(brands);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'brand_directory.csv'; a.click();
    URL.revokeObjectURL(url);
  };
  const handleTemplate = () => {
    const csv = getCSVTemplate();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'brand_template.csv'; a.click();
    URL.revokeObjectURL(url);
  };
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = importBrandsCSV(ev.target?.result as string);
      setImportResult({ imported: result.imported.length, skipped: result.skipped.length });
      refresh();
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const statusBadge = (s: string) => {
    switch (s) {
      case 'system': return <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Built-in</span>;
      case 'custom': return <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">Custom</span>;
      case 'unverified': return <span className="text-xs px-1.5 py-0.5 rounded bg-warning/10 text-warning">Unverified</span>;
      case 'catalog': return <span className="text-xs px-1.5 py-0.5 rounded bg-success/10 text-success">Catalog</span>;
      default: return null;
    }
  };

  if (showAdd) {
    return <AddBrandForm onBack={() => { setShowAdd(false); refresh(); }} storeIndustry={store.industry} />;
  }

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold font-display">📚 Brand Directory</h2>
      </div>

      {/* Search */}
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search brands..."
        className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm mb-3" />

      {/* Filters */}
      <div className="flex gap-2 mb-3 overflow-x-auto">
        <select value={industryFilter} onChange={e => setIndustryFilter(e.target.value)}
          className="h-8 rounded-md bg-input border border-border px-2 text-xs text-foreground">
          <option value="all">All industries</option>
          {industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select value={countryFilter} onChange={e => setCountryFilter(e.target.value)}
          className="h-8 rounded-md bg-input border border-border px-2 text-xs text-foreground">
          <option value="all">All countries</option>
          {countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-8 rounded-md bg-input border border-border px-2 text-xs text-foreground">
          <option value="all">All status</option>
          <option value="system">Built-in</option>
          <option value="custom">Custom</option>
          <option value="unverified">Unverified</option>
        </select>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-4">
        <Button variant="teal" size="sm" className="h-8 text-xs flex-1" onClick={() => setShowAdd(true)}>
          <Plus className="w-3 h-3 mr-1" /> Add brand
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => fileRef.current?.click()}>
          <Upload className="w-3 h-3 mr-1" /> Import
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExport}>
          <Download className="w-3 h-3 mr-1" /> Export
        </Button>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
      </div>

      {/* Import result */}
      {importResult && (
        <div className="bg-success/10 border border-success/20 rounded-lg p-3 mb-3">
          <p className="text-xs text-success font-medium">✅ {importResult.imported} brands imported{importResult.skipped > 0 ? ` · ${importResult.skipped} skipped (duplicates)` : ''}</p>
          <button onClick={() => setImportResult(null)} className="text-xs text-muted-foreground mt-1">Dismiss</button>
        </div>
      )}

      {/* Brand count */}
      <p className="text-xs text-muted-foreground mb-2">{filtered.length} of {brands.length} brands</p>

      {/* Brand list */}
      <div className="space-y-2">
        {filtered.slice(0, 50).map(brand => (
          <div key={brand.id} className="bg-card rounded-lg border border-border p-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold">{brand.name}</span>
                  {statusBadge(brand.status)}
                </div>
                {brand.website && (
                  <a href={`https://${brand.website}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary flex items-center gap-1">
                    {brand.website} <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">{brand.industry}</span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs font-mono-data text-muted-foreground">{brand.tag}</span>
                  {brand.aliases.length > 0 && (
                    <>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">{brand.aliases.length} alias{brand.aliases.length > 1 ? 'es' : ''}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-1.5 ml-2">
                {brand.website && (
                  <a href={`https://${brand.website}`} target="_blank" rel="noopener noreferrer"
                    className="text-muted-foreground p-1"><ExternalLink className="w-3.5 h-3.5" /></a>
                )}
                {brand.status !== 'system' && (
                  <button onClick={() => handleDelete(brand.id)} className="text-destructive p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                )}
              </div>
            </div>
          </div>
        ))}
        {filtered.length > 50 && <p className="text-xs text-muted-foreground text-center py-2">Showing first 50 of {filtered.length} brands</p>}
      </div>

      {/* Template download */}
      <button onClick={handleTemplate} className="text-xs text-primary mt-4 block">Download CSV template for bulk import →</button>
    </div>
  );
}

function AddBrandForm({ onBack, storeIndustry }: { onBack: () => void; storeIndustry: string }) {
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [website, setWebsite] = useState('');
  const [tag, setTag] = useState('');
  const [industry, setIndustry] = useState(storeIndustry);
  const [country, setCountry] = useState('AU');
  const [notes, setNotes] = useState('');
  const industries = getIndustryList();

  const handleSave = () => {
    if (!name.trim()) return;
    addBrand({
      name: name.trim(),
      aliases: aliases.split(',').map(a => a.trim()).filter(Boolean),
      website: website.trim(),
      category: industry,
      industry,
      country,
      tag: tag.trim() || name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(),
      status: 'custom',
      notes: notes.trim(),
      addedBy: 'user',
    });
    onBack();
  };

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold font-display">Add Brand</h2>
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Brand name *</label>
          <input value={name} onChange={e => { setName(e.target.value); setTag(e.target.value.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()); }}
            placeholder="e.g. MECCA" className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Also known as (comma separated)</label>
          <input value={aliases} onChange={e => setAliases(e.target.value)}
            placeholder="e.g. MECCA Cosmetica, MECCA Brands Pty Ltd" className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Official website</label>
          <input value={website} onChange={e => setWebsite(e.target.value)}
            placeholder="e.g. mecca.com.au" className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Shopify tag</label>
          <input value={tag} onChange={e => setTag(e.target.value)}
            placeholder="Auto-generated" className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm font-mono-data" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Industry</label>
            <select value={industry} onChange={e => setIndustry(e.target.value)}
              className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm text-foreground">
              {industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Country</label>
            <select value={country} onChange={e => setCountry(e.target.value)}
              className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm text-foreground">
              {['AU', 'US', 'UK', 'NZ', 'CA', 'FR', 'IT', 'DE', 'JP', 'EU'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Optional notes" className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm resize-none" />
        </div>
        {website && (
          <a href={`https://${website}`} target="_blank" rel="noopener noreferrer"
            className="text-xs text-primary flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> Test website →
          </a>
        )}
        <Button variant="teal" className="w-full h-11" onClick={handleSave} disabled={!name.trim()}>Save brand</Button>
      </div>
    </div>
  );
}

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
      <div className="bg-muted/50 rounded-lg p-3 border border-border mb-4">
        <p className="text-xs text-muted-foreground">Template: <span className="font-mono text-foreground text-xs">{store.seoTitleTemplate || '{product} | {brand} | {store}'}</span></p>
        <p className="text-xs text-muted-foreground mt-0.5">Store: <span className="font-medium text-foreground">{store.name || 'Not set'}</span> · {industry.displayName}</p>
      </div>
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
      {productName && brand && (
        <>
          <div className="mb-4">
            <p className="text-xs text-muted-foreground mb-2 font-medium">Google preview</p>
            <div className="bg-background rounded-lg border border-border p-4">
              <p className="text-primary text-base leading-snug truncate" style={{ fontFamily: 'Arial, sans-serif' }}>{seo.seoTitle}</p>
              <p className="text-success text-xs mt-0.5 truncate" style={{ fontFamily: 'Arial, sans-serif' }}>{store.url || 'yourstore.com'} › products</p>
              <p className="text-muted-foreground text-xs mt-1 leading-relaxed line-clamp-2" style={{ fontFamily: 'Arial, sans-serif' }}>{seo.seoDescription}</p>
            </div>
            <div className="flex gap-4 mt-2">
              <span className={`text-xs font-mono ${titleColor}`}>Title: {seo.titleLength}/70</span>
              <span className={`text-xs font-mono ${descColor}`}>Desc: {seo.descLength}/160</span>
            </div>
          </div>
          <div className="space-y-3">
            <div><label className="text-xs text-muted-foreground mb-1 block">SEO Title</label><div className="bg-muted rounded-md px-3 py-2 text-sm font-mono-data break-all">{seo.seoTitle}</div></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Meta Description</label><div className="bg-muted rounded-md px-3 py-2 text-sm font-mono-data break-all">{seo.seoDescription}</div></div>
            <Button variant="outline" className="w-full" onClick={() => navigator.clipboard.writeText(`${seo.seoTitle}\n${seo.seoDescription}`)}>Copy to clipboard</Button>
          </div>
        </>
      )}
    </div>
  );
}
// ── Google Feed Preview Panel ──────────────────────────────
function GoogleFeedPanel({ onBack }: { onBack: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saleStart, setSaleStart] = useState('');
  const [saleEnd, setSaleEnd] = useState('');
  const [marginFloor, setMarginFloorState] = useState(getMarginFloor);

  const getSaleDateStr = () => {
    if (!saleStart || !saleEnd) return '';
    return `${saleStart}T00:00+10:00/${saleEnd}T23:59+10:00`;
  };

  // Load last invoice products from localStorage
  const getProducts = () => {
    try {
      const raw = localStorage.getItem("last_enriched_products");
      if (raw) return JSON.parse(raw) as { name: string; brand: string; type: string; price: number; rrp: number; tags?: string }[];
      return [];
    } catch { return []; }
  };

  const products = getProducts();
  const hasProducts = products.length > 0;

  const xml = hasProducts ? generateGoogleFeedXML(products, undefined, getSaleDateStr()) : '';

  const handleDownloadXML = () => {
    if (!hasProducts) return;
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'google_shopping_feed.xml'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadTSV = () => {
    if (!hasProducts) return;
    const tsv = generateGoogleFeedTSV(products, getSaleDateStr());
    const blob = new Blob(['\uFEFF' + tsv], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'google_shopping_feed.tsv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    if (!xml) return;
    navigator.clipboard.writeText(xml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold font-display">Google Shopping feed</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Preview and download a Google Merchant Center-ready product feed from your current invoice batch
      </p>

      <div className="bg-card rounded-lg border border-border p-4 mb-4">
        <p className="text-sm text-muted-foreground">
          {hasProducts
            ? `${products.length} products ready for Google Shopping feed.`
            : 'Load an invoice first to generate the feed preview.'}
        </p>
      </div>

      {hasProducts && (
        <>
          <div className="bg-card rounded-lg border border-border p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Feed preview</h3>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleCopy}>
                {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy XML</>}
              </Button>
            </div>
            <pre className="text-[10.5px] font-mono-data text-muted-foreground bg-muted/50 rounded-lg p-3 max-h-80 overflow-auto whitespace-pre-wrap break-all">
              {xml.slice(0, 2000)}{xml.length > 2000 ? `\n\n... (${products.length} products total)` : ''}
            </pre>
          </div>

          {/* Sale dates */}
          <div className="bg-card rounded-lg border border-border p-4 mb-4">
            <h3 className="text-sm font-semibold mb-2">Sale dates (optional)</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">Sale starts</label>
                <input type="date" value={saleStart} onChange={e => setSaleStart(e.target.value)}
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">Sale ends</label>
                <input type="date" value={saleEnd} onChange={e => setSaleEnd(e.target.value)}
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Leave blank to omit — Google will show the sale indefinitely until you update the feed.
            </p>
          </div>

          <div className="flex gap-3 mb-4">
            <Button variant="default" className="flex-1 h-11 gap-2" onClick={handleDownloadXML}>
              <Download className="w-4 h-4" /> Download feed (.xml)
            </Button>
            <Button variant="outline" size="sm" className="h-11 text-xs" onClick={handleDownloadTSV}>
              Download as TSV
            </Button>
          </div>
        </>
      )}

      {/* Promotions feed section */}
      {(() => {
        const saleMeta = getSaleMeta();
        const hasPromo = saleMeta && saleMeta.direction === 'apply';
        return (
          <div className="bg-card rounded-lg border border-border p-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold mb-0.5">Promotions feed</h3>
                <p className="text-xs text-muted-foreground">
                  {hasPromo
                    ? `${saleMeta.pct}% off — ${saleMeta.tags.slice(0, 2).join(', ') || 'selected products'} — applied ${new Date(saleMeta.appliedAt).toLocaleDateString('en-AU')}`
                    : 'No sale applied yet'}
                </p>
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1" disabled={!hasPromo} onClick={() => {
                const xml = generatePromotionsFeed();
                if (!xml) return;
                const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'google_promotions_feed.xml'; a.click();
                URL.revokeObjectURL(url);
              }}>
                <Download className="w-3 h-3" /> Download
              </Button>
            </div>
          </div>
        );
      })()}

      {/* Automated Discounts section */}
      <div className="bg-card rounded-lg border border-border p-4 mb-4">
        <h3 className="text-sm font-semibold mb-1">Google Automated Discounts</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
          Your feed includes cost and minimum price data. Enrol in Google Merchant Center → Growth → Manage programs → Automated Discounts.
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Margin floor: <strong className="text-foreground">Cost × {marginFloor.toFixed(2)}</strong></span>
          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => {
            const val = prompt(
              'Set minimum margin multiplier:\n1.20 = 20% above cost (recommended)\n1.15 = 15% above cost\n1.30 = 30% above cost\n\nCurrent: ' + marginFloor.toFixed(2),
              String(marginFloor)
            );
            const num = parseFloat(val || '');
            if (!isNaN(num) && num >= 1.0 && num <= 3.0) {
              setMarginFloor(num);
              setMarginFloorState(num);
            }
          }}>
            Change
          </Button>
        </div>
        {hasProducts && (() => {
          const withCogs = products.filter(p => (p as any).cogs && (p as any).cogs > 0).length;
          return (
            <p className={`text-[11px] mt-2 font-mono ${withCogs === products.length ? 'text-success' : 'text-warning'}`}>
              {withCogs}/{products.length} products have cost data
            </p>
          );
        })()}
      </div>

      {/* Local Inventory feed section */}
      <div className="bg-card rounded-lg border border-border p-4 mb-4">
        <h3 className="text-sm font-semibold mb-1">Local Inventory feed</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
          Shows "In stock nearby" in Google Shopping for local shoppers. Submit to Merchant Center → Products → Local products → Feeds.
        </p>
        {(() => {
          const store = getLocalStoreSettings();
          if (!store) return (
            <p className="text-[11px] text-muted-foreground">
              Store details not set. Add a retail location with address in Settings → Locations.
            </p>
          );
          return (
            <>
              <p className="text-[11px] text-success font-mono mb-2">Store: {store.name} ({store.code})</p>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1" disabled={!hasProducts} onClick={() => {
                const feedProducts = products.map(p => ({
                  id: `${p.name}-${p.brand}`.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 60),
                  price: p.price,
                  rrp: p.rrp,
                  qty: 1,
                }));
                const xml = generateLocalInventoryFeed(feedProducts, store);
                const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'google_local_inventory.xml'; a.click();
                URL.revokeObjectURL(url);
              }}>
                <Download className="w-3 h-3" /> Download local inventory feed
              </Button>
            </>
          );
        })()}
        <p className="text-[10px] text-muted-foreground mt-2">
          First time? Also submit a Store feed in Google Merchant Center → Business information → Stores to register your physical location.
        </p>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
        <p className="text-xs font-semibold text-primary mb-1">💡 How to submit to Google Merchant Center:</p>
        <p className="text-xs text-muted-foreground">
          Google Merchant Center → Products → Feeds → Add feed → Upload file → select the downloaded .xml file. Allow up to 24 hours for review.
        </p>
      </div>
    </div>
  );
}
// ── Image Download Helper Panel ──────────────────────────────
type EnrichedImageProduct = {
  title: string;
  sku?: string;
  colour?: string;
  imageSrc: string;
  imageUrls?: string[];
};

function slugifyForFilename(s: string): string {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function ImageTile({ product, index, onReenrich }: { product: EnrichedImageProduct; index: number; onReenrich: () => void }) {
  const [errored, setErrored] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const url = product.imageSrc || (product.imageUrls && product.imageUrls[0]) || '';
  let domain = '';
  try { domain = url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch {}

  const filename = (() => {
    const sku = slugifyForFilename(product.sku || '');
    const colour = slugifyForFilename(product.colour || '');
    const base = sku || slugifyForFilename(product.title) || `image-${index + 1}`;
    return colour ? `${base}-${colour}.jpg` : `${base}.jpg`;
  })();

  const handleDownload = async () => {
    if (!url) return;
    setDownloading(true);
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      window.open(url, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-card rounded-md border border-border overflow-hidden flex flex-col">
      <div className="relative w-full aspect-square bg-muted">
        {!errored && url ? (
          <img
            src={url}
            alt={product.title}
            crossOrigin="anonymous"
            className="w-full h-full object-cover cursor-pointer"
            onClick={() => window.open(url, '_blank')}
            onLoad={(e) => {
              const img = e.currentTarget;
              setDims({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setErrored(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center p-2 gap-2">
            <p className="text-[10px] text-muted-foreground leading-tight">Image not available — try re-enriching</p>
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={onReenrich}>
              Re-enrich
            </Button>
          </div>
        )}
      </div>
      <div className="p-2 space-y-0.5">
        <p className="text-[11px] font-medium truncate" title={product.title}>{product.title}</p>
        {product.sku && <p className="text-[10px] text-muted-foreground truncate font-mono-data">{product.sku}</p>}
        {!errored && dims && (
          <p className="text-[10px] text-muted-foreground">{dims.w} × {dims.h}px</p>
        )}
        {!errored && domain && (
          <p className="text-[10px] text-muted-foreground truncate">{domain}</p>
        )}
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-[11px] gap-1 mt-1"
          onClick={handleDownload}
          disabled={errored || !url || downloading}
        >
          <Download className="w-3 h-3" /> {downloading ? 'Downloading…' : 'Download'}
        </Button>
      </div>
    </div>
  );
}

function ImageHelperPanel({ onBack }: { onBack: () => void }) {
  const [copied, setCopied] = useState(false);

  const getEnrichedProducts = (): EnrichedImageProduct[] => {
    try {
      const raw = localStorage.getItem('last_enriched_products');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((p: any) => p.imageSrc || (p.imageUrls && p.imageUrls.length > 0)) : [];
    } catch { return []; }
  };

  const products = getEnrichedProducts();

  const copyUrlList = () => {
    const list = products.map(p => `${p.title}\t${p.imageSrc}`).join('\n');
    navigator.clipboard.writeText(list);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openAllTabs = () => {
    const urls = products.map(p => p.imageSrc).filter(Boolean);
    if (urls.length === 0) return;
    if (urls.length > 20 && !confirm(`Open ${urls.length} tabs? Your browser may block this.`)) return;
    urls.forEach(url => window.open(url, '_blank'));
  };

  const handleReenrich = () => {
    alert('Open the invoice review screen and click Enrich All to refetch images.');
  };

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
        <h2 className="text-lg font-semibold font-display">🖼 Image download helper</h2>
      </div>

      <p className="text-sm text-muted-foreground mb-5">
        Shopify imports images automatically from URLs. Use this if you also want the files on your computer.
      </p>

      <div className="bg-card rounded-lg border border-border p-4 mb-4">
        <h3 className="text-sm font-semibold mb-1">Images from last import</h3>
        <p className="text-xs text-muted-foreground mb-4">
          {products.length > 0 ? `${products.length} products with images` : 'No enriched products yet. Run Enrich All on an invoice first.'}
        </p>

        {products.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
            {products.map((p, i) => (
              <ImageTile key={i} product={p} index={i} onReenrich={handleReenrich} />
            ))}
          </div>
        )}

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-primary">💡 Tip:</span> Use the Download button on each tile to save with SKU-based filenames, or "Open all in tabs" to save many at once.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="teal" size="sm" className="flex-1 gap-1" onClick={openAllTabs} disabled={products.length === 0}>
            <ExternalLink className="w-3.5 h-3.5" /> Open all in tabs
          </Button>
          <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={copyUrlList} disabled={products.length === 0}>
            {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy URL list</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
// ── Learning Memory Panel ──────────────────────────────────
import { getMemoryList, deleteMemory, type InvoiceMemory } from "@/lib/invoice-learning";
import { getLayoutLabel } from "@/lib/invoice-templates";

function LearningMemoryPanel({ onBack }: { onBack: () => void }) {
  const [memories, setMemories] = useState<InvoiceMemory[]>(getMemoryList());
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = () => setMemories(getMemoryList());
  const handleDelete = (supplier: string) => {
    deleteMemory(supplier);
    refresh();
  };

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground mb-4 hover:text-foreground transition-colors">
        <ChevronLeft className="w-3.5 h-3.5" /> Back to Tools
      </button>
      <h2 className="text-lg font-bold text-foreground mb-1 flex items-center gap-2">
        <Brain className="w-5 h-5 text-secondary" /> Learning Memory
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        Invoice patterns learned from your uploads. The more you parse, the smarter extraction becomes.
      </p>

      {memories.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Brain className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No patterns learned yet</p>
          <p className="text-xs mt-1">Upload and parse an invoice to start building memory.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-card border border-border rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-foreground">{memories.length}</p>
              <p className="text-[10px] text-muted-foreground">Suppliers learned</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-foreground">{memories.reduce((s, m) => s + m.totalParses, 0)}</p>
              <p className="text-[10px] text-muted-foreground">Total parses</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-foreground">{memories.reduce((s, m) => s + m.totalCorrections, 0)}</p>
              <p className="text-[10px] text-muted-foreground">Corrections learned</p>
            </div>
          </div>

          {memories.map(mem => {
            const isOpen = expanded === mem.supplierName;
            return (
              <div key={mem.supplierName} className="border border-border rounded-lg bg-card overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : mem.supplierName)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{mem.supplierName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {getLayoutLabel(mem.fingerprint.layoutType as any)} • {mem.totalParses} parse{mem.totalParses !== 1 ? "s" : ""}
                      {mem.confidenceBoost > 0 && <span className="text-success ml-1">+{mem.confidenceBoost} boost</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {mem.totalCorrections > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/15 text-secondary">
                        {mem.totalCorrections} corrections
                      </span>
                    )}
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border px-4 py-3 space-y-3 text-xs">
                    <div>
                      <p className="font-semibold text-foreground mb-1.5">📐 Layout Fingerprint</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                        <div className="flex gap-2"><span className="text-muted-foreground w-24 shrink-0">Layout:</span><span className="text-foreground">{mem.fingerprint.layoutType}</span></div>
                        <div className="flex gap-2"><span className="text-muted-foreground w-24 shrink-0">Variant method:</span><span className="text-foreground">{mem.fingerprint.variantMethod}</span></div>
                        <div className="flex gap-2"><span className="text-muted-foreground w-24 shrink-0">Size system:</span><span className="text-foreground">{mem.fingerprint.sizeSystem}</span></div>
                        <div className="flex gap-2"><span className="text-muted-foreground w-24 shrink-0">Grouping:</span><span className="text-foreground">{mem.fingerprint.groupingRequired ? "Yes" : "No"}</span></div>
                        {mem.fingerprint.costFieldRule && <div className="flex gap-2 col-span-2"><span className="text-muted-foreground w-24 shrink-0">Cost field:</span><span className="text-foreground">{mem.fingerprint.costFieldRule}</span></div>}
                        {mem.fingerprint.quantityFieldRule && <div className="flex gap-2 col-span-2"><span className="text-muted-foreground w-24 shrink-0">Qty field:</span><span className="text-foreground">{mem.fingerprint.quantityFieldRule}</span></div>}
                        {mem.fingerprint.lineItemZone && <div className="flex gap-2 col-span-2"><span className="text-muted-foreground w-24 shrink-0">Line-item zone:</span><span className="text-foreground">{mem.fingerprint.lineItemZone}</span></div>}
                      </div>
                      {mem.fingerprint.tableHeaders.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {mem.fingerprint.tableHeaders.map((h, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[9px]">{h}</span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="font-semibold text-foreground mb-1.5">📊 Stats</p>
                      <div className="flex gap-4 text-[11px]">
                        <span>Parses: <strong>{mem.totalParses}</strong></span>
                        <span>Corrections: <strong>{mem.totalCorrections}</strong></span>
                        <span>Boost: <strong className="text-success">+{mem.confidenceBoost}</strong></span>
                        <span>Noise: <strong>{mem.noisePatterns.length}</strong></span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">Last parsed: {new Date(mem.lastParsed).toLocaleDateString()}</p>
                    </div>

                    {mem.fieldCorrections.length > 0 && (
                      <div>
                        <p className="font-semibold text-foreground mb-1.5">✏️ Learned Corrections ({mem.fieldCorrections.length})</p>
                        <div className="space-y-0.5 max-h-32 overflow-y-auto">
                          {mem.fieldCorrections.map((fc, i) => (
                            <div key={i} className="flex items-center gap-2 text-[10px]">
                              <span className="px-1 py-0.5 rounded bg-primary/10 text-primary">{fc.field}</span>
                              <span className="text-muted-foreground line-through">{fc.pattern}</span>
                              <span className="text-foreground">→</span>
                              <span className="text-success font-medium">{fc.corrected}</span>
                              <span className="text-muted-foreground ml-auto">×{fc.occurrences}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {mem.noisePatterns.length > 0 && (
                      <div>
                        <p className="font-semibold text-foreground mb-1.5">🚫 Noise Patterns ({mem.noisePatterns.length})</p>
                        <div className="space-y-0.5 max-h-24 overflow-y-auto">
                          {mem.noisePatterns.slice(0, 10).map((np, i) => (
                            <div key={i} className="flex items-center gap-2 text-[10px]">
                              <span className="text-muted-foreground truncate max-w-[200px]">"{np.text}"</span>
                              <span className="text-destructive text-[9px]">{np.reason}</span>
                              <span className="text-muted-foreground ml-auto">×{np.occurrences}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {mem.groupingRules.length > 0 && (
                      <div>
                        <p className="font-semibold text-foreground mb-1.5">🔗 Grouping Rules</p>
                        {mem.groupingRules.map((g, i) => (
                          <p key={i} className="text-[10px] text-muted-foreground">• {g.description} (×{g.occurrences})</p>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2 pt-2 border-t border-border">
                      <Button variant="outline" size="sm" className="text-[10px] h-7 gap-1 text-destructive" onClick={() => handleDelete(mem.supplierName)}>
                        <Trash2 className="w-3 h-3" /> Delete Memory
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ToolsScreen = () => {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");

  if (activeTool === "price_lookup") return <PriceLookup onBack={() => setActiveTool(null)} />;
  if (activeTool === "supplier_emails") return <SupplierEmails onBack={() => setActiveTool(null)} />;
  if (activeTool === "seasons") return <SeasonManager onBack={() => setActiveTool(null)} />;
  if (activeTool === "seo") return <SeoWriterPanel onBack={() => setActiveTool(null)} />;
  if (activeTool === "tags") return <TagBuilderPanel onBack={() => setActiveTool(null)} />;
  if (activeTool === "brands") return <BrandDirectoryPanel onBack={() => setActiveTool(null)} />;
  if (activeTool === "google_feed") return <GoogleFeedPanel onBack={() => setActiveTool(null)} />;
  if (activeTool === "image_helper") return <ImageHelperPanel onBack={() => setActiveTool(null)} />;
  if (activeTool === "export_collections") return <ExportCollections onBack={() => setActiveTool(null)} />;
  if (activeTool === "import_collections") return <ImportCollections onBack={() => setActiveTool(null)} />;
  if (activeTool === "auto_collections") return <AutoCollectionBuilder onBack={() => setActiveTool(null)} />;
  if (activeTool === "collection_seo") return <CollectionSEOPanel onBack={() => setActiveTool(null)} />;
  if (activeTool === "feed_optimise") return <AIFeedOptimisation onBack={() => setActiveTool(null)} />;
  if (activeTool === "feed_health") return <FeedHealthPanel onBack={() => setActiveTool(null)} />;
  if (activeTool === "learning_memory") return <LearningMemoryPanel onBack={() => setActiveTool(null)} />;
  if (activeTool === "collection_seo_export") {
    const CollectionSEOExport = lazy(() => import("@/components/CollectionSEOExport"));
    return <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}><CollectionSEOExport onBack={() => setActiveTool(null)} /></Suspense>;
  }
  if (activeTool === "csv_seo") {
    const ShopifyCSVSEO = lazy(() => import("@/components/ShopifyCSVSEO"));
    return <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}><ShopifyCSVSEO onBack={() => setActiveTool(null)} /></Suspense>;
  }
  if (activeTool === "ads_guide") {
    const AdsGuideTabs = lazy(() => import("@/components/AdsGuideTabs"));
    return <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}><div className="animate-fade-in"><div className="px-4 pt-6"><div className="flex items-center gap-3 mb-2"><button onClick={() => setActiveTool(null)} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button><h2 className="text-lg font-semibold font-display">Ads & SEO Guides</h2></div></div><AdsGuideTabs /></div></Suspense>;
  }
  if (activeTool === "google_ads_wizard") {
    const GoogleAdsSetupWizard = lazy(() => import("@/components/GoogleAdsSetupWizard"));
    return <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}><GoogleAdsSetupWizard onBack={() => setActiveTool(null)} /></Suspense>;
  }
  if (activeTool === "meta_ads_wizard") {
    const MetaAdsSetupWizard = lazy(() => import("@/components/MetaAdsSetupWizard"));
    return <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}><MetaAdsSetupWizard onBack={() => setActiveTool(null)} /></Suspense>;
  }
  if (activeTool === "performance_dash") {
    const PerformanceDashboard = lazy(() => import("@/components/PerformanceDashboard"));
    return <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}><PerformanceDashboard onBack={() => setActiveTool(null)} /></Suspense>;
  }
  if (activeTool === "organic_seo") {
    const OrganicSEOFlow = lazy(() => import("@/components/OrganicSEOFlow"));
    return <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}><OrganicSEOFlow onBack={() => setActiveTool(null)} /></Suspense>;
  }
  if (activeTool === "social_media") {
    const SocialMediaPanel = lazy(() => import("@/components/SocialMediaPanel"));
    return <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}><SocialMediaPanel onBack={() => setActiveTool(null)} /></Suspense>;
  }
  if (activeTool === "competitor_intel") {
    const CompetitorIntelFlow = lazy(() => import("@/components/CompetitorIntelFlow"));
    return <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}><CompetitorIntelFlow onBack={() => setActiveTool(null)} /></Suspense>;
  }
  if (activeTool === "price_monitor") {
    const CompetitorPriceMonitor = lazy(() => import("@/components/CompetitorPriceMonitor"));
    return <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}><CompetitorPriceMonitor onBack={() => setActiveTool(null)} /></Suspense>;
  }
  if (activeTool === "geo_agentic") {
    const GeoAgenticFlow = lazy(() => import("@/components/GeoAgenticFlow"));
    return <Suspense fallback={<div className="p-8 text-center text-muted-foreground">Loading…</div>}><GeoAgenticFlow onBack={() => setActiveTool(null)} /></Suspense>;
  }

  if (activeTool === "ai") {
    return (
      <div className="px-4 pt-6 pb-24 animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setActiveTool(null)} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <h2 className="text-lg font-semibold font-display">AI instructions</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-3">Tell SupplierSync exactly how to process your invoices. These rules override all defaults.</p>
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={8}
          placeholder={`Examples:\n• QTY means quantity, first price is cost, second is retail\n• Add my brand name at the start of every product name\n• Replace 'nk' with Necklace, 'br' with Bracelet`}
          className="w-full rounded-lg bg-input border border-border px-4 py-3 text-sm resize-none leading-relaxed placeholder:text-muted-foreground/50" />
        <div className="flex flex-wrap gap-2 mt-3">
          {quickInserts.map((qi) => (
            <button key={qi.label} onClick={() => setInstructions((prev) => (prev ? prev + "\n" : "") + qi.text)}
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-muted text-muted-foreground active:bg-accent">{qi.label}</button>
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
            <button key={tool.id} onClick={() => setActiveTool(tool.id)}
              className="bg-card rounded-lg border border-border p-4 text-left active:bg-muted transition-colors">
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
