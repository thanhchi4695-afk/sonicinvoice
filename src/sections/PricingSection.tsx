import { useState, useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Check } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const plans = [
  {
    name: 'Import',
    subtitle: 'Starter',
    monthlyPrice: 99,
    annualPrice: 79,
    description: 'Invoice parsing, Shopify push, 7-layer auto-tagging. For single-store retailers.',
    features: ['Unlimited invoices', 'Shopify integration', 'AI product extraction', '7-layer auto-tagging', 'GST calculation', 'Email support'],
    cta: 'Start free trial',
    highlighted: false,
  },
  {
    name: 'Import + Rank',
    subtitle: 'Professional',
    monthlyPrice: 249,
    annualPrice: 199,
    description: 'Everything in Import, plus SEO collections, competitor gap analysis, and AI content generation.',
    features: ['Everything in Import', 'SEO collection generation', 'Competitor gap analysis', 'Google Shopping feed fixes', 'Bulk discounts & markdowns', 'Priority support'],
    cta: 'Start free trial',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    subtitle: 'Custom',
    monthlyPrice: null,
    annualPrice: null,
    description: 'Multi-store, agency pricing, and full API access. For retailers with 500+ brands.',
    features: ['Everything in Import + Rank', 'Multi-store management', 'Dedicated account manager', 'Custom integrations', 'Full API access', 'SLA guarantee'],
    cta: 'Contact sales',
    highlighted: false,
  },
];

export default function PricingSection() {
  const [isAnnual, setIsAnnual] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const header = ref.current.querySelector('.pricing-header');
    const cards = ref.current.querySelectorAll('.pricing-card');
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
        stagger: 0.12,
        ease: 'power3.out',
        scrollTrigger: { trigger: ref.current, start: 'top 80%' },
      }
    );
  }, []);

  return (
    <section id="pricing" className="py-[120px] bg-[#0a0a0a]">
      <div ref={ref} className="max-w-[1200px] mx-auto px-6 md:px-12">
        <div className="pricing-header text-center mb-12">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#737373] block mb-4">
            PRICING
          </span>
          <h2 className="font-serif text-[44px] text-[#fafafa] tracking-[-0.03em] leading-[1.1]">
            Simple pricing for every retailer
          </h2>
        </div>

        {/* Toggle */}
        <div className="flex items-center justify-center mb-12">
          <div
            className="relative flex items-center bg-[#262626] rounded-full w-[240px] h-[44px] cursor-pointer"
            onClick={() => setIsAnnual(!isAnnual)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setIsAnnual(!isAnnual); }}
            role="switch"
            aria-checked={isAnnual}
            tabIndex={0}
          >
            <div
              className="absolute left-1 top-1 w-[114px] h-[36px] bg-lime rounded-full transition-transform duration-300 ease-out"
              style={{ transform: isAnnual ? 'translateX(118px)' : 'translateX(0)' }}
            />
            <span
              className={`relative z-10 flex-1 text-center text-sm font-medium transition-colors duration-300 ${
                !isAnnual ? 'text-[#0a0a0a]' : 'text-[#a3a3a3]'
              }`}
            >
              Monthly
            </span>
            <span
              className={`relative z-10 flex-1 text-center text-sm font-medium transition-colors duration-300 flex items-center justify-center gap-1 ${
                isAnnual ? 'text-[#0a0a0a]' : 'text-[#a3a3a3]'
              }`}
            >
              Annual
              <span className="text-[10px] text-lime">Save 20%</span>
            </span>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`pricing-card relative bg-[#171717] rounded-2xl p-8 ${
                plan.highlighted
                  ? 'border-2 border-lime'
                  : 'border border-white/[0.08]'
              }`}
            >
              {plan.highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-lime text-[#0a0a0a] font-mono text-[10px] uppercase tracking-wider px-3 py-1 rounded-full">
                  Most popular
                </span>
              )}

              <div className="mb-4">
                <h3 className="text-sm font-medium text-[#fafafa]">{plan.name}</h3>
                <span className="font-mono text-[11px] text-[#737373] uppercase tracking-wider">{plan.subtitle}</span>
              </div>

              <div className="h-[60px] mb-4 overflow-hidden relative">
                {plan.monthlyPrice !== null ? (
                  <>
                    <div
                      className="absolute inset-0 flex items-baseline gap-1 transition-all duration-300"
                      style={{
                        transform: isAnnual ? 'translateY(-20px)' : 'translateY(0)',
                        opacity: isAnnual ? 0 : 1,
                      }}
                    >
                      <span className="font-serif text-[48px] text-[#fafafa]">${plan.monthlyPrice}</span>
                      <span className="text-sm text-[#737373]">/ month</span>
                    </div>
                    <div
                      className="absolute inset-0 flex items-baseline gap-1 transition-all duration-300"
                      style={{
                        transform: isAnnual ? 'translateY(0)' : 'translateY(20px)',
                        opacity: isAnnual ? 1 : 0,
                      }}
                    >
                      <span className="font-serif text-[48px] text-[#fafafa]">${plan.annualPrice}</span>
                      <span className="text-sm text-[#737373]">/ month</span>
                    </div>
                  </>
                ) : (
                  <span className="font-serif text-[48px] text-[#fafafa]">Custom</span>
                )}
              </div>

              <p className="text-sm text-[#a3a3a3] mb-6">{plan.description}</p>

              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm text-[#a3a3a3]">
                    <Check size={16} className="text-lime flex-shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>

              <a
                href="#"
                className={`block w-full text-center py-3 rounded-lg text-sm font-medium transition-all duration-300 ${
                  plan.highlighted
                    ? 'bg-lime text-[#0a0a0a] hover:brightness-110'
                    : 'border border-white/[0.14] text-[#fafafa] hover:bg-white/[0.06]'
                }`}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
