// ════════════════════════════════════════════════════════════════
// HomeWizard — Phase 1 of the 6-phase guided flow.
//
// Asks two questions before upload:
//   1. What are you uploading?  (Invoice | Packing slip)
//   2. Where do your products go?  (Shopify | Lightspeed)
//
// Both answers are remembered in localStorage:
//   - `preferred_doc_type` → "invoice" | "packing_slip"
//   - `preferred_pos`      → "shopify" | "lightspeed"
//
// Returning users see their saved choices as small editable
// chips at the top of the upload area (soft default — skippable).
//
// Then routes to:
//   - Invoice  → setActiveFlow("invoice")
//   - Packing  → setActiveFlow("packing_slip")
//
// Existing alternate entry points (Email Inbox, JOOR, Wholesale)
// are kept as a secondary row beneath the main upload card.
// ════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { FileText, Package, ShoppingBag, Store, Mail, Upload, Briefcase, Camera, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import AgentPipelineShowcase from "@/components/AgentPipelineShowcase";

export type DocType = "invoice" | "packing_slip";
export type PosChoice = "shopify" | "lightspeed";

interface HomeWizardProps {
  onStartInvoice: () => void;
  onStartPackingSlip: () => void;
  onStartEmailInbox?: () => void;
  onStartJoor?: () => void;
  onStartWholesaleImport?: () => void;
  onStartLookbookImport?: () => void;
  onStartScanMode?: () => void;
  onOpenAgentGuide?: () => void;
  onOpenAutomation?: () => void;
  onOpenIntegrations?: () => void;
}

const DOC_KEY = "preferred_doc_type";
const POS_KEY = "preferred_pos";

