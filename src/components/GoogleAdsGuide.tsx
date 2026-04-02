import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, ExternalLink, CheckCircle2, Target, BarChart3, Search, TrendingUp, ShoppingCart, Rocket, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const STORAGE_KEY = "skuPilot_googleAdsProgress";

interface Tip {
  id: string;
  title: string;
  explanation: string;
  whyItMatters: string;
  example?: string;
}

interface Phase {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  tips: Tip[];
}

const phases: Phase[] = [
  {
    id: "phase1",
    title: "Phase 1 — Foundations",
    subtitle: "Before You Spend a Cent",
    icon: <Target className="w-5 h-5" />,
    tips: [
      {
        id: "1.1",
        title: "Fix Your Offer Before Spending Anything",
        explanation: "Google Ads amplify what already works — they cannot fix a weak offer or a product nobody wants to buy. Before running ads, confirm you have: a product people genuinely want, a price they're willing to pay, and healthy enough profit margins to afford customer acquisition.",
        whyItMatters: "If your gross profit margin is below 15–20%, making Google Ads profitable is very hard. Every ad dollar must come back as profit — that's only possible with decent margins. Aim for 40–60%+ gross margin on advertised products.",
      },
      {
        id: "1.2",
        title: "Define Your Ideal Customer Before Targeting Anyone",
        explanation: "Your best results come from focusing on your most valuable customers — the ones who spend the most, buy repeatedly, refer friends, and leave great reviews. Write down 1–3 sentences describing this person: who they are, what problem they have, and why they choose you over competitors.",
        whyItMatters: "Google Ads lets you spend money precisely. If you're vague about who you're targeting, you'll waste budget on people who will never buy. Specificity = efficiency.",
      },
      {
        id: "1.3",
        title: "Start with 1–3 Products, Not Your Entire Catalogue",
        explanation: "When you first start Google Ads, focus only on your best-selling or most profitable products — not everything in your store. Running fewer campaigns gives Google more data to optimise with, and gives you a faster path to seeing what works.",
        whyItMatters: "Spreading budget thin across 50 products means each product gets too few clicks to learn from. Concentrate spend on your winners first, then expand once profitability is proven.",
      },
      {
        id: "1.4",
        title: "Make Sure Your Website Is Ready to Convert",
        explanation: "Your ad gets the click. Your website earns the sale. Before spending any money, check these four things on your product page: Does it load in under 3 seconds on mobile? Is the product photography professional and clear? Are customer reviews and trust signals visible above the fold? Is the Add to Cart button prominent and easy to tap on mobile?",
        whyItMatters: "Ben Heath has documented 30%+ conversion lifts simply from aligning the ad headline with the landing page. A bad landing page wastes 100% of your ad spend — the traffic arrives but doesn't buy.",
      },
    ],
  },
  {
    id: "phase2",
    title: "Phase 2 — Account & Tracking",
    subtitle: "Set Up Properly Once, Never Regret It",
    icon: <BarChart3 className="w-5 h-5" />,
    tips: [
      {
        id: "2.1",
        title: "Create Your Google Ads Account the Right Way",
        explanation: "Go to ads.google.com. When prompted to create a campaign, choose 'Create an account without a campaign' — this skips the quick-setup wizard so you can configure everything properly. Set billing country, timezone, and currency to match your business. Add at least two payment methods to avoid account suspension if one payment fails.",
        whyItMatters: "Skipping the guided setup prevents Google from auto-creating a poorly configured campaign that wastes your first week of budget.",
      },
      {
        id: "2.2",
        title: "Set Up Conversion Tracking BEFORE Your First Campaign",
        explanation: "Conversion tracking tells Google what a 'success' looks like — in your case, a product purchase. Without it, Google optimises for cheap clicks instead of actual sales. Steps: In Google Ads go to Goals → Conversions → New Conversion Action. Choose 'Website', set category to 'Purchase'. Use Google Tag Manager to install the tracking tag on your order confirmation page. Test by making a test purchase — status should show 'Recording'.",
        whyItMatters: "This is the single most important technical step. Every smart bidding strategy requires accurate conversion data. Ben Heath showed a real example where Google reported 3 conversions but the actual number was 6. Without accurate tracking, you may turn off profitable campaigns by mistake.",
      },
      {
        id: "2.3",
        title: "Link Google Merchant Center to Your Google Ads Account",
        explanation: "For retail stores selling physical products, Google Merchant Center is where your product data lives (titles, prices, images, stock levels). It must be linked to Google Ads before you can run Shopping ads. In Merchant Center: go to Settings → Linked accounts → Google Ads → enter your Google Ads Customer ID.",
        whyItMatters: "Shopping ads (product image + price + star rating at the top of Google results) are the highest-converting ad format for retail. You cannot run them without Merchant Center linked. Set this up on Day 1.",
      },
      {
        id: "2.4",
        title: "Set Up Both Browser-Side AND Server-Side Tracking",
        explanation: "Standard browser tracking misses conversions due to privacy settings, ad blockers, and iOS updates. To capture the full picture, also send conversion data from your server back to Google. For Shopify stores, use a tool like Elevar to set this up easily.",
        whyItMatters: "Ben Heath showed a live example: Google reported 3 conversions, but server-side tracking showed 6. Running on half your data could cause you to pause profitable campaigns and waste weeks of opportunity.",
      },
    ],
  },
  {
    id: "phase3",
    title: "Phase 3 — Search Campaigns",
    subtitle: "Start with Search — Highest Intent, Simplest to Control",
    icon: <Search className="w-5 h-5" />,
    tips: [
      {
        id: "3.1",
        title: "Start with a Search Campaign (Not Performance Max)",
        explanation: "A Search campaign shows text ads when someone searches for your product on Google. It's the simplest campaign type and produces the highest-intent traffic. Start here before trying Performance Max, Shopping, or YouTube ads.",
        whyItMatters: "Search ads are your testing ground. Get consistent conversions here first, then expand to other formats.",
      },
      {
        id: "3.2",
        title: "Choose the Right Campaign Objective: Sales",
        explanation: "When creating your Search campaign, select 'Sales' as your objective — not Website Traffic or Brand Awareness. This tells Google's AI you want purchases, and it targets accordingly.",
        whyItMatters: "If you select 'Website Traffic', Google finds people who click cheaply but rarely buy. Always optimise for the outcome you actually want.",
      },
      {
        id: "3.3",
        title: "Turn Off the Display Network",
        explanation: "Google automatically includes the Display Network (banner ads on websites) in Search campaigns. Turn this OFF. In campaign settings → Networks: uncheck 'Display Network', leave 'Search Network' checked.",
        whyItMatters: "Display traffic is cheap for a reason — it converts poorly. Keep your Search budget for high-intent searchers only.",
      },
      {
        id: "3.4",
        title: "Target Locations Where Your Customers Actually Are",
        explanation: "Only target locations where you can ship to or serve customers. Set location targeting to 'Presence' (not 'Presence or interest') so ads only show to people physically in your target area. For international retail: create separate campaigns per country.",
        whyItMatters: "The 'Presence or interest' default setting shows your ads to people researching your area but not living there — wasted spend for most retailers.",
      },
      {
        id: "3.5",
        title: "Build a Focused Keyword List (5–10 Per Ad Group)",
        explanation: "Create one ad group per product category (e.g., 'Women's Rashguards', 'Kids' Wetsuits'). Add 5–10 highly specific keywords per ad group using Phrase Match (\"quotes\") and Exact Match ([brackets]). Avoid Broad Match when starting out — it triggers irrelevant searches.",
        whyItMatters: "Broad Match keywords can show your ad to someone searching for 'free swimwear' or 'secondhand rashguard'. Phrase and Exact Match keeps your spend on qualified buyers.",
        example: "For a swimwear retailer: \"women's rashguard Australia\", [rashguard long sleeve], \"buy rashguard online\", [UPF swimwear women]",
      },
      {
        id: "3.6",
        title: "Build Your Negative Keyword List BEFORE Launch",
        explanation: "Negative keywords prevent ads from showing for searches that will never convert. Add these immediately for any retail store: free, cheap, cheapest, DIY, wholesale, used, secondhand, jobs, salary. Use Google Keyword Planner to find related terms you don't sell — your negative list will often be longer than your keyword list.",
        whyItMatters: "Without negatives, 30–50% of your budget can go to people who will never become customers. This is the highest-return 30 minutes you can spend before launching.",
      },
      {
        id: "3.7",
        title: "Write Your Responsive Search Ad the Right Way",
        explanation: "A Responsive Search Ad has up to 15 headlines (30 chars each) and 4 descriptions (90 chars each). Google tests combinations to find the best performers. Include your keyword in 2–3 headlines. Pin the most important headline to Position 1.",
        whyItMatters: "Poorly written RSAs with generic headlines produce low click-through rates and high costs. Specific, benefit-driven headlines outperform generic ones 2–3x.",
        example: "Benefit headlines: 'Free AU Shipping', 'Over 500 Reviews', 'UPF 50+ Sun Protection'. Description CTAs: 'Shop the Full Range Now', 'Free Returns on All Orders'.",
      },
      {
        id: "3.8",
        title: "Add Extensions (Assets) to Make Your Ad Bigger",
        explanation: "Extensions add extra information to your ad at no extra cost, making it appear larger on search results pages. Add at minimum: Sitelinks (4+) to category pages, Callouts like 'Free AU Shipping Over $75', and Structured Snippets e.g. 'Types: Rashguards, Wetsuits, Swim Shorts'.",
        whyItMatters: "Ads with extensions take up more screen space, pushing competitors further down the page — more clicks at no extra CPC.",
      },
      {
        id: "3.9",
        title: "Set a Budget You Can Afford to Lose",
        explanation: "Start with a daily budget you could lose entirely without financial hardship. For most retailers: $20–$50/day ($600–$1,500/month) is enough to gather real data. Ignore Google's budget recommendations — they almost always suggest more than you need.",
        whyItMatters: "You will not be profitable immediately. The first 2–4 weeks are data-gathering. Plan to run at a loss while you learn what works, then optimise toward profit.",
      },
      {
        id: "3.10",
        title: "Start with 'Maximise Conversions' Bidding",
        explanation: "Under Bidding, select 'Maximise Conversions'. This tells Google to get as many purchases as possible within your budget. Do NOT start with Target ROAS or Target CPA — these require 30–50 conversions of historical data to work properly.",
        whyItMatters: "Choosing the wrong bidding strategy early is one of the most common reasons new campaigns fail to gain traction. Maximise Conversions works immediately. Target ROAS only works after you have enough data.",
      },
    ],
  },
  {
    id: "phase4",
    title: "Phase 4 — Weekly Optimisation",
    subtitle: "Weeks 2–8: Review Weekly, Improve Consistently",
    icon: <TrendingUp className="w-5 h-5" />,
    tips: [
      {
        id: "4.1",
        title: "Review Your Search Terms Report Every Week",
        explanation: "Go to Insights & Reports → Search Terms. This shows every actual search query that triggered your ad — including ones you never intended. Review weekly and add irrelevant searches as negative keywords. Sort by 'Cost' to find the most expensive irrelevant searches first.",
        whyItMatters: "This is the single most important weekly task. Ben Heath's agency does this routinely for all clients. Regular negative keyword additions directly improve ROAS — often dramatically within the first 30 days.",
        example: "Frequency: Weekly for the first 3 months, then fortnightly as campaigns mature.",
      },
      {
        id: "4.2",
        title: "Focus on One North Star Metric: ROAS",
        explanation: "ROAS (Return on Ad Spend) = Revenue from ads ÷ Ad spend. If you spend $500 and generate $2,000 in sales, your ROAS is 4x (400%). This single number tells you if your ads are working. Ignore click-through rate, impressions, and ad position.",
        whyItMatters: "Whether a ROAS is profitable depends on your gross margin. At 50% gross margin, you need at least a 2x ROAS to break even. At 60% gross margin, break-even is ~1.7x. Know your margin, know your minimum ROAS target.",
      },
      {
        id: "4.3",
        title: "Pause Keywords That Spend But Never Convert",
        explanation: "After 2–4 weeks of data, review each keyword. If a keyword has spent more than 3x your average order value (e.g., $300 on a $100 AOV product) and generated zero conversions — pause it. Replace with more specific keyword variations.",
        whyItMatters: "Dead keywords quietly drain your budget every day. Regular pruning is what separates profitable campaigns from unprofitable ones.",
      },
      {
        id: "4.4",
        title: "Test Ad Headlines and Descriptions Systematically",
        explanation: "After 2–3 weeks, check the Asset Performance report (Ads → Assets). Headlines rated 'Best' are working — add similar ones. Headlines rated 'Low' can be replaced.",
        whyItMatters: "Continuous testing of ad copy is how campaigns improve over time. A single better-performing headline can lift CTR by 20–30%.",
        example: "Try these angles: Price-focused ('From $39.95 — Free Shipping'), Benefit-focused ('UPF 50+ All-Day Sun Protection'), Social proof ('4.9 Stars — 500+ Happy Customers'), Seasonal ('New Summer Styles Just Arrived').",
      },
      {
        id: "4.5",
        title: "Improve Your Landing Page Continuously",
        explanation: "Send traffic to the specific product or category page that matches your ad — never to your homepage. The headline of the landing page should match the headline of the ad exactly. Test adding: customer reviews above the fold, trust badges, size guides, and a sticky 'Add to Cart' button on mobile.",
        whyItMatters: "A 10% improvement in your landing page conversion rate doubles the efficiency of your entire ad spend. This is the highest-leverage optimisation available — and it costs nothing beyond your time.",
      },
      {
        id: "4.6",
        title: "Add Target ROAS Only After 50+ Conversions",
        explanation: "Once your campaign has 50+ conversions, switch bidding from 'Maximise Conversions' to 'Target ROAS'. Set your target at approximately what you've naturally been achieving (e.g., if getting 3.5x, set target ROAS at 300–320%). Start conservatively and tighten over time.",
        whyItMatters: "Switching to Target ROAS too early (under 30 conversions) puts your campaign in an extended learning phase and performance drops. Patience here saves weeks of wasted spend.",
      },
    ],
  },
  {
    id: "phase5",
    title: "Phase 5 — Shopping & Performance Max",
    subtitle: "Scale from Search into Shopping and Performance Max",
    icon: <ShoppingCart className="w-5 h-5" />,
    tips: [
      {
        id: "5.1",
        title: "Add Standard Shopping After Search Is Profitable",
        explanation: "Shopping ads show your product image, title, price, and store name — they appear above text results. Set up: New Campaign → Sales → Shopping → select Merchant Center → choose Standard Shopping. Start with Manual CPC or Maximise Clicks. Budget: at least 10x your average product CPC per day.",
        whyItMatters: "Shopping ads are the highest-converting format for retail because the buyer can see the product, price, and ratings before clicking. A click on a Shopping ad has far higher purchase intent than a text ad click.",
      },
      {
        id: "5.2",
        title: "Organise Shopping Ad Groups by Product Category",
        explanation: "Create one ad group per product category (e.g., 'Rashguards', 'Wetsuits', 'Swim Shorts'). Add products to each ad group using product filters. CRITICAL: exclude other products from each ad group to prevent overlap.",
        whyItMatters: "Ad group structure lets you set different bids per category based on margin and conversion rate. Your most profitable product categories get higher bids. Overlap causes wasted spend.",
      },
      {
        id: "5.3",
        title: "Optimise Your Product Titles — They Are Your Keywords",
        explanation: "In Shopping campaigns, Google decides what searches to show your products for based primarily on your product title. A poorly written title = showing for the wrong searches. Format: [Brand] + [Product Type] + [Key Feature] + [Material] + [Colour/Size].",
        whyItMatters: "Your product title in Merchant Center IS your keyword strategy for Shopping. Invest time rewriting titles before launching — it's more important than bid adjustments.",
        example: "GOOD: 'Seafolly Women's Rashguard Long Sleeve UPF 50+ Navy'. BAD: 'Rashguard-001-NVY'.",
      },
      {
        id: "5.4",
        title: "Add Performance Max AFTER Shopping Is Working",
        explanation: "Performance Max (PMax) shows ads across Search, Shopping, YouTube, Gmail, and Display from one campaign. It requires more setup, more budget, and more creative assets. Only add PMax after Shopping is consistently profitable. Needs: Quality images (4+ landscape + 4+ square), at least 1 real video, customer email list, $50–100/day minimum budget.",
        whyItMatters: "PMax is more scalable than any other campaign type because it reaches people across all of Google. But it fails without quality creative and accurate conversion data.",
      },
      {
        id: "5.5",
        title: "Use Micro-Influencer Creative for Performance Max",
        explanation: "The biggest differentiator in Performance Max is your creative. Ben Heath strongly recommends using micro-influencers instead of product-only images. Find influencers with 10,000–100,000 followers who do brand partnerships. Typical cost: $200–$800 per video.",
        whyItMatters: "Google's AI optimises for whatever creative converts best. Real people holding and wearing your products builds trust faster than studio photography alone. Ben says this produces 'night-and-day ROAS improvements'.",
      },
      {
        id: "5.6",
        title: "Set Up Audience Signals in Performance Max",
        explanation: "Audience Signals guide Google's AI toward your ideal customer faster. Add in this order: 1) Customer email list (export from Shopify), 2) Website visitors — all pages, 540-day window, 3) Cart abandoners, 4) Custom search intent: add 10–20 phrases your ideal customer searches for.",
        whyItMatters: "Audience Signals dramatically shorten the learning phase. Without them, PMax learns slowly at your expense.",
      },
    ],
  },
  {
    id: "phase6",
    title: "Phase 6 — Scaling",
    subtitle: "Scale Slowly and Deliberately",
    icon: <Rocket className="w-5 h-5" />,
    tips: [
      {
        id: "6.1",
        title: "The Golden Rule: Maximum 20% Budget Increase at a Time",
        explanation: "When a campaign is working and you want to spend more, increase the daily budget by a maximum of 20%. Then wait at least 7 days before increasing again. This keeps the campaign in a stable learning state.",
        whyItMatters: "Google's AI uses machine learning to optimise. Large sudden budget increases trigger a new 'learning phase' where performance temporarily drops — sometimes dramatically.",
        example: "Example: $50/day → $60/day (wait 7 days) → $72/day → $86/day → $103/day",
      },
      {
        id: "6.2",
        title: "Build a Branded Search Campaign to Protect Your Name",
        explanation: "Once your brand is getting known, competitors can bid on your brand name and steal your customers. A Branded Search campaign targets searches for your exact brand name. Set it up as a separate campaign with a modest daily budget ($10–20/day).",
        whyItMatters: "Branded search campaigns typically have the highest ROAS of any campaign type (often 10–20x+) because the searcher already knows and wants you. They also block competitors from intercepting your most valuable traffic.",
      },
      {
        id: "6.3",
        title: "Separate New Customer vs Remarketing Campaigns",
        explanation: "As you scale, split ad spend into two buckets: 1) New customer acquisition campaigns — targeting people who've never bought from you (lower ROAS but builds growth). 2) Remarketing campaigns — targeting past visitors and cart abandoners (higher ROAS but no new customers). In PMax: enable 'Customer Acquisition' bidding.",
        whyItMatters: "Remarketing alone is not growth. You must continuously acquire new customers to scale your business. If all your ROAS comes from remarketing, your business is not growing.",
      },
      {
        id: "6.4",
        title: "Identify and Bid Higher for Your High-Value Customers",
        explanation: "Not all customers are equal. Your top 10–15% likely spend 3–5x more and return more often. Export your customer list from Shopify, segment by lifetime value, upload the high-value segment to Google Ads as a Customer Match audience, then use 'Customer acquisition' bidding.",
        whyItMatters: "If you know a customer is worth $800 lifetime versus $80, you can afford to pay 10x more to acquire them. This is one of the highest-leverage optimisations in Google Ads.",
      },
      {
        id: "6.5",
        title: "Test Like a Scientist, Not a Gambler",
        explanation: "Most campaigns will not work immediately — that's completely normal. The strategy: test small ($300–$500 per campaign), cut losers quickly, and scale winners aggressively. Most experiments fail. One winner can cover all losses many times over.",
        whyItMatters: "Ben Heath's agency example: after 10 failed $500 campaigns ($5,000 total loss), the 11th campaign generated a 5x ROAS. Scaled to $100,000 spend at 4x ROAS = $400,000 revenue.",
      },
      {
        id: "6.6",
        title: "Never Stop Testing Ad Copy and Creative",
        explanation: "Even when campaigns perform well, refresh your ad creative every 6–8 weeks. Try different angles: seasonal offer, new product benefit, customer testimonial, competitor comparison, price hook. Always run at least one 'safe' proven ad and one 'test' new ad simultaneously.",
        whyItMatters: "Ben Heath says a campaign with 2x ROAS can reach 5–6x ROAS over months of consistent creative testing. Stale creative is one of the top reasons a profitable campaign slowly declines.",
      },
    ],
  },
];

