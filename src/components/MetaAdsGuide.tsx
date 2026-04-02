import { useState, useEffect, useMemo } from "react";
import { ExternalLink, CheckCircle2, Target, BarChart3, Paintbrush, TrendingUp, ShoppingCart, Rocket, Layers, AlertTriangle, Users } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const STORAGE_KEY = "skuPilot_metaAdsProgress";
const INTRO_KEY = "skuPilot_metaAdsIntroSeen";

interface Tip {
  id: string;
  title: string;
  explanation: string;
  whyItMatters: string;
  retailExample?: string;
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
    id: "m-phase1",
    title: "Phase 1 — Account Foundations",
    subtitle: "Set Up Meta Ads the Right Way From Day One",
    icon: <Target className="w-5 h-5" />,
    tips: [
      {
        id: "m1.1",
        title: "Use Meta Business Suite — Not a Boosted Post",
        explanation: "Never boost posts from Instagram or Facebook. Always create campaigns through Meta Ads Manager (business.facebook.com). Boosting limits your targeting, bidding, and optimisation options severely.",
        whyItMatters: "Boosted posts optimise for engagement (likes, comments) not purchases. You'll spend $500 and get 200 likes but zero sales.",
        retailExample: "A Darwin boutique boosted a post for $200 and got 150 likes. The same $200 in Ads Manager with purchase optimisation generated 4 sales at $50 each.",
      },
      {
        id: "m1.2",
        title: "Install the Meta Pixel + Conversions API",
        explanation: "The Meta Pixel tracks website visitors from your ads. The Conversions API (CAPI) sends the same data server-side, catching events the pixel misses due to iOS privacy and ad blockers. For Shopify: enable both in Settings → Customer Events → Meta.",
        whyItMatters: "Without CAPI, Meta may only see 40–60% of your actual conversions. Its AI optimises on incomplete data, targeting the wrong people and inflating your cost per purchase.",
        retailExample: "After enabling CAPI, a retailer saw reported conversions jump from 8/week to 14/week — Meta's AI immediately improved targeting because it finally had full data.",
      },
      {
        id: "m1.3",
        title: "Verify Your Domain in Meta Business Settings",
        explanation: "Go to Business Settings → Brand Safety → Domains → Add your domain. Follow the DNS or meta tag verification. This unlocks conversion event priority settings and prevents others from editing your pixel events.",
        whyItMatters: "Unverified domains are limited to 8 conversion events and cannot prioritise them. Verification is required for full tracking after iOS 14.5 changes.",
      },
      {
        id: "m1.4",
        title: "Set Up Your Conversion Events Correctly",
        explanation: "In Events Manager, configure your pixel events in priority order: 1) Purchase (highest), 2) Add to Cart, 3) Initiate Checkout, 4) View Content. Always optimise campaigns for Purchase — never for Add to Cart or View Content.",
        whyItMatters: "Ben Heath emphasises: optimise for the event you actually want. Meta will find people who add to cart but never buy if that's what you tell it to optimise for.",
        retailExample: "Switching from 'Add to Cart' to 'Purchase' optimisation increased ROAS from 1.8x to 3.4x for a clothing brand — fewer but higher-quality conversions.",
      },
    ],
  },
  {
    id: "m-phase2",
    title: "Phase 2 — Campaign Structure",
    subtitle: "One Ad Set, Not Many — Let Meta's AI Work",
    icon: <Layers className="w-5 h-5" />,
    tips: [
      {
        id: "m2.1",
        title: "Use ONE Ad Set Per Campaign — Consolidate Data",
        explanation: "The biggest shift in Meta Ads for 2025–2026: stop splitting audiences into multiple ad sets. Use one campaign with one ad set containing all your ads. This gives Meta's AI the maximum data to optimise with. Multiple ad sets split your budget and create audience overlap.",
        whyItMatters: "Ben Heath calls this the #1 structural change. Meta's AI needs 50+ conversions per week per ad set to exit the learning phase. Splitting into 5 ad sets means each needs 50 — that's 250 conversions/week instead of 50.",
        retailExample: "A shoe retailer running 6 ad sets at $30/day each consolidated to 1 ad set at $180/day. Cost per purchase dropped 35% within 2 weeks.",
      },
      {
        id: "m2.2",
        title: "Use Advantage+ Audience — Stop Manual Targeting",
        explanation: "Replace all interest-based and lookalike targeting with Advantage+ Audience. This lets Meta's AI find your buyers using its own signals — browsing behaviour, purchase history, and engagement patterns. You can add 'audience suggestions' as hints but Meta will go beyond them.",
        whyItMatters: "Manual interest targeting limits Meta to a small pool. Advantage+ Audience accesses Meta's full user graph — billions of signals you can't target manually. Ben Heath says this consistently outperforms manual targeting in 2025.",
        retailExample: "Removing all interest targeting and switching to Advantage+ Audience increased a fashion brand's reach by 3x while maintaining the same ROAS.",
      },
      {
        id: "m2.3",
        title: "Choose the Right Campaign Objective: Sales",
        explanation: "Always select 'Sales' as your campaign objective. Not traffic, not engagement, not leads. Sales. Then select 'Website' as the conversion location and 'Purchase' as the conversion event.",
        whyItMatters: "Every other objective tells Meta to find people who click, watch, or engage — not people who buy. The objective determines WHO sees your ad. Choose wrong and you reach the wrong audience entirely.",
      },
      {
        id: "m2.4",
        title: "Set Campaign Budget at the Campaign Level (CBO)",
        explanation: "Use Campaign Budget Optimisation (CBO) — set your daily budget at the campaign level, not the ad set level. This lets Meta shift budget to whichever ads are performing best automatically.",
        whyItMatters: "CBO combined with one ad set gives Meta full control to allocate budget to winning ads in real-time. Manual budget allocation means you're guessing — Meta's AI is better at this than you.",
        retailExample: "Start with $30–50/day minimum. Meta needs at least $30/day to generate enough data for its algorithm to learn effectively.",
      },
    ],
  },
  {
    id: "m-phase3",
    title: "Phase 3 — Creative That Converts",
    subtitle: "UGC and Hooks — Not Studio Photography",
    icon: <Paintbrush className="w-5 h-5" />,
    tips: [
      {
        id: "m3.1",
        title: "UGC Outperforms Studio Photography — Always",
        explanation: "User-Generated Content (UGC) — real people using your products on camera — outperforms polished studio photography on Meta in almost every test. Hire micro-influencers (1K–50K followers) to create short videos wearing/using your products. Typical cost: $100–$500 per video.",
        whyItMatters: "Ben Heath says UGC is the single biggest creative lever for Meta Ads. People scroll past ads that look like ads. UGC looks like organic content, stops the scroll, and builds trust instantly.",
        retailExample: "A swimwear brand replaced all studio product shots with UGC videos. Cost per purchase dropped from $38 to $19 — a 50% improvement.",
      },
      {
        id: "m3.2",
        title: "The Hook Is Everything — First 3 Seconds Decide",
        explanation: "The first 3 seconds of your video ad determine whether someone watches or scrolls past. Create multiple hook variations for each ad: different opening lines, different visual openers, different text overlays. Test 3–5 hooks per winning ad concept.",
        whyItMatters: "Instead of creating entirely new ads when performance drops, create new hooks for proven ads. This is 10x faster and cheaper than producing new content, and often revives 'dead' ads.",
        retailExample: "Hook examples: 'POV: You just found the perfect summer dress in Darwin' / 'I wore this to brunch and got 5 compliments' / 'The dress that sells out every restock'",
      },
      {
        id: "m3.3",
        title: "Use All Placements — Let Meta Optimise Delivery",
        explanation: "Don't restrict placements to just Instagram Feed or Facebook Feed. Select 'Advantage+ Placements' to let Meta show your ad on Feed, Stories, Reels, Explore, Messenger, and Audience Network. Meta's AI knows where each user is most likely to convert.",
        whyItMatters: "Restricting placements raises your CPM (cost per 1000 impressions) because you're competing in a smaller auction pool. Advantage+ Placements consistently lowers CPM by 20–40%.",
      },
      {
        id: "m3.4",
        title: "Create Ads in Multiple Formats: 1:1, 9:16, and 4:5",
        explanation: "Each placement has an ideal aspect ratio. Create your creative in: 1:1 (square) for Feed, 9:16 (vertical) for Stories/Reels, 4:5 for Facebook Feed. Upload all three as part of the same ad using 'Asset Customisation'.",
        whyItMatters: "A 16:9 landscape video on Instagram Stories wastes 60% of screen space. Format-native creative gets 2–3x more engagement because it fills the screen naturally.",
      },
      {
        id: "m3.5",
        title: "Run 3–6 Ads Per Ad Set — Never Just One",
        explanation: "Meta's AI needs options to test. Run 3–6 different ads simultaneously in your single ad set. Include a mix of: UGC videos, static images with text overlay, carousel ads, and before/after content. Let Meta find the winner.",
        whyItMatters: "One ad gives Meta zero testing ability. Six ads let it find the best performer for each audience segment. Your top ad usually generates 60–70% of all spend — the others are there for testing.",
        retailExample: "A good mix: 2 UGC videos (different creators), 1 carousel of bestsellers, 1 lifestyle image with offer, 1 customer testimonial video, 1 product demo.",
      },
    ],
  },
  {
    id: "m-phase4",
    title: "Phase 4 — Advantage+ Shopping Campaigns",
    subtitle: "The Ecommerce Scaling Weapon",
    icon: <ShoppingCart className="w-5 h-5" />,
    tips: [
      {
        id: "m4.1",
        title: "Advantage+ Shopping Campaigns (ASC) — What They Are",
        explanation: "ASC is Meta's fully automated campaign type for ecommerce. It requires minimal setup: upload your creative, set a budget, and Meta handles targeting, placement, and bidding entirely. No audience selection, no manual bidding. ASC tests up to 150 creative combinations automatically.",
        whyItMatters: "Ben Heath says ASC is the #1 scaling tool for ecommerce in 2025–2026. It consistently outperforms manual campaigns once you have proven creative and working pixel data.",
        retailExample: "A fashion retailer switched from manual campaigns to ASC and saw ROAS increase from 2.8x to 4.2x within 3 weeks — with less management time.",
      },
      {
        id: "m4.2",
        title: "Only Use ASC After You Have Winning Creative",
        explanation: "ASC amplifies what works. If your creative is weak, ASC will amplify failure. First, find 2–3 winning ads in a standard Sales campaign (ads with consistent ROAS above target for 7+ days). Then move those winning ads into an ASC campaign.",
        whyItMatters: "ASC has no manual controls — you can't fix targeting or bidding. The only input is creative. If your creative doesn't convert, ASC can't save it.",
      },
      {
        id: "m4.3",
        title: "Set Your Existing Customer Budget Cap",
        explanation: "In ASC settings, set the 'Existing customer budget cap' to 20–30%. This prevents Meta from spending your entire budget remarketing to people who already bought — forcing it to find new customers.",
        whyItMatters: "Without the cap, ASC will retarget existing customers heavily because they convert cheaply. Your ROAS looks great but your business isn't growing. Cap it to force acquisition.",
        retailExample: "Set to 25%: Meta spends 75% finding new customers and 25% on remarketing. This balances growth with profitability.",
      },
      {
        id: "m4.4",
        title: "Upload Your Customer List for Better AI Training",
        explanation: "Export your customer email list from Shopify and upload it to Meta as a Custom Audience. In ASC, this helps Meta understand who your existing customers are (to cap spend on them) and find similar new customers.",
        whyItMatters: "The customer list is the most valuable data you can give Meta's AI. It uses purchase patterns, demographics, and interests of your buyers to find identical people who haven't bought yet.",
      },
    ],
  },
  {
    id: "m-phase5",
    title: "Phase 5 — Creative Fatigue & Iteration",
    subtitle: "Hook Variations — Not New Ads",
    icon: <TrendingUp className="w-5 h-5" />,
    tips: [
      {
        id: "m5.1",
        title: "Recognise Creative Fatigue Before It Kills Performance",
        explanation: "Creative fatigue happens when your audience has seen your ad too many times. Signs: CPM rises, CTR drops, frequency exceeds 3.0, cost per purchase increases 20%+ over 7 days. Check these metrics weekly in Ads Manager.",
        whyItMatters: "Creative fatigue is the #1 reason profitable campaigns decline. It's not that your audience changed — it's that they've seen your ad 5+ times and now ignore it.",
        retailExample: "If your frequency hits 3.5 and cost per purchase has risen 25% from its best week — it's time for new hooks, not panic.",
      },
      {
        id: "m5.2",
        title: "Create Hook Variations — Don't Replace the Entire Ad",
        explanation: "When an ad fatigues, don't create an entirely new ad from scratch. Instead, keep the same body/middle/end and create 3–5 new hook variations (first 3 seconds). This is Ben Heath's top recommendation for combating fatigue efficiently.",
        whyItMatters: "The hook is what fatigues first because it's what people see before deciding to watch. The product pitch in the middle is still effective — just give it a fresh opening.",
        retailExample: "Original hook: 'These dresses are selling out'. New hooks: 'Darwin girls — this one's for you' / 'I wasn't going to post this but...' / 'The dress I get asked about every time'",
      },
      {
        id: "m5.3",
        title: "Test New Creative Every 2 Weeks",
        explanation: "Add 1–2 new ads to your ad set every 2 weeks. Don't wait for fatigue to hit — proactively refresh. Keep winners running and let Meta shift budget naturally. Only pause ads manually if cost per purchase exceeds 2x your target for 7+ days.",
        whyItMatters: "Proactive creative testing prevents the feast-and-famine cycle where campaigns crash, you scramble for new creative, and waste 2 weeks rebuilding momentum.",
      },
      {
        id: "m5.4",
        title: "Use Dynamic Creative Testing (DCT) for Rapid Iteration",
        explanation: "Enable 'Dynamic Creative' on your ad set. Upload 5 images/videos, 5 headlines, and 5 primary texts. Meta tests all combinations (up to 125) and finds the best mix automatically. Great for finding winning text + image combinations quickly.",
        whyItMatters: "DCT lets you test 125 combinations with the budget it would take to test 5 ads manually. It's the fastest way to discover what copy and creative resonates.",
      },
    ],
  },
  {
    id: "m-phase6",
    title: "Phase 6 — Scaling Profitably",
    subtitle: "Scale Slowly — Meta's AI Needs Stability",
    icon: <Rocket className="w-5 h-5" />,
    tips: [
      {
        id: "m6.1",
        title: "The 20% Rule: Never Increase Budget More Than 20%",
        explanation: "When a campaign is profitable and you want to scale, increase the daily budget by maximum 20% at a time. Wait 3–5 days before the next increase. Large jumps reset Meta's learning phase and tank performance.",
        whyItMatters: "Meta's delivery algorithm learns from recent data. A 100% budget jump means it's spending at double the rate with yesterday's data — it makes poor decisions until it re-learns, often at your expense.",
        retailExample: "$50/day → $60/day (wait 4 days) → $72/day (wait 4 days) → $86/day. Gradual scaling preserves ROAS.",
      },
      {
        id: "m6.2",
        title: "Horizontal Scaling: Duplicate Winning Campaigns",
        explanation: "Instead of only increasing budget (vertical scaling), duplicate your winning campaign with a new audience angle or new creative. Run both simultaneously. This spreads risk and often finds new pockets of profitable customers.",
        whyItMatters: "Vertical scaling has diminishing returns — at some point, more budget means higher CPMs. Horizontal scaling opens new audience pools without inflating costs on your existing campaign.",
      },
      {
        id: "m6.3",
        title: "Separate Prospecting and Retargeting Budgets",
        explanation: "Run two campaign types: 1) Prospecting — broad targeting, new customer acquisition, 70–80% of total budget. 2) Retargeting — website visitors, cart abandoners, past buyers, 20–30% of budget. Use different creative for each.",
        whyItMatters: "Retargeting alone isn't growth — it's just converting people who already found you. Prospecting fills the top of your funnel. Without it, retargeting audiences shrink and costs rise.",
        retailExample: "Retargeting creative: 'Still thinking about it? Here's 10% off' with the exact product they viewed. Prospecting creative: UGC showcasing your brand lifestyle.",
      },
      {
        id: "m6.4",
        title: "Know Your Break-Even ROAS and Scale Above It",
        explanation: "Calculate: Break-even ROAS = 1 / Gross Margin. At 50% margin, break-even is 2x ROAS. At 60% margin, it's 1.67x. Only scale campaigns consistently above break-even for 7+ days. Factor in shipping costs, returns, and payment processing fees.",
        whyItMatters: "Scaling an unprofitable campaign faster just loses money faster. Know your number before you increase budget.",
      },
    ],
  },
  {
    id: "m-phase7",
    title: "Phase 7 — Advanced Strategies",
    subtitle: "For When You're Spending $100+/Day Profitably",
    icon: <Users className="w-5 h-5" />,
    tips: [
      {
        id: "m7.1",
        title: "Build a Lookalike Audience from Your Best Customers",
        explanation: "Export your top 25% of customers by lifetime value from Shopify. Upload as a Custom Audience in Meta. Create a 1% Lookalike Audience. Use this as an 'Audience Suggestion' in Advantage+ Audience — Meta will weight these signals heavily.",
        whyItMatters: "A 1% Lookalike of your top spenders tells Meta exactly who to find more of. It's the highest-quality signal you can provide short of uploading purchase data directly.",
      },
      {
        id: "m7.2",
        title: "Use Catalog Ads for Dynamic Product Retargeting",
        explanation: "Connect your Shopify product catalog to Meta Commerce Manager. Create a 'Catalog Sales' campaign that dynamically shows each visitor the exact products they viewed. Meta automatically generates the ad creative from your product feed.",
        whyItMatters: "Catalog ads achieve the highest ROAS of any Meta ad format because they show people exactly what they already expressed interest in. Typical ROAS: 5–15x on warm audiences.",
        retailExample: "A visitor views 3 pairs of shoes, leaves without buying. Next day they see an ad showing those exact 3 shoes with current prices. Click-through rate: 3–5x higher than generic ads.",
      },
      {
        id: "m7.3",
        title: "Test Broad vs. Advantage+ Audience Regularly",
        explanation: "Run periodic tests: one campaign with completely open targeting (no audience suggestions) vs. one with Advantage+ Audience suggestions. Compare ROAS over 7–14 days. Meta's AI sometimes performs better with zero guidance.",
        whyItMatters: "As Meta's AI improves, it needs less human input. Some brands find completely open targeting outperforms curated audiences — the only way to know is to test.",
      },
      {
        id: "m7.4",
        title: "Implement Post-Purchase Upsell Campaigns",
        explanation: "Create a campaign targeting people who purchased in the last 7–30 days. Show them complementary products, bundle offers, or new arrivals. This is your cheapest customer acquisition because trust is already established.",
        whyItMatters: "Selling to an existing customer costs 5–7x less than acquiring a new one. Post-purchase campaigns often achieve 10–20x ROAS and increase customer lifetime value significantly.",
        retailExample: "Customer buys a dress → 3 days later sees an ad: 'Complete the look — shoes and accessories that match your new dress. Free shipping for returning customers.'",
      },
    ],
  },
];