const HomeWizard = ({
  onStartInvoice,
  onStartPackingSlip,
  onStartEmailInbox,
  onStartJoor,
  onStartWholesaleImport,
  onStartLookbookImport,
  onStartScanMode,
  onOpenAgentGuide,
  onOpenAutomation,
  onOpenIntegrations,
}: HomeWizardProps) => {
  const [docType, setDocType] = useState<DocType | null>(() =>
    (localStorage.getItem(DOC_KEY) as DocType) || null
  );
  const [pos, setPos] = useState<PosChoice | null>(() =>
    (localStorage.getItem(POS_KEY) as PosChoice) || null
  );
  // When a user clicks a chip we let them re-pick that one answer.
  const [editing, setEditing] = useState<"doc" | "pos" | null>(null);

  // Persist whenever the user changes a choice
  useEffect(() => {
    if (docType) localStorage.setItem(DOC_KEY, docType);
  }, [docType]);
  useEffect(() => {
    if (pos) localStorage.setItem(POS_KEY, pos);
  }, [pos]);

  const hasBothChoices = !!docType && !!pos && editing === null;

  const proceed = () => {
    if (!docType) return;
    if (docType === "invoice") onStartInvoice();
    else onStartPackingSlip();
  };

  // ── Tile button ─────────────────────────────────────────────
  const Tile = ({
    selected,
    onClick,
    icon: Icon,
    label,
    description,
  }: {
    selected: boolean;
    onClick: () => void;
    icon: React.ElementType;
    label: string;
    description: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start gap-3 rounded-xl border-2 p-5 text-left transition-all",
        "hover:border-primary/60 hover:bg-primary/5 active:scale-[0.99]",
        selected
          ? "border-primary bg-primary/10 shadow-sm"
          : "border-border bg-card"
      )}
    >
      <div
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-lg transition-colors",
          selected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 pb-24 lg:p-6">
      {/* ── Phase indicator ─────────────────────────────────── */}
      <PhaseStepper current={1} />

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-foreground">
          Process a new delivery
        </h1>
        <p className="text-sm text-muted-foreground">
          Step 1 of 6 · Tell us what you're uploading and where it goes.
        </p>
      </div>

      {/* ── Returning user: show chips ────────────────────────── */}
      {hasBothChoices && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <span className="text-xs text-muted-foreground">Using:</span>
          <button
            onClick={() => setEditing("doc")}
            className="inline-flex items-center gap-1.5 rounded-md bg-card px-2.5 py-1 text-xs font-medium hover:bg-muted"
          >
            {docType === "invoice" ? <FileText className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />}
            {docType === "invoice" ? "Invoice" : "Packing slip"}
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </button>
          <button
            onClick={() => setEditing("pos")}
            className="inline-flex items-center gap-1.5 rounded-md bg-card px-2.5 py-1 text-xs font-medium hover:bg-muted"
          >
            {pos === "shopify" ? <ShoppingBag className="h-3.5 w-3.5" /> : <Store className="h-3.5 w-3.5" />}
            {pos === "shopify" ? "Shopify" : "Lightspeed"}
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </button>
          <Badge variant="secondary" className="ml-auto text-[10px]">remembered</Badge>
        </div>
      )}

      {/* ── Q1 — What are you uploading? ─────────────────────── */}
      {(!docType || editing === "doc") && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            1. What are you uploading?
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Tile
              selected={docType === "invoice"}
              onClick={() => { setDocType("invoice"); setEditing(null); }}
              icon={FileText}
              label="Invoice"
              description="Full extraction — products, prices, costs, and stock counts."
            />
            <Tile
              selected={docType === "packing_slip"}
              onClick={() => { setDocType("packing_slip"); setEditing(null); }}
              icon={Package}
              label="Packing slip"
              description="Quantities only — for stock check + qty update."
            />
          </div>
        </section>
      )}

      {/* ── Q2 — Where do your products go? ──────────────────── */}
      {(!pos || editing === "pos") && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            2. Where do your products go?
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Tile
              selected={pos === "shopify"}
              onClick={() => { setPos("shopify"); setEditing(null); }}
              icon={ShoppingBag}
              label="Shopify"
              description="Push products + stock direct to your Shopify store."
            />
            <Tile
              selected={pos === "lightspeed"}
              onClick={() => { setPos("lightspeed"); setEditing(null); }}
              icon={Store}
              label="Lightspeed"
              description="Generate Lightspeed-format CSVs ready to import."
            />
          </div>
        </section>
      )}

      {/* ── Upload action ────────────────────────────────────── */}
      {hasBothChoices && (
        <section className="space-y-3">
          <button
            onClick={proceed}
            className="group flex w-full items-center gap-4 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-6 text-left transition-all hover:border-primary hover:bg-primary/10 active:scale-[0.995]"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Upload className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">
                Upload {docType === "invoice" ? "invoice" : "packing slip"}
              </p>
              <p className="text-xs text-muted-foreground">
                PDF, Excel, CSV, or photo · drop a file in the next screen
              </p>
            </div>
            <span className="text-xs font-medium text-primary group-hover:translate-x-0.5 transition-transform">
              Continue →
            </span>
          </button>

          {/* ── Alternate entry points (kept, not deleted) ───── */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Or import from
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {onStartEmailInbox && (
                <AltEntry icon={Mail} label="Email inbox" onClick={onStartEmailInbox} />
              )}
              {onStartJoor && (
                <AltEntry icon={Briefcase} label="JOOR" onClick={onStartJoor} />
              )}
              {onStartWholesaleImport && (
                <AltEntry icon={FileText} label="Wholesale" onClick={onStartWholesaleImport} />
              )}
              {onStartScanMode && (
                <AltEntry icon={Camera} label="Scan mode" onClick={onStartScanMode} />
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── AI Agents pipeline showcase (always visible) ───── */}
      <AgentPipelineShowcase
        onOpenGuide={onOpenAgentGuide}
        onOpenAutomation={onOpenAutomation}
        onStartInvoice={onStartInvoice}
        onOpenIntegrations={onOpenIntegrations}
      />
    </div>
  );
};

// ── Small alt-entry button ─────────────────────────────────────
const AltEntry = ({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"
  >
    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
    {label}
  </button>
);

// ── Phase stepper (1–6) ────────────────────────────────────────
const PHASES = ["Upload", "Extract", "Stock check", "Enrich", "Prepare", "Export"];

export const PhaseStepper = ({ current }: { current: number }) => (
  <ol className="flex flex-wrap items-center gap-1.5 text-[11px]">
    {PHASES.map((label, i) => {
      const num = i + 1;
      const isActive = num === current;
      const isDone = num < current;
      return (
        <li key={label} className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-semibold",
              isActive && "bg-primary text-primary-foreground",
              isDone && "bg-primary/20 text-primary",
              !isActive && !isDone && "bg-muted text-muted-foreground"
            )}
          >
            {num}
          </span>
          <span
            className={cn(
              "hidden sm:inline",
              isActive ? "font-semibold text-foreground" : "text-muted-foreground"
            )}
          >
            {label}
          </span>
          {num < PHASES.length && (
            <span className="mx-0.5 text-muted-foreground/40">·</span>
          )}
        </li>
      );
    })}
  </ol>
);

export default HomeWizard;
