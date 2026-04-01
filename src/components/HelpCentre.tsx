import { useState } from "react";
import { ChevronDown, ChevronRight, Search, Mail, Calendar, Bug, Keyboard, BookOpen, HelpCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

const quickStartGuides = [
  {
    title: "How to process your first invoice",
    steps: [
      "Tap 'Import invoice' on the dashboard",
      "Upload a PDF, Excel, CSV, Word file, or take a photo",
      "Optionally add supplier name and custom AI instructions",
      "Wait for AI to extract and enrich product data",
      "Review enriched products — edit any fields that need correction",
      "Choose your export format and download the file",
    ],
  },
  {
    title: "How to connect Shopify",
    steps: [
      "Go to Account → Store Setup",
      "Enter your Shopify store URL (e.g. mystore.myshopify.com)",
      "Enter your Shopify Admin API access token",
      "Click 'Save settings' — your store is now connected",
    ],
  },
  {
    title: "Understanding confidence scores",
    steps: [
      "HIGH (green): Product was matched with strong evidence — RRP, brand, and type all confirmed",
      "MEDIUM (amber): Most fields matched but one or more may need manual review",
      "LOW (red): Product could not be matched reliably — review before exporting",
      "You can filter exports by confidence level in the pre-export review screen",
    ],
  },
  {
    title: "How tags are generated",
    steps: [
      "Tags follow a multi-layer formula configured per industry",
      "Layers include: gender, department, product type, brand, arrival month, price status",
      "Special properties (e.g. underwire, chlorine resistant) are detected from product names",
      "You can customise tag rules in Tools → Tag Rules",
      "Tags are added to the Shopify CSV Tags column automatically",
    ],
  },
  {
    title: "How RRP lookup works",
    steps: [
      "For each product, Sonic Invoice searches the brand's official website",
      "Then checks trusted retail aggregators for your region",
      "It always uses local currency prices matching your store config",
      "Amazon and eBay are never used as RRP sources",
      "Results are cached to speed up future lookups for the same product",
    ],
  },
  {
    title: "How to use bulk sale pricing",
    steps: [
      "Upload your Shopify product CSV export",
      "Filter products by vendor, tag, or type",
      "Set discount percentage and rounding rule",
      "Preview changes before downloading",
      "Download updated CSV and re-import to Shopify",
    ],
  },
];

const faqItems = [
  {
    q: "Does this replace Stocky?",
    a: "Yes. Sonic Invoice replaces Stocky's inventory receiving workflow and adds AI invoice scanning, RRP lookup, SEO generation, and Shopify tag automation that Stocky never had.",
  },
  {
    q: "Will anything push to Shopify automatically?",
    a: "No. Every action requires your approval. Nothing posts to Shopify without you clicking confirm.",
  },
  {
    q: "What file types are supported?",
    a: "PDF (digital and scanned), Excel (XLSX/XLS), CSV, and invoice photos (JPG/PNG). The AI reads all formats.",
  },
  {
    q: "How does the RRP lookup work?",
    a: "For each product, Sonic Invoice searches the brand's official website, then trusted retail aggregators for your region. It always uses local currency prices and never Amazon or eBay.",
  },
  {
    q: "How accurate is the tag generation?",
    a: "Tags follow a configurable multi-layer formula. The default swimwear formula covers gender, department, product type, brand, arrival month, price status, and 12+ special properties. You can customise the formula for your industry.",
  },
  {
    q: "Is my data private?",
    a: "Yes. Each user's data is stored separately. Users cannot see each other's invoices, history, or products.",
  },
  {
    q: "What brands are pre-loaded?",
    a: "100+ brands across multiple industries. For swimwear: Seafolly, Baku, Bond Eye, Jantzen, Sea Level, Jets, Tigerlily, Speedo, Monte & Lou, Kulani Kinis, Funkita, Sunseeker, Artesands, Capriosca, and many more.",
  },
  {
    q: "How do I give a supplier their own login?",
    a: "Go to Account settings, find User Management, click Add User, and set their role. They will only see their own invoices and data.",
  },
];

const shortcuts = [
  { keys: "Ctrl/⌘ + U", action: "Upload invoice" },
  { keys: "Ctrl/⌘ + E", action: "Start enrichment" },
  { keys: "Ctrl/⌘ + X", action: "Export CSV" },
  { keys: "Ctrl/⌘ + D", action: "Go to dashboard" },
  { keys: "Ctrl/⌘ + ?", action: "Open help" },
];

const HelpCentre = () => {
  const [openGuide, setOpenGuide] = useState<number | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredGuides = searchQuery
    ? quickStartGuides.filter(g => g.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : quickStartGuides;

  const filteredFaq = searchQuery
    ? faqItems.filter(f => f.q.toLowerCase().includes(searchQuery.toLowerCase()) || f.a.toLowerCase().includes(searchQuery.toLowerCase()))
    : faqItems;

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <h1 className="text-2xl font-bold font-display mb-1">Help Centre</h1>
      <p className="text-muted-foreground text-sm mb-4">Guides, FAQ, and support</p>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search help topics..."
          className="w-full h-10 rounded-lg bg-input border border-border pl-10 pr-3 text-sm"
        />
      </div>

      {/* Quick Start Guides */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <BookOpen className="w-4 h-4" /> Quick start guides
        </h2>
        <div className="space-y-1">
          {filteredGuides.map((guide, i) => (
            <div key={i} className="bg-card rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setOpenGuide(openGuide === i ? null : i)}
                className="w-full px-4 py-3 flex items-center justify-between text-left"
              >
                <span className="text-sm font-medium">{guide.title}</span>
                {openGuide === i ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              </button>
              {openGuide === i && (
                <div className="px-4 pb-3">
                  <ol className="text-xs text-muted-foreground space-y-1.5 pl-4 list-decimal">
                    {guide.steps.map((step, j) => (
                      <li key={j}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <HelpCircle className="w-4 h-4" /> Frequently asked questions
        </h2>
        <div className="space-y-1">
          {filteredFaq.map((faq, i) => (
            <div key={i} className="bg-card rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full px-4 py-3 flex items-center justify-between text-left"
              >
                <span className="text-sm font-medium">{faq.q}</span>
                {openFaq === i ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              </button>
              {openFaq === i && (
                <div className="px-4 pb-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Keyboard Shortcuts */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Keyboard className="w-4 h-4" /> Keyboard shortcuts
        </h2>
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="space-y-2">
            {shortcuts.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{s.action}</span>
                <kbd className="px-2 py-0.5 rounded bg-muted text-xs font-mono-data border border-border">{s.keys}</kbd>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact & Support */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Contact & support</h2>
        <div className="space-y-2">
          <a href="mailto:support@sonic_invoice.app" className="flex items-center gap-3 bg-card rounded-lg border border-border px-4 py-3 text-sm hover:bg-muted/50 transition-colors">
            <Mail className="w-4 h-4 text-primary" />
            <span>Contact support</span>
            <ExternalLink className="w-3 h-3 text-muted-foreground ml-auto" />
          </a>
          <a href="mailto:demo@sonic_invoice.app?subject=Demo%20request" className="flex items-center gap-3 bg-card rounded-lg border border-border px-4 py-3 text-sm hover:bg-muted/50 transition-colors">
            <Calendar className="w-4 h-4 text-primary" />
            <span>Book a demo</span>
            <ExternalLink className="w-3 h-3 text-muted-foreground ml-auto" />
          </a>
          <a href="mailto:bugs@sonic_invoice.app?subject=Bug%20report%20-%20Sonic Invoice" className="flex items-center gap-3 bg-card rounded-lg border border-border px-4 py-3 text-sm hover:bg-muted/50 transition-colors">
            <Bug className="w-4 h-4 text-destructive" />
            <span>Report a bug</span>
            <ExternalLink className="w-3 h-3 text-muted-foreground ml-auto" />
          </a>
        </div>
      </section>

      <p className="text-center text-[10px] text-muted-foreground/50 mt-8">
        Sonic Invoice v1.0 · Built for fashion retail
      </p>
    </div>
  );
};

export default HelpCentre;
