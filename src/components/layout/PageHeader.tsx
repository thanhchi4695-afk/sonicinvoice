import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Optional slot rendered above the title (e.g. breadcrumbs, back link). */
  eyebrow?: ReactNode;
  className?: string;
}

/**
 * Apple-inspired page header.
 * Title 28/600 (Syne via .font-display), subtitle 14/muted, primary action right-aligned.
 * Use once per screen — replaces ad-hoc <header><h1/></header> blocks.
 */
const PageHeader = ({ title, subtitle, actions, eyebrow, className }: PageHeaderProps) => (
  <header
    className={cn(
      "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6",
      className,
    )}
  >
    <div className="min-w-0 flex-1">
      {eyebrow && <div className="mb-1.5 text-caption text-muted-foreground">{eyebrow}</div>}
      <h1 className="text-page-title font-display text-foreground leading-tight truncate">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1 text-body text-muted-foreground max-w-2xl">{subtitle}</p>
      )}
    </div>
    {actions && (
      <div className="flex items-center gap-2 shrink-0 sm:pt-1">{actions}</div>
    )}
  </header>
);

export default PageHeader;
export { PageHeader };
