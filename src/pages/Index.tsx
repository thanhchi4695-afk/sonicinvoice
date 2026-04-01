import { useState } from "react";
import AuthScreen from "@/components/AuthScreen";
import BottomTabBar from "@/components/BottomTabBar";
import HomeScreen from "@/components/HomeScreen";
import HistoryScreen from "@/components/HistoryScreen";
import ToolsScreen from "@/components/ToolsScreen";
import AccountScreen from "@/components/AccountScreen";
import InvoiceFlow from "@/components/InvoiceFlow";
import BulkSaleFlow from "@/components/BulkSaleFlow";
import RestockAnalytics from "@/components/RestockAnalytics";
import PriceAdjustmentPanel from "@/components/PriceAdjustmentPanel";
import PriceLookup from "@/components/PriceLookup";

const Index = () => {
  const [authed, setAuthed] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [activeFlow, setActiveFlow] = useState<"invoice" | "sale" | "restock" | "price_adjust" | "price_lookup" | null>(null);

  if (!authed) {
    return <AuthScreen onAuth={() => setAuthed(true)} />;
  }

  if (activeFlow === "invoice") {
    return <InvoiceFlow onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "sale") {
    return <BulkSaleFlow onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "restock") {
    return <RestockAnalytics onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "price_adjust") {
    return <PriceAdjustmentPanel onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "price_lookup") {
    return <PriceLookup onBack={() => setActiveFlow(null)} />;
  }

  return (
    <div className="min-h-screen">
      {activeTab === "home" && (
        <HomeScreen
          onStartInvoice={() => setActiveFlow("invoice")}
          onStartSale={() => setActiveFlow("sale")}
          onStartRestock={() => setActiveFlow("restock")}
          onStartPriceAdjust={() => setActiveFlow("price_adjust")}
        />
      )}
      {activeTab === "history" && <HistoryScreen />}
      {activeTab === "tools" && <ToolsScreen />}
      {activeTab === "account" && <AccountScreen />}
      <BottomTabBar activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default Index;
