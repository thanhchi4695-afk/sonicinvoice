import { lazy, Suspense, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, HeartPulse, Activity } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

const InventoryDashboard = lazy(() => import("@/components/InventoryDashboard"));
const ProductHealthPanel = lazy(() => import("@/components/ProductHealthPanel"));
const StockMonitorPanel = lazy(() => import("@/components/StockMonitorPanel"));

const fallback = (
  <div className="flex items-center justify-center min-h-[200px]">
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

interface InventoryViewProps {
  onBack: () => void;
}

export default function InventoryView({ onBack }: InventoryViewProps) {
  const [tab, setTab] = useState("dashboard");

  return (
    <div className="min-h-screen pb-24 animate-fade-in">
      <div className="sticky top-0 z-30 bg-background/85 backdrop-blur-md border-b border-border/70">
        <div className="px-4 sm:px-6 pt-5 pb-3 max-w-[1600px] mx-auto">
          <PageHeader
            title="Inventory"
            subtitle="Live stock health, monitoring and product diagnostics."
          />
          <Tabs value={tab} onValueChange={setTab} className="mt-3">
            <TabsList className="h-9 bg-muted/50">
              <TabsTrigger value="dashboard" className="text-xs gap-1.5 h-7">
                <Package className="w-3.5 h-3.5" /> Dashboard
              </TabsTrigger>
              <TabsTrigger value="health" className="text-xs gap-1.5 h-7">
                <HeartPulse className="w-3.5 h-3.5" /> Health
              </TabsTrigger>
              <TabsTrigger value="monitor" className="text-xs gap-1.5 h-7">
                <Activity className="w-3.5 h-3.5" /> Monitor
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 max-w-[1600px] mx-auto">
        <Suspense fallback={fallback}>
          {tab === "dashboard" && <InventoryDashboard onBack={onBack} />}
          {tab === "health" && <ProductHealthPanel onBack={onBack} />}
          {tab === "monitor" && <StockMonitorPanel onBack={onBack} />}
        </Suspense>
      </div>
    </div>
  );
}
