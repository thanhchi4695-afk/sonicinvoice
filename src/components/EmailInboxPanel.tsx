import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, Copy, Check, Upload, Mail, Paperclip, ChevronDown, Loader2, FileText, Image, RefreshCw, LogOut, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addAuditEntry } from "@/lib/audit-log";
import { getInvoiceParserModel } from "@/lib/invoice-parser-model";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface EmailInboxPanelProps {
  onBack: () => void;
  onProcessInvoice?: (supplierName: string) => void;
}

type Provider = "gmail" | "outlook" | "imap";

interface InboxItem {
  id: string;
  source: "gmail" | "outlook" | "imap" | "sim";
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

interface ProviderConnection {
  id: string;
  provider: Provider;
  email_address: string;
  last_checked_at: string | null;
  is_active: boolean;
}

const providerLabel = (p: Provider) =>
  p === "gmail" ? "Gmail" : p === "outlook" ? "Outlook" : "Yahoo / IMAP";

const providerBadgeCls = (p: Provider | "sim") =>
  p === "gmail" ? "bg-success/15 text-success border-success/20"
  : p === "outlook" ? "bg-primary/15 text-primary border-primary/20"
  : p === "imap" ? "bg-purple-500/15 text-purple-300 border-purple-500/20"
  : "bg-warning/15 text-warning border-warning/20";

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
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [loadingConn, setLoadingConn] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<Provider | null>(null);
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
  const [showYahooModal, setShowYahooModal] = useState(false);
  const [yahooEmail, setYahooEmail] = useState("");
  const [yahooPassword, setYahooPassword] = useState("");
  const [yahooProvider, setYahooProvider] = useState<"gmail" | "yahoo" | "icloud" | "outlook" | "ventraip" | "fastmail" | "custom">("gmail");
  const [yahooHost, setYahooHost] = useState("");
  const [yahooPort, setYahooPort] = useState("993");
  const [yahooSubmitting, setYahooSubmitting] = useState(false);

  useEffect(() => {
    try { localStorage.setItem("sonic_smart_bulk_enabled", smartBulk ? "1" : "0"); } catch {}
  }, [smartBulk]);
  const demo = isDemoMode();
  const connection = connections[0] ?? null; // back-compat for legacy refs

  const loadConnection = useCallback(async () => {
    setLoadingConn(true);
    const [g, o, i] = await Promise.all([
      supabase.from("gmail_connections").select("id, email_address, last_checked_at, is_active").eq("is_active", true).order("created_at", { ascending: true }),
      supabase.from("outlook_connections").select("id, email_address, last_checked_at, is_active").eq("is_active", true).order("created_at", { ascending: true }),
      supabase.from("imap_connections").select("id, email_address, last_checked_at, is_active").eq("is_active", true).order("created_at", { ascending: true }),
    ]);
    const all: ProviderConnection[] = [
      ...((g.data as any[]) ?? []).map(r => ({ ...r, provider: "gmail" as Provider })),
      ...((o.data as any[]) ?? []).map(r => ({ ...r, provider: "outlook" as Provider })),
      ...((i.data as any[]) ?? []).map(r => ({ ...r, provider: "imap" as Provider })),
    ];
    setConnections(all);
    setLoadingConn(false);
  }, []);

