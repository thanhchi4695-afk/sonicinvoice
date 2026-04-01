import { useState } from "react";
import { X, AlertTriangle, Eye, Edit2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStoreConfig } from "@/lib/prompt-builder";

interface PreviewProduct {
  name: string;
  brand: string;
  type: string;
  price: number;
  rrp: number;
  description?: string;
  sizes?: string[];
  colours?: string[];
  tags?: string[];
  seoTitle?: string;
  seoDesc?: string;
  imageUrl?: string;
}

interface ShopifyPreviewProps {
  product: PreviewProduct;
  open: boolean;
  onClose: () => void;
  onSave?: (updated: PreviewProduct) => void;
}

const ShopifyPreview = ({ product, open, onClose, onSave }: ShopifyPreviewProps) => {
  const config = getStoreConfig();
  const sym = config.currencySymbol || "$";
  const storeName = config.name || "My Store";
  const storeUrl = config.url || "mystore.com";

  const [p, setP] = useState<PreviewProduct>({ ...product });
  const [editing, setEditing] = useState<string | null>(null);

  if (!open) return null;

  const desc = p.description || "";
  const sizes = p.sizes || ["6", "8", "10", "12", "14"];
  const colours = p.colours || ["Black"];
  const tags = p.tags || [p.type, p.brand, "new arrivals", "full_price"].filter(Boolean);
  const seoTitle = p.seoTitle || `${p.name} | ${p.brand} | ${storeName}`;
  const seoDesc = p.seoDesc || `Shop the ${p.name} from ${p.brand}. Available now at ${storeName}.`;
  const isOnSale = p.rrp > p.price && p.price > 0;
  const hasImage = !!p.imageUrl;

  // Issues
  const issues: { msg: string; field: string }[] = [];
  if (seoTitle.length > 70) issues.push({ msg: `SEO title is ${seoTitle.length} chars (max 70)`, field: "seoTitle" });
  if (seoDesc.length > 160) issues.push({ msg: `Meta description is ${seoDesc.length} chars (max 160)`, field: "seoDesc" });
  if (!desc) issues.push({ msg: "No description set", field: "description" });
  if (p.price > p.rrp && p.rrp > 0) issues.push({ msg: "Compare-at price is lower than selling price", field: "price" });
  if (!hasImage) issues.push({ msg: "No image — product will import without photo", field: "image" });
  if (desc && /<[^>]+>/.test(desc) && desc.includes("<")) issues.push({ msg: "Description may contain raw HTML tags", field: "description" });

  const update = (field: string, value: any) => setP(prev => ({ ...prev, [field]: value }));
  const startEdit = (field: string) => setEditing(field);
  const stopEdit = () => setEditing(null);

  const handleSave = () => { onSave?.(p); onClose(); };

  const EditableText = ({ field, value, className, tag: Tag = "span" as any, multiline }: { field: string; value: string; className?: string; tag?: any; multiline?: boolean }) => {
    if (editing === field) {
      return multiline ? (
        <textarea autoFocus value={value} onChange={e => update(field, e.target.value)} onBlur={stopEdit}
          className={`w-full rounded border border-primary bg-background px-2 py-1 text-sm resize-y min-h-[60px] ${className}`} />
      ) : (
        <input autoFocus value={value} onChange={e => update(field, e.target.value)} onBlur={stopEdit}
          className={`w-full rounded border border-primary bg-background px-2 py-1 ${className}`} />
      );
    }
    return (
      <Tag className={`cursor-pointer hover:bg-primary/10 rounded px-0.5 transition-colors group inline-flex items-center gap-1 ${className}`}
        onClick={() => startEdit(field)}>
        {value || <span className="italic text-muted-foreground">Click to add</span>}
        <Edit2 className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      </Tag>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 overflow-y-auto p-4">
      <div className="bg-background rounded-xl border border-border w-full max-w-lg my-4 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-background rounded-t-xl z-10">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm text-foreground">Shopify Preview</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm" onClick={handleSave} className="gap-1 h-7 text-xs">
              <Check className="w-3 h-3" /> Save
            </Button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Issues */}
        {issues.length > 0 && (
          <div className="mx-4 mt-3 rounded-lg bg-destructive/10 border border-destructive/20 p-3">
            <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> {issues.length} issue{issues.length > 1 ? "s" : ""} found
            </p>
            {issues.map((iss, i) => (
              <button key={i} onClick={() => startEdit(iss.field)}
                className="block text-xs text-destructive/80 mt-0.5 hover:underline">• {iss.msg}</button>
            ))}
          </div>
        )}

        {/* Product preview */}
        <div className="p-4 space-y-4">
          {/* Image */}
          <div className="rounded-lg bg-muted flex items-center justify-center aspect-square max-h-[240px] overflow-hidden">
            {hasImage ? (
              <img src={p.imageUrl} alt={p.name} className="w-full h-full object-contain" />
            ) : (
              <div className="text-center text-muted-foreground">
                <div className="text-4xl mb-2">📷</div>
                <p className="text-xs">No image available</p>
              </div>
            )}
          </div>

          {/* Brand */}
          <EditableText field="brand" value={p.brand} className="text-xs text-muted-foreground uppercase tracking-wider font-medium" tag="div" />

          {/* Title */}
          <EditableText field="name" value={p.name} className="text-lg font-bold text-foreground leading-tight" tag="div" />

          {/* Price */}
          <div className="flex items-baseline gap-2" onClick={() => startEdit("price")}>
            {isOnSale ? (
              <>
                <span className="text-lg font-bold text-destructive">{sym}{p.price.toFixed(2)}</span>
                <span className="text-sm text-muted-foreground line-through">{sym}{p.rrp.toFixed(2)}</span>
              </>
            ) : (
              <span className="text-lg font-bold text-foreground">{sym}{p.rrp.toFixed(2)}</span>
            )}
          </div>
          {editing === "price" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Price</label>
                <input type="number" value={p.price} onChange={e => update("price", parseFloat(e.target.value) || 0)} onBlur={stopEdit}
                  className="w-full rounded border border-primary bg-background px-2 py-1 text-sm" autoFocus />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Compare-at</label>
                <input type="number" value={p.rrp} onChange={e => update("rrp", parseFloat(e.target.value) || 0)}
                  className="w-full rounded border border-primary bg-background px-2 py-1 text-sm" />
              </div>
            </div>
          )}

          {/* Variants */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">Size</label>
              <select className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
                {sizes.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            {colours.length > 1 && (
              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-1">Colour</label>
                <select className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
                  {colours.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Description</p>
            {editing === "description" ? (
              <textarea autoFocus value={desc} onChange={e => update("description", e.target.value)} onBlur={stopEdit}
                className="w-full rounded border border-primary bg-background px-3 py-2 text-sm min-h-[100px] resize-y" />
            ) : (
              <div onClick={() => startEdit("description")}
                className="text-sm text-foreground/80 leading-relaxed cursor-pointer hover:bg-primary/5 rounded p-1 transition-colors group">
                {desc ? (
                  <div dangerouslySetInnerHTML={{ __html: desc.replace(/\n/g, "<br/>") }} />
                ) : (
                  <p className="italic text-muted-foreground">No description — click to add</p>
                )}
                <Edit2 className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 mt-1 transition-opacity" />
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full bg-muted text-[10px] text-muted-foreground border border-border">{t}</span>
            ))}
          </div>

          {/* SEO Preview */}
          <div className="rounded-lg border border-border bg-card p-3 space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Google Search Preview</p>
            <EditableText field="seoTitle"
              value={seoTitle}
              className={`text-sm font-medium leading-snug ${seoTitle.length > 70 ? "text-destructive" : "text-blue-500"}`}
              tag="div" />
            <p className="text-xs text-green-600 truncate">{storeUrl} › products</p>
            <EditableText field="seoDesc"
              value={seoDesc}
              className={`text-xs leading-relaxed ${seoDesc.length > 160 ? "text-destructive" : "text-muted-foreground"}`}
              tag="div"
              multiline />
          </div>

          <p className="text-[10px] text-muted-foreground text-center">Click any field to edit inline</p>
        </div>
      </div>
    </div>
  );
};

export default ShopifyPreview;
