import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, Copy, Check, Upload, Mail, Paperclip, ChevronDown, Loader2, FileText, Image, RefreshCw, LogOut, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addAuditEntry } from "@/lib/audit-log";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface EmailInboxPanelProps {
  onBack: () => void;
  onProcessInvoice?: (supplierName: string) => void;
}

interface InboxItem {
  id: string;
  source: "gmail" | "sim";
  from: string;
  fromEmail: string;
  subject: string;
  received: string;
  receivedDate: Date;
  attachmentName: string;
  attachmentPages: number;
  attachmentType: "pdf" | "xlsx" | "csv" | "image";
  status: "queued" | "processing" | "ready" | "done";
  supplierName?: string | null;
  knownSupplier?: boolean;
  confidence?: "high" | "medium" | "low";
  messageId?: string;
  attachmentId?: string;
  attachmentMime?: string;
  parseJobId?: string;
  parsedVariantCount?: number;
  importing?: boolean;
  imported?: boolean;
}

const computeConfidence = (item: Pick<InboxItem, "knownSupplier" | "supplierName">): "high" | "medium" | "low" => {
  if (item.knownSupplier && item.supplierName) return "high";
  if (item.knownSupplier) return "medium";
  return "low";
};

const confidenceBadge = (c: "high" | "medium" | "low") => {
  const map = {
    high: { label: "High", cls: "bg-success/15 text-success border-success/20" },
    medium: { label: "Medium", cls: "bg-warning/15 text-warning border-warning/20" },
    low: { label: "Low", cls: "bg-destructive/15 text-destructive border-destructive/20" },
  } as const;
  const m = map[c];
  return (
    <span className={`text-[9px] px-1 py-0.5 rounded border shrink-0 ${m.cls}`} title={`Confidence: ${m.label}`}>
      {m.label}
    </span>
  );
};

interface GmailConnection {
  email_address: string;
  last_checked_at: string | null;
  is_active: boolean;
}

const SIM_KEY = "email_inbox_sim";
const isDemoMode = () =>
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("demo") === "1";

function getSimItems(): InboxItem[] {
  try { return JSON.parse(localStorage.getItem(SIM_KEY) || "[]"); } catch { return []; }
}
function saveSimItems(items: InboxItem[]) {
  localStorage.setItem(SIM_KEY, JSON.stringify(items));
}

