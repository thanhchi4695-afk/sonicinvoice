// GmailMonitoringPanel — Phase 2 of the Watchdog Agent.
//
// Shows the Gmail connection state and the list of supplier invoice emails
// the inbox scanner has discovered. The user manually triggers the watchdog
// from each row (Phase 3 will auto-trigger).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Mail,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Zap,
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface GmailConnection {
  id: string;
  email_address: string;
  last_checked_at: string | null;
  is_active: boolean;
}

interface AttachmentMeta {
  filename: string;
  mime_type: string;
  attachment_id: string;
  size_bytes: number;
}

interface FoundInvoice {
  id: string;
  message_id: string;
  from_email: string | null;
  subject: string | null;
  received_at: string | null;
  supplier_name: string | null;
  known_supplier: boolean;
  attachments: AttachmentMeta[];
  processed: boolean;
  agent_run_id: string | null;
}

interface Props {
  /** Called when a watchdog run completes so the parent can refresh history. */
  onRunComplete?: () => void;
}

export default function GmailMonitoringPanel({ onRunComplete }: Props) {
  const [conn, setConn] = useState<GmailConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [invoices, setInvoices] = useState<FoundInvoice[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const [{ data: c }, { data: list }] = await Promise.all([
      supabase
        .from("gmail_connections")
        .select("id, email_address, last_checked_at, is_active")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("gmail_found_invoices")
        .select(
          "id, message_id, from_email, subject, received_at, supplier_name, known_supplier, attachments, processed, agent_run_id",
        )
        .eq("user_id", user.id)
        .order("received_at", { ascending: false })
        .limit(20),
    ]);
    setConn((c as GmailConnection | null) ?? null);
    setInvoices(((list ?? []) as unknown) as FoundInvoice[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Detect ?gmail=connected once on mount and toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("gmail");
    if (!status) return;
    const email = params.get("email") ?? "";
    if (status === "connected") {
      toast.success(`Gmail connected${email ? ` — ${email} is now monitored` : ""}`);
    } else if (status === "error") {
      toast.error(
        `Gmail connection failed${
          params.get("reason") ? ` (${params.get("reason")})` : ""
        }`,
      );
    }
    // Strip the params so reloads don't re-toast
    params.delete("gmail");
    params.delete("email");
    params.delete("reason");
    const next = `${window.location.pathname}${
      params.toString() ? `?${params.toString()}` : ""
    }${window.location.hash}`;
    window.history.replaceState({}, "", next);
  }, []);

  // Realtime: refresh the list when the cron scan inserts new rows.
  useEffect(() => {
    const channel = supabase
      .channel("gmail_found_invoices_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gmail_found_invoices" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);



  async function startConnect() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Sign in first");
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("gmail-oauth-start", {
        body: {},
      });
      if (error) throw new Error(error.message);
      const url = (data as { url?: string })?.url;
      if (!url) throw new Error("No auth URL returned");
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function disconnect() {
    if (!conn) return;
    if (!confirm("Disconnect Gmail? Sonic will stop monitoring this inbox.")) return;
    const { error } = await supabase
      .from("gmail_connections")
      .delete()
      .eq("id", conn.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setConn(null);
    setInvoices([]);
    toast.success("Gmail disconnected");
  }

  async function scanNow() {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("scan-gmail-inbox", {
        body: {},
      });
      if (error) throw new Error(error.message);
      const found = (data as { invoices_found?: unknown[] })?.invoices_found ?? [];
      toast.success(
        `Scan complete — ${found.length} invoice email${found.length === 1 ? "" : "s"} found`,
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }

  async function processWithWatchdog(invoice: FoundInvoice, attachment: AttachmentMeta) {
    setProcessingId(invoice.id);
    try {
      // 1. Pull bytes from Gmail through the edge function
      const { data: fetched, error: fetchErr } = await supabase.functions.invoke(
        "gmail-fetch-attachment",
        {
          body: { message_id: invoice.message_id, attachment_id: attachment.attachment_id },
        },
      );
      if (fetchErr) throw new Error(fetchErr.message);
      const base64 = (fetched as { data_base64?: string })?.data_base64;
      if (!base64) throw new Error("Empty attachment");

      // 2. Run the watchdog
      const { data: runData, error: runErr } = await supabase.functions.invoke(
        "agent-watchdog",
        {
          body: {
            trigger_type: "email",
            file_base64: base64,
            file_name: attachment.filename,
            mime_type: attachment.mime_type,
            supplier_name: invoice.supplier_name ?? undefined,
          },
        },
      );
      if (runErr) throw new Error(runErr.message);
      if (!runData?.success) throw new Error(runData?.error || "Watchdog failed");

      // 3. Mark the email as processed and link the run
      await supabase
        .from("gmail_found_invoices")
        .update({ processed: true, agent_run_id: runData.run_id })
        .eq("id", invoice.id);

      toast.success(
        `Watchdog complete — ${runData.products_extracted ?? 0} products extracted`,
      );
      await load();
      onRunComplete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessingId(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading email monitoring…
      </div>
    );
  }

  // Disconnected state
  if (!conn) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2 text-primary">
            <Mail className="w-5 h-5" />
          </div>
          <div className="flex-1 space-y-2">
            <p className="text-sm font-semibold">Connect your Gmail inbox</p>
            <p className="text-xs text-muted-foreground">
              Sonic Invoice will watch for supplier invoices and extract products
              automatically.
            </p>
            <div className="pt-1">
              <Button size="sm" variant="teal" onClick={() => void startConnect()}>
                <Mail className="w-3 h-3 mr-1" /> Connect Gmail
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Read-only access. We never send email or modify your inbox.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Connected state
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-block w-2 h-2 rounded-full bg-success" />
            <span className="font-medium">Gmail connected</span>
            <span className="text-muted-foreground">— {conn.email_address}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="teal"
              onClick={() => void scanNow()}
              disabled={scanning}
            >
              {scanning ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3 mr-1" />
              )}
              Check for invoices now
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => void disconnect()}
            >
              Disconnect
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Last checked:{" "}
          {conn.last_checked_at
            ? new Date(conn.last_checked_at).toLocaleString()
            : "Never"}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="px-4 py-2 border-b border-border flex items-center justify-between">
          <p className="text-sm font-medium">Invoices found in Gmail</p>
          <Badge variant="secondary" className="font-mono-data">
            {invoices.length}
          </Badge>
        </div>
        {invoices.length === 0 ? (
          <div className="p-6 text-center space-y-2">
            <Inbox className="w-6 h-6 mx-auto text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              No invoice emails found in the last 7 days. Make sure your suppliers
              send invoices to {conn.email_address}.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {invoices.map((inv) => (
              <div key={inv.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {inv.subject || "(no subject)"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {inv.from_email ?? "Unknown sender"} ·{" "}
                      {inv.received_at
                        ? new Date(inv.received_at).toLocaleString()
                        : "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {inv.known_supplier ? (
                      <Badge className="bg-success text-success-foreground">
                        {inv.supplier_name}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Unknown supplier</Badge>
                    )}
                    {inv.processed && (
                      <Badge variant="outline" className="gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Processed
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  {inv.attachments.map((a) => (
                    <div
                      key={a.attachment_id}
                      className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{a.filename}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatBytes(a.size_bytes)} · {a.mime_type}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="teal"
                        disabled={processingId === inv.id}
                        onClick={() => void processWithWatchdog(inv, a)}
                      >
                        {processingId === inv.id ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Zap className="w-3 h-3 mr-1" />
                        )}
                        Process with Watchdog
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
