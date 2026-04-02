import { useState, useEffect, useMemo } from "react";
import { ExternalLink, CheckCircle2, Target, Search, FileText, Settings, Link2, BookOpen, AlertTriangle } from "lucide-react";
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

const STORAGE_KEY = "skuPilot_seoProgress";
const INTRO_KEY = "skuPilot_seoIntroSeen";

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
    id: "seo-phase1",
    title: "Phase 1 — SEO Foundations",
    subtitle: "What You Need to Know First",
    icon: <Target className="w-5 h-5" />,
    tips: [
      {
        id: "s1.1",
        title: "Understand How Google Ranks Pages (3 Core Signals)",
        explanation: "Google uses 3 primary signals to rank pages: 1) Backlinks — other websites linking to your page (Google's original ranking signal, still the most important). 2) Search intent match — does your page give searchers exactly what they are looking for in the format they expect? 3) Content quality — does your page comprehensively answer the query better than competing pages? Every SEO action you take should strengthen at least one of these three signals.",
        whyItMatters: "Most retailers focus on writing more content — but if you are not matching search intent and building authority through backlinks, you will not rank no matter how many words you write. These 3 signals are the engine. Everything else is a lever.",
        retailExample: "A swimwear store writes a 3,000-word article about 'best one-piece swimsuits.' It stays on page 3 because competitors have 10x more backlinks, and the top results are all listicle-format buyer guides — not editorial articles. Fixing just the format and adding 5 quality backlinks moves the page to position 4 in 60 days.",
      },
      {
        id: "s1.2",
        title: "Set Up Google Search Console — The Free SEO Dashboard",
        explanation: "Go to search.google.com/search-console and verify your Shopify store. This gives you: which keywords you rank for, which pages get the most clicks, your average position for every query, and any indexing errors Google has found. Submit your sitemap (yourstore.com/sitemap.xml) in GSC under Settings > Sitemaps. Check it weekly. This is the single most important free SEO tool available to any retailer.",
        whyItMatters: "Google Search Console shows you exactly what Google sees on your site — errors, crawl blocks, and which queries send traffic. Without it, you are optimising in the dark. Every serious SEO decision should be informed by GSC data before you spend a single hour on content.",
        retailExample: "A fashion retailer sets up GSC and discovers: 12 product pages are not being indexed (noindex tag accidentally left on from a theme update), and their best keyword 'linen trousers women' has average position 11 (just off page 1). They fix both. Organic traffic increases 41% in 30 days — no new content created.",
      },
      {
        id: "s1.3",
        title: "Understand Search Intent Before Creating Any Content (3 C's Method)",
        explanation: "Search intent is the reason behind a query. Analyse it using the 3 C's: 1) Content Type — what format does Google rank? Blog posts, product pages, or category pages? 2) Content Format — is it a listicle, how-to guide, comparison, or step-by-step tutorial? 3) Content Angle — what benefit or hook do top results lead with ('best', 'cheapest', 'for beginners', '2026')? Before creating any page, Google your target keyword and study the top 5 results. Match all 3 dimensions.",
        whyItMatters: "Google measures whether your page satisfies searchers. If 90% of people searching a keyword want a buyer guide but you publish an opinion piece, Google will not rank your page regardless of how good the writing is. The 3 C's analysis takes 5 minutes and prevents months of wasted effort.",
        retailExample: "A jewellery retailer wants to rank for 'gold hoop earrings.' They Google it and find the top results are all product category pages from ecommerce stores — not blog posts. They create an optimised category page (not a blog post) with filters, multiple styles, and 40 customer reviews. It reaches position 6 within 8 weeks.",
      },
      {
        id: "s1.4",
        title: "SEO Takes 3–12 Months — Plan Your Roadmap Accordingly",
        explanation: "SEO takes 3–12 months to show significant results for new pages. Unlike ads, it does not turn on and off instantly. The payoff: once you rank, traffic is free and consistent for years. Set your roadmap: Months 1–3 = foundation work (technical setup, keyword research, on-page optimisation). Months 4–6 = content and link building. Months 7–12 = compounding results and scaling.",
        whyItMatters: "Retailers who quit SEO at 30 days never see the results that kick in at 90–180 days. Those who stay consistent compound their traffic gains year over year. SEO rewards patience more than any other marketing channel — and punishes impatience more severely too.",
        retailExample: "A homewares brand publishes 15 SEO-optimised collection pages. Month 1: 120 organic visits. Month 3: 1,800 visits. Month 6: 8,400 visits. Month 12: 31,000 visits — all free, all from a one-time 3-month content investment that continues compounding.",
      },
    ],
  },
  {
    id: "seo-phase2",
    title: "Phase 2 — Keyword Research",
    subtitle: "Targeting the Right Terms",
    icon: <Search className="w-5 h-5" />,
    tips: [
      {
        id: "s2.1",
        title: "Use the BID Method to Validate Every Keyword",
        explanation: "Before targeting any keyword, validate it with the BID method: B = Business potential (if you rank #1, does this keyword bring buyers or just curious readers? Score 1–3). I = Intent match (do top SERP results match a format you can create?). D = Difficulty (are the top-ranking pages from sites similar in size and authority to yours?). Only pursue keywords that score well on all 3 dimensions.",
        whyItMatters: "Most SEO beginners chase high-volume keywords without checking business potential. A keyword with 10,000 searches/month that attracts readers but no buyers is worthless. A 500-search keyword where every visitor is ready to buy is worth 10x more. BID prevents months of optimising for traffic that never converts.",
        retailExample: "A homewares store checks 'how to fold a fitted sheet' (8,000 searches/month) — BID fails: business potential 0. They check 'linen fitted sheet queen size' (900 searches/month) — BID passes: business potential 3, buyer intent, product page format. They focus on the 900-search keyword and generate $4,200 monthly revenue from one page.",
      },
      {
        id: "s2.2",
        title: "Find Low Competition Keywords You Can Actually Win",
        explanation: "Use the free Ahrefs Keyword Generator (ahrefs.com/keyword-generator) to expand your keyword list. Filter for competition you can realistically beat. Red flags: all top 10 results are from Amazon, ASOS, or major national retailers; all top pages have 100+ backlinks; Domain Ratings of 80+. Good signs: mix of small and large sites in top 10; some pages ranking with under 20 backlinks. Start where you can win, then ladder up.",
        whyItMatters: "Targeting keywords you can win fast builds domain authority and momentum. A page that ranks #1 for a lower-volume keyword attracts backlinks, builds trust with Google, and helps you rank for harder keywords later. Every #1 ranking makes the next one easier.",
        retailExample: "A startup swimwear brand avoids 'women's swimwear' (dominated by THE ICONIC, ASOS) and targets 'minimalist one-piece swimsuit Australia' (280 searches/month, top results from small boutiques). They rank #2 in 10 weeks and use that authority to later target 'one-piece swimsuit Australia' (2,400 searches/month).",
      },
      {
        id: "s2.3",
        title: "Prioritise Transactional Keywords for Direct Sales Traffic",
        explanation: "For a retail store, prioritise transactional keywords — queries where the searcher is ready or close to buying. These include: 'buy [product]', '[product] price', '[product] Australia', '[product] online', '[product] sale', '[product] review', 'best [product]'. Also target product category keywords like 'women's linen pants' or 'gold chain necklaces.' These drive visitors who convert — not just visitors who read and leave.",
        whyItMatters: "Informational keywords ('how to style linen pants') build brand awareness but rarely convert immediately. Transactional keywords put your store in front of people with buying intent. For a retailer, transactional keywords should represent 60–70% of your target keyword list.",
        retailExample: "A fashion boutique targets 10 transactional collection-page keywords: 'linen pants women Australia', 'wide leg linen pants', 'linen pants petite', 'white linen trousers.' Each page attracts 200–800 monthly visitors with a 4.2% purchase conversion rate. Combined: 4,200 visitors/month = 176 sales/month from SEO alone.",
      },
      {
        id: "s2.4",
        title: "Mine Your Competitors' Top Pages for Keyword Ideas",
        explanation: "Your competitors have already validated valuable keywords for you. In the free Ahrefs Site Explorer (ahrefs.com/site-explorer), enter any competitor's domain and view their 'Top Pages' to see which pages drive the most traffic and what keywords they rank for. In Google, search 'site:competitor.com' to see all their indexed pages. Identify their highest-traffic pages and create better versions.",
        whyItMatters: "Competitor research shortcuts months of trial and error. If a competitor gets 5,000 monthly visitors from their 'resort wear collection' page, you know that keyword is valuable, winnable, and worth targeting. They have done the validation work for you — use it.",
        retailExample: "A boutique discovers a competitor's 'resort wear women' collection page gets 3,400 monthly organic visits. They review the page, identify the top keywords, and build a more comprehensive version with more products, stronger descriptions, and better images. Within 3 months their version outranks the competitor for 6 of the same keywords.",
      },
    ],
  },
  {
    id: "seo-phase3",
    title: "Phase 3 — On-Page SEO",
    subtitle: "Optimising Every Page to Rank",
    icon: <FileText className="w-5 h-5" />,
    tips: [
      {
        id: "s3.1",
        title: "Optimise Title Tags — The Single Most Important On-Page Element",
        explanation: "The title tag is the clickable blue link in Google search results and the most important on-page SEO signal. Include your target keyword naturally (near the beginning). Keep it under 60 characters. Make it compelling to click. For product category pages: '[Keyword] — Shop [Brand Name]'. For blog posts: use a number or benefit. In Shopify: edit via Online Store > Pages > edit the page title.",
        whyItMatters: "Google uses the title tag as a primary signal for what your page is about. A clear, keyword-rich title directly influences rankings. It also determines click-through rate in search results — a compelling title gets 30–50% more clicks than a bland one at the same position.",
        retailExample: "A retailer changes their collection page title from 'Products | Our Store' to 'Women's Linen Pants — Free Shipping in Australia | Bonnie & Belle.' Organic traffic to that page increases 67% in 4 weeks with no other changes.",
      },
      {
        id: "s3.2",
        title: "Clean URLs, Optimised Meta Descriptions, and Heading Structure",
        explanation: "Three quick on-page wins: 1) URL slug — use your target keyword with hyphens (yourstore.com/linen-pants-women, not /collection/page?id=4521). 2) Meta description — under 155 characters, include keyword and a compelling benefit. Not a ranking factor but boosts clicks by 20–40%. 3) Heading tags — H1 must include your target keyword (once per page). Use H2s for section headers with related keywords.",
        whyItMatters: "URL, meta description, and headings together take 15 minutes to fix per page and consistently move pages from position 12 to position 7–8 without any additional content work. These are the 3 fastest on-page wins with the highest return on time invested.",
        retailExample: "A jewellery store fixes these 3 elements on their ring collection page: clean URL ('/rings/gold-rings'), keyword in meta description, H1 changed from 'Rings' to 'Gold Rings Australia — Shop 200+ Styles.' Click-through rate increases from 2.8% to 5.1% and the page climbs from position 7 to position 4 in 6 weeks.",
      },
      {
        id: "s3.3",
        title: "Optimise Product Images for SEO (Alt Text + File Names)",
        explanation: "Every product image needs: 1) A descriptive file name using keywords (not 'IMG_4521.jpg' — use 'womens-linen-pants-navy-wide-leg.jpg'). 2) Alt text — a brief image description that includes your keyword naturally. In Shopify: edit alt text via Products > click the image > edit alt text field. Compress all images using TinyIMG or Shopify's built-in optimization.",
        whyItMatters: "Alt text helps Google understand what images contain — and drives meaningful traffic from Google Image Search (often 5–15% of a retail site's organic traffic). Compressed images improve page speed, a confirmed ranking factor. These two 5-minute fixes can add 20–30% more organic traffic.",
        retailExample: "A swimwear brand renames all 200 product images from 'DSC_001.jpg' to keyword-rich names and adds descriptive alt text. Within 60 days, Google Image Search traffic increases from 340 visits/month to 1,840 visits/month. Zero additional content created.",
      },
      {
        id: "s3.4",
        title: "Build Internal Links from Blog Posts to Product Pages",
        explanation: "Internal links are links from one page on your site to another. They: 1) Help Google discover and index new pages. 2) Pass link authority from established pages to newer ones. 3) Guide visitors toward products. Best practice: From every blog post, link to 3–5 relevant product or category pages. Use descriptive anchor text — not 'click here' but 'shop our linen pants collection.'",
        whyItMatters: "Internal linking is the highest-leverage, zero-cost on-page tactic. A product page with no backlinks can rank well if it receives strong internal links from authoritative pages on your own site. Most retailers have existing popular blog posts that are not passing any authority to their money pages.",
        retailExample: "A retailer's blog post 'How to Style Linen Pants for Summer' gets 800 monthly organic visitors. They add 4 internal links to product and category pages. Those pages' organic traffic increases 35–60% over 8 weeks — authority passed from the popular post to the pages that actually convert.",
      },
    ],
  },
  {
    id: "seo-phase4",
    title: "Phase 4 — Technical SEO",
    subtitle: "Helping Google Find and Index Your Store",
    icon: <Settings className="w-5 h-5" />,
    tips: [
      {
        id: "s4.1",
        title: "Check Indexation First — Is Google Actually Seeing Your Pages?",
        explanation: "In Google Search Console, go to Pages report. Look for pages with status 'Not indexed.' Common causes for Shopify: pages marked noindex, pages blocked in robots.txt, duplicate content issues. To check any page manually: Google 'site:yourstore.com/your-page-url' — if it does not appear, it is not indexed. Fix indexation issues before any other SEO work.",
        whyItMatters: "A page that is not indexed by Google cannot rank — full stop. This is the most common invisible SEO killer retailers discover. Fixing one indexation issue can instantly unlock hundreds of pages that were previously invisible to every search engine.",
        retailExample: "A Shopify store discovers all their collection pages are showing 'Duplicate, Google chose different canonical than user' in GSC. They fix canonical tags across 43 collection pages. All 43 move from not indexed to fully indexed within 3 weeks, contributing 11,400 new monthly organic visits.",
      },
      {
        id: "s4.2",
        title: "Speed Up Your Store — Page Speed is a Ranking Factor",
        explanation: "Check your store at pagespeed.web.dev. Aim for 70+ score on mobile. Quick wins for Shopify: 1) Compress all images. 2) Remove unused apps — every Shopify app adds JavaScript. 3) Use a performance-optimised theme (Dawn, Impulse, or Prestige). 4) Avoid embedding large videos directly on product pages.",
        whyItMatters: "53% of mobile users abandon a page that takes more than 3 seconds to load. Google uses Core Web Vitals as direct ranking signals. A slow store loses both rankings and conversions simultaneously — fixing speed improves both.",
        retailExample: "A Shopify store scores 31 on mobile PageSpeed. They compress 180 product images (65% file size reduction), remove 4 unused apps, and switch to a faster theme. Mobile score improves to 74. Mobile organic traffic increases 28% in 60 days.",
      },
      {
        id: "s4.3",
        title: "Submit Your Sitemap and Fix Your Site Structure",
        explanation: "Submit your Shopify sitemap to GSC: Settings > Sitemaps > add '/sitemap.xml'. Organise products into clear collections (Women's > Tops > Linen Tops). Every important page should be reachable within 3 clicks from your homepage. Use descriptive navigation labels. Add your most important collection pages to your main navigation.",
        whyItMatters: "A clear site structure helps Google understand the relationship between your pages and crawl them efficiently. Pages buried 5 clicks deep often never get properly indexed. Navigation links pass strong internal link authority.",
        retailExample: "A retailer reorganises their navigation from a flat list of 60 categories into 6 main categories with subcategories. After submitting the new sitemap, Google indexes 94% of pages within 2 weeks (up from 61%) and organic traffic increases 52% in 3 months.",
      },
      {
        id: "s4.4",
        title: "Run Monthly Site Audits With Free Ahrefs Webmaster Tools",
        explanation: "Sign up free at ahrefs.com/webmaster-tools. Verify your Shopify store. Run a crawl and schedule weekly audits. Critical issues to fix: Broken links (404 errors), Redirect chains, Orphan pages (pages with zero internal links), Missing title tags and H1 headings, Duplicate page titles.",
        whyItMatters: "Technical SEO errors compound silently over time. A single broken redirect chain can drain authority from dozens of connected pages. A monthly audit prevents small issues from becoming major ranking problems. Most retailers find 10–30 fixable issues in their first audit.",
        retailExample: "A fashion store runs its first Ahrefs audit and finds: 23 broken internal links, 14 redirect chains, and 8 orphan pages. They fix all issues in one afternoon. Overall organic traffic increases 18% in the following 30 days.",
      },
    ],
  },
  {
    id: "seo-phase5",
    title: "Phase 5 — Link Building",
    subtitle: "Earning Authority to Rank Faster",
    icon: <Link2 className="w-5 h-5" />,
    tips: [
      {
        id: "s5.1",
        title: "Use HARO and Journalist Outreach for Free High-Authority Backlinks",
        explanation: "Sign up free at connectively.us (formerly HARO — Help a Reporter Out). You receive daily emails from journalists seeking expert sources. When a query matches your expertise, respond with a brief (3–5 sentences) expert quote, your credentials, and your website URL. When published, you earn an editorial backlink from a major media outlet at zero cost.",
        whyItMatters: "A single placement in a major media outlet (Forbes, Vogue, Real Homes) can be worth more than months of traditional link building. These links come from highly authoritative domains (DR 80–95+) and are completely free. Retailers consistently land 2–5 of these per month.",
        retailExample: "A linen homewares founder responds to a journalist query about sustainable bedding. The story runs in a major home decor publication (DR 71). Their 'linen sheets Australia' category page jumps from position 12 to position 4 within 6 weeks.",
      },
      {
        id: "s5.2",
        title: "Get Links Through Guest Posts on Relevant Blogs",
        explanation: "Write an article for another website in exchange for a backlink. Process: 1) Find relevant sites (Google: intitle:'write for us' [your niche keyword]). 2) Check their Domain Rating — target DR 20–60 to start. 3) Pitch a specific article idea. 4) Write genuinely helpful content (not an ad). 5) Include 1–2 contextual links back to relevant pages on your site.",
        whyItMatters: "Guest posting earns a backlink and puts your brand in front of a new relevant audience simultaneously. A well-placed guest post on a fashion or lifestyle blog can drive qualified referral traffic for years while boosting your rankings.",
        retailExample: "A swimwear designer writes a guest post for an Australian travel blog: 'The Perfect Swimwear for Every Beach in Australia.' The post links back to 2 collection pages. It earns 340 referral visits in the first month and 3 product pages climb from page 2 to page 1.",
      },
      {
        id: "s5.3",
        title: "Get Included in Product Roundups and Gift Guides",
        explanation: "Bloggers and journalists regularly publish gift guides and 'best of' lists. Search Google for: '[your product type] gift guide [year]', 'best [your niche] products Australia 2026'. Find the author's contact details and send a personalised pitch offering a free product sample for an honest review. Budget $20–50 per outreach.",
        whyItMatters: "Gift guide placements generate high-authority editorial backlinks plus direct referral traffic and sales. These pages are frequently shared on social media and generate traffic for years. Getting featured in one popular roundup often triggers 5–15 additional secondary backlinks.",
        retailExample: "A jewellery brand sends 15 product samples to fashion bloggers writing 'Best Jewellery Gifts Under $100' guides. 9 of 15 publish reviews or roundup inclusions. Result: 9 new backlinks (average DR 31), 1,200 referral visits, and 34 direct sales in the first 30 days.",
      },
    ],
  },
  {
    id: "seo-phase6",
    title: "Phase 6 — Content Strategy",
    subtitle: "Publishing Content That Ranks and Sells",
    icon: <BookOpen className="w-5 h-5" />,
    tips: [
      {
        id: "s6.1",
        title: "The Retail Content Mix: 70% Category/Product Pages, 30% Blog",
        explanation: "Focus 70% of SEO effort on optimising product and category pages (these drive buyers directly to purchase pages). Use the remaining 30% for blog content that captures informational searches and funnels readers toward products. Every blog post must target a keyword with real search demand AND link to 3–5 relevant product or category pages.",
        whyItMatters: "Many retailers spend 100% on blog content because it is easier to create. But category and collection pages are where visitors convert to buyers. The 70/30 split maximises both search visibility and revenue from your SEO investment.",
        retailExample: "A fashion retailer has 80 blog posts and no SEO-optimised collection pages. They spend 3 months optimising all 45 collection pages first. Organic revenue from collection pages triples before they publish their next blog post — just from fixing existing pages.",
      },
      {
        id: "s6.2",
        title: "Build Content Hubs Around Your Core Product Categories",
        explanation: "A content hub is a cluster of interlinked pages around a central theme: one 'pillar' page (broad overview) and multiple 'cluster' pages (specific subtopics). Example: Pillar: 'The Complete Guide to Linen Bedding.' Clusters: 'Linen vs Cotton Sheets', 'How to Care for Linen', 'Best Thread Count for Linen'. All cluster pages link back to the pillar page and to each other.",
        whyItMatters: "Google rewards sites that demonstrate comprehensive topical authority. A content hub covering a topic from multiple angles builds more ranking authority than a single long-form article. Retailers with content hubs consistently outrank much larger competitors in their specific product niche.",
        retailExample: "A linen brand builds a content hub around 'linen bedding.' The pillar page ranks #1 for 'linen bedding Australia' (4,200 monthly searches). The 8 cluster pages each rank for subtopics. Combined, the hub drives 12,400 monthly organic visitors — 68% of whom click through to product pages.",
      },
      {
        id: "s6.3",
        title: "Update Existing Content Before Creating New Content",
        explanation: "Before creating any new SEO content, audit what you already have. In Google Search Console, filter pages by Position 5–20 — these are pages almost on page 1 that need a nudge. Update with: fresher information, expanded subtopics, additional internal links, better images with keyword-rich alt text, and more customer reviews or social proof.",
        whyItMatters: "Most SEO advice focuses on publishing more content. But a page sitting at position 11 with existing authority needs far less work to reach position 4 than a brand new page needs to reach position 20. Your existing content is your biggest underutilised SEO asset.",
        retailExample: "A retailer identifies 12 blog posts ranking between positions 8 and 18 in GSC. They spend 2 hours updating each. Nine of the 12 move to positions 1–5 within 45 days — without publishing a single new piece of content.",
      },
    ],
  },
];

