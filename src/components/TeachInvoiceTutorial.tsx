import { useState } from "react";
import {
  ArrowLeft, ArrowRight, Brain, Database, Upload,
  CheckCircle2, Sparkles, BookOpen, Eye, Wand2, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TeachInvoiceTutorialProps {
  onBack: () => void;
  /** Jump straight into the invoice upload flow when the user clicks the CTA. */
  onStartInvoice?: () => void;
  /** Open the Supplier Brain / Intelligence panel. */
  onOpenSupplierIntelligence?: () => void;
  /** Open the Catalog (Learning) Memory panel. */
  onOpenCatalogMemory?: () => void;
  /** Optional supplier name to make the copy concrete (defaults to "Claude Cowork"). */
  supplierName?: string;
}

type StepKey = "overview" | "brain" | "intelligence" | "memory" | "do";

interface TutorialStep {
  key: StepKey;
  title: string;
  short: string;
  icon: typeof Brain;
  accent: string; // tailwind classes for icon background
}

const STEPS: TutorialStep[] = [
  { key: "overview",     title: "Where do I teach the app?", short: "Overview",            icon: BookOpen, accent: "bg-primary/15 text-primary" },
  { key: "brain",        title: "Supplier Brain",            short: "Teach here",          icon: Brain,    accent: "bg-emerald-500/15 text-emerald-400" },
  { key: "intelligence", title: "Supplier Intelligence",     short: "Verify here",         icon: Eye,      accent: "bg-sky-500/15 text-sky-400" },
  { key: "memory",       title: "Learning Memory",           short: "Automatic",           icon: Database, accent: "bg-violet-500/15 text-violet-400" },
  { key: "do",           title: "Do it now",                 short: "Action",              icon: Wand2,    accent: "bg-amber-500/15 text-amber-400" },
];

/**
 * A focused, 5-step walkthrough that explains the difference between
 * Supplier Brain (teach), Supplier Intelligence (verify) and Learning Memory
 * (automatic), with a clear CTA for uploading the next invoice.
 */
const TeachInvoiceTutorial = ({
  onBack,
  onStartInvoice,
  onOpenSupplierIntelligence,
  onOpenCatalogMemory,
  supplierName = "Claude Cowork",
}: TeachInvoiceTutorialProps) => {
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  const goNext = () => setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  const goPrev = () => setStepIdx((i) => Math.max(i - 1, 0));
  const goTo   = (i: number) => setStepIdx(i);

  return (
    <div className="px-4 pt-4 pb-24 max-w-2xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-9 w-9 shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold font-display truncate">
            Teach {supplierName} invoices
          </h1>
          <p className="text-xs text-muted-foreground">
            A 5-step tour of where each kind of learning lives
          </p>
        </div>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {stepIdx + 1} / {STEPS.length}
        </Badge>
      </div>

      {/* Progress rail */}
      <div className="flex items-center gap-1.5 mb-5" role="tablist" aria-label="Tutorial steps">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={i === stepIdx}
            onClick={() => goTo(i)}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i < stepIdx && "bg-primary",
              i === stepIdx && "bg-primary",
              i > stepIdx && "bg-muted",
            )}
            title={s.short}
          />
        ))}
      </div>

      {/* Step card */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", step.accent)}>
            <step.icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold font-display">{step.title}</h2>
            <p className="text-xs text-muted-foreground">{step.short}</p>
          </div>
        </div>

        {/* Step body */}
        <div className="text-sm leading-relaxed text-foreground/90 space-y-3">
          {step.key === "overview" && (
            <>
              <p>
                There are <strong>three places</strong> the app learns from your invoices.
                They sound similar but do different things — using the wrong one is the most
                common reason people feel "the app isn't getting smarter."
              </p>
              <ul className="space-y-2 mt-2">
                <li className="flex gap-2">
                  <Brain className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span><strong>Supplier Brain</strong> — where <em>you</em> teach a supplier's invoice format. This is what you want for {supplierName}.</span>
                </li>
                <li className="flex gap-2">
                  <Eye className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <span><strong>Supplier Intelligence</strong> — read-only dashboard showing how confident the brain has become.</span>
                </li>
                <li className="flex gap-2">
                  <Database className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                  <span><strong>Learning Memory</strong> — remembers individual <em>products</em>, not formats. Fills itself in.</span>
                </li>
              </ul>
            </>
          )}

          {step.key === "brain" && (
            <>
              <p>
                <strong>Go here to teach {supplierName}'s invoice layout.</strong> Each
                correction you make on the review screen is folded back into this brain.
              </p>
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1.5">
                <p className="font-semibold text-foreground">How to find it</p>
                <p className="text-muted-foreground">
                  <span className="text-foreground">Desktop:</span> sidebar → <strong>Suppliers</strong> → open <strong>{supplierName}</strong> → <strong>Brain</strong> tab.
                </p>
                <p className="text-muted-foreground">
                  <span className="text-foreground">Mobile / embedded Shopify:</span> bottom tabs → <strong>Suppliers</strong> → tap <strong>{supplierName}</strong> → <strong>Brain</strong>.
                </p>
              </div>
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
                <p className="font-semibold text-emerald-400 mb-1">What it stores</p>
                <p className="text-muted-foreground">
                  Column map (cost vs RRP), GST treatment, SKU pattern, size system,
                  default markup, plus any custom AI instructions you've saved for the supplier.
                </p>
              </div>
              {onOpenSupplierIntelligence && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  onClick={onOpenSupplierIntelligence}
                >
                  Open Supplier Brain
                  <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              )}
            </>
          )}

          {step.key === "intelligence" && (
            <>
              <p>
                <strong>Don't teach here — just check progress.</strong> Supplier
                Intelligence shows confidence scores, correction rates, and how many
                invoices the brain has learned from across every supplier.
              </p>
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1.5">
                <p className="font-semibold text-foreground">How to find it</p>
                <p className="text-muted-foreground">
                  <span className="text-foreground">Desktop:</span> sidebar → <strong>Insights</strong>.
                </p>
                <p className="text-muted-foreground">
                  <span className="text-foreground">Mobile / embedded Shopify:</span> bottom tabs → <strong>Tools</strong> → <strong>Supplier Intelligence</strong>.
                </p>
              </div>
              <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-3 text-xs">
                <p className="font-semibold text-sky-400 mb-1">Use it to answer</p>
                <p className="text-muted-foreground">
                  "Has {supplierName}'s confidence climbed since last week?" — if yes,
                  the teaching is working. If not, do another careful review.
                </p>
              </div>
            </>
          )}

          {step.key === "memory" && (
            <>
              <p>
                <strong>Hands-off.</strong> Learning Memory (Catalog Memory) tracks
                individual products you've already seen — SKU → title → cost history —
                so refills auto-match without you re-teaching them.
              </p>
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1.5">
                <p className="font-semibold text-foreground">How to find it</p>
                <p className="text-muted-foreground">
                  Home screen → tap the <strong>Catalog</strong> stat tile, or sidebar →
                  <strong> Catalog Memory</strong>.
                </p>
              </div>
              <div className="rounded-md border border-violet-500/30 bg-violet-500/5 p-3 text-xs">
                <p className="font-semibold text-violet-400 mb-1">Why it matters</p>
                <p className="text-muted-foreground">
                  Once a {supplierName} product is in here, future invoices recognise it
                  instantly as a refill. You don't teach it directly — it fills itself.
                </p>
              </div>
              {onOpenCatalogMemory && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  onClick={onOpenCatalogMemory}
                >
                  Open Learning Memory
                  <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              )}
            </>
          )}

          {step.key === "do" && (
            <>
              <p>
                <strong>The teaching actually happens at the review screen</strong> — not
                inside any of the three panels. Here's the loop that makes the brain smarter
                with every {supplierName} invoice you upload:
              </p>
              <ol className="space-y-2 text-xs">
                <li className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center shrink-0 font-semibold">1</span>
                  <span><strong>Upload</strong> the next {supplierName} invoice (drag, paste, or tap upload).</span>
                </li>
                <li className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center shrink-0 font-semibold">2</span>
                  <span><strong>Correct</strong> anything wrong on the review screen — column mappings, GST flag, sizes, cost vs RRP. Each edit is logged.</span>
                </li>
                <li className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center shrink-0 font-semibold">3</span>
                  <span>Tick <strong>"Save for this supplier"</strong> before processing if you want custom instructions remembered.</span>
                </li>
                <li className="flex gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center shrink-0 font-semibold">4</span>
                  <span>Open <strong>Supplier Brain</strong> afterwards to confirm the auto-detected layout looks right; edit fields directly if needed.</span>
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>From invoice 2 onward you should see fewer corrections and a higher confidence score in <strong>Supplier Intelligence</strong>.</span>
                </li>
              </ol>
              {onStartInvoice && (
                <Button
                  variant="success"
                  className="w-full h-12 mt-3"
                  onClick={onStartInvoice}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload a {supplierName} invoice now
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between mt-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={goPrev}
          disabled={stepIdx === 0}
          className="gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <p className="text-[11px] text-muted-foreground">
          {STEPS[stepIdx].short}
        </p>
        {stepIdx < STEPS.length - 1 ? (
          <Button size="sm" onClick={goNext} className="gap-1">
            Next
            <ArrowRight className="w-4 h-4" />
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onBack} className="gap-1">
            <Sparkles className="w-4 h-4" />
            Done
          </Button>
        )}
      </div>
    </div>
  );
};

export default TeachInvoiceTutorial;
