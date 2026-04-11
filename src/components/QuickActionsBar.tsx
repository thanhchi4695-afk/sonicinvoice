import { useEffect } from "react";
import { ClipboardList, PackageCheck, ClipboardCheck, ScanBarcode, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useUserRole } from "@/hooks/use-user-role";

interface QuickActionsBarProps {
  onAction: (flow: string) => void;
}

const actions = [
  { id: "purchase_orders", label: "New PO", icon: ClipboardList, key: "p", permission: "create_po" as const },
  { id: "quick_receive", label: "Quick Receive", icon: PackageCheck, key: "r", permission: "receive_po" as const },
  { id: "stocktake_module", label: "New Stocktake", icon: ClipboardCheck, key: "t", permission: "create_stocktake" as const },
  { id: "scan_mode", label: "Scan Barcode", icon: ScanBarcode, key: "s", permission: "view_inventory" as const },
  { id: "stock_adjustment", label: "Adjust Stock", icon: PlusCircle, key: "a", permission: "adjust_inventory" as const },
];

const QuickActionsBar = ({ onAction }: QuickActionsBarProps) => {
  const { hasPermission } = useUserRole();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const action = actions.find((a) => a.key === e.key.toLowerCase());
      if (action && hasPermission(action.permission)) {
        e.preventDefault();
        onAction(action.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onAction, hasPermission]);

  const visible = actions.filter((a) => hasPermission(a.permission));
  if (visible.length === 0) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 lg:bottom-auto lg:top-3 lg:left-auto lg:right-4 lg:translate-x-0 flex items-center gap-1.5 bg-card border border-border rounded-full px-3 py-1.5 shadow-lg">
        {visible.map((a) => (
          <Tooltip key={a.id}>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full" onClick={() => onAction(a.id)}>
                <a.icon className="h-4 w-4" />
                <span className="sr-only">{a.label}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {a.label} <kbd className="ml-1 px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono text-[10px]">{a.key.toUpperCase()}</kbd>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
};

export default QuickActionsBar;
