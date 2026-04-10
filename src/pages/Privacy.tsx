const Privacy = () => (
  <div className="min-h-screen bg-background text-foreground">
    <div className="max-w-2xl mx-auto px-6 py-16 text-sm leading-relaxed">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-muted-foreground mb-10">Last updated: {new Date().toLocaleDateString("en-AU", { year: "numeric", month: "long", day: "numeric" })}</p>

      <div className="space-y-8 text-muted-foreground">
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">1. Introduction</h2>
          <p>
            Sonic Invoices ("we", "our", "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our web application and Chrome extension at sonicinvoice.lovable.app (the "Service").
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">2. Information we collect</h2>
          <p className="mb-2"><strong className="text-foreground">Account information:</strong> When you create an account, we collect your email address and password (stored securely via hashed encryption).</p>
          <p className="mb-2"><strong className="text-foreground">Invoice data:</strong> When you upload invoices for processing, we temporarily process the file content (text, images) to extract product data. Uploaded files are processed in memory and are not stored permanently unless you explicitly save results.</p>
          <p className="mb-2"><strong className="text-foreground">Store connection data:</strong> If you connect your Shopify store, we store your store URL and an access token to enable product synchronisation. We do not store customer payment information.</p>
          <p><strong className="text-foreground">Usage data:</strong> We collect basic usage analytics (pages visited, features used) to improve the Service. We do not use third-party tracking scripts or sell data to advertisers.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">3. How we use your information</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>To provide and maintain the Service</li>
            <li>To process invoices and extract product data using AI</li>
            <li>To synchronise products with your connected Shopify store</li>
            <li>To send transactional emails (password resets, account notifications)</li>
            <li>To improve and optimise the Service</li>
            <li>To respond to support requests</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">4. Data storage and security</h2>
          <p>
            Your data is stored on secure, encrypted servers. We use industry-standard security measures including TLS encryption in transit, AES-256 encryption at rest, and Row-Level Security (RLS) to ensure users can only access their own data. We do not share your data with third parties except as required to provide the Service (e.g., AI processing providers).
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">5. Third-party services</h2>
          <p>We use the following third-party services to operate the Service:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li><strong className="text-foreground">AI processing:</strong> Invoice text and images are sent to AI models for data extraction. No personally identifiable information is included in these requests beyond the invoice content itself.</li>
            <li><strong className="text-foreground">Shopify API:</strong> Used to sync product data with your store when you explicitly authorise the connection.</li>
            <li><strong className="text-foreground">Authentication provider:</strong> Manages user accounts, passwords, and session tokens securely.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">6. Chrome extension</h2>
          <p>
            The Sonic Invoices Chrome extension does not collect browsing history, track websites you visit, or access any data outside of the Sonic Invoices application. The extension only communicates with sonicinvoice.lovable.app and does not inject scripts into other websites.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">7. Data retention</h2>
          <p>
            We retain your account data for as long as your account is active. Invoice processing results are stored until you delete them. If you delete your account, all associated data is permanently removed within 30 days.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">8. Your rights</h2>
          <p>You have the right to:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li>Access the personal data we hold about you</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your data</li>
            <li>Export your data in a standard format</li>
            <li>Withdraw consent for data processing at any time</li>
          </ul>
          <p className="mt-2">To exercise these rights, contact us at <a href="mailto:support@sonicinvoice.app" className="text-primary underline">support@sonicinvoice.app</a>.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">9. Children's privacy</h2>
          <p>
            The Service is not intended for use by anyone under the age of 18. We do not knowingly collect personal information from children.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">10. Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes by updating the "Last updated" date at the top of this page. Continued use of the Service after changes constitutes acceptance of the updated policy.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-2">11. Contact us</h2>
          <p>
            If you have questions about this Privacy Policy, please contact us at{" "}
            <a href="mailto:support@sonicinvoice.app" className="text-primary underline">support@sonicinvoice.app</a>.
          </p>
        </section>
      </div>

      <footer className="mt-16 pt-6 border-t border-border text-xs text-muted-foreground text-center">
        © {new Date().getFullYear()} Sonic Invoices. All rights reserved.
      </footer>
    </div>
  </div>
);

export default Privacy;
