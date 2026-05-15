import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export default function CTABannerSection() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const children = ref.current.children;
    gsap.fromTo(
      children,
      { y: 30, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.7,
        stagger: 0.2,
        ease: 'power3.out',
        scrollTrigger: { trigger: ref.current, start: 'top 85%' },
      }
    );
  }, []);

  return (
    <section className="py-24 bg-gradient-to-b from-[#171717] to-[#0a0a0a] border-t border-white/[0.08]">
      <div ref={ref} className="max-w-[720px] mx-auto px-6 md:px-12 text-center">
        <h2 className="font-serif text-[40px] text-[#fafafa] tracking-[-0.03em] leading-[1.1]">
          Ready to stop copy-pasting?
        </h2>
        <p className="text-[15px] text-[#a3a3a3] mt-4">
          Built for Australian fashion retail. Knows Seafolly, Kulani Kinis, Baku, Walnut Melbourne, and 184 more.
        </p>
        <a
          href="#pricing"
          className="inline-block bg-lime text-[#0a0a0a] px-8 py-4 rounded-full font-medium text-base mt-8 hover:brightness-110 transition-all duration-300"
        >
          Get started free
        </a>
      </div>
    </section>
  );
}
