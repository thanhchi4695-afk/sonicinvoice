import { useState } from "react";
import { ChevronLeft, ChevronDown, Monitor, ArrowRight, AlertTriangle, ExternalLink } from "lucide-react";
import { useStoreMode } from "@/hooks/use-store-mode";

interface LightspeedGuideProps {
  onBack: () => void;
  onNavigate?: (flow: string) => void;
}

const LightspeedGuide = ({ onBack, onNavigate }: LightspeedGuideProps) => {
  const mode = useStoreMode();
  const [showXImport, setShowXImport] = useState(false);
  const [showRImport, setShowRImport] = useState(false);

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <button onClick={onBack} className="text-muted-foreground mb-4"><ChevronLeft className="w-5 h-5" /></button>
      <div className="flex items-center gap-2 mb-1">
        <Monitor className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-bold font-display">Lightspeed Guide</h1>
      </div>
      <p className="text-muted-foreground text-sm mb-6">
        How the Lightspeed ↔ Shopify sync works and what to edit where.
      </p>

      {/* ── Section 1: How the sync works ─────────────── */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">How the sync works</h2>
        <div className="space-y-2">
          {[
            { emoji: "📄", label: "Supplier sends invoice", sub: "PDF, Excel, or email" },
            { emoji: "⚡", label: "SkuPilot", sub: "AI reads & enriches", highlight: true },
            { emoji: "📥", label: "Lightspeed CSV", sub: "Export from SkuPilot" },
            { emoji: "🖥️", label: "Lightspeed POS", sub: "System of Record", accent: true },
            { emoji: "🔄", label: "Auto-syncs", sub: "No action needed" },
            { emoji: "🛍️", label: "Shopify Store", sub: "Online sales channel" },
          ].map((item, i) => (
            <div key={i}>
              <div className={`flex items-center gap-3 rounded-lg border p-3 ${item.accent ? 'border-primary/30 bg-primary/5' : item.highlight ? 'border-border bg-card' : 'border-border bg-card'}`}>
                <span className="text-lg shrink-0">{item.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${item.accent ? 'text-primary' : ''}`}>{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.sub}</p>
                </div>
              </div>
              {i < 5 && (
                <div className="flex justify-center py-0.5">
                  <ArrowRight className="w-3 h-3 text-muted-foreground rotate-90" />
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Lightspeed is your system of record. Everything starts in Lightspeed and flows to Shopify automatically. SkuPilot creates the Lightspeed import file — you never need to manually enter products in either system.
        </p>
      </section>

      {/* ── Section 2: Edit rules ─────────────────────── */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">What to edit where</h2>

        {/* DON'T edit in Shopify */}
        <div className="rounded-lg border-l-4 border-destructive bg-destructive/5 border border-destructive/20 p-4 mb-3">
          <p className="text-xs font-bold text-destructive mb-2">❌ DO NOT EDIT IN SHOPIFY — edit in Lightspeed only</p>
          <div className="space-y-1.5">
            {[
              ["Product name", "Editing in Shopify breaks sync"],
              ["Price", "Editing in Shopify breaks sync"],
              ["SKU", "Editing in Shopify breaks sync"],
              ["Description", "Editing in Shopify breaks sync"],
              ["Handle / URL", "Editing in Shopify breaks sync"],
              ["Inventory quantity", "Manage stock in Lightspeed"],
              ["Variants / sizes", "Add variants in Lightspeed"],
            ].map(([field, reason]) => (
              <div key={field} className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{field}</span>
                <span className="text-muted-foreground text-[11px]">{reason}</span>
              </div>
            ))}
          </div>
        </div>

        {/* SAFE to edit in Shopify */}
        <div className="rounded-lg border-l-4 border-success bg-success/5 border border-success/20 p-4">
          <p className="text-xs font-bold text-success mb-2">✅ SAFE TO EDIT IN SHOPIFY</p>
          <div className="space-y-1.5">
            {[
              ["Product images", "Manage images in Shopify"],
              ["SEO title", "Shopify-only field"],
              ["SEO description", "Shopify-only field"],
              ["Collections", "Assign collections in Shopify"],
              ["Shopify tags", "Tags managed in Shopify only"],
            ].map(([field, note]) => (
              <div key={field} className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{field}</span>
                <span className="text-muted-foreground text-[11px]">{note}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mt-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            SkuPilot generates SEO titles, meta descriptions, and tags — but for Lightspeed clients, these are added to Shopify <span className="font-medium text-foreground">after</span> Lightspeed imports the product, not via the Lightspeed CSV. See the workflow below.
          </p>
        </div>
      </section>

      {/* ── Section 3: Complete workflow ───────────────── */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">The complete workflow</h2>
        <div className="space-y-3">
          {[
            { step: 1, emoji: "📄", title: "Receive invoice from supplier", desc: "Your supplier sends an invoice (PDF, Excel, or email)", action: null },
            { step: 2, emoji: "📤", title: "Upload to SkuPilot", desc: "Upload the invoice here. AI reads every line.", action: "invoice" },
            { step: 3, emoji: "✨", title: "AI enrichment", desc: "SkuPilot finds the RRP, description, images, and generates your tags and SEO content.", action: null },
            { step: 4, emoji: "📥", title: "Download Lightspeed CSV", desc: "Export as Lightspeed format: handle, name, SKU, brand, supply price, retail price, tags, size/colour attributes, and stock quantities.", action: "invoice" },
            { step: 5, emoji: "🖥️", title: "Import into Lightspeed POS", desc: "In Lightspeed: Catalog → Products → Import. Upload your CSV. Products appear in your POS immediately.", action: null },
            { step: 6, emoji: "🔄", title: "Lightspeed syncs to Shopify", desc: "Products appear in your Shopify store within minutes. No action needed — the integration does this for you.", action: null },
            { step: 7, emoji: "🖼️", title: "Add images and SEO in Shopify", desc: "Add product photos, SEO title, meta description, and assign collections. Use the SEO export from SkuPilot for this step.", action: null },
          ].map((s) => (
            <div key={s.step} className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-bold text-primary">{s.step}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{s.emoji} {s.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
                {s.action && onNavigate && (
                  <button onClick={() => onNavigate(s.action!)} className="text-xs text-primary mt-1 flex items-center gap-1">
                    Go to {s.action === 'invoice' ? 'Upload Invoice' : s.title} <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 4: Import instructions ────────────── */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Import instructions</h2>

        {/* X-Series */}
        <button onClick={() => setShowXImport(!showXImport)}
          className="w-full flex items-center justify-between rounded-lg border border-border bg-card p-3 mb-2">
          <span className="text-sm font-medium">How to import into Lightspeed (X-Series)</span>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showXImport ? 'rotate-180' : ''}`} />
        </button>
        {showXImport && (
          <div className="border border-border rounded-lg p-4 mb-3 bg-card">
            <ol className="text-xs text-muted-foreground space-y-1.5 pl-4 list-decimal">
              <li>Log in to your Lightspeed Retail POS</li>
              <li>Go to: <span className="font-medium text-foreground">Catalog → Products</span></li>
              <li>Click: <span className="font-medium text-foreground">Import</span></li>
              <li>Drag and drop your Lightspeed CSV file</li>
              <li>The spreadsheet checker will validate your file</li>
              <li>If validation passes: click <span className="font-medium text-foreground">Continue</span></li>
              <li>If errors appear: download the error report and fix</li>
              <li>Products will appear in your catalog immediately</li>
              <li>To publish to Shopify: select products → <span className="font-medium text-foreground">Publish to Shopify</span></li>
            </ol>
            <p className="text-[11px] text-muted-foreground mt-3 border-t border-border pt-2">
              File must be .CSV, .XLSX, or .XLS. Column headers must match exactly — do not rename any columns.
            </p>
          </div>
        )}

        {/* R-Series */}
        <button onClick={() => setShowRImport(!showRImport)}
          className="w-full flex items-center justify-between rounded-lg border border-border bg-card p-3">
          <span className="text-sm font-medium">How to import into Lightspeed (R-Series)</span>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showRImport ? 'rotate-180' : ''}`} />
        </button>
        {showRImport && (
          <div className="border border-border rounded-lg p-4 mt-2 bg-card">
            <p className="text-xs text-muted-foreground mb-3">
              R-Series uses a different import process. Small imports can be done yourself. Large imports (100+ products) should be submitted to the Lightspeed Retail Imports Team — allow 3–5 business days.
            </p>
            <p className="text-xs font-semibold mb-1.5">Self-import (small batches):</p>
            <ol className="text-xs text-muted-foreground space-y-1.5 pl-4 list-decimal mb-3">
              <li>Go to: <span className="font-medium text-foreground">Inventory → Import Items → New Import</span></li>
              <li>Upload your file</li>
              <li>Select import method: <span className="font-medium text-foreground">"Create new items only"</span></li>
              <li>Review and confirm</li>
            </ol>
            <p className="text-xs font-semibold mb-1.5">Large imports (100+ products):</p>
            <p className="text-xs text-muted-foreground">
              Submit via the Lightspeed Help chat (Speeder). Select: Import Request → Inventory Import. Include your Support ID (found in Help at bottom-left).
            </p>
          </div>
        )}
      </section>
    </div>
  );
};

export default LightspeedGuide;
