import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * InvoiceStepper — Apple-style numbered stepper used in the Invoice flow header.
 *
 * - Completed steps: filled teal circle with check + connector line filled
 * - Current step:    ring + bold label
 * - Future steps:    muted circle with number
 *
 * Steps are clickable when `onStepClick` is provided AND the step is <= furthestStep.
 */
export interface StepperStep {
  label: string;
  /** Optional shorter label shown on small screens */
  shortLabel?: string;
}

interface InvoiceStepperProps {
  steps: StepperStep[];
  /** 1-based index of the current step */
  current: number;
  /** Highest 1-based index the user has reached so far (controls clickability) */
  furthest?: number;
  onStepClick?: (step: number) => void;
  className?: string;
}

export function InvoiceStepper({
  steps,
  current,
  furthest,
  onStepClick,
  className,
}: InvoiceStepperProps) {
  const reach = Math.max(furthest ?? current, current);

  return (
    <ol
      className={cn("flex items-center gap-1 w-full", className)}
      aria-label="Invoice progress"
    >
      {steps.map((s, idx) => {
        const n = idx + 1;
        const isComplete = n < current;
        const isCurrent = n === current;
        const isReachable = n <= reach;
        const clickable = !!onStepClick && isReachable && !isCurrent;

        const Inner = (
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                "shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors",
                isComplete && "bg-primary text-primary-foreground",
                isCurrent && "bg-primary/15 text-primary ring-2 ring-primary",
                !isComplete && !isCurrent && "bg-muted text-muted-foreground border border-border",
              )}
              aria-current={isCurrent ? "step" : undefined}
            >
              {isComplete ? <Check className="w-3.5 h-3.5" /> : n}
            </span>
            <span
              className={cn(
                "text-[11px] sm:text-xs truncate transition-colors",
                isCurrent ? "text-foreground font-semibold" : "text-muted-foreground",
                isComplete && "text-foreground/80",
              )}
            >
              <span className="hidden sm:inline">{s.label}</span>
              <span className="sm:hidden">{s.shortLabel ?? s.label}</span>
            </span>
          </div>
        );

        return (
          <li key={n} className="flex items-center gap-1 flex-1 min-w-0">
            {clickable ? (
              <button
                type="button"
                onClick={() => onStepClick?.(n)}
                className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background"
              >
                {Inner}
              </button>
            ) : (
              Inner
            )}
            {n < steps.length && (
              <div
                aria-hidden
                className={cn(
                  "flex-1 h-px transition-colors",
                  n < current ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
