import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const partners = ['Shopify', 'Xero', 'MYOB', 'Google Shopping', 'Claude AI'];

export default function LogoTrustBar() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const els = ref.current.querySelectorAll('.partner-item');
    gsap.fromTo(
      els,
      { y: 20, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.6,
        stagger: 0.1,
        ease: 'power3.out',
        scrollTrigger: { trigger: ref.current, start: 'top 85%' },
      }
    );
  }, []);

  return (
    <section
      className="w-full py-16 border-t border-b border-white/[0.06] bg-[#0a0a0a]"
    >
      <div ref={ref} className="max-w-[1200px] mx-auto px-6 md:px-12 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#737373] mb-8">
          Works with your existing stack
        </p>
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-16">
          {partners.map((name) => (
            <span
              key={name}
              className="partner-item font-mono text-xs uppercase tracking-[0.08em] text-[#737373]/40"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
