import { useState } from "react";
import { Tag, Search, Globe, Bot, ChevronLeft, DollarSign, Plus, Trash2, ToggleLeft, ToggleRight, RotateCcw, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import PriceLookup from "@/components/PriceLookup";
import { getStoreConfig, getIndustryConfig } from "@/lib/prompt-builder";
import { generateSeo, type SeoProduct } from "@/lib/seo-engine";
import {
  getTagConfig, saveTagConfig, resetTagConfig, getIndustryTagDefaults,
  generateTags, toTag,
  type TagConfig, type ProductTypeEntry, type TagLayer, type SpecialRule, type TagInput,
} from "@/lib/tag-engine";

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

const ToolsScreen = () => {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");

  if (activeTool === "price_lookup") return <PriceLookup onBack={() => setActiveTool(null)} />;
  if (activeTool === "seo") return <SeoWriterPanel onBack={() => setActiveTool(null)} />;
  if (activeTool === "tags") return <TagBuilderPanel onBack={() => setActiveTool(null)} />;

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
