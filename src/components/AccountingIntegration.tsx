import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Check, X, Loader2, ExternalLink, Unplug, RefreshCw, FileText, ChevronRight, Filter, Brain, Upload, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import Papa from "papaparse";
import {
  classifyInvoice, isFreightLine, recordSuccessfulPush, recordCorrection,
  seedFromXeroBillsCSV, getClassificationStats, getAllAccountCodes,
  getSupplierHistory, type InvoiceCategorisation,
} from "@/lib/invoice-category-ai";

interface AccountingConnection {
  id: string;
  platform: string;
  xero_tenant_name?: string;
  myob_company_file_name?: string;
  account_mappings: Record<string, string>;
  connected_at: string;
  last_synced?: string;
}

interface PushRecord {
  id: string;
  platform: string;
  invoice_id: string;
  external_id?: string;
  external_url?: string;
  supplier_name?: string;
  invoice_date?: string;
  total_inc_gst?: number;
  gst_amount?: number;
  status: string;
  error_message?: string;
  pushed_at: string;
}

const CATEGORIES = [
  { key: "swimwear", label: "Swimwear / Apparel" },
  { key: "footwear", label: "Footwear" },
  { key: "accessories", label: "Accessories" },
  { key: "home", label: "Home & Living" },
  { key: "freight", label: "Freight / Shipping" },
  { key: "other", label: "Other / Uncategorised" },
];

