import { useState, useEffect } from "react";
import { FileText, Package, ShoppingBag, Store, Mail, Briefcase, Upload, Check, Link as LinkIcon, Code as CodeIcon, RefreshCw, Sparkles, Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import HomeWizard from "@/components/HomeWizard";
import ProductUrlImporter, { type ImportedLineItem } from "@/components/ProductUrlImporter";
import HowToVideoButton from "@/components/HowToVideoButton";
import { setSessionProducts } from "@/stores/invoice-session-store";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────
// Phase 1 — Upload
// Two-question wizard:
//   Q1: What are you uploading? (Invoice | Packing slip)
//   Q2: Where do your products go? (Shopify | Lightspeed)
// Persists POS choice to localStorage("preferred_pos").
// Then renders the existing HomeWizard upload area so all
// existing entry points (Email Inbox, JOOR, Wholesale, Lookbook,
// Scan) remain available — nothing is removed.
// ─────────────────────────────────────────────────────────────

export type UploadKind = "invoice" | "packing_slip" | "html";
export type PreferredPos = "shopify" | "lightspeed";

interface PhaseFlowHomeProps {
  onStartInvoice: () => void;
  onStartPackingSlip: () => void;
  onStartEmailInbox: () => void;
  onStartJoor: () => void;
  onStartWholesaleImport: () => void;
  onStartLookbookImport: () => void;
  onStartScanMode: () => void;
}

const PHASES = [
  { n: 1, label: "Upload" },
  { n: 2, label: "Extract" },
  { n: 3, label: "Stock check" },
  { n: 4, label: "Enrich" },
  { n: 5, label: "Prepare" },
  { n: 6, label: "Export" },
];

const PhaseFlowHome = (props: PhaseFlowHomeProps) => {
  const [kind, setKind] = useState<UploadKind | null>(null);
  const [pos, setPos] = useState<PreferredPos | null>(null);

  // Restore POS choice on mount.
  useEffect(() => {
    const saved = localStorage.getItem("preferred_pos") as PreferredPos | null;
    if (saved === "shopify" || saved === "lightspeed") setPos(saved);
  }, []);

  const choosePos = (p: PreferredPos) => {
    setPos(p);
    localStorage.setItem("preferred_pos", p);
  };

  // When both questions answered, fire the matching flow.
  // We only auto-advance for invoice — for packing slip we still
  // require explicit click so the user can pick an alternate entry.
  const ready = !!kind && !!pos;

  const enterFlow = () => {
    if (!kind) return;
    if (kind === "invoice") props.onStartInvoice();
    else if (kind === "html") {
      // HTML uploads use the same downstream invoice flow; flag the source so
      // the upload step can hint the parser (text/html instead of PDF/image).
      localStorage.setItem("upload_source_kind", "html");
      props.onStartInvoice();
    } else props.onStartPackingSlip();
  };

  return (
    <div className="px-4 py-6 sm:py-10 max-w-4xl mx-auto">
      {/* ── Persistent 6-phase progress indicator ── */}
      <div className="mb-8">
        <ol className="flex items-center justify-between gap-1 text-[10px] sm:text-xs">
          {PHASES.map((p, i) => {
            const active = p.n === 1;
            return (
              <li key={p.n} className="flex-1 flex flex-col items-center">
                <div
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center font-bold border",
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border",
                  )}
                >
                  {p.n}
                </div>
                <span
                  className={cn(
                    "mt-1 truncate",
                    active ? "text-foreground font-medium" : "text-muted-foreground",
                  )}
                >
                  {p.label}
                </span>
                {i < PHASES.length - 1 && (
                  <div className="hidden sm:block absolute" />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <h1 className="text-2xl sm:text-3xl font-bold font-display mb-1">Start a new run</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Two quick questions and we’ll guide you through the full 6-phase flow.
      </p>

      {/* ── Q1 ── */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
            1
          </span>
          <h2 className="text-base font-semibold">What are you uploading?</h2>
          <HowToVideoButton
            videoSrc="/howto/invoice-upload.mp4"
            title="Upload an invoice"
            description="Drop a PDF, JPG or PNG — Sonic extracts every line, cost and quantity, ready for your catalog."
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TileButton
            active={kind === "invoice"}
            onClick={() => setKind("invoice")}
            icon={<FileText className="w-6 h-6" />}
            title="Invoice"
            subtitle="Full extract → enrich → export"
          />
          <TileButton
            active={kind === "packing_slip"}
            onClick={() => setKind("packing_slip")}
            icon={<Package className="w-6 h-6" />}
            title="Packing slip"
            subtitle="Stock-check & qty update only"
          />
          <TileButton
            active={kind === "html"}
            onClick={() => setKind("html")}
            icon={<CodeIcon className="w-6 h-6" />}
            title="HTML file"
            subtitle="Parse a saved web invoice (.html)"
          />
        </div>
      </section>

      {/* ── Q2 ── */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
            2
          </span>
          <h2 className="text-base font-semibold">Where do your products go?</h2>
          {pos && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              Saved as default
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TileButton
            active={pos === "shopify"}
            onClick={() => choosePos("shopify")}
            icon={<ShoppingBag className="w-6 h-6" />}
            title="Shopify"
            subtitle="Export Shopify CSV / live push"
          />
          <TileButton
            active={pos === "lightspeed"}
            onClick={() => choosePos("lightspeed")}
            icon={<Store className="w-6 h-6" />}
            title="Lightspeed"
            subtitle="Export Lightspeed CSV"
          />
        </div>
      </section>

      {/* ── Continue CTA ── */}
      <div className="mb-6">
        <button
          onClick={enterFlow}
          disabled={!ready}
          className={cn(
            "w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-lg font-semibold text-base transition-colors shadow-sm",
            ready
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed",
          )}
        >
          <Upload className="w-5 h-5" />
          {ready
            ? `Continue → upload ${kind === "invoice" ? "invoice" : kind === "html" ? "HTML file" : "packing slip"}`
            : "Choose both options to continue"}
        </button>
      </div>

      {/* ── Import from URL — highlighted: paste a product link to prep it for Shopify ── */}
      <section className="mb-10 rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            ⚡ Fastest way
          </span>
          <LinkIcon className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Paste a product URL → ready for Shopify</h2>
          <HowToVideoButton
            videoSrc="/howto/url-importer.mp4"
            title="Paste product URL"
            description="See how a single paste pulls name, price, variants, description and images — ready for Shopify."
            label="Watch how the URL importer works"
          />
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Drop in any brand or supplier product link. We auto-collect the <strong>name, price, variants, description and images</strong> — formatted to upload straight into Shopify.
        </p>

        <div className="grid gap-4 md:grid-cols-[1fr_240px]">
          <ProductUrlImporter
            className="border border-primary/20 bg-background"
            onAddToInvoice={(item: ImportedLineItem) => {
            // Hand off to the same downstream flow as an extracted invoice.
            setSessionProducts(
              [
                {
                  product_title: item.name,
                  sku: "",
                  vendor: "",
                  unit_cost: 0,
                  rrp: typeof item.price === "number" ? item.price : 0,
                  margin_pct: 0,
                  qty: 1,
                },
              ],
              "",
            );
            toast.success("Imported — opening invoice flow…");
            props.onStartInvoice();
          }}
          />

          {/* How-to mini guide */}
          <aside className="rounded-lg border border-border bg-muted/30 p-4 text-xs">
            <p className="font-semibold text-foreground mb-2 flex items-center gap-1">
              <span aria-hidden>📋</span> How it works
            </p>
            <ol className="space-y-2 text-muted-foreground list-decimal list-inside">
              <li><span className="text-foreground font-medium">Copy</span> a product URL from any brand or supplier site.</li>
              <li><span className="text-foreground font-medium">Paste</span> it into the box on the left and hit Fetch.</li>
              <li>We extract <span className="text-foreground">name, price, variants, description &amp; images</span>.</li>
              <li>Review, then push straight to <span className="text-foreground">Shopify</span>.</li>
            </ol>
            <p className="mt-3 text-[11px] text-muted-foreground/80">
              Tip: works best on Shopify-powered brand sites and most major retailers.
            </p>
          </aside>
        </div>
      </section>


      {/* ── Alternate entry points (preserved) ── */}
      <div className="border-t border-border pt-6">
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
          Or use an alternate source
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <AltBtn icon={<Mail className="w-4 h-4" />} label="Email inbox" onClick={props.onStartEmailInbox} />
        </div>

        {/* Original HomeWizard kept fully accessible below as the
            "classic" upload surface — preserves every existing entry
            point and behaviour. */}
        <details className="mt-6">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            Show classic upload dashboard
          </summary>
          <div className="mt-3">
            <HomeWizard
              onStartInvoice={props.onStartInvoice}
              onStartPackingSlip={props.onStartPackingSlip}
              onStartEmailInbox={props.onStartEmailInbox}
              onStartJoor={props.onStartJoor}
              onStartWholesaleImport={props.onStartWholesaleImport}
              onStartLookbookImport={props.onStartLookbookImport}
              onStartScanMode={props.onStartScanMode}
            />
          </div>
        </details>
      </div>
    </div>
  );
};

const TileButton = ({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "relative text-left rounded-lg border p-4 transition-all",
      active
        ? "border-primary bg-primary/5 ring-2 ring-primary/30"
        : "border-border bg-card hover:border-primary/50 hover:bg-muted/30",
    )}
  >
    {active && (
      <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
        <Check className="w-3 h-3" />
      </span>
    )}
    <div className={cn("mb-2", active ? "text-primary" : "text-muted-foreground")}>{icon}</div>
    <div className="font-semibold text-sm">{title}</div>
    <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
  </button>
);

const AltBtn = ({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card hover:bg-muted/40 text-xs font-medium transition-colors"
  >
    {icon}
    <span className="truncate">{label}</span>
  </button>
);

export default PhaseFlowHome;
