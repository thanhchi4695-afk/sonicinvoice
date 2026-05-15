import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const steps = [
  {
    num: '01',
    title: 'Upload your invoice',
    desc: 'Drop any PDF, Excel, CSV, or Word file. Sonic reads every line — products, sizes, colours, prices, quantities.',
  },
  {
    num: '02',
    title: 'Review AI-extracted products',
    desc: 'Every product is automatically mapped to Shopify fields — title, SKU, barcode, price, cost, quantity, variants.',
  },
  {
    num: '03',
    title: 'Push to your store',
    desc: 'One click publishes directly to Shopify. Your inventory is live, accurate, and ready to sell.',
  },
];

export default function HowItWorksSection() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const header = ref.current.querySelector('.section-header');
    const cards = ref.current.querySelectorAll('.step-card');
    gsap.fromTo(
      header,
      { y: 30, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.7,
        ease: 'power3.out',
        scrollTrigger: { trigger: ref.current, start: 'top 80%' },
      }
    );
    gsap.fromTo(
      cards,
      { y: 40, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.8,
        stagger: 0.15,
        ease: 'power3.out',
        scrollTrigger: { trigger: ref.current, start: 'top 80%' },
      }
    );
  }, []);

  return (
    <section id="how-it-works" className="py-[120px] bg-[#0a0a0a]">
      <div ref={ref} className="max-w-[1200px] mx-auto px-6 md:px-12">
        <div className="section-header mb-16">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#737373] block mb-4">
            HOW IT WORKS
          </span>
          <h2 className="font-serif text-[40px] text-[#fafafa] tracking-[-0.03em] leading-[1.1]">
            From invoice to Shopify in three steps
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {steps.map((step) => (
            <div key={step.num} className="step-card">
              <div className="w-8 h-8 rounded-full border border-lime/30 flex items-center justify-center mb-5">
                <span className="font-mono text-sm text-lime">{step.num}</span>
              </div>
              <h3 className="text-lg font-medium text-[#fafafa] mb-3">{step.title}</h3>
              <p className="text-sm text-[#a3a3a3] leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
