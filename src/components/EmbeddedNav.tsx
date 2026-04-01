import { Home, FolderOpen, Wrench, User, BarChart3, HelpCircle, FileText, Package, Layers, BookOpen, Mail, ClipboardList, Link } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmbeddedNavProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onFlowChange: (flow: string) => void;
}

const navSections = [
  {
    title: "Main",
    items: [
      { id: "home", label: "Dashboard", icon: Home, type: "tab" as const },
      { id: "analytics", label: "Analytics", icon: BarChart3, type: "tab" as const },
      { id: "history", label: "History", icon: FolderOpen, type: "tab" as const },
    ],
  },
  {
    title: "Workflows",
    items: [
      { id: "invoice", label: "Process Invoice", icon: FileText, type: "flow" as const },
      { id: "sale", label: "Bulk Sale", icon: Layers, type: "flow" as const },
      { id: "purchase_orders", label: "Purchase Orders", icon: ClipboardList, type: "flow" as const },
      { id: "email_inbox", label: "Email Inbox", icon: Mail, type: "flow" as const },
      { id: "catalog_memory", label: "Catalog Memory", icon: BookOpen, type: "flow" as const },
      { id: "restock", label: "Restock Analytics", icon: Package, type: "flow" as const },
      { id: "collab_seo", label: "Collab SEO", icon: Link, type: "flow" as const },
    ],
  },
  {
    title: "Settings",
    items: [
      { id: "tools", label: "Tools & Feeds", icon: Wrench, type: "tab" as const },
      { id: "help", label: "Help Centre", icon: HelpCircle, type: "tab" as const },
      { id: "account", label: "Account", icon: User, type: "tab" as const },
    ],
  },
];

const EmbeddedNav = ({ activeTab, onTabChange, onFlowChange }: EmbeddedNavProps) => {
  return (
    <aside className="w-56 shrink-0 border-r border-border bg-card/50 h-full overflow-y-auto">
      <div className="px-4 py-4">
        <h2 className="text-sm font-bold font-display text-foreground">Sonic Invoice</h2>
        <p className="text-[10px] text-muted-foreground">Shopify Embedded</p>
      </div>
      <nav className="px-2 pb-4 space-y-4">
        {navSections.map((section) => (
          <div key={section.title}>
            <p className="px-2 mb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.type === "tab" && activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.type === "tab") onTabChange(item.id);
                      else onFlowChange(item.id);
                    }}
                    className={cn(
                      "flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-sm transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="px-4 pb-4 mt-auto border-t border-border pt-3">
        <p className="text-[9px] text-muted-foreground">Sonic Invoice v1.0</p>
        <p className="text-[9px] text-muted-foreground">Built for AU fashion boutiques</p>
      </div>
    </aside>
  );
};

export default EmbeddedNav;
