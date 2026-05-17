import { useState } from 'react';
import { Menu, X } from 'lucide-react';

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Integrations', href: '#integrations' },
  { label: 'Demo', href: '/demo' },
  { label: 'How it works', href: '/how-it-works' },
];

export default function Navigation() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] backdrop-blur-2xl bg-[#0a0a0a]/60">
      <div className="max-w-[1200px] mx-auto px-6 md:px-12 flex items-center justify-between h-16">
        <a href="#" className="flex items-center gap-2">
          <span className="font-sans text-lg font-semibold text-[#fafafa]">Sonic Invoices</span>
          <span className="w-2 h-2 rounded-full bg-lime" />
        </a>

        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-sm text-[#a3a3a3] hover:text-[#fafafa] transition-colors duration-300"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-4">
          <a
            href="/workflows"
            className="text-sm text-[#a3a3a3] hover:text-[#fafafa] transition-colors duration-300"
          >
            Workflows
          </a>
          <a
            href="/login"
            className="text-sm text-[#a3a3a3] hover:text-[#fafafa] transition-colors duration-300"
          >
            Sign in
          </a>
          <a
            href="/signup"
            className="text-sm font-medium bg-lime text-[#0a0a0a] px-5 py-2 rounded-full hover:brightness-110 transition-all duration-300">Get started
          </a>
        </div>

        <button
          className="md:hidden text-[#a3a3a3]"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-white/[0.06] bg-[#0a0a0a]/95 backdrop-blur-2xl px-6 py-6 space-y-4">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="block text-sm text-[#a3a3a3] hover:text-[#fafafa] transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <div className="pt-4 border-t border-white/[0.06] flex flex-col gap-3">
            <a href="/how-it-works" className="text-sm text-[#a3a3a3]" onClick={() => setMobileOpen(false)}>How it works</a>
            <a href="/workflows" className="text-sm text-[#a3a3a3]" onClick={() => setMobileOpen(false)}>Workflows</a>
            <a href="/login" className="text-sm text-[#a3a3a3]">Sign in</a>
            <a
              href="/signup"
              className="text-sm font-medium bg-lime text-[#0a0a0a] px-5 py-2.5 rounded-full text-center">Get started
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