const bonusMistakes: Tip[] = [
  { id: "sb.1", title: "Chasing keywords too competitive for your authority", explanation: "Targeting keywords dominated by Amazon, ASOS, or national retailers with hundreds of backlinks and entire SEO teams.", whyItMatters: "You'll spend months creating content that never reaches page 1. Start with keywords you can realistically win, then ladder up." },
  { id: "sb.2", title: "Targeting high-volume keywords with zero buyer intent", explanation: "Informational queries that attract readers but never convert to sales.", whyItMatters: "A keyword with 10,000 searches/month that brings zero buyers is worth less than a 500-search keyword with purchase intent." },
  { id: "sb.3", title: "No Google Search Console setup", explanation: "Optimising without any data on what Google actually sees, indexes, or ranks you for.", whyItMatters: "You're flying blind. GSC is free and takes 10 minutes to set up — there is no excuse for not having it." },
  { id: "sb.4", title: "Not matching search intent format", explanation: "Writing a blog post when top results are product pages, or creating a product page when top results are editorial guides.", whyItMatters: "Google measures user satisfaction. Wrong format = wrong audience = no ranking, regardless of content quality." },
  { id: "sb.5", title: "Thin or supplier-copied product descriptions", explanation: "Google identifies these as low-quality and refuses to rank them above competitors with unique descriptions.", whyItMatters: "Duplicate supplier descriptions appear on dozens of other stores. Google has no reason to rank your version over any other." },
  { id: "sb.6", title: "Missing or generic title tags on collection pages", explanation: "'Collections | Store Name' instead of a keyword-rich, click-worthy title.", whyItMatters: "Title tags are the #1 on-page ranking signal. A generic title wastes your strongest SEO lever." },
  { id: "sb.7", title: "No internal links from blog posts to product pages", explanation: "Popular content not passing any authority to the pages that actually generate revenue.", whyItMatters: "Your blog traffic is wasted if it doesn't funnel visitors and link authority to your money pages." },
  { id: "sb.8", title: "Ignoring page speed", explanation: "Slow stores lose both rankings and conversions simultaneously, yet a 1-afternoon speed fix can improve both metrics significantly.", whyItMatters: "53% of mobile users abandon pages that take more than 3 seconds to load. Google uses speed as a direct ranking signal." },
  { id: "sb.9", title: "Never building any backlinks", explanation: "Expecting great content alone to rank in competitive niches without earning any domain authority from external sites.", whyItMatters: "Backlinks are Google's #1 ranking signal. Without them, perfect on-page SEO won't get you to page 1 in competitive niches." },
  { id: "sb.10", title: "Quitting before 90 days", explanation: "Abandoning SEO right before the compounding effect begins. The first 60 days are always the hardest and least rewarding.", whyItMatters: "SEO compounds. Month 1 is painful. Month 3 shows momentum. Month 6–12 delivers exponential returns on the same initial work." },
];

