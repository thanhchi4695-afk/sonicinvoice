import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import AutoBreadcrumbs from "./AutoBreadcrumbs";

interface AppTopBarProps {
  /** Left slot — typically <SidebarTrigger /> on desktop. */
  leading?: ReactNode;
  /** Right slot — environment chip, notifications, avatar. */
  trailing?: ReactNode;
  /** Override the auto breadcrumbs with custom content. */
  center?: ReactNode;
  className?: string;
}

/**
 * Apple-style top bar (h-14). Recedes — `bg-card/60` + subtle border.
 * Sticky so breadcrumbs and global controls stay reachable while scrolling.
 */
const AppTopBar = ({ leading, trailing, center, className }: AppTopBarProps) => (
  <div
    className={cn(
      "sticky top-0 z-30 h-14 flex items-center gap-3 px-4 border-b border-border/60 bg-card/70 backdrop-blur-md",
      className,
    )}
  >
    {leading && <div className="flex items-center shrink-0">{leading}</div>}
    <div className="flex-1 min-w-0">{center ?? <AutoBreadcrumbs />}</div>
    {trailing && <div className="flex items-center gap-2 shrink-0">{trailing}</div>}
  </div>
);

export default AppTopBar;
export { AppTopBar };
