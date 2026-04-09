import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Check, X, Loader2, ExternalLink, Sparkles,
  AlertTriangle, Edit2, ChevronDown, ChevronRight, DollarSign,
  FileText, RotateCcw, Save,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  classifyInvoice, classifyInvoiceLines, isFreightLine,
  recordSuccessfulPush, recordCorrection, getAllAccountCodes,
  type InvoiceCategorisation,
} from "@/lib/invoice-category-ai";
import type { UnifiedBill, UnifiedBillLine } from "@/lib/unified-types";
import { invoiceToUnifiedBill, type RawInvoiceData } from "@/lib/unified-mappers";

// ── Types ──

interface BillReviewLine {
  description: string;
  quantity: number;
  unitPrice: number;
  totalExGst: number;
  gstAmount: number;
  accountCode: string;
  accountName: string;
  isFreight: boolean;
  aiConfidence: number;
  aiMethod: string;
}

interface BillReviewData {
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  subtotalExGst: number;
  gstAmount: number;
  totalIncGst: number;
  lines: BillReviewLine[];
  headerAccountCode: string;
  headerAccountName: string;
  headerConfidence: number;
  headerMethod: string;
  headerExplanation: string;
  alternatives: { code: string; name: string; category: string; score: number }[];
}

export interface AccountingBillReviewProps {
  invoice: {
    id?: string;
    supplier: string;
    invoice_number?: string;
    invoice_date?: string;
    due_date?: string;
    subtotal?: number;
    gst?: number;
    total?: number;
    category?: string;
    line_items?: {
      description?: string;
      product_name?: string;
      quantity?: number;
      unit_price?: number;
      unit_price_inc_gst?: number;
      total_inc_gst?: number;
    }[];
  };
  onBack?: () => void;
  onPushComplete?: (result: { platform: string; externalUrl?: string }) => void;
}

const ALL_CODES = getAllAccountCodes();
const FREIGHT_CODE = "61700";

function buildReviewData(invoice: AccountingBillReviewProps["invoice"]): BillReviewData {
  const headerClassification = classifyInvoice(
    invoice.supplier,
    "",
    invoice.line_items?.map((li) => ({ description: li.description || li.product_name }))
  );

  const lines: BillReviewLine[] = (invoice.line_items || []).map((li) => {
    const desc = li.description || li.product_name || "";
    const freight = isFreightLine(desc);
    const unitPrice = li.unit_price || li.unit_price_inc_gst || 0;
    const totalIncGst = li.total_inc_gst || unitPrice * (li.quantity || 1);
    const gst = totalIncGst / 11;
    const totalExGst = totalIncGst - gst;

    return {
      description: desc,
      quantity: li.quantity || 1,
      unitPrice,
      totalExGst,
      gstAmount: gst,
      accountCode: freight ? FREIGHT_CODE : headerClassification.accountCode,
      accountName: freight
        ? "Freight & Cartage"
        : headerClassification.accountName,
      isFreight: freight,
      aiConfidence: freight ? 90 : headerClassification.confidence,
      aiMethod: freight ? "keyword" : headerClassification.method,
    };
  });

  // If no line items, create a single summary line
  if (lines.length === 0) {
    const total = invoice.total || 0;
    const gst = invoice.gst || total / 11;
    lines.push({
      description: `${invoice.supplier} — ${invoice.category || "Stock purchase"}`,
      quantity: 1,
      unitPrice: total,
      totalExGst: total - gst,
      gstAmount: gst,
      accountCode: headerClassification.accountCode,
      accountName: headerClassification.accountName,
      isFreight: false,
      aiConfidence: headerClassification.confidence,
      aiMethod: headerClassification.method,
    });
  }

  return {
    supplierName: invoice.supplier || "",
    invoiceNumber: invoice.invoice_number || "",
    invoiceDate: invoice.invoice_date || new Date().toISOString().split("T")[0],
    dueDate: invoice.due_date || "",
    subtotalExGst: invoice.subtotal || lines.reduce((s, l) => s + l.totalExGst, 0),
    gstAmount: invoice.gst || lines.reduce((s, l) => s + l.gstAmount, 0),
    totalIncGst: invoice.total || lines.reduce((s, l) => s + l.totalExGst + l.gstAmount, 0),
    lines,
    headerAccountCode: headerClassification.accountCode,
    headerAccountName: headerClassification.accountName,
    headerConfidence: headerClassification.confidence,
    headerMethod: headerClassification.method,
    headerExplanation: headerClassification.explanation,
    alternatives: headerClassification.alternatives,
  };
}

// ── Main Component ──

