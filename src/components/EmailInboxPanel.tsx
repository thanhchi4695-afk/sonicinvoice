import { useState } from "react";
import { ChevronLeft, Copy, Check, Upload, Mail, Paperclip, ChevronDown, Loader2, FileText, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addAuditEntry } from "@/lib/audit-log";

interface EmailInboxPanelProps {
  onBack: () => void;
  onProcessInvoice?: (supplierName: string) => void;
}

interface InboxItem {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  received: string;
  receivedDate: Date;
  attachmentName: string;
  attachmentPages: number;
  attachmentType: "pdf" | "xlsx" | "csv" | "image";
  status: "queued" | "processing" | "ready" | "done";
}

const INBOX_KEY = "email_inbox";

function getInboxItems(): InboxItem[] {
  try { return JSON.parse(localStorage.getItem(INBOX_KEY) || "[]"); } catch { return []; }
}

function saveInboxItems(items: InboxItem[]) {
  localStorage.setItem(INBOX_KEY, JSON.stringify(items));
}

// Seed demo items
(function seedInbox() {
  const existing = getInboxItems();
  if (existing.length > 0) return;
  const seed: InboxItem[] = [
    {
      id: "inbox-1",
      from: "Jantzen Orders",
      fromEmail: "orders@jantzen.com.au",
      subject: "Invoice JAN-2847 — March delivery",
      received: "Today 2:14 PM",
      receivedDate: new Date(),
      attachmentName: "JAN-2847.pdf",
      attachmentPages: 3,
      attachmentType: "pdf",
      status: "queued",
    },
    {
      id: "inbox-2",
      from: "Seafolly Wholesale",
      fromEmail: "wholesale@seafolly.com.au",
      subject: "SF Invoice #1190 — Restock order",
      received: "Today 10:22 AM",
      receivedDate: new Date(Date.now() - 4 * 60 * 60 * 1000),
      attachmentName: "SF-1190.xlsx",
      attachmentPages: 1,
      attachmentType: "xlsx",
      status: "ready",
    },
    {
      id: "inbox-3",
      from: "Baku Australia",
      fromEmail: "accounts@baku.com.au",
      subject: "March Statement & Invoice BK-501",
      received: "Yesterday 4:30 PM",
      receivedDate: new Date(Date.now() - 22 * 60 * 60 * 1000),
      attachmentName: "BK-501.pdf",
      attachmentPages: 2,
      attachmentType: "pdf",
      status: "done",
    },
  ];
  saveInboxItems(seed);
})();

export function getUnprocessedInboxCount(): number {
  return getInboxItems().filter(i => i.status === "queued" || i.status === "ready").length;
}

const attachmentIcon = (type: InboxItem["attachmentType"]) => {
  switch (type) {
    case "pdf": return <FileText className="w-3 h-3 text-destructive" />;
    case "xlsx": case "csv": return <FileText className="w-3 h-3 text-success" />;
    case "image": return <Image className="w-3 h-3 text-primary" />;
  }
};

const statusBadge = (status: InboxItem["status"]) => {
  switch (status) {
    case "queued": return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-warning/15 text-warning border border-warning/20">⏳ Queued</span>;
    case "processing": return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/15 text-primary border border-primary/20 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Processing</span>;
    case "ready": return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-success/15 text-success border border-success/20">✅ Ready</span>;
    case "done": return <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border">✓ Done</span>;
  }
};

