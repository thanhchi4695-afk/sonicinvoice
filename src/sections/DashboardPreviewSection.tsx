import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const tableData = [
  { product: 'Seafolly One Piece Navy', sku: 'SEA-OP-NVY-12', price: '$189.00', stock: '24', status: 'Published' },
  { product: 'Kulani Kinis Bikini Top', sku: 'KK-BT-FLR-8', price: '$145.00', stock: '18', status: 'Published' },
  { product: 'Baku Boardshort Navy', sku: 'BK-BS-NVY-S', price: '$95.00', stock: '14', status: 'Published' },
  { product: 'Bond-Eye Rash Guard', sku: 'BE-RG-TEA-10', price: '$95.00', stock: '31', status: 'Pending' },
  { product: 'Seafolly DD-Cup Bikini', sku: 'SEA-BC-DD-WHT', price: '$165.00', stock: '8', status: 'Pending' },
];

export default function DashboardPreviewSection() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const card = ref.current.querySelector('.dashboard-card');
    const tooltip = ref.current.querySelector('.floating-tooltip');
    gsap.fromTo(
      card,
      { scale: 0.95, opacity: 0 },
      {
        scale: 1,
        opacity: 1,
        duration: 1.0,
        ease: 'power2.out',
        scrollTrigger: { trigger: ref.current, start: 'top 75%' },
      }
    );
    if (tooltip) {
      gsap.fromTo(
        tooltip,
        { y: 10, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.6,
          ease: 'power3.out',
          scrollTrigger: { trigger: ref.current, start: 'top 70%' },
        }
      );
    }
  }, []);

  return (
    <section id="integrations" className="py-[120px] bg-[#0a0a0a]">
      <div ref={ref} className="max-w-[1100px] mx-auto px-6 md:px-12">
        <div
          className="dashboard-card relative bg-[#171717] rounded-2xl border border-white/[0.08] overflow-hidden"
        >
          {/* Browser Chrome */}
          <div className="flex items-center gap-2 px-4 py-3 bg-[#171717] border-b border-white/[0.06]">
            <div className="w-3 h-3 rounded-full bg-[#ef4444]" />
            <div className="w-3 h-3 rounded-full bg-[#f59e0b]" />
            <div className="w-3 h-3 rounded-full bg-[#22c55e]" />
            <span className="ml-3 font-mono text-[11px] text-[#737373] bg-[#262626] rounded-full px-4 py-1">
              sonicinvoices.com/dashboard
            </span>
          </div>

          {/* Dashboard Layout */}
          <div className="flex min-h-[400px]">
            {/* Sidebar */}
            <div className="w-[200px] border-r border-white/[0.06] p-4 hidden md:block">
              <div className="flex items-center gap-2 mb-1 px-3 py-2 rounded-lg bg-white/[0.04]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a3e635" strokeWidth="1.5">
                  <path d="M9 17v-2a2 2 0 012-2h2a2 2 0 012 2v2M3 7h18M5 7v10a2 2 0 002 2h10a2 2 0 002-2V7" />
                </svg>
                <span className="text-[13px] text-[#fafafa]">Invoices</span>
              </div>
              {['Products', 'Collections', 'SEO', 'Analytics'].map((item) => (
                <div key={item} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/[0.04] cursor-pointer transition-colors">
                  <div className="w-4 h-4 rounded bg-[#262626]" />
                  <span className="text-[13px] text-[#a3a3a3]">{item}</span>
                </div>
              ))}
            </div>

            {/* Main Content */}
            <div className="flex-1 p-6 overflow-x-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-[#fafafa]">Products</h3>
                <span className="font-mono text-[11px] text-[#737373]">47 products from Seafolly invoice</span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['Product', 'SKU', 'Price', 'Stock', 'Status'].map((h) => (
                      <th key={h} className="text-left py-2 px-3 font-mono text-[10px] uppercase tracking-wider text-[#737373]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, i) => (
                    <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 text-[12px] text-[#a3a3a3] whitespace-nowrap">{row.product}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-[#737373]">{row.sku}</td>
                      <td className="py-2.5 px-3 text-[12px] text-[#a3a3a3]">{row.price}</td>
                      <td className="py-2.5 px-3 text-[12px] text-[#a3a3a3]">{row.stock}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`text-[9px] px-2 py-0.5 rounded-full font-mono ${
                            row.status === 'Published'
                              ? 'bg-lime/20 text-lime'
                              : 'bg-[#f59e0b]/20 text-[#f59e0b]'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Floating Tooltip */}
          <div className="floating-tooltip absolute bottom-6 right-6 font-mono text-[11px] text-lime bg-lime/10 border border-lime/20 rounded-lg px-3 py-2">
            AI matched 47 products from Seafolly invoice
          </div>
        </div>
      </div>
    </section>
  );
}