export default function AccountingBillReview({
  invoice,
  onBack,
  onPushComplete,
}: AccountingBillReviewProps) {
  const [bill, setBill] = useState<BillReviewData>(() => buildReviewData(invoice));
  const [connections, setConnections] = useState<any[]>([]);
  const [pushing, setPushing] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<{
    success: boolean; platform: string; url?: string; error?: string;
  } | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);
  const [showAllLines, setShowAllLines] = useState(bill.lines.length <= 8);

  useEffect(() => {
    supabase.from("accounting_connections").select("*").then(({ data }) => {
      setConnections((data as any[]) || []);
    });
  }, []);

  // ── Field editing ──

  const updateHeader = (field: keyof BillReviewData, value: string) => {
    setBill((prev) => ({ ...prev, [field]: value }));
  };

  const updateLine = (idx: number, field: keyof BillReviewLine, value: string | number | boolean) => {
    setBill((prev) => {
      const lines = [...prev.lines];
      lines[idx] = { ...lines[idx], [field]: value };
      // Recalculate totals
      const subtotalExGst = lines.reduce((s, l) => s + l.totalExGst, 0);
      const gstAmount = lines.reduce((s, l) => s + l.gstAmount, 0);
      return { ...prev, lines, subtotalExGst, gstAmount, totalIncGst: subtotalExGst + gstAmount };
    });
  };

  const setAllLinesToCode = (code: string) => {
    const codeDef = ALL_CODES.find((c) => c.code === code);
    setBill((prev) => ({
      ...prev,
      headerAccountCode: code,
      headerAccountName: codeDef?.name || "",
      lines: prev.lines.map((l) =>
        l.isFreight ? l : { ...l, accountCode: code, accountName: codeDef?.name || "" }
      ),
    }));
  };

  // ── Push to accounting ──

  const handlePush = async (platform: "xero" | "myob") => {
    const conn = connections.find((c) => c.platform === platform);
    if (!conn) {
      toast.error(`No ${platform} connection found. Go to Account Settings to connect.`);
      return;
    }

    setPushing(platform);
    setPushResult(null);

    try {
      // Find or create contact/supplier
      const contactAction = platform === "xero" ? "find_or_create_contact" : "find_or_create_supplier";
      const { data: contactData, error: contactError } = await supabase.functions.invoke(
        "accounting-proxy",
        { body: { action: contactAction, platform, supplier_name: bill.supplierName } }
      );
      if (contactError) throw contactError;

      const contactId = platform === "xero" ? contactData.contactId : contactData.uid;

      // Build invoice payload with per-line account codes
      const invoicePayload = {
        id: invoice.id || `inv-${Date.now()}`,
        supplier: bill.supplierName,
        invoice_number: bill.invoiceNumber,
        invoice_date: bill.invoiceDate,
        due_date: bill.dueDate,
        subtotal: bill.subtotalExGst,
        gst: bill.gstAmount,
        total: bill.totalIncGst,
        category: bill.headerAccountName,
        line_items: bill.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit_price_inc_gst: l.totalExGst + l.gstAmount,
          total_inc_gst: l.totalExGst + l.gstAmount,
          account_code: l.accountCode,
        })),
      };

      const pushBody: any = { action: "push_bill", platform, invoice: invoicePayload };
      if (platform === "xero") {
        pushBody.contact_id = contactId;
        pushBody.account_code = bill.headerAccountCode;
      } else {
        pushBody.supplier_uid = contactId;
        pushBody.account_uid = bill.headerAccountCode;
        pushBody.gst_uid = conn.account_mappings?.gst_uid || "";
      }

      const { data, error } = await supabase.functions.invoke("accounting-proxy", { body: pushBody });
      if (error) throw error;

      if (data?.success) {
        // Record success for AI learning
        const codeDef = ALL_CODES.find((c) => c.code === bill.headerAccountCode);
        recordSuccessfulPush(
          bill.supplierName,
          bill.headerAccountCode,
          codeDef?.name || "",
          codeDef?.category || "",
          "GST on Expenses"
        );

        // Record corrections if user changed the AI suggestion
        const original = buildReviewData(invoice);
        if (bill.headerAccountCode !== original.headerAccountCode) {
          const newDef = ALL_CODES.find((c) => c.code === bill.headerAccountCode);
          recordCorrection(
            bill.supplierName,
            original.headerAccountCode,
            bill.headerAccountCode,
            newDef?.name || "",
            newDef?.category || "",
            "GST on Expenses"
          );
        }

        setPushResult({ success: true, platform, url: data.external_url });
        toast.success(`Draft bill sent to ${platform === "xero" ? "Xero" : "MYOB"}`);
        onPushComplete?.({ platform, externalUrl: data.external_url });
      } else {
        throw new Error(data?.error || "Push failed");
      }
    } catch (err: any) {
      setPushResult({ success: false, platform, error: err.message });
      toast.error(err.message);
    } finally {
      setPushing(null);
    }
  };

  // ── Confidence badge helper ──
  const ConfDot = ({ confidence }: { confidence: number }) => (
    <span
      className={`inline-block w-2 h-2 rounded-full ${
        confidence >= 70 ? "bg-green-500" : confidence >= 40 ? "bg-yellow-500" : "bg-destructive"
      }`}
    />
  );

  const visibleLines = showAllLines ? bill.lines : bill.lines.slice(0, 5);
  const hasXero = connections.some((c) => c.platform === "xero");
  const hasMyob = connections.some((c) => c.platform === "myob");

  // ── Render: success state ──
  if (pushResult?.success) {
    return (
      <div className="space-y-4">
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        )}
        <div className="bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900 p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center mx-auto">
            <Check className="w-6 h-6 text-green-600" />
          </div>
          <h2 className="text-lg font-semibold">Bill sent to {pushResult.platform === "xero" ? "Xero" : "MYOB"}</h2>
          <p className="text-sm text-muted-foreground">
            Created as a <strong>DRAFT</strong> bill — your accountant can review before approving.
          </p>
          <div className="text-sm space-y-1">
            <p>Supplier: <strong>{bill.supplierName}</strong></p>
            <p>Total: <strong>${bill.totalIncGst.toFixed(2)}</strong> (inc GST ${bill.gstAmount.toFixed(2)})</p>
            <p>Category: <strong>{bill.headerAccountName}</strong></p>
          </div>
          {pushResult.url && (
            <a
              href={pushResult.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-primary hover:underline text-sm font-medium"
            >
              View in {pushResult.platform === "xero" ? "Xero" : "MYOB"} <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    );
  }

  // ── Render: review screen ──
  return (
    <div className="space-y-4">
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      )}

      {/* Header */}
      <div className="flex items-center gap-2">
        <FileText className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Review bill before pushing</h2>
      </div>

      {/* Bill header fields */}
      <div className="bg-card rounded-lg border border-border p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <EditableField
            label="Supplier"
            value={bill.supplierName}
            onChange={(v) => updateHeader("supplierName", v)}
          />
          <EditableField
            label="Invoice #"
            value={bill.invoiceNumber}
            onChange={(v) => updateHeader("invoiceNumber", v)}
            placeholder="Optional"
          />
          <EditableField
            label="Invoice date"
            value={bill.invoiceDate}
            onChange={(v) => updateHeader("invoiceDate", v)}
            type="date"
          />
          <EditableField
            label="Due date"
            value={bill.dueDate}
            onChange={(v) => updateHeader("dueDate", v)}
            type="date"
            placeholder="Optional"
          />
        </div>

        {/* Totals row */}
        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Subtotal ex GST</span>
            <p className="text-sm font-semibold">${bill.subtotalExGst.toFixed(2)}</p>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">GST</span>
            <p className="text-sm font-semibold">${bill.gstAmount.toFixed(2)}</p>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Total inc GST</span>
            <p className="text-sm font-bold text-primary">${bill.totalIncGst.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* AI classification header */}
      <div className="bg-card rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">AI category suggestion</span>
          <ConfDot confidence={bill.headerConfidence} />
          <span className="text-[10px] text-muted-foreground ml-1">
            {bill.headerConfidence}% — {bill.headerMethod}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{bill.headerExplanation}</p>

        <div className="flex items-center gap-2">
          <select
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={bill.headerAccountCode}
            onChange={(e) => setAllLinesToCode(e.target.value)}
          >
            {ALL_CODES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs shrink-0"
            onClick={() => {
              const original = buildReviewData(invoice);
              setAllLinesToCode(original.headerAccountCode);
              toast.info("Reset to AI suggestion");
            }}
          >
            <RotateCcw className="w-3 h-3 mr-1" /> Reset
          </Button>
        </div>

        {bill.alternatives.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] text-muted-foreground">Also possible:</span>
            {bill.alternatives.slice(0, 3).map((alt) => (
              <button
                key={alt.code}
                onClick={() => setAllLinesToCode(alt.code)}
                className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
              >
                {alt.code} — {alt.category}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Line items ({bill.lines.length})
          </h3>
          {bill.lines.some((l) => l.isFreight) && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
              Mixed invoice: product + freight detected
            </span>
          )}
        </div>

        <div className="divide-y divide-border/50">
          {visibleLines.map((line, idx) => (
            <LineItemRow
              key={idx}
              line={line}
              index={idx}
              expanded={expandedLine === idx}
              onToggle={() => setExpandedLine(expandedLine === idx ? null : idx)}
              onUpdate={(field, value) => updateLine(idx, field, value)}
            />
          ))}
        </div>

        {!showAllLines && bill.lines.length > 5 && (
          <button
            onClick={() => setShowAllLines(true)}
            className="w-full py-2 text-xs text-primary hover:bg-muted/50 transition-colors"
          >
            Show all {bill.lines.length} lines
          </button>
        )}
      </div>

      {/* Push buttons */}
      <div className="bg-card rounded-lg border border-border p-4 space-y-3">
        {connections.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">
              No accounting software connected.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Go to Account Settings → Accounting Integration to connect Xero or MYOB.
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Bill will be created as <strong>DRAFT</strong> — your accountant reviews before approving.
            </p>
            <div className="flex gap-3">
              {hasXero && (
                <Button
                  onClick={() => handlePush("xero")}
                  disabled={!!pushing}
                  className="flex-1"
                >
                  {pushing === "xero" ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <DollarSign className="w-4 h-4 mr-2" />
                  )}
                  Push to Xero
                </Button>
              )}
              {hasMyob && (
                <Button
                  onClick={() => handlePush("myob")}
                  disabled={!!pushing}
                  variant="outline"
                  className="flex-1"
                >
                  {pushing === "myob" ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <DollarSign className="w-4 h-4 mr-2" />
                  )}
                  Push to MYOB
                </Button>
              )}
            </div>
          </>
        )}
        {pushResult?.error && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{pushResult.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Line Item Row ──

function LineItemRow({
  line,
  index,
  expanded,
  onToggle,
  onUpdate,
}: {
  line: BillReviewLine;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (field: keyof BillReviewLine, value: string | number | boolean) => void;
}) {
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-2 cursor-pointer" onClick={onToggle}>
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        )}

        <span
          className={`inline-block w-2 h-2 rounded-full shrink-0 ${
            line.aiConfidence >= 70 ? "bg-green-500" : line.aiConfidence >= 40 ? "bg-yellow-500" : "bg-destructive"
          }`}
        />

        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{line.description || "(no description)"}</p>
          <p className="text-[10px] text-muted-foreground">
            {line.isFreight ? (
              <span className="text-yellow-600 dark:text-yellow-400 font-medium">Freight</span>
            ) : (
              <span>{line.accountCode} — {line.accountName}</span>
            )}
            <span className="mx-1">·</span>
            Qty {line.quantity}
            <span className="mx-1">·</span>
            ${(line.totalExGst + line.gstAmount).toFixed(2)}
          </p>
        </div>
      </div>

      {expanded && (
        <div className="ml-7 mt-2 bg-muted/30 rounded-md p-3 space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Description</label>
              <Input
                value={line.description}
                onChange={(e) => onUpdate("description", e.target.value)}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Account code</label>
              <select
                className="w-full h-7 rounded-md border border-input bg-background px-2 text-xs"
                value={line.accountCode}
                onChange={(e) => {
                  const def = ALL_CODES.find((c) => c.code === e.target.value);
                  onUpdate("accountCode", e.target.value);
                  onUpdate("accountName", def?.name || "");
                  onUpdate("isFreight", e.target.value === FREIGHT_CODE);
                }}
              >
                {ALL_CODES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Qty</label>
              <Input
                type="number"
                value={line.quantity}
                onChange={(e) => onUpdate("quantity", parseInt(e.target.value) || 1)}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Ex GST</label>
              <Input
                type="number"
                step="0.01"
                value={line.totalExGst.toFixed(2)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  onUpdate("totalExGst", val);
                  onUpdate("gstAmount", val * 0.1);
                }}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">GST</label>
              <Input
                type="number"
                step="0.01"
                value={line.gstAmount.toFixed(2)}
                onChange={(e) => onUpdate("gstAmount", parseFloat(e.target.value) || 0)}
                className="h-7 text-xs"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-1 border-t border-border/50">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                line.aiConfidence >= 70 ? "bg-green-500" : line.aiConfidence >= 40 ? "bg-yellow-500" : "bg-destructive"
              }`}
            />
            AI: {line.aiConfidence}% confidence via {line.aiMethod}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Editable field ──

function EditableField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-sm mt-0.5"
      />
    </div>
  );
}
