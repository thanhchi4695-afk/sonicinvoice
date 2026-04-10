import FeatureTile from "@/components/FeatureTile";
import { getRecentAuditEntries, formatRelativeTime } from "@/lib/audit-log";
import { getUnprocessedInboxCount } from "@/components/EmailInboxPanel";

interface InvoicesTabProps {
  onStartInvoice: () => void;
  onStartStockCheck: () => void;
  onStartPackingSlip: () => void;
  onStartScanMode: () => void;
  onStartEmailInbox: () => void;
  onStartJoor: () => void;
  onStartWholesaleImport: () => void;
  onStartLookbookImport: () => void;
  onStartPurchaseOrders: () => void;
  onStartOrderForm: () => void;
  onStartAccounting: () => void;
  onStartRestock: () => void;
  onStartReorder: () => void;
  onStartSuppliers: () => void;
  onStartCatalogMemory: () => void;
}

const InvoicesTab = ({
  onStartInvoice, onStartStockCheck, onStartPackingSlip, onStartScanMode,
  onStartEmailInbox, onStartJoor, onStartWholesaleImport, onStartLookbookImport,
  onStartPurchaseOrders, onStartOrderForm, onStartAccounting, onStartRestock,
  onStartReorder, onStartSuppliers, onStartCatalogMemory,
}: InvoicesTabProps) => {
  const unread = getUnprocessedInboxCount();

  const tiles = [
    { icon: "📄", label: "Import invoice", onClick: onStartInvoice, highlight: true },
    { icon: "🔍", label: "Stock check", onClick: onStartStockCheck, highlight: true },
    { icon: "📦", label: "Packing slip", onClick: onStartPackingSlip },
    { icon: "📷", label: "Scan mode", onClick: onStartScanMode },
    { icon: "📧", label: "Email inbox", onClick: onStartEmailInbox, badge: unread || undefined },
    { icon: "🔗", label: "JOOR orders", onClick: onStartJoor },
    { icon: "📥", label: "Wholesale import", onClick: onStartWholesaleImport },
    { icon: "📸", label: "Lookbook import", onClick: onStartLookbookImport },
    { icon: "📋", label: "Purchase orders", onClick: onStartPurchaseOrders },
    { icon: "📝", label: "Order forms", onClick: onStartOrderForm },
    { icon: "💼", label: "Accounting push", onClick: onStartAccounting },
    { icon: "📊", label: "Restock analytics", onClick: onStartRestock },
    { icon: "🔄", label: "Reorder suggestions", onClick: onStartReorder },
    { icon: "👥", label: "Supplier performance", onClick: onStartSuppliers },
    { icon: "📚", label: "Catalog memory", onClick: onStartCatalogMemory },
  ];

  const auditEntries = getRecentAuditEntries(5);

  return (
    <div className="px-4 pt-4 pb-24 animate-fade-in">
      <h1 className="text-xl font-bold font-display mb-1">Invoices & Stock</h1>
      <p className="text-muted-foreground text-sm mb-4">Full invoice workflow</p>

      <div className="grid grid-cols-2 gap-2 mb-6">
        {tiles.map((tile) => (
          <FeatureTile key={tile.label} {...tile} />
        ))}
      </div>

      {auditEntries.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Recent activity</h3>
          <div className="space-y-1.5">
            {auditEntries.map((entry, i) => (
              <div key={`${entry.timestamp}-${i}`} className="flex items-center gap-2 bg-card rounded-lg border border-border px-3 py-2.5">
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                  {entry.action}
                </span>
                <span className="text-xs flex-1 truncate text-foreground/80">{entry.detail}</span>
                <span className="text-[10px] text-muted-foreground font-mono-data shrink-0">{formatRelativeTime(entry.timestamp)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default InvoicesTab;
