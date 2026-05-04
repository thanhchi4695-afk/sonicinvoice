import { Fragment, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/** Map raw path segments to friendlier labels. Extend as new routes appear. */
const LABEL_MAP: Record<string, string> = {
  dashboard: "Dashboard",
  account: "Account",
  billing: "Billing",
  settings: "Settings",
  rules: "Rules",
  setup: "Setup",
  "google-shopping": "Google Shopping",
  "pricing-intelligence": "Pricing Intelligence",
  support: "Support",
  privacy: "Privacy",
  health: "Health",
  admin: "Admin",
  secrets: "Secrets",
  analyse: "Analyse",
};

const prettify = (segment: string) =>
  LABEL_MAP[segment] ??
  segment
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

interface AutoBreadcrumbsProps {
  /** Optional override: extra trailing crumb (e.g. dynamic page title). */
  trailing?: string;
}

/**
 * Auto-generated breadcrumbs from the current route. Hidden on the root `/`.
 */
const AutoBreadcrumbs = ({ trailing }: AutoBreadcrumbsProps) => {
  const { pathname } = useLocation();

  const crumbs = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    return parts.map((segment, idx) => ({
      segment,
      label: prettify(segment),
      href: "/" + parts.slice(0, idx + 1).join("/"),
    }));
  }, [pathname]);

  if (crumbs.length === 0) return null;

  const items = trailing
    ? [...crumbs, { segment: "__trailing__", label: trailing, href: pathname }]
    : crumbs;

  return (
    <Breadcrumb className="text-caption">
      <BreadcrumbList>
        {items.map((crumb, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <Fragment key={`${crumb.href}-${idx}`}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
};

export default AutoBreadcrumbs;
export { AutoBreadcrumbs };
