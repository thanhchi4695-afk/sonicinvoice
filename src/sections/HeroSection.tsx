import { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import AuroraBackground from '@/components/AuroraBackground';
import gsap from 'gsap';

export default function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!textRef.current) return;
    const els = textRef.current.children;
    gsap.fromTo(
      els,
      { y: 40, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.8, stagger: 0.12, ease: 'power3.out', delay: 0.3 }
    );
    if (cardsRef.current) {
      gsap.fromTo(
        cardsRef.current,
        { y: 60, opacity: 0 },
        { y: 0, opacity: 1, duration: 1.0, ease: 'power3.out', delay: 0.8 }
      );
    }
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden"
    >
      <AuroraBackground />

      <div className="relative z-10 flex flex-col items-center text-center px-6 pt-24 pb-8">
        <div ref={textRef} className="max-w-[720px] flex flex-col items-center">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#737373] mb-6">
            AUSTRALIAN FASHION RETAILERS
          </span>

          <h1 className="font-serif text-[clamp(40px,5vw,64px)] font-normal text-[#fafafa] leading-[1.0] tracking-[-0.04em]">
            Turn supplier invoices into Shopify products in{' '}
            <em className="italic">fifteen minutes</em>.
          </h1>

          <p className="text-base text-[#a3a3a3] max-w-[600px] leading-relaxed mt-6">
            Sonic Invoices uses AI to extract every product from your supplier invoices and maps them directly to Shopify — with 7-layer Australian retail tagging, SEO collections, and competitor gap analysis built in.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 mt-10">
            <a
              href="#pricing"
              className="bg-lime text-[#0a0a0a] px-6 py-3 rounded-full font-medium text-sm hover:brightness-110 transition-all duration-300"
            >
              Upload your first invoice
            </a>
            <a
              href="#how-it-works"
              className="border border-white/[0.14] text-[#fafafa] px-6 py-3 rounded-full font-medium text-sm hover:bg-white/[0.06] transition-all duration-300"
            >
              Watch demo
            </a>
          </div>
        </div>

        {/* Hero Cards */}
        <div
          ref={cardsRef}
          className="mt-16 hidden md:block"
          style={{ perspective: '1200px', perspectiveOrigin: '50% 50%' }}
        >
          <div className="flex items-center gap-[-40px]">
            {/* Left Card - Invoice Upload */}
            <div
              className="relative w-[320px] h-[220px] rounded-2xl p-5 flex flex-col"
              style={{
                transform: 'rotateY(-22.5deg) rotateX(10deg)',
                transformStyle: 'preserve-3d',
                backdropFilter: 'blur(40px)',
                background: 'rgba(23,23,23,0.6)',
                border: '1px solid rgba(255,255,255,0.08)',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 2px 16px rgba(0,0,0,0.5)',
              }}
            >
              <div
                className="absolute inset-0 rounded-2xl pointer-events-none"
                style={{
                  background:
                    'radial-gradient(ellipse 90% 40% at 50% 0%, rgba(255,255,255,0.18), transparent)',
                }}
              />
              <div
                className="absolute top-0 left-[20%] right-[20%] h-[1px]"
                style={{
                  background: 'linear-gradient(90deg, transparent, #a3e635, transparent)',
                }}
              />
              <div className="flex items-center gap-2 mb-4">
                <div className="w-3 h-3 rounded-full bg-[#ef4444]" />
                <div className="w-3 h-3 rounded-full bg-[#f59e0b]" />
                <div className="w-3 h-3 rounded-full bg-[#22c55e]" />
                <span className="ml-2 font-mono text-[10px] text-[#737373] bg-[#262626] rounded-full px-3 py-0.5">
                  sonicinvoices.com/upload
                </span>
              </div>
              <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-white/[0.08] rounded-xl">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="1.5">
                  <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                </svg>
                <span className="text-[11px] text-[#737373] mt-2 font-mono">Drop invoice here</span>
              </div>
            </div>

            {/* Right Card - Shopify Products */}
            <div
              className="relative w-[360px] h-[240px] rounded-2xl p-5 flex flex-col -ml-10"
              style={{
                transform: 'rotateY(-22.5deg) rotateX(10deg)',
                transformStyle: 'preserve-3d',
                backdropFilter: 'blur(40px)',
                background: 'rgba(23,23,23,0.6)',
                border: '1px solid rgba(255,255,255,0.08)',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 2px 16px rgba(0,0,0,0.5)',
              }}
            >
              <div
                className="absolute inset-0 rounded-2xl pointer-events-none"
                style={{
                  background:
                    'radial-gradient(ellipse 90% 40% at 50% 0%, rgba(255,255,255,0.18), transparent)',
                }}
              />
              <div
                className="absolute top-0 left-[20%] right-[20%] h-[1px]"
                style={{
                  background: 'linear-gradient(90deg, transparent, #a3e635, transparent)',
                }}
              />
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-[#ef4444]" />
                <div className="w-3 h-3 rounded-full bg-[#f59e0b]" />
                <div className="w-3 h-3 rounded-full bg-[#22c55e]" />
                <span className="ml-2 font-mono text-[10px] text-[#737373] bg-[#262626] rounded-full px-3 py-0.5">
                  mystore.myshopify.com/admin
                </span>
              </div>
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2 py-1.5 border-b border-white/[0.06]">
                  <div className="w-6 h-6 rounded bg-[#262626] flex-shrink-0" />
                  <span className="text-[10px] text-[#a3a3a3] flex-1 truncate">Seafolly One Piece</span>
                  <span className="text-[10px] text-lime font-mono">$189</span>
                  <span className="text-[9px] bg-lime/20 text-lime px-1.5 py-0.5 rounded-full font-mono">
                    Published
                  </span>
                </div>
                <div className="flex items-center gap-2 py-1.5 border-b border-white/[0.06]">
                  <div className="w-6 h-6 rounded bg-[#262626] flex-shrink-0" />
                  <span className="text-[10px] text-[#a3a3a3] flex-1 truncate">Kulani Kinis Bikini</span>
                  <span className="text-[10px] text-lime font-mono">$145</span>
                  <span className="text-[9px] bg-lime/20 text-lime px-1.5 py-0.5 rounded-full font-mono">
                    Published
                  </span>
                </div>
                <div className="flex items-center gap-2 py-1.5 border-b border-white/[0.06]">
                  <div className="w-6 h-6 rounded bg-[#262626] flex-shrink-0" />
                  <span className="text-[10px] text-[#a3a3a3] flex-1 truncate">Walnut Melbourne Dress</span>
                  <span className="text-[10px] text-lime font-mono">$220</span>
                  <span className="text-[9px] bg-[#f59e0b]/20 text-[#f59e0b] px-1.5 py-0.5 rounded-full font-mono">
                    Pending
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll Indicator */}
        <div className="mt-12 animate-bounce-slow">
          <ChevronDown size={20} className="text-[#737373]" />
        </div>
      </div>
    </section>
  );
}