const SEOGuide = () => {
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
            <DialogTitle className="text-lg">🔍 SEO Retail Guide</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              This guide is based on research from <strong>Ahrefs</strong> (@AhrefsCom) — 331 tutorials, 17+ years of SEO expertise, and data from over 500 million websites worldwide.
              <br /><br />
              Key principles: <strong>3 Core Ranking Signals</strong> (backlinks, intent match, content quality), the <strong>BID Method</strong> for keyword validation, <strong>search intent matching</strong>, and <strong>updating existing content before creating new</strong>.
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

        {/* Resource buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Button variant="outline" size="sm" className="w-full text-xs" asChild>
            <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Google Search Console
            </a>
          </Button>
          <Button variant="outline" size="sm" className="w-full text-xs" asChild>
            <a href="https://ahrefs.com/webmaster-tools" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Ahrefs Free Tools
            </a>
          </Button>
          <Button variant="outline" size="sm" className="w-full text-xs" asChild>
            <a href="https://pagespeed.web.dev" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              PageSpeed Insights
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
                  <p className="text-sm font-semibold text-foreground">Bonus — 10 Biggest SEO Mistakes Retailers Make</p>
                  <p className="text-xs text-muted-foreground">Eliminate These to Boost Traffic 50–200%</p>
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
          Strategies sourced from Ahrefs YouTube channel (@AhrefsCom). 331 tutorials, 17+ years of SEO expertise, data from 500M+ websites worldwide.
        </p>
      </div>
    </>
  );
};

export default SEOGuide;
