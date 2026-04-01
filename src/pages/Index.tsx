import { useState } from "react";
import AuthScreen from "@/components/AuthScreen";
import BottomTabBar from "@/components/BottomTabBar";
import HomeScreen from "@/components/HomeScreen";
import HistoryScreen from "@/components/HistoryScreen";
import ToolsScreen from "@/components/ToolsScreen";
import AccountScreen from "@/components/AccountScreen";
import InvoiceFlow from "@/components/InvoiceFlow";
import BulkSaleFlow from "@/components/BulkSaleFlow";

const Index = () => {
  const [authed, setAuthed] = useState(false);
  const [activeTab, setActiveTab] = useState("home");
  const [activeFlow, setActiveFlow] = useState<"invoice" | "sale" | null>(null);

  if (!authed) {
    return <AuthScreen onAuth={() => setAuthed(true)} />;
  }

  if (activeFlow === "invoice") {
    return <InvoiceFlow onBack={() => setActiveFlow(null)} />;
  }

  if (activeFlow === "sale") {
    return <BulkSaleFlow onBack={() => setActiveFlow(null)} />;
  }

  return (
    <div className="min-h-screen">
      {activeTab === "home" && (
        <HomeScreen
          onStartInvoice={() => setActiveFlow("invoice")}
          onStartSale={() => setActiveFlow("sale")}
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