const bonusMistakes: Tip[] = [
  { id: "mb.1", title: "Boosting posts instead of using Ads Manager", explanation: "Boosting optimises for engagement, not sales. You'll get likes, not customers.", whyItMatters: "Every dollar boosted is a dollar that could have driven an actual purchase through a proper Sales campaign." },
  { id: "mb.2", title: "Splitting budget across too many ad sets", explanation: "Multiple ad sets fragment your data. Meta's AI needs concentrated data to learn.", whyItMatters: "Each ad set needs 50 conversions/week to exit learning. 5 ad sets = 250 conversions needed instead of 50." },
  { id: "mb.3", title: "Using interest-based targeting in 2025", explanation: "Manual interest targeting limits Meta's AI. Advantage+ Audience consistently outperforms hand-picked interests.", whyItMatters: "You're competing against Meta's own AI with less data. Let the machine do what it's designed to do." },
  { id: "mb.4", title: "Optimising for Add to Cart instead of Purchase", explanation: "Meta will find people who add to cart but never complete checkout. Optimise for the event you actually want.", whyItMatters: "Add to Cart optimisation can show 3x more conversions but generate 50% less actual revenue." },
  { id: "mb.5", title: "Only using studio photography — no UGC", explanation: "Polished product shots look like ads. People scroll past ads. UGC looks like organic content and stops the scroll.", whyItMatters: "Ben Heath documents UGC outperforming studio creative by 2–3x consistently across retail accounts." },
  { id: "mb.6", title: "Creating new ads instead of new hooks", explanation: "When performance drops, the hook fatigued — not the entire ad. New hooks are 10x cheaper and faster than new ads.", whyItMatters: "You'll burn through creative budget unnecessarily and lose weeks of momentum creating from scratch." },
  { id: "mb.7", title: "Increasing budget by 50%+ overnight", explanation: "Large budget jumps reset Meta's learning phase. Performance crashes for 3–7 days while the AI re-learns.", whyItMatters: "A 50% increase on a $100/day campaign costs you $150/day of poor performance while Meta re-calibrates. Scale 20% at a time." },
  { id: "mb.8", title: "Not installing Conversions API (CAPI)", explanation: "Browser-only tracking misses 30–50% of conversions due to iOS privacy and ad blockers. Meta optimises on incomplete data.", whyItMatters: "You're paying for Meta to target the wrong people because it can't see your actual customers." },
  { id: "mb.9", title: "Running ads without a tested landing page", explanation: "Your ad gets the click. Your landing page gets the sale. A slow, confusing, or generic landing page wastes 100% of ad spend.", whyItMatters: "A 1-second delay in mobile load time reduces conversions by 20%. Test your landing page before spending on ads." },
  { id: "mb.10", title: "Judging campaign performance before 7 days", explanation: "Meta's learning phase takes 3–7 days. Pausing a campaign after 2 days means you paid for data you'll never use.", whyItMatters: "Day 1–3 performance is not representative. Wait for full learning phase completion before making decisions." },
];

