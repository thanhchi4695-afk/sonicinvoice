import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const features = [
  {
    title: 'Invoice to Shopify in Minutes',
    body: 'Upload any supplier invoice and Sonic Invoices uses AI to extract every product, map it to Shopify fields, and produce a Shopify-ready product file. Australian GST is calculated automatically. No reformatting or copy-pasting required.',
    image: '/images/image-1.jpg',
    span: 'col-span-1 md:col-span-2',
  },
  {
    title: 'Connect Your Retail Back Office',
    body: 'Connects to Shopify for direct inventory push, Lightspeed for CSV export, and Xero or MYOB for accounting workflows. Keep product, stock, and invoice data moving without copy-pasting between systems.',
    image: '/images/image-2.jpg',
    span: 'col-span-1',
  },
  {
    title: 'Bulk Discounts & Markdown Ladders',
    body: 'Apply bulk discounts, markups, or exact pricing to any product selection. Put entire Shopify collections on sale or restore original prices with a full audit trail. Automated markdown ladders reduce prices for slow-moving stock on a staged schedule.',
    image: '/images/image-3.jpg',
    span: 'col-span-1',
  },
  {
    title: 'Google Shopping Feed & SEO Automation',
    body: 'Fix Google Merchant Center disapprovals in bulk — missing gender, age_group, and colour attributes pushed directly to Shopify via metafields. Generate AI-optimised collection SEO pages, organic blog posts for topical authority, and product descriptions that rank. Optimise for AI assistants like ChatGPT and Perplexity.',
    image: '/images/image-4.jpg',
    span: 'col-span-1 md:col-span-2',
  },
  {
    title: 'Shopify Stocky Replacement',
    body: 'Purchase orders, demand forecasting, dead stock detection, stocktake management, and AI-powered reorder intelligence in one place. Built to replace Shopify\'s discontinued Stocky app with everything Stocky had and more.',
    image: '/images/image-5.jpg',
    span: 'col-span-1',
  },
  {
    title: '57 Tools for Fashion Retailers',
    body: 'Invoicing, inventory, marketing, SEO, social media automation, accounting integration with Xero and MYOB, competitor intelligence, and more — organised into four tabs so nothing is hard to find.',
    image: '/images/image-6.jpg',
    span: 'col-span-1',
  },
  {
    title: 'Ask Claude About Your Store',
    body: 'Connect Claude AI to your store data via Sonic\'s MCP server. Ask natural language questions — which collections need SEO content, what gaps competitors have that you don\'t, what to focus on this week. Works with Claude, Kimi, and any MCP-compatible AI.',
    image: '/images/image-2.jpg',
    span: 'col-span-1 md:col-span-2',
  },
];

export default function FeatureBentoSection() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const header = ref.current.querySelector('.section-header');
    const cards = ref.current.querySelectorAll('.bento-card');
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
      { y: 30, opacity: 0, scale: 0.98 },
      {
        y: 0,
        opacity: 1,
        scale: 1,
        duration: 0.7,
        stagger: 0.08,
        ease: 'power3.out',
        scrollTrigger: { trigger: ref.current, start: 'top 80%' },
      }
    );
  }, []);

  return (
    <section id="features" className="py-[120px] bg-[#0a0a0a]">
      <div ref={ref} className="max-w-[1200px] mx-auto px-6 md:px-12">
        <div className="section-header text-center mb-16">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-[#737373] block mb-4">
            FEATURES
          </span>
          <h2 className="font-serif text-[44px] text-[#fafafa] tracking-[-0.03em] leading-[1.1] mb-4">
            The complete retail back-office
          </h2>
          <p className="text-[15px] text-[#a3a3a3] max-w-[600px] mx-auto">
            57 tools for independent fashion retailers running Shopify with 10 to 500+ brands.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => (
            <div
              key={feature.title}
              className={`bento-card group bg-[#171717] border border-white/[0.08] rounded-2xl p-8 hover:border-white/[0.14] transition-all duration-300 ${feature.span}`}
            >
              <div className="relative w-full h-[160px] rounded-xl overflow-hidden mb-6">
                <img
                  src={feature.image}
                  alt={feature.title}
                  className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#171717] to-transparent opacity-60" />
              </div>
              <h3 className="text-xl font-medium text-[#fafafa] mb-3">{feature.title}</h3>
              <p className="text-sm text-[#a3a3a3] leading-relaxed">{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
