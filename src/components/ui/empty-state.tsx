import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  /** Lucide icon component (preferred) */
  icon?: LucideIcon;
  /** Or any custom node (e.g. emoji, illustration) */
  iconNode?: React.ReactNode;
  title: string;
  body?: string;
  cta?: {
    label: string;
    onClick?: () => void;
    href?: string;
    variant?: "primary" | "teal" | "amber" | "outline" | "default";
  };
  secondaryCta?: {
    label: string;
    onClick?: () => void;
  };
  className?: string;
}

/**
 * Standard empty state — centred illustration + 16/600 title + 14/muted body + single CTA.
 * Matches the redesign spec (plan §6 Empty states).
 */
export function EmptyState({
  icon: Icon,
  iconNode,
  title,
  body,
  cta,
  secondaryCta,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-16 animate-fade-in",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-center w-14 h-14 rounded-full bg-muted/60 text-muted-foreground">
        {iconNode ?? (Icon ? <Icon className="w-6 h-6" strokeWidth={1.5} /> : null)}
      </div>
      <h3 className="text-base font-semibold text-foreground mb-1">{title}</h3>
      {body && (
        <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">{body}</p>
      )}
      {(cta || secondaryCta) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {cta &&
            (cta.href ? (
              <a href={cta.href}>
                <Button variant={(cta.variant as any) ?? "primary"}>{cta.label}</Button>
              </a>
            ) : (
              <Button variant={(cta.variant as any) ?? "primary"} onClick={cta.onClick}>
                {cta.label}
              </Button>
            ))}
          {secondaryCta && (
            <Button variant="ghost" onClick={secondaryCta.onClick}>
              {secondaryCta.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
