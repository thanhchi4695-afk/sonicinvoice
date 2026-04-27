import { useState, useMemo } from "react";
import { ChevronLeft, Mail, Copy, Check, ExternalLink, Download, Save, Plus, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getStoreConfig } from "@/lib/prompt-builder";
import { usePromptDialog } from "@/hooks/use-prompt-dialog";

// ── Types ──────────────────────────────────────────────────
interface SupplierContact {
  brand: string;
  salesRepName: string;
  salesRepEmail: string;
  salesRepPhone: string;
  accountsEmail: string;
  notes: string;
}

interface EmailTemplate {
  id: string;
  label: string;
  emoji: string;
  desc: string;
  buildSubject: (ctx: TemplateContext) => string;
  buildBody: (ctx: TemplateContext) => string;
}

interface TemplateContext {
  storeName: string;
  storeCity: string;
  brand: string;
  contact: SupplierContact;
  poRef: string;
  season: string;
  currency: string;
  date: string;
}

// ── Contacts persistence ──────────────────────────────────
const CONTACTS_KEY = "supplier_contacts";
function loadContacts(): SupplierContact[] {
  try { return JSON.parse(localStorage.getItem(CONTACTS_KEY) || "[]"); } catch { return []; }
}
function saveContacts(c: SupplierContact[]) { localStorage.setItem(CONTACTS_KEY, JSON.stringify(c)); }

const CUSTOM_TEMPLATES_KEY = "supplier_email_templates_custom";
function loadCustomTemplates(): { name: string; subject: string; body: string }[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_TEMPLATES_KEY) || "[]"); } catch { return []; }
}
function saveCustomTemplates(t: { name: string; subject: string; body: string }[]) {
  localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(t));
}

