## Google Ads Setup AI — Full Wizard Flow

### Architecture
- Create a single `GoogleAdsSetupWizard.tsx` component with internal step state (screens 1–10)
- Add entry card on HomeScreen
- Register as a new flow (`google_ads_setup`) in Index.tsx and EmbeddedNav

### Screens to Build

1. **Onboarding Hook** — Hero screen with benefits + "Start Setup" CTA
2. **Business Check** — Product/price/margin inputs with AI margin analysis
3. **Account Setup Tracker** — 5-item checklist with expandable guide modals, blocks progress without conversion tracking
4. **First Campaign Setup** — Guided form: location, budget, product selection, auto keyword generator, negative keywords
5. **Ad Creation (AI)** — AI-generated headlines/descriptions with copy buttons
6. **Tracking Dashboard** — ROAS, spend, revenue, conversions metrics display with insight box
7. **Weekly Optimisation** — Checklist + smart alerts for underperforming keywords
8. **Unlock Shopping Ads** — Conditional screen (only if conversions exist), launch Shopping campaign
9. **Performance Max** — Asset checklist (images, video, customer list) + launch CTA
10. **Scaling Engine** — Budget recommendation, remarketing toggles

### Bonus
- Error prevention alerts throughout (no tracking → stop, too many products → reduce, budget too low)
- Progress saved to localStorage under `skuPilot_googleAdsSetup`
- Dark theme, teal/green CTAs, card-based layout matching existing design system

### Files Changed
- `src/components/GoogleAdsSetupWizard.tsx` (new — main wizard)
- `src/components/HomeScreen.tsx` (add entry card)
- `src/pages/Index.tsx` (add flow routing)
- `src/components/EmbeddedNav.tsx` (add sidebar entry)
