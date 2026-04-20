import { Button } from "@/components/ui/button";
import { Receipt, X } from "lucide-react";
import { useInvoiceSession } from "@/stores/invoice-session-store";

export default function InvoiceSessionBanner() {
  const { sessionProducts, sessionSupplier, sessionDate, clearSession, hasSession } = useInvoiceSession();
  if (!hasSession) return null;
  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
      <Receipt className="w-4 h-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0 truncate">
        Using products from current invoice — <span className="font-medium">{sessionSupplier || "Untitled supplier"}</span>
        {" · "}{sessionProducts.length} products
        {sessionDate && <> · {sessionDate}</>}
      </div>
      <Button variant="ghost" size="sm" onClick={clearSession} className="h-7 text-xs">
        <X className="w-3 h-3 mr-1" /> Clear session
      </Button>
    </div>
  );
}
