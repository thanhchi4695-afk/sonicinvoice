import Navigation from "@/components/LandingNavigation";
import HeroSection from "@/sections/HeroSection";
import StatBarSection from "@/sections/StatBarSection";
import FeatureBentoSection from "@/sections/FeatureBentoSection";
import TestimonialsSection from "@/sections/TestimonialsSection";
import CTABannerSection from "@/sections/CTABannerSection";
import RouteSeo from "@/components/RouteSeo";

export default function Demo() {
  return (
    <div className="bg-[#0a0a0a] min-h-screen">
      <RouteSeo
        title="Sonic Invoices Demo — See it in action"
        description="A short pitch tour of Sonic Invoices: invoice → Shopify product in minutes."
        path="/demo"
        noindex
      />
      <Navigation />
      <HeroSection />
      <StatBarSection />
      <FeatureBentoSection />
      <TestimonialsSection />
      <CTABannerSection />
    </div>
  );
}
