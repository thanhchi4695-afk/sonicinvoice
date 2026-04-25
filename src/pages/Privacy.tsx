import { Link } from "react-router-dom";

const Privacy = () => (
  <div className="min-h-screen bg-background text-foreground">
    <div className="max-w-2xl mx-auto px-6 py-16 text-sm leading-relaxed">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-muted-foreground mb-10">Sonic Invoice — Last updated April 2026</p>

      <div className="space-y-8 text-muted-foreground">
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">1. What we collect</h2>
          <p className="mb-4">
            Sonic Invoice accesses your Gmail inbox in read-only mode to detect supplier invoice emails. We read email metadata (sender address, subject line, date) and download attachments (PDF, Excel, CSV files) from emails that match supplier invoice patterns such as tax invoices, purchase orders, and packing slips.
          </p>
          <p>
            We also collect the product data you process through the app: product names, SKUs, costs, prices, and quantities extracted from your supplier invoices.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">2. What we do NOT do</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>We never read personal emails.</li>
            <li>We never store email content or email body text.</li>
            <li>We never send emails from your account.</li>
            <li>We never modify or delete emails in your inbox.</li>
            <li>We never share your data with third parties.</li>
            <li>We never sell your data.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">3. How we use your data</h2>
          <p className="mb-4">
            Invoice attachment files are processed to extract product information and then discarded. We store only the extracted product data in your account on our secure database.
          </p>
          <p>
            Your supplier invoice history is used to train the Supplier Brain — an AI system that learns your suppliers' invoice formats to improve extraction accuracy over time. This data is scoped to your account only.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">4. Data security</h2>
          <p>
            All data is stored in a secure Supabase database with row-level security — you can only access your own data. Gmail access tokens are encrypted and stored securely. We use HTTPS for all data transmission.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">5. Your rights</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>You can disconnect Gmail at any time from Account → Automation → Disconnect.</li>
            <li>You can delete your account and all associated data by contacting us.</li>
            <li>You can request a copy of your data at any time.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">6. Contact</h2>
          <p className="mb-1">For privacy questions or data requests:</p>
          <p className="mb-1">Email: <a href="mailto:thanhchi4695@gmail.com" className="text-primary underline">thanhchi4695@gmail.com</a></p>
          <p className="mb-1">Business: NT Chi, Darwin NT, Australia</p>
          <p>ABN: 73 361 643 990</p>
        </section>
      </div>

      <footer className="mt-16 pt-6 border-t border-border text-xs text-muted-foreground text-center">
        <p>© {new Date().getFullYear()} Sonic Invoice. All rights reserved.</p>
        <p className="mt-2">
          <Link to="/" className="text-primary underline">Back to home</Link>
        </p>
      </footer>
    </div>
  </div>
);

export default Privacy;