const EmailInboxPanel = ({ onBack, onProcessInvoice }: EmailInboxPanelProps) => {
  const [items, setItems] = useState<InboxItem[]>(getInboxItems);
  const [copied, setCopied] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [simFrom, setSimFrom] = useState("");
  const [simSubject, setSimSubject] = useState("");
  const [simFile, setSimFile] = useState<string | null>(null);

  const username = localStorage.getItem("sonic_invoice_username") || "splash";
  const inboxAddress = `${username}@suppliersync.app`;

  const handleCopy = () => {
    navigator.clipboard.writeText(inboxAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleProcess = (item: InboxItem) => {
    // Update status
    const updated = items.map(i => i.id === item.id ? { ...i, status: "done" as const } : i);
    setItems(updated);
    saveInboxItems(updated);
    addAuditEntry("Email", `Processed email invoice from ${item.from}: ${item.subject}`);

    // Extract supplier name from email domain
    const domain = item.fromEmail.split("@")[1] || "";
    const supplierName = domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1);
    onProcessInvoice?.(supplierName);
  };

  const handleSimulateSend = () => {
    if (!simFrom.trim()) return;
    const fileName = simFile || "invoice.pdf";
    const ext = fileName.split(".").pop()?.toLowerCase() || "pdf";
    const attachType: InboxItem["attachmentType"] = ["jpg", "jpeg", "png", "heic", "webp"].includes(ext) ? "image" : ext === "xlsx" ? "xlsx" : ext === "csv" ? "csv" : "pdf";

    const newItem: InboxItem = {
      id: `inbox-${Date.now()}`,
      from: simFrom.includes("@") ? simFrom.split("@")[0] : simFrom,
      fromEmail: simFrom.includes("@") ? simFrom : `${simFrom.toLowerCase().replace(/\s+/g, "")}@supplier.com`,
      subject: simSubject || `Invoice from ${simFrom}`,
      received: "Just now",
      receivedDate: new Date(),
      attachmentName: fileName,
      attachmentPages: Math.floor(Math.random() * 4) + 1,
      attachmentType: attachType,
      status: "queued",
    };
    const updated = [newItem, ...items];
    setItems(updated);
    saveInboxItems(updated);
    addAuditEntry("Email", `Received simulated email from ${newItem.fromEmail}: ${newItem.subject}`);
    setSimFrom("");
    setSimSubject("");
    setSimFile(null);
    setShowSimulator(false);
  };

  const queuedCount = items.filter(i => i.status === "queued" || i.status === "ready").length;

  return (
    <div className="min-h-screen pb-24 animate-fade-in">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h2 className="text-lg font-semibold font-display">📥 Email Inbox</h2>
          </div>
          {queuedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary text-primary-foreground">{queuedCount} unprocessed</span>
          )}
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* Inbox address card */}
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground mb-1">Your dedicated inbox:</p>
              <p className="text-sm font-semibold font-mono-data text-primary break-all">{inboxAddress}</p>
              <p className="text-[11px] text-muted-foreground mt-2">
                Give this address to your suppliers. When they email an invoice, it will appear here automatically.
              </p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 h-8 text-xs gap-1" onClick={handleCopy}>
              {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-3 pt-2 border-t border-primary/10">
            Supports PDF, Excel, CSV, and image attachments. Inbox refreshes every 30 seconds.
          </p>
        </div>

        {/* Inbox queue */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Inbox queue</h3>
          {items.length === 0 ? (
            <div className="bg-card rounded-lg border border-border p-8 text-center">
              <div className="w-14 h-14 rounded-full bg-muted mx-auto flex items-center justify-center mb-3">
                <Mail className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No invoices yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Share your inbox address with your suppliers and their invoices will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="divide-y divide-border">
                {items.map(item => (
                  <div key={item.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-medium truncate">{item.from}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0">{item.received}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{item.subject}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border border-border">
                            {attachmentIcon(item.attachmentType)}
                            <Paperclip className="w-2.5 h-2.5" />
                            {item.attachmentName}
                            {item.attachmentType === "pdf" && <span className="text-muted-foreground/60">· {item.attachmentPages} pg</span>}
                          </span>
                          {statusBadge(item.status)}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {(item.status === "queued" || item.status === "ready") && (
                          <Button size="sm" variant="teal" className="h-7 text-xs" onClick={() => handleProcess(item)}>
                            Process →
                          </Button>
                        )}
                        {item.status === "done" && (
                          <span className="text-[10px] text-muted-foreground">📧 Email</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Simulate incoming email */}
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setShowSimulator(!showSimulator)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-xs font-medium flex items-center gap-2">
              <Mail className="w-3.5 h-3.5 text-muted-foreground" />
              📧 Simulate incoming email
            </span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showSimulator ? "rotate-180" : ""}`} />
          </button>
          {showSimulator && (
            <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
              <p className="text-[11px] text-muted-foreground">Test the inbox flow by simulating a supplier email.</p>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">From</label>
                <input
                  value={simFrom}
                  onChange={e => setSimFrom(e.target.value)}
                  placeholder="orders@jantzen.com.au"
                  className="w-full h-9 rounded-md bg-input border border-border px-3 text-sm"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Subject</label>
                <input
                  value={simSubject}
                  onChange={e => setSimSubject(e.target.value)}
                  placeholder="Invoice JAN-2847"
                  className="w-full h-9 rounded-md bg-input border border-border px-3 text-sm"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Attachment</label>
                <div className="flex items-center gap-2">
                  <label className="flex-1 h-9 rounded-md bg-input border border-border px-3 text-sm flex items-center gap-2 cursor-pointer text-muted-foreground">
                    <Upload className="w-3.5 h-3.5" />
                    {simFile || "Choose file..."}
                    <input
                      type="file"
                      accept=".pdf,.xlsx,.csv,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={e => setSimFile(e.target.files?.[0]?.name || null)}
                    />
                  </label>
                </div>
              </div>
              <Button variant="teal" className="w-full h-10" onClick={handleSimulateSend} disabled={!simFrom.trim()}>
                <Mail className="w-4 h-4 mr-2" /> Send to inbox
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmailInboxPanel;