const bonusMistakes: Tip[] = [
  { id: "b.1", title: "Running ads without conversion tracking", explanation: "Google cannot optimise for sales it doesn't know about. You'll waste your entire budget optimising for clicks.", whyItMatters: "This is mistake #1 for a reason — every other optimisation depends on accurate data." },
  { id: "b.2", title: "Using Broad Match keywords without understanding search terms", explanation: "Broad Match without a robust negative keyword list is the fastest way to burn budget on irrelevant traffic.", whyItMatters: "Your ads could be showing for 'free swimwear' or 'DIY rashguard patterns' without you knowing." },
  { id: "b.3", title: "Sending traffic to your homepage instead of product pages", explanation: "A shopper who clicked an ad for 'rashguards' doesn't want to land on your full homepage and search again.", whyItMatters: "Every extra click between the ad and the product is a drop-off point. Direct landing = higher conversion." },
  { id: "b.4", title: "Setting Target ROAS too high, too early", explanation: "Set before 50 conversions, an unrealistic ROAS target prevents Google from spending your budget at all.", whyItMatters: "Your campaign sits idle while competitors take all the traffic. Start with Maximise Conversions first." },
  { id: "b.5", title: "Pausing campaigns after 3–7 days because 'they're not working'", explanation: "Google's learning phase takes 2–4 weeks. Campaigns interrupted during learning never reach their potential.", whyItMatters: "The learning phase is an investment. Pulling out early means you paid for data you'll never use." },
  { id: "b.6", title: "Increasing budget by more than 20% at once", explanation: "Large budget jumps reset the learning phase. Patience and incremental increases produce better long-term results.", whyItMatters: "A 100% budget increase can tank a profitable campaign overnight. Always scale gradually." },
  { id: "b.7", title: "Ignoring the Search Terms report", explanation: "Without weekly negative keyword additions, budget continues flowing to irrelevant searches indefinitely.", whyItMatters: "30–50% of your budget could be going to searches that will never convert — and you'd never know." },
  { id: "b.8", title: "Using poor quality images in Performance Max", explanation: "Google's AI needs excellent creative to find the best placements. Low-quality images produce low-quality results.", whyItMatters: "PMax with bad creative = expensive brand damage. Invest in quality imagery before launching." },
  { id: "b.9", title: "Advertising your entire product catalogue from day one", explanation: "Too little data per product = no optimisation. Focus on your top 3 products first, then expand.", whyItMatters: "Concentration beats diversification in early-stage ads. Winners fund expansion." },
  { id: "b.10", title: "Treating Google Ads as set-and-forget", explanation: "Unlike some forms of marketing, Google Ads requires weekly attention: negatives, bids, creative, landing pages.", whyItMatters: "Unattended campaigns degrade over time as competitors optimise and market conditions change." },
];

