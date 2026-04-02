import { useState } from "react";
import GoogleAdsGuide from "@/components/GoogleAdsGuide";
import MetaAdsGuide from "@/components/MetaAdsGuide";
import SEOGuide from "@/components/SEOGuide";

const AdsGuideTabs = () => {
  const [tab, setTab] = useState<"google" | "meta" | "seo">("google");

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-32 space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab("google")}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
            tab === "google"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          📊 Google Ads
        </button>
        <button
          onClick={() => setTab("meta")}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
            tab === "meta"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          📘 Meta Ads
        </button>
        <button
          onClick={() => setTab("seo")}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
            tab === "seo"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          🔍 SEO Guide
        </button>
      </div>

      {tab === "google" && <GoogleAdsGuide />}
      {tab === "meta" && <MetaAdsGuide />}
      {tab === "seo" && <SEOGuide />}
    </div>
  );
};

export default AdsGuideTabs;
