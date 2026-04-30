import { lazy, Suspense, useState } from "react";
import { BookOpen, Compass } from "lucide-react";
import { cn } from "@/lib/utils";

const HowToCatalog = lazy(() => import("@/components/HowToCatalog"));
const LightspeedGuide = lazy(() => import("@/components/LightspeedGuide"));

interface Props {
  onNavigateToFeature?: (flowKey: string) => void;
  onNavigateToTab?: (tab: string) => void;
}

type SubTab = "howto" | "guide";

const HowToTabs = ({ onNavigateToFeature, onNavigateToTab }: Props) => {
  const [sub, setSub] = useState<SubTab>("howto");

  const tabs: { id: SubTab; label: string; icon: typeof BookOpen }[] = [
    { id: "howto", label: "How To", icon: BookOpen },
    { id: "guide", label: "Guide", icon: Compass },
  ];

  return (
    <div className="animate-fade-in">
      {/* Sub-tab bar */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex items-center gap-1 px-4 pt-3">
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = sub === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSub(t.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
        {sub === "howto" && (
          <HowToCatalog
            onNavigateToFeature={onNavigateToFeature}
            onNavigateToTab={onNavigateToTab}
          />
        )}
        {sub === "guide" && <LightspeedGuide />}
      </Suspense>
    </div>
  );
};

export default HowToTabs;
