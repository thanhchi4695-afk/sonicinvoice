import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * StickyActionBar — sticks to the bottom of the viewport on long forms
 * (Invoice Review, Stock Adjustments, etc).
 *
 * Layout:
 *  - leading slot   (e.g., "Back", small status text)
 *  - center slot    (e.g., counts / warnings)
 *  - trailing slot  (primary CTA)
 *
 * On mobile/iPad the bar safely respects the bottom-nav height (handled by
 * StockyLayout — adds bottom padding to the page when the tab bar is shown).
 */
interface StickyActionBarProps {
  leading?: React.ReactNode;
  center?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}

export function StickyActionBar({
  leading,
  center,
  trailing,
  className,
}: StickyActionBarProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 left-0 right-0 z-30 border-t border-border/60 bg-card/85 backdrop-blur-md",
        "px-4 py-2.5",
        className,
      )}
      role="toolbar"
      aria-label="Page actions"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">{leading}</div>
        <div className="hidden sm:flex items-center gap-2 min-w-0 text-xs text-muted-foreground truncate">
          {center}
        </div>
        <div className="flex items-center gap-2 shrink-0">{trailing}</div>
      </div>
    </div>
  );
}