  const loadFoundInvoices = useCallback(async () => {
    const { data, error } = await supabase
      .from("gmail_found_invoices")
      .select("id, message_id, from_email, subject, received_at, supplier_name, known_supplier, attachments, processed, provider")
      .order("received_at", { ascending: false })
      .limit(1000);
    if (error) return;
    const items: InboxItem[] = [];
    for (const row of data ?? []) {
      const atts = (row.attachments as any[]) ?? [];
      const first = atts[0];
      if (!first) continue;
      const recDate = row.received_at ? new Date(row.received_at) : new Date();
      const provider = ((row as any).provider ?? "gmail") as Provider;
      items.push({
        id: row.id,
        source: provider,
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

  // On mount + handle ?gmail/?outlook=connected redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const key of ["gmail", "outlook"]) {
      const v = params.get(key);
      const labelMap: Record<string, string> = { gmail: "Gmail", outlook: "Outlook" };
      if (v === "connected") {
        toast({ title: `${labelMap[key]} connected`, description: params.get("email") ?? "" });
        addAuditEntry("Email", `Connected ${labelMap[key]}: ${params.get("email") ?? ""}`);
        params.delete(key); params.delete("email");
      } else if (v === "error") {
        toast({ title: `${labelMap[key]} connection failed`, description: params.get("reason") ?? "", variant: "destructive" });
        params.delete(key); params.delete("reason");
      }
    }
    const url = window.location.pathname + (params.toString() ? `?${params}` : "");
    window.history.replaceState({}, "", url);
    loadConnection();
    loadFoundInvoices();
  }, [loadConnection, loadFoundInvoices, toast]);

  const isInAppBrowser = (() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    return /FBAN|FBAV|FB_IAB|Messenger|Instagram|Line\/|MicroMessenger|WeChat|TikTok|Snapchat|Twitter|LinkedInApp|GSA\//i.test(ua);
  })();

  const startOAuth = async (provider: "gmail" | "outlook") => {
    setConnecting(provider);
    try {
      const fn = provider === "gmail" ? "gmail-oauth-start" : "outlook-oauth-start";
      const { data, error } = await supabase.functions.invoke(fn, {
        body: { origin: window.location.origin },
      });
      if (error) throw error;
      const url = (data as any)?.url;
      if (!url) throw new Error("No OAuth URL returned");

      if (isInAppBrowser) {
        try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
        toast({
          title: "Open in Safari or Chrome",
          description: `${providerLabel(provider)} sign-in is blocked inside in-app browsers. The link is copied — paste it into your browser.`,
        });
        const isAndroid = /Android/i.test(navigator.userAgent);
        if (isAndroid) {
          window.location.href = `intent://${url.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`;
        } else {
          window.open(url, "_blank");
        }
        setConnecting(null);
        return;
      }
      window.location.href = url;
    } catch (err: any) {
      toast({ title: `Couldn't start ${providerLabel(provider)} connect`, description: err?.message ?? String(err), variant: "destructive" });
      setConnecting(null);
    }
  };

  const PROVIDER_PRESETS: Record<string, { host: string; port: number } | null> = {
    gmail: { host: "imap.gmail.com", port: 993 },
    yahoo: { host: "imap.mail.yahoo.com", port: 993 },
    icloud: { host: "imap.mail.me.com", port: 993 },
    outlook: { host: "outlook.office365.com", port: 993 },
    ventraip: { host: "ventraip.email", port: 993 },
    fastmail: { host: "imap.fastmail.com", port: 993 },
    custom: null,
  };

  const handleConnectYahoo = async () => {
    if (!yahooEmail.trim() || !yahooPassword.trim()) return;
    const preset = PROVIDER_PRESETS[yahooProvider];
    const host = (yahooHost.trim() || preset?.host || "").trim();
    const port = Number(yahooPort) || preset?.port || 993;
    if (!host) {
      toast({ title: "IMAP host required", description: "Enter your provider's incoming mail server.", variant: "destructive" });
      return;
    }
    setYahooSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("imap-connect", {
        body: {
          email: yahooEmail.trim(),
          app_password: yahooPassword.trim(),
          provider: yahooProvider === "gmail" || yahooProvider === "ventraip" || yahooProvider === "fastmail" || yahooProvider === "custom" ? "custom" : yahooProvider,
          imap_host: host,
          imap_port: port,
          imap_tls: true,
        },
      });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error ?? "IMAP login failed");
      toast({ title: `${providerLabel("imap")} connected`, description: yahooEmail.trim() });
      addAuditEntry("Email", `Connected IMAP (${yahooProvider}): ${yahooEmail.trim()}`);
      setShowYahooModal(false);
      setYahooEmail(""); setYahooPassword(""); setYahooHost(""); setYahooPort("993");
      await loadConnection();
    } catch (err: any) {
      toast({ title: "Couldn't connect", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setYahooSubmitting(false);
    }
  };

  const handleDisconnect = async (target?: ProviderConnection) => {
    const all = !target;
    const label = all
      ? "Disconnect ALL email accounts? Inbox history will be cleared. You can reconnect any time."
      : `Disconnect ${target!.email_address}? Other connected accounts stay connected.`;
    if (!confirm(label)) return;

    const tableFor = (p: Provider) =>
      p === "gmail" ? "gmail_connections" : p === "outlook" ? "outlook_connections" : "imap_connections";

    if (target) {
      const { error: delConnErr } = await supabase.from(tableFor(target.provider)).delete().eq("id", target.id);
      if (delConnErr) {
        toast({ title: "Failed", description: delConnErr.message, variant: "destructive" });
        return;
      }
    } else {
      await Promise.all([
        supabase.from("gmail_connections").delete().eq("is_active", true),
        supabase.from("outlook_connections").delete().eq("is_active", true),
        supabase.from("imap_connections").delete().eq("is_active", true),
      ]);
      const { error: delInvErr } = await supabase
        .from("gmail_found_invoices")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      if (delInvErr) console.warn("[email] failed to clear found invoices", delInvErr);
      setGmailItems([]);
      setAutoProcessedIds(new Set());
    }
    addAuditEntry("Email", all
      ? "Disconnected all email accounts and cleared inbox queue"
      : `Disconnected ${providerLabel(target!.provider)}: ${target!.email_address}`);
    await loadConnection();
    toast({ title: "Disconnected", description: all ? "Inbox queue cleared." : target!.email_address });
  };

  const handleScanNow = async () => {
    setScanning(true);
    try {
      // Run all three scans in parallel; report aggregate.
      const providers = Array.from(new Set(connections.map(c => c.provider)));
      const results = await Promise.all(
        providers.map(async (p) => {
          const fn = p === "gmail" ? "scan-gmail-inbox" : p === "outlook" ? "scan-outlook-inbox" : "scan-imap-inbox";
          try {
            const { data, error } = await supabase.functions.invoke(fn, { body: {} });
            if (error) throw error;
            return { provider: p, data };
          } catch (e: any) {
            return { provider: p, error: e?.message ?? String(e) };
          }
        }),
      );
      let totalScanned = 0, totalFound = 0;
      const reauthProviders: Provider[] = [];
      for (const r of results) {
        const data: any = (r as any).data;
        if (data?.error) {
          const msg = String(data.error);
          if (/reauth|authoris|invalid_grant/i.test(msg)) reauthProviders.push((r as any).provider);
          continue;
        }
        totalScanned += data?.emails_scanned ?? 0;
        totalFound += data?.invoices_found?.length ?? 0;
      }
      if (reauthProviders.length) {
        toast({
          title: `Reconnect ${reauthProviders.map(p => providerLabel(p)).join(", ")}`,
          description: "Authorisation expired. Please connect again.",
          variant: "destructive",
        });
        await loadConnection();
      }
      addAuditEntry("Email", `Scanned all inboxes — ${totalScanned} email(s), ${totalFound} with invoice attachments`);
      toast({
        title: "Scan complete",
        description: `Scanned ${totalScanned} email${totalScanned === 1 ? "" : "s"}, ${totalFound} with invoice attachment${totalFound === 1 ? "" : "s"}`,
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
    const isEmail = item.source === "gmail" || item.source === "outlook" || item.source === "imap";
    if (isEmail && !item.knownSupplier && item.fromEmail) {
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

    if (isEmail) {
      setGmailItems(prev => prev.map(i => i.id === item.id ? { ...i, status: "processing" } : i));
      addAuditEntry("Email", `Started processing email invoice from ${item.from}: ${item.subject}`);

      try {
        if (!item.messageId || !item.attachmentId) {
          throw new Error("Missing attachment reference");
        }

        const fetchFn = item.source === "outlook" ? "outlook-fetch-attachment"
          : item.source === "imap" ? "imap-fetch-attachment"
          : "gmail-fetch-attachment";
        const { data: attData, error: attErr } = await supabase.functions.invoke(
          fetchFn,
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
              claudeModel: getInvoiceParserModel(),
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
        {/* Email connection card */}
        <div className="bg-card rounded-lg border border-border p-4">
          {loadingConn ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking connections…
            </div>
          ) : connections.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  Connected inboxes ({connections.length})
                </p>
                <Button size="sm" variant="teal" className="h-8" onClick={handleScanNow} disabled={scanning}>
                  {scanning
                    ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Scanning…</>
                    : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Scan all</>}
                </Button>
              </div>
              <ul className="divide-y divide-border rounded-md border border-border">
                {connections.map(c => {
                  const ageMin = c.last_checked_at
                    ? (Date.now() - new Date(c.last_checked_at).getTime()) / 60000
                    : null;
                  const healthy = ageMin !== null && ageMin < 10;
                  return (
                    <li key={`${c.provider}:${c.id}`} className="flex items-center gap-3 px-3 py-2">
                      <div className="w-8 h-8 rounded-full bg-success/15 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-4 h-4 text-success" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium truncate">{c.email_address}</p>
                          <span className={`text-[9px] px-1 py-0.5 rounded border shrink-0 ${providerBadgeCls(c.provider)}`}>
                            {providerLabel(c.provider).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="relative flex h-2 w-2">
                            {healthy && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />}
                            <span className={`relative inline-flex rounded-full h-2 w-2 ${healthy ? "bg-success" : "bg-muted-foreground"}`} />
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {c.last_checked_at
                              ? (healthy ? "Auto-scan active · every 5 min" : `Idle ${Math.round(ageMin!)}m`)
                              : "Not scanned yet"}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs shrink-0"
                        onClick={() => handleDisconnect(c)}
                      >
                        <LogOut className="w-3 h-3 mr-1" /> Remove
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Button size="sm" variant="outline" className="h-9" onClick={() => startOAuth("gmail")} disabled={connecting === "gmail"}>
                  {connecting === "gmail"
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening…</>
                    : <><Mail className="w-4 h-4 mr-2" /> Add Gmail</>}
                </Button>
                <Button size="sm" variant="outline" className="h-9" onClick={() => startOAuth("outlook")} disabled={connecting === "outlook"}>
                  {connecting === "outlook"
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening…</>
                    : <><Mail className="w-4 h-4 mr-2" /> Add Outlook</>}
                </Button>
                <Button size="sm" variant="outline" className="h-9" onClick={() => setShowYahooModal(true)}>
                  <Mail className="w-4 h-4 mr-2" /> Add Yahoo / IMAP
                </Button>
              </div>
              <div className="flex justify-end">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleDisconnect()}>
                  Remove all
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Scans the last 180 days of each inbox (up to 250 messages per account per scan) for invoice / PO / packing slip / receipt / statement / bill attachments.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold mb-1">Connect your email to auto-pull invoices</p>
                  <p className="text-xs text-muted-foreground">
                    Read-only access. Sonic Invoices scans your inbox for supplier invoices and queues them here. You can connect Gmail, Outlook, or Yahoo (and other IMAP providers).
                  </p>
                </div>
              </div>
              {isInAppBrowser && (
                <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                  <strong>Open in Safari or Chrome.</strong> Gmail and Outlook block sign-in inside Messenger, Instagram, TikTok and other in-app browsers. Tap the <span className="font-mono">•••</span> menu → "Open in browser".
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                <Button variant="teal" className="h-10" onClick={() => startOAuth("gmail")} disabled={connecting === "gmail"}>
                  {connecting === "gmail"
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening…</>
                    : <><Mail className="w-4 h-4 mr-2" /> Connect Gmail</>}
                </Button>
                <Button variant="teal" className="h-10" onClick={() => startOAuth("outlook")} disabled={connecting === "outlook"}>
                  {connecting === "outlook"
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening…</>
                    : <><Mail className="w-4 h-4 mr-2" /> Connect Outlook</>}
                </Button>
                <Button variant="teal" className="h-10" onClick={() => setShowYahooModal(true)}>
                  <Mail className="w-4 h-4 mr-2" /> Connect Yahoo / IMAP
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Yahoo / IMAP modal */}
        {showYahooModal && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !yahooSubmitting && setShowYahooModal(false)}>
            <div className="bg-card rounded-lg border border-border p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold">Connect via app password</h3>
                <button onClick={() => setShowYahooModal(false)} disabled={yahooSubmitting} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Provider</label>
                  <select
                    value={yahooProvider}
                    onChange={e => {
                      const v = e.target.value as any;
                      setYahooProvider(v);
                      const preset = PROVIDER_PRESETS[v];
                      setYahooHost(preset?.host ?? "");
                      setYahooPort(String(preset?.port ?? 993));
                    }}
                    className="w-full h-9 rounded-md bg-input border border-border px-2 text-sm"
                  >
                    <option value="gmail">Gmail / Google Workspace</option>
                    <option value="yahoo">Yahoo Mail (Ymail)</option>
                    <option value="icloud">iCloud Mail</option>
                    <option value="outlook">Outlook (IMAP fallback)</option>
                    <option value="ventraip">VentraIP / Splash</option>
                    <option value="fastmail">Fastmail</option>
                    <option value="custom">Custom IMAP server</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Email</label>
                  <input
                    type="email"
                    value={yahooEmail}
                    onChange={e => setYahooEmail(e.target.value)}
                    placeholder="you@yourdomain.com"
                    className="w-full h-9 rounded-md bg-input border border-border px-3 text-sm"
                  />
                </div>
                <div className="grid grid-cols-[1fr,90px] gap-2">
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">IMAP host</label>
                    <input
                      type="text"
                      value={yahooHost}
                      onChange={e => setYahooHost(e.target.value)}
                      placeholder={PROVIDER_PRESETS[yahooProvider]?.host ?? "mail.example.com"}
                      className="w-full h-9 rounded-md bg-input border border-border px-3 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">Port</label>
                    <input
                      type="number"
                      value={yahooPort}
                      onChange={e => setYahooPort(e.target.value)}
                      placeholder="993"
                      className="w-full h-9 rounded-md bg-input border border-border px-3 text-sm font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">
                    {yahooProvider === "yahoo" || yahooProvider === "icloud" ? "App password (16 chars)" : "Mailbox password"}
                  </label>
                  <input
                    type="password"
                    value={yahooPassword}
                    onChange={e => setYahooPassword(e.target.value)}
                    placeholder={yahooProvider === "yahoo" || yahooProvider === "icloud" ? "xxxx xxxx xxxx xxxx" : "your mailbox password"}
                    className="w-full h-9 rounded-md bg-input border border-border px-3 text-sm font-mono"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {yahooProvider === "yahoo" && <>Yahoo: <a href="https://login.yahoo.com/account/security" target="_blank" rel="noopener noreferrer" className="underline">login.yahoo.com/account/security</a> → "Generate app password". </>}
                    {yahooProvider === "icloud" && <>iCloud: <a href="https://appleid.apple.com" target="_blank" rel="noopener noreferrer" className="underline">appleid.apple.com</a> → Sign-In Security → App-Specific Passwords. </>}
                    {yahooProvider === "ventraip" && <>VentraIP Splash: use your normal mailbox password. Confirm host in VIPControl → Email Hosting → Manage. </>}
                    {yahooProvider === "fastmail" && <>Fastmail: Settings → Privacy & Security → App passwords. </>}
                    {yahooProvider === "outlook" && <>Outlook IMAP requires an app password from your Microsoft account security page. </>}
                    {yahooProvider === "custom" && <>Use the IMAP host & password from your email provider's control panel. </>}
                    The password is encrypted at rest.
                  </p>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1 h-9" onClick={() => setShowYahooModal(false)} disabled={yahooSubmitting}>
                    Cancel
                  </Button>
                  <Button variant="teal" className="flex-1 h-9" onClick={handleConnectYahoo} disabled={yahooSubmitting || !yahooEmail.trim() || !yahooPassword.trim()}>
                    {yahooSubmitting
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Testing…</>
                      : <>Connect</>}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}


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
                          {(item.source === "gmail" || item.source === "outlook" || item.source === "imap") && (
                            <span className={`text-[9px] px-1 py-0.5 rounded border shrink-0 ${providerBadgeCls(item.source)}`}>
                              {providerLabel(item.source).toUpperCase()}
                            </span>
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