// ── Templates ─────────────────────────────────────────────
const TEMPLATES: EmailTemplate[] = [
  {
    id: "new_order", label: "New Season Order", emoji: "📦", desc: "Place a new season purchase order",
    buildSubject: (c) => `${c.season} Order — ${c.storeName} — ${c.poRef}`,
    buildBody: (c) =>
`Hi ${c.contact.salesRepName || "Team"},

I'd like to place our ${c.season} order for ${c.storeName}${c.storeCity ? ` (${c.storeCity})` : ""}.

PO Reference: ${c.poRef}
Season: ${c.season}

[Product list — paste from your order form]

Requested delivery date: [Date]
Payment terms: [Your standard terms]

Shipping address:
${c.storeName}
[Your address]

Please confirm receipt and expected dispatch date.

Kind regards,
${c.storeName}`,
  },
  {
    id: "discrepancy", label: "Invoice Discrepancy", emoji: "⚠️", desc: "Query differences between PO and invoice",
    buildSubject: (c) => `Query re Invoice [INV#] — ${c.brand}`,
    buildBody: (c) =>
`Hi ${c.contact.salesRepName || "Accounts Team"},

We've received invoice [INV#] dated ${c.date} and have identified the following discrepancies against our PO (${c.poRef}):

Product | Expected Qty | Invoiced Qty | Difference
--------|-------------|-------------|----------
[Product name] | [X] | [Y] | [±Z]

Could you please review and issue a credit note / send the missing items?

Please let me know if you need any further details.

Kind regards,
${c.storeName}`,
  },
  {
    id: "delivery_followup", label: "Delivery Follow-Up", emoji: "🚚", desc: "Chase an overdue delivery",
    buildSubject: (c) => `Following up — ${c.brand} ${c.season} delivery`,
    buildBody: (c) =>
`Hi ${c.contact.salesRepName || "Team"},

I'm following up on our order ${c.poRef} for ${c.season}.

The expected delivery date was [Date] and we haven't yet received the shipment.

Could you please provide an updated ETA and tracking information?

Kind regards,
${c.storeName}`,
  },
  {
    id: "price_query", label: "Price Increase Query", emoji: "💰", desc: "Query unexpected cost changes",
    buildSubject: (c) => `Price query — ${c.brand} ${c.date} invoice`,
    buildBody: (c) =>
`Hi ${c.contact.salesRepName || "Team"},

We've noticed some cost changes on your latest invoice compared to our previous order:

Product | Previous Cost | New Cost | Change
--------|--------------|---------|-------
[Product name] | ${c.currency}[old] | ${c.currency}[new] | +[X]%

Could you please confirm whether these are correct and provide an updated wholesale price list?

Kind regards,
${c.storeName}`,
  },
  {
    id: "catalog_request", label: "Catalog Request", emoji: "📋", desc: "Request current season catalog",
    buildSubject: (c) => `Catalog request — ${c.storeName}`,
    buildBody: (c) =>
`Hi ${c.contact.salesRepName || "Team"},

We'd love to see your current ${c.season} catalog for ${c.brand}.

Could you please send us a digital copy (PDF or Excel) with wholesale pricing? We're planning our buys for the upcoming season.

${c.storeCity ? `We're based in ${c.storeCity} and` : "We"} would appreciate any new arrivals or exclusives available.

Kind regards,
${c.storeName}`,
  },
];

// ── Component ─────────────────────────────────────────────
const SupplierEmails = ({ onBack }: { onBack: () => void }) => {
  const promptDialog = usePromptDialog();
  const config = getStoreConfig();
  const storeName = config.name || "My Store";
  const storeCity = config.city || "";
  const sym = config.currencySymbol || "$";

  const [view, setView] = useState<"list" | "compose" | "contacts">("list");
  const [contacts, setContacts] = useState<SupplierContact[]>(loadContacts);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [selectedBrand, setSelectedBrand] = useState("");
  const [toField, setToField] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);
  const [customTemplates, setCustomTemplates] = useState(loadCustomTemplates);

  // Contact editing
  const [editContact, setEditContact] = useState<SupplierContact>({ brand: "", salesRepName: "", salesRepEmail: "", salesRepPhone: "", accountsEmail: "", notes: "" });

  const brands = useMemo(() => [...new Set(contacts.map(c => c.brand))].sort(), [contacts]);

  const now = new Date();
  const season = now.getMonth() >= 6 ? `Summer ${now.getFullYear()}/${(now.getFullYear() + 1).toString().slice(2)}` : `Winter ${now.getFullYear()}`;
  const poRef = `PO-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(3, "0")}`;

  const openTemplate = (tmpl: EmailTemplate) => {
    const contact = contacts.find(c => c.brand === selectedBrand) || { brand: selectedBrand, salesRepName: "", salesRepEmail: "", salesRepPhone: "", accountsEmail: "", notes: "" };
    const ctx: TemplateContext = { storeName, storeCity, brand: selectedBrand || "[Brand]", contact, poRef, season, currency: sym, date: now.toLocaleDateString() };
    setSelectedTemplate(tmpl);
    setToField(contact.salesRepEmail || contact.accountsEmail || "");
    setSubject(tmpl.buildSubject(ctx));
    setBody(tmpl.buildBody(ctx));
    setView("compose");
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(`To: ${toField}\nSubject: ${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleMailto = () => {
    window.open(`mailto:${encodeURIComponent(toField)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  };

  const handleDownload = () => {
    const blob = new Blob([`To: ${toField}\nSubject: ${subject}\n\n${body}`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${selectedTemplate?.id || "email"}_${selectedBrand || "supplier"}.txt`;
    a.click();
  };

  const handleSaveCustom = () => {
    const name = prompt("Template name:");
    if (!name) return;
    const updated = [...customTemplates, { name, subject, body }];
    setCustomTemplates(updated);
    saveCustomTemplates(updated);
  };

  const saveContact = () => {
    if (!editContact.brand.trim()) return;
    const idx = contacts.findIndex(c => c.brand === editContact.brand);
    const updated = idx >= 0 ? contacts.map((c, i) => i === idx ? editContact : c) : [...contacts, editContact];
    setContacts(updated);
    saveContacts(updated);
    setEditContact({ brand: "", salesRepName: "", salesRepEmail: "", salesRepPhone: "", accountsEmail: "", notes: "" });
  };

  const deleteContact = (brand: string) => {
    const updated = contacts.filter(c => c.brand !== brand);
    setContacts(updated);
    saveContacts(updated);
  };

  // ── Contacts view ────────────────────────────────────────
  if (view === "contacts") {
    return (
      <div className="pb-24 px-4 pt-4 max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setView("list")}><ChevronLeft className="w-5 h-5" /></Button>
          <h1 className="text-lg font-bold text-foreground">📇 Supplier Contacts</h1>
        </div>

        {/* Add / edit form */}
        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            {editContact.brand && contacts.some(c => c.brand === editContact.brand) ? "Edit Contact" : "Add Contact"}
          </h3>
          <input placeholder="Brand name *" value={editContact.brand}
            onChange={e => setEditContact({ ...editContact, brand: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Sales rep name" value={editContact.salesRepName}
              onChange={e => setEditContact({ ...editContact, salesRepName: e.target.value })}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
            <input placeholder="Sales rep email" type="email" value={editContact.salesRepEmail}
              onChange={e => setEditContact({ ...editContact, salesRepEmail: e.target.value })}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
            <input placeholder="Sales rep phone" value={editContact.salesRepPhone}
              onChange={e => setEditContact({ ...editContact, salesRepPhone: e.target.value })}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
            <input placeholder="Accounts email" type="email" value={editContact.accountsEmail}
              onChange={e => setEditContact({ ...editContact, accountsEmail: e.target.value })}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </div>
          <textarea placeholder="Notes" value={editContact.notes}
            onChange={e => setEditContact({ ...editContact, notes: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground h-16 resize-none" />
          <Button size="sm" onClick={saveContact} disabled={!editContact.brand.trim()}>
            <Save className="w-3.5 h-3.5 mr-1" /> Save Contact
          </Button>
        </Card>

        {/* Contact list */}
        {contacts.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No contacts yet. Add your first supplier above.</p>}
        {contacts.map(c => (
          <Card key={c.brand} className="p-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold text-sm text-foreground">{c.brand}</div>
                {c.salesRepName && <div className="text-xs text-muted-foreground mt-0.5"><User className="w-3 h-3 inline mr-1" />{c.salesRepName}</div>}
                {c.salesRepEmail && <div className="text-xs text-muted-foreground">{c.salesRepEmail}</div>}
                {c.salesRepPhone && <div className="text-xs text-muted-foreground">{c.salesRepPhone}</div>}
                {c.accountsEmail && <div className="text-xs text-muted-foreground mt-0.5">Accounts: {c.accountsEmail}</div>}
                {c.notes && <div className="text-xs text-muted-foreground mt-1 italic">{c.notes}</div>}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditContact(c)}>
                  <Mail className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteContact(c.brand)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  // ── Compose view ─────────────────────────────────────────
  if (view === "compose") {
    return (
      <div className="pb-24 px-4 pt-4 max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setView("list")}><ChevronLeft className="w-5 h-5" /></Button>
          <h1 className="text-lg font-bold text-foreground">{selectedTemplate?.emoji} {selectedTemplate?.label}</h1>
        </div>

        <Card className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <input value={toField} onChange={e => setToField(e.target.value)}
              placeholder="supplier@example.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Body</label>
            <textarea value={body} onChange={e => setBody(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground mt-1 h-64 resize-y font-mono" />
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy to clipboard"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleMailto} className="gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> Open in mail
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload} className="gap-1.5">
            <Download className="w-3.5 h-3.5" /> Download .txt
          </Button>
          <Button variant="outline" size="sm" onClick={handleSaveCustom} className="gap-1.5">
            <Save className="w-3.5 h-3.5" /> Save as template
          </Button>
        </div>
      </div>
    );
  }

  // ── Template list view ───────────────────────────────────
  return (
    <div className="pb-24 px-4 pt-4 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}><ChevronLeft className="w-5 h-5" /></Button>
        <h1 className="text-lg font-bold text-foreground">✉️ Supplier Emails</h1>
      </div>

      {/* Brand selector */}
      <Card className="p-3">
        <label className="text-xs font-medium text-muted-foreground block mb-1">Supplier / Brand</label>
        <div className="flex gap-2">
          <select value={selectedBrand} onChange={e => setSelectedBrand(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
            <option value="">Select a brand...</option>
            {brands.map(b => <option key={b} value={b}>{b}</option>)}
            <option value="__other">Other (type below)</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => setView("contacts")} className="gap-1">
            <User className="w-3.5 h-3.5" /> Contacts
          </Button>
        </div>
        {selectedBrand === "__other" && (
          <input placeholder="Brand name" className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            onChange={e => setSelectedBrand(e.target.value)} />
        )}
      </Card>

      {/* Built-in templates */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Templates</h2>
        {TEMPLATES.map(t => (
          <button key={t.id} onClick={() => openTemplate(t)}
            className="w-full text-left rounded-lg border border-border bg-card p-3 hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-base">{t.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">{t.label}</div>
                <div className="text-xs text-muted-foreground">{t.desc}</div>
              </div>
              <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </div>
          </button>
        ))}
      </div>

      {/* Custom saved templates */}
      {customTemplates.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Saved Templates</h2>
          {customTemplates.map((t, i) => (
            <button key={i} onClick={() => { setSubject(t.subject); setBody(t.body); setView("compose"); setSelectedTemplate({ id: "custom", label: t.name, emoji: "📝", desc: "", buildSubject: () => t.subject, buildBody: () => t.body }); }}
              className="w-full text-left rounded-lg border border-border bg-card p-3 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-base">📝</span>
                <div className="text-sm font-medium text-foreground">{t.name}</div>
                <Button variant="ghost" size="icon" className="ml-auto h-6 w-6 text-destructive" onClick={e => { e.stopPropagation(); const u = customTemplates.filter((_, j) => j !== i); setCustomTemplates(u); saveCustomTemplates(u); }}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SupplierEmails;
