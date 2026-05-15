import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export default function TestimonialsSection() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const card = ref.current.querySelector('.testimonial-card');
    gsap.fromTo(
      card,
      { y: 60, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 1.0,
        ease: 'power3.out',
        scrollTrigger: { trigger: ref.current, start: 'top 80%' },
      }
    );
  }, []);

  return (
    <section className="py-[120px] bg-[#0a0a0a]">
      <div ref={ref} className="max-w-[1000px] mx-auto px-6 md:px-12">
        <div className="testimonial-card bg-[#171717] border border-white/[0.08] rounded-3xl p-8 md:p-12">
          <span className="font-serif text-[72px] leading-[0.5] text-lime/30 block mb-4">&ldquo;</span>
          <blockquote className="font-serif text-[24px] md:text-[28px] italic text-[#fafafa] leading-[1.4] mb-8">
            We used to spend two hours every Monday entering Seafolly and Kulani Kinis invoices manually. Sonic Invoices does it in fifteen minutes. The AI tagging is accurate right out of the box — it already knows all our brands.
          </blockquote>
          <p className="text-sm text-[#737373]">
            — Lisa Richards, Owner, Splash Swimwear Darwin NT
          </p>
        </div>
      </div>
    </section>
  );
}
