// ════════════════════════════════════════════════════════════════
// AgentTourController — step-by-step guided tour that highlights
// each agent card and auto-opens its info popover. Uses a portal
// overlay with a cut-out spotlight on the active card and a
// floating control bar (Prev / Next / Skip / progress).
// ════════════════════════════════════════════════════════════════

import { useEffect, useLayoutEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface TourStep {
  /** data-tour-id attribute on the target card */
  targetId: string;
  /** Title shown in the tour caption */
  title: string;
  /** Caption shown beneath the title */
  caption: string;
}

interface Props {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
  /** Notified when the active step changes — use to drive popover open state. */
  onStepChange?: (targetId: string | null) => void;
}

const PADDING = 8;

const AgentTourController = ({ steps, open, onClose, onStepChange }: Props) => {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const current = steps[stepIdx];

  // Reset to first step whenever the tour opens
  useEffect(() => {
    if (open) setStepIdx(0);
  }, [open]);

  // Notify parent of active step (so it can open the matching popover)
  useEffect(() => {
    if (!open) {
      onStepChange?.(null);
      return;
    }
    onStepChange?.(current?.targetId ?? null);
  }, [open, current?.targetId, onStepChange]);

  // Measure the target element's bounding box
  const measure = useCallback(() => {
    if (!open || !current) return;
    const el = document.querySelector<HTMLElement>(
      `[data-tour-id="${current.targetId}"]`
    );
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Wait one frame for scroll, then measure
    requestAnimationFrame(() => {
      setRect(el.getBoundingClientRect());
    });
  }, [open, current]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    if (!open) return;
    const handle = () => measure();
    window.addEventListener("resize", handle);
    window.addEventListener("scroll", handle, true);
    return () => {
      window.removeEventListener("resize", handle);
      window.removeEventListener("scroll", handle, true);
    };
  }, [open, measure]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stepIdx, steps.length]);

  const next = () => {
    if (stepIdx < steps.length - 1) setStepIdx((i) => i + 1);
    else onClose();
  };
  const prev = () => {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  };

  if (!open || !current) return null;

  // Spotlight box (with padding); fall back to centred if no rect
  const spotlight = rect
    ? {
        top: rect.top - PADDING,
        left: rect.left - PADDING,
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
      }
    : null;

  // Caption position: below the spotlight if there's room, else above
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const captionBelow = !rect || rect.bottom + 180 < vh;

  return createPortal(
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {/* Dim overlay with spotlight cut-out via SVG mask */}
      <svg className="absolute inset-0 h-full w-full pointer-events-auto" onClick={onClose}>
        <defs>
          <mask id="agent-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {spotlight && (
              <rect
                x={spotlight.left}
                y={spotlight.top}
                width={spotlight.width}
                height={spotlight.height}
                rx={12}
                ry={12}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="hsl(var(--background) / 0.78)"
          mask="url(#agent-tour-mask)"
        />
      </svg>

      {/* Highlight ring around the spotlight */}
      {spotlight && (
        <div
          className="absolute rounded-xl border-2 border-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.25)] animate-pulse pointer-events-none"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
          }}
        />
      )}

      {/* Caption + controls */}
      <div
        className={cn(
          "absolute left-1/2 -translate-x-1/2 w-[min(420px,calc(100vw-24px))] pointer-events-auto",
          "rounded-xl border border-border bg-card p-4 shadow-2xl"
        )}
        style={
          spotlight
            ? captionBelow
              ? { top: spotlight.top + spotlight.height + 16 }
              : { top: Math.max(16, spotlight.top - 180) }
            : { top: "50%", transform: "translate(-50%, -50%)" }
        }
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Guided tour · Step {stepIdx + 1} of {steps.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tour"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="text-sm font-semibold text-foreground">{current.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{current.caption}</p>

        {/* Progress dots */}
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {steps.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStepIdx(i)}
              aria-label={`Go to step ${i + 1}`}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === stepIdx ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
              )}
            />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={prev}
            disabled={stepIdx === 0}
            className="h-8 text-xs"
          >
            <ChevronLeft className="h-3 w-3" /> Prev
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs text-muted-foreground">
            Skip
          </Button>
          <Button size="sm" onClick={next} className="h-8 text-xs">
            {stepIdx === steps.length - 1 ? "Done" : "Next"} <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AgentTourController;
