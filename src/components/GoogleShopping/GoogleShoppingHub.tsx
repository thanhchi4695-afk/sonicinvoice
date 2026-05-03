/**
 * GoogleShoppingHub
 *
 * Single entry point that exposes every Google Shopping module the
 * project ships with: feed health overview, product attributes table,
 * promotions builder, and the bulk discount scheduler.
 *
 * Heavy panels are lazy-loaded so the initial route stays under the
 * 2.5 s LCP budget.
 */

import { Suspense, lazy, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  ListChecks,
  Megaphone,
  PercentCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

const FeedDashboard = lazy(() => import("./FeedDashboard"));
const ProductFeedTable = lazy(() => import("./ProductFeedTable"));
const PromotionsFeedBuilder = lazy(() => import("./PromotionsFeedBuilder"));
const BulkDiscountScheduler = lazy(() => import("./BulkDiscountScheduler"));

import { BackButton } from "@/components/BackButton";

type Tab = "overview" | "products" | "promotions" | "discounts";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview",   label: "Overview",       icon: BarChart3 },
  { id: "products",   label: "Product feed",   icon: ListChecks },
  { id: "promotions", label: "Promotions",     icon: Megaphone },
  { id: "discounts",  label: "Bulk discounts", icon: PercentCircle },
];

function PanelSkeleton() {
  return (
    <Card>
      <CardContent className="p-6 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
        <div className="grid grid-cols-3 gap-3 pt-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64 w-full mt-4" />
      </CardContent>
    </Card>
  );
}

export default function GoogleShoppingHub() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <BackButton to="/dashboard" />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="w-full grid grid-cols-2 sm:grid-cols-4">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="gap-1.5">
              <t.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{t.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Suspense fallback={<PanelSkeleton />}>
            <FeedDashboard />
          </Suspense>
        </TabsContent>
        <TabsContent value="products" className="mt-4">
          <Suspense fallback={<PanelSkeleton />}>
            <ProductFeedTable />
          </Suspense>
        </TabsContent>
        <TabsContent value="promotions" className="mt-4">
          <Suspense fallback={<PanelSkeleton />}>
            <PromotionsFeedBuilder />
          </Suspense>
        </TabsContent>
        <TabsContent value="discounts" className="mt-4">
          <Suspense fallback={<PanelSkeleton />}>
            <BulkDiscountScheduler />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
