import { useEffect } from "react";
import { Mail, Calendar, Bug } from "lucide-react";

const Support = () => {
  useEffect(() => {
    document.title = "Support — Sonic Invoices | Help for Shopify Invoice Processing";
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", "Get help with Sonic Invoices — invoice to Shopify conversion, JOOR & Faire sync, bulk discounts, Google Shopping feed fixes, and inventory management. Email support and FAQs.");
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">Sonic Invoices Support</h1>
        <p className="text-muted-foreground mb-10">
          Need help with Sonic Invoices? We're here for you.
        </p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Contact us</h2>
          <div className="space-y-3">
            <a href="mailto:support@sonicinvoice.app" className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm hover:bg-muted/50 transition-colors">
              <Mail className="w-5 h-5 text-primary" />
              <div>
                <p className="font-medium">Email support</p>
                <p className="text-muted-foreground">support@sonicinvoice.app</p>
              </div>
            </a>
            <a href="mailto:support@sonicinvoice.app?subject=Bug%20Report" className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm hover:bg-muted/50 transition-colors">
              <Bug className="w-5 h-5 text-destructive" />
              <div>
                <p className="font-medium">Report a bug</p>
                <p className="text-muted-foreground">Let us know what went wrong</p>
              </div>
            </a>
            <a href="mailto:demo@sonicinvoice.app?subject=Demo%20Request" className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm hover:bg-muted/50 transition-colors">
              <Calendar className="w-5 h-5 text-primary" />
              <div>
                <p className="font-medium">Book a demo</p>
                <p className="text-muted-foreground">See Sonic Invoices in action</p>
              </div>
            </a>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Frequently asked questions</h2>
          <div className="space-y-4 text-sm">
            {[
              { q: "How do I convert an invoice to Shopify products?", a: "Upload any PDF, Excel, CSV, or Word invoice. AI extracts every product and maps it to Shopify fields — title, SKU, barcode, price, cost, quantity, colour, size. Review and push to Shopify in minutes." },
              { q: "Can I link JOOR and Faire orders to Shopify?", a: "Yes. Connect to JOOR (live API), Faire, NuOrder, Brandscope, or Brandboom. Pull wholesale orders directly and push products to Shopify in one click." },
              { q: "How do bulk discounts work?", a: "Apply bulk discounts, markups, or exact pricing to any product selection. Put entire collections on sale or restore original prices. Margin protection ensures no product falls below cost." },
              { q: "What file types are supported?", a: "PDF (digital and scanned), Excel (XLSX/XLS), CSV, Word documents, and invoice photos (JPG/PNG)." },
              { q: "Will anything push to Shopify automatically?", a: "No. Every action requires your approval. Nothing posts to Shopify without you clicking confirm." },
              { q: "Is my data private?", a: "Yes. Each user's data is stored separately and encrypted. Users cannot see each other's invoices, history, or products." },
              { q: "Does this replace Shopify Stocky?", a: "Yes. Sonic Invoices includes purchase orders, demand forecasting, dead stock detection, stocktake management, and AI-powered reorder intelligence — everything Stocky had and more." },
              { q: "Does this work with the Shopify POS?", a: "Yes. Sonic Invoices integrates with Shopify, which syncs with Shopify POS automatically." },
            ].map((item, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-4">
                <p className="font-medium mb-1">{item.q}</p>
                <p className="text-muted-foreground">{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">Response times</h2>
          <p className="text-sm text-muted-foreground">
            We aim to respond to all support requests within 24 hours during business days (Mon–Fri, 9 AM – 5 PM AEST).
            Critical bug reports are prioritised and typically addressed within 4 hours.
          </p>
        </section>

        <footer className="mt-16 pt-6 border-t border-border text-xs text-muted-foreground text-center">
          © {new Date().getFullYear()} Sonic Invoices. All rights reserved.
        </footer>
      </div>
    </div>
  );
};

export default Support;