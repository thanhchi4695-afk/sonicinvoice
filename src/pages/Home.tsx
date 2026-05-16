import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { isShopifyEmbedded } from "@/lib/shopify-embedded";
import Navigation from "@/components/LandingNavigation";
import HeroSection from "@/sections/HeroSection";
import ConnectionMapHero from "@/sections/ConnectionMapHero";
import CompleteFlowSection from "@/sections/CompleteFlowSection";
import GuidedWorkflowsSection from "@/sections/GuidedWorkflowsSection";
import StatBarSection from "@/sections/StatBarSection";
import LogoTrustBar from "@/sections/LogoTrustBar";
import HowItWorksSection from "@/sections/HowItWorksSection";
import DashboardPreviewSection from "@/sections/DashboardPreviewSection";
import FeatureBentoSection from "@/sections/FeatureBentoSection";
import TestimonialsSection from "@/sections/TestimonialsSection";
import PricingSection from "@/sections/PricingSection";
import CTABannerSection from "@/sections/CTABannerSection";
import FooterSection from "@/sections/FooterSection";
import RouteSeo from "@/components/RouteSeo";

export default function Home() {
  const navigate = useNavigate();

  useEffect(() => {
    if (isShopifyEmbedded()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    // Auto-forward already-authed users to the app
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate("/dashboard", { replace: true });
    }).catch(() => {});
  }, [navigate]);

  return (
    <div className="bg-[#0a0a0a] min-h-screen">
      <RouteSeo
        title="Sonic Invoices — Invoice to Shopify in Minutes"
        description="Turn supplier invoices into Shopify products in minutes. AI app for fashion retailers — bulk discounts, Google Shopping feed, SEO, Xero/MYOB sync."
        path="/"
      />
      <Navigation />
      <HeroSection />
      <ConnectionMapHero />
      <CompleteFlowSection />
      <StatBarSection />
      <LogoTrustBar />
      <HowItWorksSection />
      <DashboardPreviewSection />
      <FeatureBentoSection />
      <TestimonialsSection />
      <PricingSection />
      <CTABannerSection />
      <FooterSection />
    </div>
  );
}
