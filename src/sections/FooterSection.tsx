const footerLinks = {
  Product: ['Features', 'Pricing', 'Integrations', 'Changelog'],
  Resources: ['Documentation', 'API Reference', 'Blog', 'Support'],
  Company: ['About', 'Careers', 'Privacy', 'Terms'],
};

export default function FooterSection() {
  return (
    <footer className="py-16 bg-[#0a0a0a] border-t border-white/[0.06]">
      <div className="max-w-[1200px] mx-auto px-6 md:px-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* Brand */}
          <div>
            <span className="font-sans text-lg font-semibold text-[#fafafa] block mb-2">
              Sonic Invoices
            </span>
            <p className="text-[13px] text-[#737373]">
              The AI-powered retail back-office
            </p>
          </div>

          {/* Link Columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="text-sm font-medium text-[#fafafa] mb-4">{category}</h4>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-sm text-[#a3a3a3] hover:text-[#fafafa] transition-colors duration-300"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom Bar */}
        <div className="flex flex-col md:flex-row items-center justify-between pt-8 border-t border-white/[0.06]">
          <p className="font-mono text-[11px] text-[#737373]">
            &copy; 2026 Sonic Invoices. Built in Darwin, Australia.
          </p>
          <div className="flex items-center gap-6 mt-4 md:mt-0">
            {['GitHub', 'Twitter', 'LinkedIn'].map((social) => (
              <a
                key={social}
                href="#"
                className="font-mono text-[11px] text-[#737373] hover:text-[#a3a3a3] transition-colors duration-300"
              >
                {social}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