export function getUnprocessedInboxCount(): number {
  // Sim-only count for the home badge — real Gmail count is fetched on-demand.
  return getSimItems().filter(i => i.status === "queued" || i.status === "ready").length;
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

const relTime = (d: Date) => {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const guessType = (filename: string): InboxItem["attachmentType"] => {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "pdf";
  if (["jpg", "jpeg", "png", "heic", "webp"].includes(ext)) return "image";
  if (ext === "xlsx") return "xlsx";
  if (ext === "csv") return "csv";
  return "pdf";
};

const EmailInboxPanel = ({ onBack, onProcessInvoice }: EmailInboxPanelProps) => {
  const { toast } = useToast();
  const [connection, setConnection] = useState<GmailConnection | null>(null);
  const [loadingConn, setLoadingConn] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [gmailItems, setGmailItems] = useState<InboxItem[]>([]);
  const [simItems, setSimItems] = useState<InboxItem[]>(getSimItems);
  const [showSimulator, setShowSimulator] = useState(false);
  const [simFrom, setSimFrom] = useState("");
  const [simSubject, setSimSubject] = useState("");
  const [simFile, setSimFile] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  const [filter, setFilter] = useState<"all" | "known" | "unknown" | "processed">("all");
  const [search, setSearch] = useState("");
  const [smartBulk, setSmartBulk] = useState<boolean>(() => {
    try { return localStorage.getItem("sonic_smart_bulk_enabled") === "1"; } catch { return false; }
  });
  const [autoProcessedIds, setAutoProcessedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    try { localStorage.setItem("sonic_smart_bulk_enabled", smartBulk ? "1" : "0"); } catch {}
  }, [smartBulk]);
  const demo = isDemoMode();

  const loadConnection = useCallback(async () => {
    setLoadingConn(true);
    const { data, error } = await supabase
      .from("gmail_connections")
      .select("email_address, last_checked_at, is_active")
      .eq("is_active", true)
      .maybeSingle();
    if (!error) setConnection(data as GmailConnection | null);
    setLoadingConn(false);
  }, []);

  const loadFoundInvoices = useCallback(async () => {
    const { data, error } = await supabase
      .from("gmail_found_invoices")
      .select("id, message_id, from_email, subject, received_at, supplier_name, known_supplier, attachments, processed")
      .order("received_at", { ascending: false })
      .limit(50);
    if (error) return;
    const items: InboxItem[] = [];
    for (const row of data ?? []) {
      const atts = (row.attachments as any[]) ?? [];
      const first = atts[0];
      if (!first) continue;
      const recDate = row.received_at ? new Date(row.received_at) : new Date();
      items.push({
        id: row.id,
        source: "gmail",
        from: row.supplier_name || row.from_email?.split("@")[0] || "(unknown)",
        fromEmail: row.from_email ?? "",
        subject: row.subject ?? "(no subject)",
        received: relTime(recDate),
        receivedDate: recDate,
        attachmentName: first.filename,
        attachmentPages: 1,
        attachmentType: guessType(first.filename),
        status: row.processed ? "done" : "ready",
        supplierName: row.supplier_name,
        knownSupplier: row.known_supplier,
        confidence: computeConfidence({ knownSupplier: row.known_supplier, supplierName: row.supplier_name }),
        messageId: row.message_id,
        attachmentId: first.attachment_id,
        attachmentMime: first.mime_type,
      });
    }
    setGmailItems(items);
  }, []);

  // On mount + handle ?gmail=connected redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gParam = params.get("gmail");
    if (gParam === "connected") {
      toast({ title: "Gmail connected", description: params.get("email") ?? "" });
      addAuditEntry("Email", `Connected Gmail: ${params.get("email") ?? ""}`);
      params.delete("gmail"); params.delete("email");
      const url = window.location.pathname + (params.toString() ? `?${params}` : "");
      window.history.replaceState({}, "", url);
    } else if (gParam === "error") {
      toast({ title: "Gmail connection failed", description: params.get("reason") ?? "", variant: "destructive" });
    }
    loadConnection();
    loadFoundInvoices();
  }, [loadConnection, loadFoundInvoices, toast]);

  const isInAppBrowser = (() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    return /FBAN|FBAV|FB_IAB|Messenger|Instagram|Line\/|MicroMessenger|WeChat|TikTok|Snapchat|Twitter|LinkedInApp|GSA\//i.test(ua);
  })();

  const handleConnectGmail = async () => {
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("gmail-oauth-start");
      if (error) throw error;
      const url = (data as any)?.url;
      if (!url) throw new Error("No OAuth URL returned");

      if (isInAppBrowser) {
        // Google blocks OAuth in embedded webviews ("disallowed_useragent").
        // Copy the link and prompt the user to open it in Safari/Chrome.
        try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
        toast({
          title: "Open in Safari or Chrome",
          description: "Google blocks sign-in inside Messenger/Instagram. The link is copied — paste it into your browser.",
        });
        // Best-effort escape attempts (iOS Safari & Android Chrome intent)
        const isAndroid = /Android/i.test(navigator.userAgent);
        if (isAndroid) {
          window.location.href = `intent://${url.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`;
        } else {
          window.open(url, "_blank");
        }
        setConnecting(false);
        return;
      }

      window.location.href = url;
    } catch (err: any) {
      toast({ title: "Couldn't start Gmail connect", description: err?.message ?? String(err), variant: "destructive" });
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect Gmail? You can reconnect any time.")) return;
    const { error } = await supabase
      .from("gmail_connections")
      .update({ is_active: false })
      .eq("is_active", true);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    addAuditEntry("Email", "Disconnected Gmail");
    setConnection(null);
    setGmailItems([]);
    toast({ title: "Gmail disconnected" });
  };

  const handleScanNow = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("scan-gmail-inbox", {
        body: {},
      });
      if (error) throw error;
      // The function returns 200 with { error } on reauth required, so check the body too
      if (data && (data as any).error) {
        const msg = String((data as any).error);
        if (/reauth|authoris|invalid_grant/i.test(msg)) {
          toast({
            title: "Reconnect Gmail",
            description: "Your Gmail authorisation expired. Please connect again.",
            variant: "destructive",
          });
          await loadConnection();
          return;
        }
        throw new Error(msg);
      }
      const found = (data as any)?.invoices_found?.length ?? 0;
      const scanned = (data as any)?.emails_scanned ?? 0;
      addAuditEntry("Email", `Scanned Gmail inbox — ${scanned} email(s), ${found} with invoice attachments`);
      toast({
        title: "Scan complete",
        description: `Scanned ${scanned} email${scanned === 1 ? "" : "s"}, ${found} with invoice attachment${found === 1 ? "" : "s"}`,
      });
      await Promise.all([loadConnection(), loadFoundInvoices()]);
    } catch (err: any) {
      toast({ title: "Scan failed", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const handleProcess = async (item: InboxItem) => {
    // Auto-learn: if this is an unknown Gmail sender, ask whether to save the
    // domain to a supplier profile so future emails are tagged KNOWN.
    let resolvedSupplier = item.supplierName ?? null;
    if (item.source === "gmail" && !item.knownSupplier && item.fromEmail) {
      const domain = item.fromEmail.split("@")[1]?.toLowerCase();
      if (domain) {
        const guess = domain.split(".")[0].replace(/^./, c => c.toUpperCase());
        const supplierName = window.prompt(
          `Save ${domain} as a supplier so future emails auto-tag KNOWN?\n\nEnter supplier name (or cancel to skip):`,
          guess,
        );
        if (supplierName && supplierName.trim()) {
          const trimmed = supplierName.trim();
          try {
            const { data: sessionData } = await supabase.auth.getSession();
            const userId = sessionData?.session?.user?.id;
            if (userId) {
              const { data: existing } = await supabase
                .from("supplier_profiles")
                .select("id, email_domains")
                .eq("user_id", userId)
                .eq("supplier_name", trimmed)
                .maybeSingle();
              if (existing) {
                const domains = Array.from(new Set([...(existing.email_domains ?? []), domain]));
                await supabase.from("supplier_profiles").update({ email_domains: domains }).eq("id", existing.id);
              } else {
                await supabase.from("supplier_profiles").insert({
                  user_id: userId,
                  supplier_name: trimmed,
                  email_domains: [domain],
                  is_active: true,
                });
              }
              resolvedSupplier = trimmed;
              addAuditEntry("Email", `Learned supplier ${trimmed} from ${domain}`);
              toast({ title: "Supplier learned", description: `${domain} → ${trimmed}. Future emails will auto-tag KNOWN.` });
            }
          } catch (err: any) {
            console.warn("Auto-learn failed", err);
            toast({ title: "Couldn't save supplier", description: err?.message ?? String(err), variant: "destructive" });
          }
        }
      }
    }

    const supplierName = (resolvedSupplier
      || (item.fromEmail.split("@")[1]?.split(".")[0] ?? "Supplier"));
    const niceSupplier = supplierName.charAt(0).toUpperCase() + supplierName.slice(1);

    if (item.source === "gmail") {
      // Mark as processing in UI immediately
      setGmailItems(prev => prev.map(i => i.id === item.id ? { ...i, status: "processing" } : i));
      addAuditEntry("Email", `Started processing email invoice from ${item.from}: ${item.subject}`);

      try {
        if (!item.messageId || !item.attachmentId) {
          throw new Error("Missing Gmail attachment reference");
        }

        // 1. Fetch attachment bytes (base64) via existing edge function
        const { data: attData, error: attErr } = await supabase.functions.invoke(
          "gmail-fetch-attachment",
          { body: { message_id: item.messageId, attachment_id: item.attachmentId } },
        );
        if (attErr) throw attErr;
        const fileBase64 = (attData as any)?.data_base64;
        if (!fileBase64) throw new Error("Attachment fetch returned no data");

        // 2. Run 3-stage parse pipeline
        const { data: parseData, error: parseErr } = await supabase.functions.invoke(
          "parse-invoice",
          {
            body: {
              fileBase64,
              supplierName: niceSupplier,
              mimeType: item.attachmentMime || "application/pdf",
              inputFilename: item.attachmentName,
              source: "gmail",
            },
          },
        );
        if (parseErr) throw parseErr;
        const parsed = parseData as any;
        const newConfidence: "high" | "medium" | "low" = parsed?.confidence ?? "low";
        const rowCount = Array.isArray(parsed?.rows) ? parsed.rows.length : 0;

        // 3. Mark processed in DB and update UI with real confidence
        await supabase
          .from("gmail_found_invoices")
          .update({ processed: true })
          .eq("id", item.id);
        setGmailItems(prev => prev.map(i => i.id === item.id
          ? { ...i, status: "done", confidence: newConfidence, parseJobId: parsed?.jobId, parsedVariantCount: rowCount }
          : i));

        const confLabel = newConfidence.charAt(0).toUpperCase() + newConfidence.slice(1);
        toast({
          title: "Parsed successfully",
          description: `${rowCount} variant${rowCount === 1 ? "" : "s"} from ${niceSupplier} — confidence: ${confLabel}`,
        });
        addAuditEntry("Email", `Parsed ${rowCount} variants from ${niceSupplier} (${confLabel})`);
        onProcessInvoice?.(niceSupplier);
      } catch (err: any) {
        console.error("parse-invoice failed", err);
        setGmailItems(prev => prev.map(i => i.id === item.id ? { ...i, status: "ready" } : i));
        toast({
          title: "Parse failed",
          description: err?.message ?? String(err),
          variant: "destructive",
        });
      }
    } else {
      const updated = simItems.map(i => i.id === item.id ? { ...i, status: "processing" as const } : i);
      setSimItems(updated);
      saveSimItems(updated);
      addAuditEntry("Email", `Started processing email invoice from ${item.from}: ${item.subject}`);
      onProcessInvoice?.(niceSupplier);
    }
  };

  const handleImportToShopify = async (item: InboxItem) => {
    if (!item.parseJobId) {
      toast({ title: "No parse job", description: "Process the invoice first.", variant: "destructive" });
      return;
    }
    setGmailItems(prev => prev.map(i => i.id === item.id ? { ...i, importing: true } : i));
    toast({ title: "Importing to Shopify…", description: `${item.parsedVariantCount ?? ""} variant${item.parsedVariantCount === 1 ? "" : "s"} from ${item.from}` });
    try {
      const { data, error } = await supabase.functions.invoke("shopify-import", {
        body: { jobId: item.parseJobId },
      });
      if (error) throw error;
      const result = data as { created: number; updated: number; failed: number; errors?: Array<{ message: string }> };
      const created = result?.created ?? 0;
      const updated = result?.updated ?? 0;
      const failed = result?.failed ?? 0;
      if (failed > 0 && created + updated === 0) {
        throw new Error(result?.errors?.[0]?.message ?? "All products failed");
      }
      setGmailItems(prev => prev.map(i => i.id === item.id ? { ...i, importing: false, imported: true } : i));
      toast({
        title: "Imported to Shopify",
        description: `${created} created, ${updated} updated${failed > 0 ? `, ${failed} failed` : ""}`,
      });
      addAuditEntry("Shopify", `Imported parse job ${item.parseJobId} — ${created} created, ${updated} updated, ${failed} failed`);
    } catch (err: any) {
      console.error("shopify-import failed", err);
      setGmailItems(prev => prev.map(i => i.id === item.id ? { ...i, importing: false } : i));
      toast({
        title: "Shopify import failed",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (!smartBulk) return;
    const candidates = gmailItems.filter(
      i =>
        (i.confidence ?? computeConfidence(i)) === "high" &&
        i.status !== "done" &&
        i.status !== "processing" &&
        !autoProcessedIds.has(i.id),
    );
    if (candidates.length === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    setAutoProcessedIds(prev => {
      const next = new Set(prev);
      candidates.forEach(c => next.add(c.id));
      return next;
    });
    candidates.forEach((item, idx) => {
      timers.push(setTimeout(() => {
        handleProcess(item).catch(err => console.warn("Smart bulk auto-process failed", err));
      }, 1000 + idx * 500));
    });
    return () => { timers.forEach(clearTimeout); };
  }, [gmailItems, smartBulk, autoProcessedIds]);

  const handleProcessAllKnown = async () => {
    const targets = [...gmailItems, ...simItems].filter(
      i =>
        (i.confidence ?? computeConfidence(i)) === "high" &&
        i.status !== "done" &&
        i.status !== "processing",
    );
    if (targets.length === 0) {
      toast({ title: "Nothing to process", description: "No High-confidence invoices ready. Medium and Low items need manual review." });
      return;
    }
    setBulkProgress({ current: 0, total: targets.length });
    let success = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      setBulkProgress({ current: i + 1, total: targets.length });
      try {
        await handleProcess(targets[i]);
        success++;
      } catch (err) {
        console.warn("Bulk process failed for", targets[i].id, err);
        failed++;
      }
      if (i < targets.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    setBulkProgress(null);
    toast({
      title: "Bulk processing complete",
      description: `${success} processed${failed ? `, ${failed} failed` : ""} from known suppliers.`,
    });
    addAuditEntry("Email", `Bulk processed ${success} known-supplier invoices${failed ? ` (${failed} failed)` : ""}`);
  };

  const handleSimulateSend = () => {
    if (!simFrom.trim()) return;
    const fileName = simFile || "invoice.pdf";
    const newItem: InboxItem = {
      id: `sim-${Date.now()}`,
      source: "sim",
      from: simFrom.includes("@") ? simFrom.split("@")[0] : simFrom,
      fromEmail: simFrom.includes("@") ? simFrom : `${simFrom.toLowerCase().replace(/\s+/g, "")}@supplier.com`,
      subject: simSubject || `Invoice from ${simFrom}`,
      received: "Just now",
      receivedDate: new Date(),
      attachmentName: fileName,
      attachmentPages: 1,
      attachmentType: guessType(fileName),
      status: "queued",
      confidence: "low",
    };
    const updated = [newItem, ...simItems];
    setSimItems(updated);
    saveSimItems(updated);
    addAuditEntry("Email", `Received simulated email from ${newItem.fromEmail}: ${newItem.subject}`);
    setSimFrom(""); setSimSubject(""); setSimFile(null); setShowSimulator(false);
  };

  const items = [...gmailItems, ...simItems];
  const filteredItems = items.filter(i => {
    if (filter === "known" && !i.knownSupplier) return false;
    if (filter === "unknown" && i.knownSupplier) return false;
    if (filter === "processed" && i.status !== "done") return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hay = `${i.from ?? ""} ${i.subject ?? ""} ${i.supplierName ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const queuedCount = items.filter(i => i.status === "queued" || i.status === "ready").length;

  return (
    <div className="min-h-screen pb-24 animate-fade-in">
      <div className="sticky top-0 z-40 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-muted-foreground"><ChevronLeft className="w-5 h-5" /></button>
          <div className="flex-1"><h2 className="text-lg font-semibold font-display">📥 Email Inbox</h2></div>
          {queuedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary text-primary-foreground">{queuedCount} unprocessed</span>
          )}
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* Gmail connection card */}
        <div className="bg-card rounded-lg border border-border p-4">
          {loadingConn ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking Gmail connection…
            </div>
          ) : connection ? (
            <div>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-success/15 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-success" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">Connected: {connection.email_address}</p>
                  <p className="text-xs text-muted-foreground">
                    {connection.last_checked_at
                      ? `Last scanned ${relTime(new Date(connection.last_checked_at))}`
                      : "Not scanned yet"}
                  </p>
                  {(() => {
                    if (!connection.last_checked_at) return null;
                    const ageMin = (Date.now() - new Date(connection.last_checked_at).getTime()) / 60000;
                    const healthy = ageMin < 10;
                    return (
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="relative flex h-2 w-2">
                          {healthy && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />}
                          <span className={`relative inline-flex rounded-full h-2 w-2 ${healthy ? "bg-success" : "bg-muted-foreground"}`} />
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {healthy ? "Auto-scan active · every 5 min" : `Auto-scan idle (${Math.round(ageMin)}m since last run)`}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="teal" className="flex-1 h-9" onClick={handleScanNow} disabled={scanning}>
                  {scanning
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scanning…</>
                    : <><RefreshCw className="w-4 h-4 mr-2" /> Scan now</>}
                </Button>
                <Button size="sm" variant="outline" className="h-9" onClick={handleDisconnect}>
                  <LogOut className="w-4 h-4 mr-1" /> Disconnect
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Scans the last 30 days for emails with PDF / XLSX / CSV / image attachments matching invoice, PO, packing slip, receipt, statement or bill.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold mb-1">Connect Gmail to auto-pull invoices</p>
                  <p className="text-xs text-muted-foreground">
                    Read-only access. Sonic Invoices scans your inbox for supplier invoices and queues them here.
                  </p>
                </div>
              </div>
              {isInAppBrowser && (
                <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                  <strong>Open in Safari or Chrome.</strong> Google blocks sign-in inside Messenger, Instagram, TikTok and other in-app browsers. Tap the <span className="font-mono">•••</span> menu → "Open in browser".
                </div>
              )}
              <Button variant="teal" className="w-full h-10 mt-3" onClick={handleConnectGmail} disabled={connecting}>
                {connecting
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening Google…</>
                  : <><Mail className="w-4 h-4 mr-2" /> Connect Gmail</>}
              </Button>
            </div>
          )}
        </div>

        {/* Inbox queue */}
        <div>
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">Inbox queue</h3>
            <div className="flex items-center gap-2">
              {(() => {
                const highQueued = items.filter(i => (i.confidence ?? computeConfidence(i)) === "high" && i.status !== "done" && i.status !== "processing").length;
                if (bulkProgress) {
                  return (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Processing {bulkProgress.current} of {bulkProgress.total} High-confidence invoices…
                    </span>
                  );
                }
                if (highQueued > 0) {
                  return (
                    <Button size="sm" variant="teal" className="h-7 text-xs" onClick={handleProcessAllKnown} title="Auto-processes High confidence only. Medium and Low stay for manual review.">
                      Process all High ({highQueued})
                    </Button>
                  );
                }
                return null;
              })()}
              <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none" title="Auto-process newly arrived High-confidence invoices">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary cursor-pointer"
                  checked={smartBulk}
                  onChange={(e) => setSmartBulk(e.target.checked)}
                />
                Auto-process new
              </label>
            </div>
          </div>
          {smartBulk && (
            <div className="mb-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
              Auto-processing High-confidence invoices. Medium and Low items need manual review.
            </div>
          )}
          {items.length > 0 && (
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <div className="flex items-center gap-1">
                {(["all", "known", "unknown", "processed"] as const).map(f => {
                  const active = filter === f;
                  const label = f.charAt(0).toUpperCase() + f.slice(1);
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search sender, subject, supplier…"
                className="flex-1 min-w-[160px] h-7 px-2.5 text-xs rounded-md bg-muted border border-border placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
          {items.length === 0 ? (
            <div className="bg-card rounded-lg border border-border p-8 text-center">
              <div className="w-14 h-14 rounded-full bg-muted mx-auto flex items-center justify-center mb-3">
                <Mail className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No invoices yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                {connection ? "Hit Scan now to check your inbox." : "Connect Gmail or use the simulator below to preview the flow."}
              </p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="bg-card rounded-lg border border-border p-6 text-center">
              <p className="text-xs text-muted-foreground">No invoices match this filter.</p>
            </div>
          ) : (
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <div className="divide-y divide-border">
                {filteredItems.map(item => (
                  <div key={item.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-medium truncate">{item.from}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0">{item.received}</span>
                          {item.source === "gmail" && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-success/15 text-success border border-success/20 shrink-0">GMAIL</span>
                          )}
                          {item.source === "sim" && demo && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-warning/15 text-warning border border-warning/20 shrink-0">DEMO</span>
                          )}
                          {item.knownSupplier && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-primary/15 text-primary border border-primary/20 shrink-0">KNOWN</span>
                          )}
                          {confidenceBadge(item.confidence ?? computeConfidence(item))}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{item.subject}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border border-border">
                            {attachmentIcon(item.attachmentType)}
                            <Paperclip className="w-2.5 h-2.5" />
                            {item.attachmentName}
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
                          item.imported ? (
                            <span className="text-[10px] text-success font-medium">✓ Imported to Shopify</span>
                          ) : item.parseJobId ? (
                            <Button
                              size="sm"
                              variant="teal"
                              className="h-7 text-xs"
                              disabled={item.importing}
                              onClick={() => handleImportToShopify(item)}
                              title="Push parsed variants to your Shopify store"
                            >
                              {item.importing
                                ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Importing…</>
                                : <>Import to Shopify{item.parsedVariantCount ? ` (${item.parsedVariantCount})` : ""}</>}
                            </Button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">✓ Done</span>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Simulator (still useful for demos / testing flow without Gmail) */}
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <button onClick={() => setShowSimulator(!showSimulator)} className="w-full flex items-center justify-between px-4 py-3 text-left">
            <span className="text-xs font-medium flex items-center gap-2">
              <Mail className="w-3.5 h-3.5 text-muted-foreground" />
              Preview the flow — simulate an incoming email
            </span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showSimulator ? "rotate-180" : ""}`} />
          </button>
          {showSimulator && (
            <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
              <p className="text-[11px] text-muted-foreground">For previewing only — no real email is sent.</p>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">From</label>
                <input value={simFrom} onChange={e => setSimFrom(e.target.value)} placeholder="orders@jantzen.com.au" className="w-full h-9 rounded-md bg-input border border-border px-3 text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Subject</label>
                <input value={simSubject} onChange={e => setSimSubject(e.target.value)} placeholder="Invoice JAN-2847" className="w-full h-9 rounded-md bg-input border border-border px-3 text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">Attachment</label>
                <label className="flex-1 h-9 rounded-md bg-input border border-border px-3 text-sm flex items-center gap-2 cursor-pointer text-muted-foreground">
                  <Upload className="w-3.5 h-3.5" />
                  {simFile || "Choose file..."}
                  <input type="file" accept=".pdf,.xlsx,.csv,.jpg,.jpeg,.png" className="hidden" onChange={e => setSimFile(e.target.files?.[0]?.name || null)} />
                </label>
              </div>
              <Button variant="teal" className="w-full h-10" onClick={handleSimulateSend} disabled={!simFrom.trim()}>
                <Mail className="w-4 h-4 mr-2" /> Add to preview queue
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmailInboxPanel;
