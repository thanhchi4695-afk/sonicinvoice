import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const stats = [
  { value: '187', label: 'brands learned' },
  { value: '3,858', label: 'products processed' },
  { value: '87%', label: 'time saved' },
];

export default function StatBarSection() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const items = ref.current.querySelectorAll('.stat-item');
    gsap.fromTo(
      items,
      { y: 30, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.7,
        stagger: 0.15,
        ease: 'power3.out',
        scrollTrigger: { trigger: ref.current, start: 'top 85%' },
      }
    );
  }, []);

  return (
    <section className="py-16 bg-[#0a0a0a] border-b border-white/[0.06]">
      <div ref={ref} className="max-w-[1200px] mx-auto px-6 md:px-12">
        <div className="grid grid-cols-3 gap-8 text-center">
          {stats.map((stat) => (
            <div key={stat.label} className="stat-item">
              <span className="font-serif text-[36px] md:text-[48px] text-[#fafafa] tracking-[-0.03em]">
                {stat.value}
              </span>
              <span className="block font-mono text-[11px] uppercase tracking-[0.1em] text-[#737373] mt-1">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