const MetaAdsGuide = () => {
  const [completed, setCompleted] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch { return {}; }
  });

  const [showIntro, setShowIntro] = useState(() => {
    return localStorage.getItem(INTRO_KEY) !== "true";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
  }, [completed]);

  const handleCloseIntro = () => {
    setShowIntro(false);
    localStorage.setItem(INTRO_KEY, "true");
  };

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
            {tip.retailExample && (
              <div className="mt-2 rounded-md bg-secondary/30 border border-secondary/50 p-2.5">
                <p className="text-xs font-medium text-secondary-foreground mb-0.5">🛍 Retail Example</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{tip.retailExample}</p>
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
    <>
      {/* Intro Modal */}
      <Dialog open={showIntro} onOpenChange={(open) => { if (!open) handleCloseIntro(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg">📘 Meta Ads Guide</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              This guide is based on strategies from <strong>Ben Heath</strong> (@BenHeath), one of the world's leading Meta Ads experts. Ben runs Heath Media, managing millions in ad spend for ecommerce brands worldwide.
              <br /><br />
              Key 2025–2026 shifts covered: <strong>one ad set structure</strong>, <strong>Advantage+ Audience</strong>, <strong>UGC-first creative</strong>, <strong>hook variations over new ads</strong>, and <strong>Advantage+ Shopping Campaigns</strong>.
            </DialogDescription>
          </DialogHeader>
          <Button onClick={handleCloseIntro} className="w-full mt-2">Got it — let's go</Button>
        </DialogContent>
      </Dialog>

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
            <a href="https://business.facebook.com" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Meta Ads Manager
            </a>
          </Button>
          <Button variant="outline" size="sm" className="w-full text-xs" asChild>
            <a href="https://business.facebook.com/commerce" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Commerce Manager
            </a>
          </Button>
          <Button variant="outline" size="sm" className="w-full text-xs" asChild>
            <a href="https://business.facebook.com/events_manager" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Events Manager
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
                  <p className="text-xs text-muted-foreground">Common Meta Ads Mistakes That Waste Budget</p>
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
          Strategies sourced from Ben Heath's YouTube channel (@BenHeath). Ben runs Heath Media, a Meta Ads agency managing millions in ad spend for ecommerce brands worldwide.
        </p>
      </div>
    </>
  );
};

export default MetaAdsGuide;