const GoogleAdsGuide = () => {
  const [completed, setCompleted] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch { return {}; }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
  }, [completed]);

  const allTipIds = useMemo(() => {
    const ids: string[] = [];
    phases.forEach(p => p.tips.forEach(t => ids.push(t.id)));
    bonusMistakes.forEach(t => ids.push(t.id));
    return ids;
  }, []);

  const totalTips = allTipIds.length;
  const completedCount = allTipIds.filter(id => completed[id]).length;
  const progressPct = totalTips > 0 ? Math.round((completedCount / totalTips) * 100) : 0;

  const toggle = (id: string) => {
    setCompleted(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const renderTip = (tip: Tip) => (
    <Card key={tip.id} className="border-border/50 bg-card/60">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Checkbox
            checked={!!completed[tip.id]}
            onCheckedChange={() => toggle(tip.id)}
            className="mt-1 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h4 className={`text-sm font-semibold ${completed[tip.id] ? "line-through text-muted-foreground" : "text-foreground"}`}>
              {tip.id}. {tip.title}
            </h4>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{tip.explanation}</p>
            {tip.example && (
              <div className="mt-2 rounded-md bg-muted/50 border border-border/50 p-2.5">
                <p className="text-xs text-muted-foreground font-mono leading-relaxed">{tip.example}</p>
              </div>
            )}
            <div className="mt-2.5 rounded-md bg-primary/5 border border-primary/20 p-2.5">
              <p className="text-xs font-medium text-primary mb-0.5">Why it matters</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{tip.whyItMatters}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const getPhaseProgress = (phase: Phase) => {
    const done = phase.tips.filter(t => completed[t.id]).length;
    return { done, total: phase.tips.length };
  };

  return (
    <div className="space-y-6">
      {/* Overall progress */}
      <Card className="border-primary/30">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Overall progress</span>
            </div>
            <span className="text-sm font-bold text-primary">{completedCount}/{totalTips} tips</span>
          </div>
          <Progress value={progressPct} className="h-2.5" />
          <p className="text-xs text-muted-foreground text-right">{progressPct}% complete</p>
        </CardContent>
      </Card>

      {/* Action buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Button variant="outline" size="sm" className="w-full text-xs" asChild>
          <a href="https://ads.google.com" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Google Ads
          </a>
        </Button>
        <Button variant="outline" size="sm" className="w-full text-xs" asChild>
          <a href="https://merchants.google.com" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Merchant Center
          </a>
        </Button>
        <Button variant="outline" size="sm" className="w-full text-xs" asChild>
          <a href="https://tagmanager.google.com" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Tag Manager
          </a>
        </Button>
      </div>

      {/* Phases */}
      <Accordion type="multiple" className="space-y-2">
        {phases.map(phase => {
          const { done, total } = getPhaseProgress(phase);
          return (
            <AccordionItem key={phase.id} value={phase.id} className="border border-border/50 rounded-lg overflow-hidden bg-card/30">
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <div className="flex items-center gap-3 text-left flex-1">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    {phase.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{phase.title}</p>
                    <p className="text-xs text-muted-foreground">{phase.subtitle}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${done === total ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {done}/{total}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="space-y-3">
                  {phase.tips.map(renderTip)}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}

        {/* Bonus section */}
        <AccordionItem value="bonus" className="border border-amber-500/30 rounded-lg overflow-hidden bg-card/30">
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-3 text-left flex-1">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Bonus — 10 Expensive Mistakes to Avoid</p>
                <p className="text-xs text-muted-foreground">The Costly Lessons — Learn Them for Free</p>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${bonusMistakes.every(t => completed[t.id]) ? "bg-amber-500/20 text-amber-500" : "bg-muted text-muted-foreground"}`}>
                {bonusMistakes.filter(t => completed[t.id]).length}/{bonusMistakes.length}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <div className="space-y-3">
              {bonusMistakes.map(renderTip)}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Attribution */}
      <p className="text-[10px] text-muted-foreground/60 text-center pt-4">
        Strategies sourced from Ben Heath's YouTube channel (@BenHeathGoogleAds). Ben runs Heath Media, a Google Ads agency that has spent $300M+ on ad campaigns generating $1.2B+ in revenue.
      </p>
    </div>
  );
};

export default GoogleAdsGuide;
