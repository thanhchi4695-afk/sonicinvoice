import * as React from "react";
import { cn } from "@/lib/utils";

export interface DataTableShellProps {
  /** Section title shown in the header (16/600). */
  title?: React.ReactNode;
  /** Optional supporting text under the title. */
  description?: React.ReactNode;
  /** Right-aligned actions (filters, exports, primary CTA). */
  actions?: React.ReactNode;
  /** Optional toolbar row rendered below the header (search, chips, bulk-actions). */
  toolbar?: React.ReactNode;
  /** Footer content (pagination, totals). */
  footer?: React.ReactNode;
  /** When true, render no inner padding so DataGrid/Table can sit flush. */
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Standard wrapper around tables/data grids — gives every table the same Apple-style
 * card chrome: rounded card, subtle border, header row with title + actions, optional
 * toolbar, and a footer slot. Pairs with `<EmptyState />` rendered as children when
 * the table has no rows. Spec: plan §6 Tables (DataGrids).
 */
export function DataTableShell({
  title,
  description,
  actions,
  toolbar,
  footer,
  flush = false,
  className,
  children,
}: DataTableShellProps) {
  const hasHeader = title || description || actions;
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card shadow-sm overflow-hidden",
        className,
      )}
    >
      {hasHeader && (
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border/70">
          <div className="min-w-0">
            {title && (
              <h3 className="text-base font-semibold leading-tight text-foreground truncate">
                {title}
              </h3>
            )}
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      {toolbar && (
        <div className="px-4 py-2 border-b border-border/70 bg-muted/30">{toolbar}</div>
      )}
      <div className={cn(flush ? "" : "p-3 sm:p-4")}>{children}</div>
      {footer && (
        <div className="px-4 py-2.5 border-t border-border/70 bg-muted/20 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  );
}

export default DataTableShell;