// ── Main component ──
export default function AccountingIntegration({ onBack }: { onBack: () => void }) {
  const [screen, setScreen] = useState<"select" | "mapping" | "history" | "training">("select");
  const [connections, setConnections] = useState<AccountingConnection[]>([]);
  const [history, setHistory] = useState<PushRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [activePlatform, setActivePlatform] = useState<"xero" | "myob" | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [savingMappings, setSavingMappings] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<string>("all");
  const [trainingStats, setTrainingStats] = useState(getClassificationStats());
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadConnections();
    loadHistory();
  }, []);

  const loadConnections = async () => {
    const { data } = await supabase.from("accounting_connections").select("*");
    setConnections((data as any[]) || []);
    setLoading(false);
  };

  const loadHistory = async () => {
    const { data } = await supabase.from("accounting_push_history").select("*").order("pushed_at", { ascending: false }).limit(100);
    setHistory((data as any[]) || []);
  };

  const getConnection = (platform: string) => connections.find(c => c.platform === platform);

  const handleConnect = async (platform: "xero" | "myob") => {
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("accounting-proxy", {
        body: { action: "get_auth_url", platform },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("No auth URL returned");

      // Open OAuth popup
      const popup = window.open(data.url, `${platform}_auth`, "width=600,height=700,left=200,top=100");

      // Listen for postMessage from callback
      const handler = (event: MessageEvent) => {
        if (event.data?.type === "ACCOUNTING_AUTH_SUCCESS") {
          toast.success(`Connected to ${event.data.data?.tenant_name || event.data.data?.company_name || platform}`);
          loadConnections();
          window.removeEventListener("message", handler);
        } else if (event.data?.type === "ACCOUNTING_AUTH_ERROR") {
          toast.error(`Connection failed: ${event.data.error}`);
          window.removeEventListener("message", handler);
        }
      };
      window.addEventListener("message", handler);

      // Fallback: check if popup closed without completing
      const interval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(interval);
          setConnecting(false);
          window.removeEventListener("message", handler);
          loadConnections();
        }
      }, 1000);
    } catch (err: any) {
      toast.error(err.message || "Failed to start connection");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (platform: string) => {
    const conn = getConnection(platform);
    if (!conn) return;
    await supabase.from("accounting_connections").delete().eq("id", conn.id);
    toast.success(`Disconnected from ${platform}`);
    loadConnections();
  };

  const openMappingScreen = async (platform: "xero" | "myob") => {
    setActivePlatform(platform);
    setScreen("mapping");
    const conn = getConnection(platform);
    setMappings(conn?.account_mappings || {});

    try {
      const { data, error } = await supabase.functions.invoke("accounting-proxy", {
        body: { action: "get_accounts", platform },
      });
      if (error) throw error;
      setAccounts(data?.accounts || []);
    } catch {
      toast.error("Could not load accounts from " + platform);
    }
  };

  const saveMappings = async () => {
    if (!activePlatform) return;
    setSavingMappings(true);
    const conn = getConnection(activePlatform);
    if (conn) {
      await supabase.from("accounting_connections").update({ account_mappings: mappings }).eq("id", conn.id);
      toast.success("Account mappings saved");
      loadConnections();
    }
    setSavingMappings(false);
  };

  const filteredHistory = history.filter(h => {
    if (historyFilter === "all") return true;
    if (historyFilter === "pushed" || historyFilter === "failed") return h.status === historyFilter;
    return h.platform === historyFilter;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  // ── MAPPING SCREEN ──
  if (screen === "mapping" && activePlatform) {
    const platformLabel = activePlatform === "xero" ? "Xero" : "MYOB";
    const filteredAccounts = activePlatform === "xero"
      ? accounts.filter((a: any) => a.Type === "EXPENSE" || a.Type === "DIRECTCOSTS" || a.Class === "EXPENSE")
      : accounts;

    return (
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <button onClick={() => setScreen("select")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-xl font-semibold">Map categories → {platformLabel} accounts</h1>
        <p className="text-sm text-muted-foreground">Select which account code to use for each product category when bills are pushed.</p>

        <div className="space-y-3">
          {CATEGORIES.map(cat => (
            <div key={cat.key} className="flex items-center gap-3 bg-card rounded-lg border border-border p-3">
              <span className="text-sm font-medium flex-1 min-w-0">{cat.label}</span>
              <select
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={mappings[cat.key] || ""}
                onChange={e => setMappings(prev => ({ ...prev, [cat.key]: e.target.value }))}
              >
                <option value="">Select account…</option>
                {filteredAccounts.map((a: any) => (
                  <option key={a.AccountID || a.UID || a.DisplayID} value={activePlatform === "xero" ? a.Code : a.UID}>
                    {activePlatform === "xero" ? `${a.Code} — ${a.Name}` : `${a.DisplayID} — ${a.Name}`}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <Button onClick={saveMappings} disabled={savingMappings} className="w-full">
          {savingMappings ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
          Save mapping
        </Button>
      </div>
    );
  }

  // ── HISTORY SCREEN ──
  if (screen === "history") {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <button onClick={() => setScreen("select")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-xl font-semibold">Push history</h1>

        <div className="flex gap-2 flex-wrap">
          {["all", "pushed", "failed", "xero", "myob"].map(f => (
            <button
              key={f}
              onClick={() => setHistoryFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium border ${historyFilter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border"}`}
            >
              {f === "all" ? "All" : f === "pushed" ? "✓ Pushed" : f === "failed" ? "✗ Failed" : f.toUpperCase()}
            </button>
          ))}
        </div>

        {filteredHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No push history yet</p>
        ) : (
          <div className="space-y-2">
            {filteredHistory.map(h => (
              <div key={h.id} className="bg-card rounded-lg border border-border p-3 flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full shrink-0 ${h.status === "pushed" ? "bg-green-500" : "bg-destructive"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{h.supplier_name || "Unknown"}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">${Number(h.total_inc_gst || 0).toFixed(2)}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="uppercase text-xs font-mono text-muted-foreground">{h.platform}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {new Date(h.pushed_at).toLocaleDateString()}
                    {h.status === "failed" && h.error_message && <span className="text-destructive ml-2">Error: {h.error_message.slice(0, 80)}</span>}
                  </div>
                </div>
                {h.external_url && (
                  <a href={h.external_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs flex items-center gap-1">
                    View <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── AI TRAINING SCREEN ──
  if (screen === "training") {
    const stats = trainingStats;
    const supplierHistory = getSupplierHistory();

    const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const seeded = seedFromXeroBillsCSV(results.data as Record<string, string>[]);
          setTrainingStats(getClassificationStats());
          toast.success(`Learned from ${seeded} new supplier→category rules`);
        },
      });
    };

    return (
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <button onClick={() => setScreen("select")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">AI Category Intelligence</h1>
            <p className="text-sm text-muted-foreground">Train the AI to auto-categorise invoices by uploading your Xero bills export</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card rounded-lg border border-border p-3 text-center">
            <div className="text-2xl font-bold text-primary">{stats.totalSuppliers}</div>
            <div className="text-xs text-muted-foreground">Suppliers learned</div>
          </div>
          <div className="bg-card rounded-lg border border-border p-3 text-center">
            <div className="text-2xl font-bold text-primary">{stats.totalRules}</div>
            <div className="text-xs text-muted-foreground">Account codes</div>
          </div>
          <div className="bg-card rounded-lg border border-border p-3 text-center">
            <div className="text-2xl font-bold text-primary">{supplierHistory.length}</div>
            <div className="text-xs text-muted-foreground">Classification rules</div>
          </div>
        </div>

        {/* Upload */}
        <div className="bg-card rounded-lg border-2 border-dashed border-border p-6 text-center space-y-3">
          <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
          <div>
            <p className="text-sm font-medium">Upload Xero Bills Export (CSV)</p>
            <p className="text-xs text-muted-foreground mt-1">
              In Xero: Accounting → Reports → Aged Payables Detail → Export as CSV.
              Or: Business → Bills → Export.
            </p>
          </div>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-4 h-4 mr-2" /> Choose CSV file
          </Button>
        </div>

        {/* Top categories */}
        {stats.topCategories.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Learned categories</h3>
            {stats.topCategories.map(cat => (
              <div key={cat.category} className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
                <span className="text-sm">{cat.category}</span>
                <span className="text-xs text-muted-foreground">{cat.suppliers} suppliers</span>
              </div>
            ))}
          </div>
        )}

        {/* Supplier rules preview */}
        {supplierHistory.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Supplier rules ({supplierHistory.length})</h3>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {supplierHistory
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 30)
                .map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-muted/20 rounded px-3 py-2">
                    <span className="font-medium truncate flex-1">{r.supplierName}</span>
                    <span className="text-muted-foreground mx-2">{r.accountCode} — {r.category}</span>
                    <span className={`font-mono ${r.confidence >= 70 ? "text-green-600" : r.confidence >= 40 ? "text-yellow-600" : "text-destructive"}`}>
                      {r.confidence}%
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── PLATFORM SELECTOR (default) ──
  const xeroConn = getConnection("xero");
  const myobConn = getConnection("myob");

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div>
        <h1 className="text-xl font-semibold">Accounting integration</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Push supplier invoices directly to your accounting software — GST, total, category and supplier all pre-filled. No double entry.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Xero */}
        <div className="bg-card rounded-lg border border-border p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#13B5EA]/15 flex items-center justify-center text-lg font-bold text-[#13B5EA]">X</div>
            <div>
              <h2 className="font-semibold">Xero</h2>
              <p className="text-xs text-muted-foreground">Used by most AU retailers & accountants</p>
            </div>
          </div>
          {xeroConn ? (
            <>
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Check className="w-4 h-4" />
                <span>Connected to "{xeroConn.xero_tenant_name}"</span>
              </div>
              {xeroConn.last_synced && (
                <p className="text-xs text-muted-foreground">Last synced: {new Date(xeroConn.last_synced).toLocaleDateString()}</p>
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openMappingScreen("xero")}>
                  Account mapping
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDisconnect("xero")}>
                  <Unplug className="w-3 h-3 mr-1" /> Disconnect
                </Button>
              </div>
            </>
          ) : (
            <Button onClick={() => handleConnect("xero")} disabled={connecting} className="w-full">
              {connecting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Connect Xero <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>

        {/* MYOB */}
        <div className="bg-card rounded-lg border border-border p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#6B2D8B]/15 flex items-center justify-center text-lg font-bold text-[#6B2D8B]">M</div>
            <div>
              <h2 className="font-semibold">MYOB</h2>
              <p className="text-xs text-muted-foreground">Dominant in AU/NZ small business & retail</p>
            </div>
          </div>
          {myobConn ? (
            <>
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Check className="w-4 h-4" />
                <span>Connected to "{myobConn.myob_company_file_name}"</span>
              </div>
              {myobConn.last_synced && (
                <p className="text-xs text-muted-foreground">Last synced: {new Date(myobConn.last_synced).toLocaleDateString()}</p>
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openMappingScreen("myob")}>
                  Account mapping
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDisconnect("myob")}>
                  <Unplug className="w-3 h-3 mr-1" /> Disconnect
                </Button>
              </div>
            </>
          ) : (
            <Button onClick={() => handleConnect("myob")} disabled={connecting} className="w-full">
              {connecting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Connect MYOB <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      </div>

      {/* AI Training link */}
      <button
        onClick={() => setScreen("training")}
        className="w-full bg-card rounded-lg border border-border p-4 flex items-center gap-3 hover:bg-muted/50 transition-colors"
      >
        <Brain className="w-5 h-5 text-primary" />
        <div className="flex-1 text-left">
          <span className="text-sm font-medium">AI Category Intelligence</span>
          <span className="text-xs text-muted-foreground ml-2">
            {trainingStats.totalSuppliers > 0 ? `${trainingStats.totalSuppliers} suppliers learned` : "Upload Xero bills to train"}
          </span>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </button>

      {/* Push history link */}
      {history.length > 0 && (
        <button
          onClick={() => setScreen("history")}
          className="w-full bg-card rounded-lg border border-border p-4 flex items-center gap-3 hover:bg-muted/50 transition-colors"
        >
          <FileText className="w-5 h-5 text-muted-foreground" />
          <div className="flex-1 text-left">
            <span className="text-sm font-medium">Push history</span>
            <span className="text-xs text-muted-foreground ml-2">{history.length} records</span>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

// ── Inline push panel for InvoiceFlow / WholesaleImportFlow ──
export function AccountingPushPanel({ invoice }: { invoice: any }) {
  const [connections, setConnections] = useState<AccountingConnection[]>([]);
  const [pushing, setPushing] = useState<string | null>(null);
  const [result, setResult] = useState<{ platform: string; success: boolean; url?: string; error?: string } | null>(null);

  useEffect(() => {
    supabase.from("accounting_connections").select("*").then(({ data }) => {
      setConnections((data as any[]) || []);
    });
  }, []);

  const handlePush = async (platform: "xero" | "myob") => {
    const conn = connections.find(c => c.platform === platform);
    if (!conn) return;

    setPushing(platform);
    setResult(null);

    try {
      // Find or create contact
      const contactAction = platform === "xero" ? "find_or_create_contact" : "find_or_create_supplier";
      const { data: contactData, error: contactError } = await supabase.functions.invoke("accounting-proxy", {
        body: { action: contactAction, platform, supplier_name: invoice.supplier || "Unknown Supplier" },
      });
      if (contactError) throw contactError;

      const contactId = platform === "xero" ? contactData.contactId : contactData.uid;
      const accountCode = conn.account_mappings?.["swimwear"] || conn.account_mappings?.["other"] || "";

      const pushBody: any = { action: "push_bill", platform, invoice };
      if (platform === "xero") {
        pushBody.contact_id = contactId;
        pushBody.account_code = accountCode;
      } else {
        pushBody.supplier_uid = contactId;
        pushBody.account_uid = accountCode;
        pushBody.gst_uid = conn.account_mappings?.["gst_uid"] || "";
      }

      const { data, error } = await supabase.functions.invoke("accounting-proxy", { body: pushBody });
      if (error) throw error;

      if (data?.success) {
        setResult({ platform, success: true, url: data.external_url });
        toast.success(`Bill sent to ${platform === "xero" ? "Xero" : "MYOB"} as draft`);
      } else {
        throw new Error(data?.error || "Push failed");
      }
    } catch (err: any) {
      setResult({ platform, success: false, error: err.message });
      toast.error(`Failed to push to ${platform}: ${err.message}`);
    } finally {
      setPushing(null);
    }
  };

  if (connections.length === 0) {
    return (
      <div className="bg-muted/50 rounded-lg border border-border p-4 mt-4">
        <p className="text-sm text-muted-foreground">
          Connect Xero or MYOB in Account Settings to push invoices directly to your accounting software.
        </p>
      </div>
    );
  }

  if (result?.success) {
    return (
      <div className="bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900 p-4 mt-4">
        <div className="flex items-center gap-2 text-green-700 dark:text-green-400 mb-2">
          <Check className="w-5 h-5" />
          <span className="font-medium">Bill sent to {result.platform === "xero" ? "Xero" : "MYOB"}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Your accountant will see this as a draft bill ready to review and authorise.
        </p>
        {result.url && (
          <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1 mt-2">
            View in {result.platform === "xero" ? "Xero" : "MYOB"} <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border p-4 mt-4 space-y-3">
      <h3 className="text-sm font-semibold">Send to accounting software</h3>
      <div className="text-xs text-muted-foreground space-y-1">
        <p>Supplier: {invoice.supplier || "—"}</p>
        <p>Total: ${Number(invoice.total || 0).toFixed(2)} {invoice.gst ? `(inc GST $${Number(invoice.gst).toFixed(2)})` : ""}</p>
        <p>Category: {invoice.category || "Stock purchase"}</p>
      </div>
      <div className="flex gap-2">
        {connections.map(conn => (
          <Button
            key={conn.platform}
            size="sm"
            variant="outline"
            onClick={() => handlePush(conn.platform as "xero" | "myob")}
            disabled={!!pushing}
          >
            {pushing === conn.platform ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Push to {conn.platform === "xero" ? "Xero" : "MYOB"}
          </Button>
        ))}
      </div>
      {result?.error && (
        <p className="text-xs text-destructive">{result.error}</p>
      )}
    </div>
  );
}
