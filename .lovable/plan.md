# Sonic Invoices — Apple-Inspired Redesign Plan
_Scope: every screen **except** the homepage. Zero functions removed — all 55 flows preserved._

> Source: `sonic_invoices_redesign_plan.docx` (May 2026 audit) + Apple HIG 2025.
> Project memory still applies (dark theme, teal/amber accents, Syne/IBM Plex Mono, 32px DataGrid rows, Colour-first/Size-second variants, Shopify embedded sidebar ≥1024 / bottom bar <1024).

---

## 0. Guiding principles

| Apple HIG | Applied to Sonic Invoices |
|---|---|
| **Clarity** | One obvious primary action per screen. Secondary actions present but quieter. |
| **Deference** | Chrome (sidebar, headers) recedes; data is the hero. |
| **Depth** | Progressive disclosure — surface simple, complexity on demand. |
| **Consistency** | One spacing scale, one type scale, one semantic colour map. |
| **Feedback** | Every action gets a toast or inline confirmation within 200 ms. |

**Non-negotiables**
- Keep every existing route, edge function, and feature.
- Keep dark theme + teal/amber accents (memory rule); the doc's light palette is mapped into our existing semantic tokens, not replacing them.
- Touch targets ≥ 44 px (iPad in-store usage).
- Respect Shopify embedded layout: sidebar ≥1024 px, bottom bar <1024 px.

---

## 1. Design system refresh (foundation — do first)

Edit `src/index.css` + `tailwind.config.ts` only — no component changes yet.

**Tokens to formalise (HSL, semantic):**
- `--surface`, `--surface-elevated`, `--surface-sunken` (replace ad-hoc `bg-card/50` etc.)
- `--accent-teal`, `--accent-amber`, `--accent-success`, `--accent-warning`, `--accent-danger`, `--accent-info` — single source of truth for status pills, toasts, badges.
- `--sidebar-bg`, `--sidebar-item`, `--sidebar-item-hover`, `--sidebar-item-active`.
- Spacing scale: `--space-1..7` = 4 / 8 / 12 / 16 / 24 / 32 / 48 px.
- Type scale (Syne for h1–h3, Inter for body, IBM Plex Mono for data):
  - Page title 28/600, Section 20/600, Card 16/600, Body 14/400, Caption 12/500, Mono-data 13/500.
- Radii: `--radius-sm 6`, `--radius-md 10`, `--radius-lg 14`, `--radius-pill 999`.
- Shadows: `--shadow-card`, `--shadow-modal`, `--shadow-toast` (subtle, single source).

**Buttons** — extend existing `buttonVariants` with strict semantic variants: `primary` (action), `secondary` (passive), `ghost` (low-emphasis), `destructive`, `teal` (already used). Remove ad-hoc `bg-blue-*` / `bg-navy-*` usage.

**Acceptance:** rg shows zero raw colour classes (`bg-blue-`, `text-white`, `bg-slate-`) in `src/components/**` after migration prompts run.

---

## 2. Navigation overhaul (highest user-impact)

**Problem:** 17 flat sidebar items at equal weight; no mental model.

**Fix: grouped sidebar with 4 sections** (`src/components/EmbeddedNav.tsx` + dashboard sidebar):

1. **Stock** — Inventory, Stock Adjustments, Stocktakes, Transfers
2. **Suppliers** — Invoices, Purchase Orders, Suppliers, Brand Rules
3. **Reports** — Reports Hub, Forecasting, Margins, Sales Velocity
4. **Tools** — Paste Link, Tag Rules, Tools, Claude Integration, Connectors, Settings

Rules:
- Group label is small caps 11/600 muted.
- Group containing the active route stays expanded (`defaultOpen` based on `useLocation`).
- Collapsible to icon-only rail (`collapsible="icon"`); `SidebarTrigger` lives in the top header so it stays visible.
- On Shopify embedded mobile (<1024 px), the existing bottom bar gets the same 4 group icons; tapping opens a sheet with the group's items (preserve current routes).
- Active state uses `--sidebar-item-active` + a 2 px left teal accent bar.
- Add a persistent **Quick Search (⌘K)** trigger pinned at the top of the sidebar — opens existing global search.

**Acceptance:** every existing route is still reachable in ≤2 clicks; sidebar item count visible at any time ≤ 8.

---

## 3. App shell & top bar

- New top bar (h-14): SidebarTrigger · breadcrumb · environment chip (Test/Live) · notifications · user avatar.
- Breadcrumbs auto-generated from route — replaces ad-hoc page titles.
- Page header pattern (every screen): `<PageHeader title subtitle actions />` component — title 28/600, subtitle 14/muted, primary action right-aligned. Build once in `src/components/layout/PageHeader.tsx`, replace ad-hoc headers screen-by-screen.

---

## 4. Invoice flow (Upload → Extract → Review → Enrich → Publish)

| Screen | Change |
|---|---|
| **Phase progress bar** | Replace 6 disabled/“Soon” pills with a single linear stepper (4 active steps). Hidden `Soon` items go behind a “More” menu. Clicking a future step is disabled (not navigation). |
| **Review (line items)** | Sticky bottom action bar: `Approve N items →` always visible. Inline edit on cell click. Confidence chips: HIGH (green), MEDIUM (amber), LOW (red) — already in confidence-export-gate memory. |
| **Enrich** | Two-column layout: source data (left, read-only) vs Shopify-ready (right, editable). Differences highlighted in amber. |
| **Publish** | Single hero card: store name, product count, location, status. One large primary `Publish to Shopify →`. Success: green check + toast + “View in Shopify” link (uses existing `openShopifyAdmin` helper). |

---

## 5. Per-screen redesigns (preserve every feature)

**Inventory**
- Default to a curated 6-column view (Image · SKU · Title · Stock · Price · Status); column picker reveals the rest.
- Sticky first column (image+title) on horizontal scroll for iPad.
- Filter bar: search + 3 chip filters (Status, Location, Brand). “More filters” opens a sheet.
- Bulk-action bar slides up from bottom when rows selected.

**Purchase Orders**
- List shows status pills: Draft / Sent / Partial / Received / Overdue (semantic colours).
- “Needs action” quick filter at top.
- Form is split into 3 collapsible sections: Supplier · Line items · Delivery.

**Stock Adjustments**
- Progressive form: Location + Reason → Product search → Quantity → Notes.
- Recent adjustments preview rail on the right.

**Stocktakes**
- Scan mode: full-screen on mobile, 64 px input, audio + vibration feedback.
- Variance summary card at top: counted / expected / variance %.

**Reports hub**
- Replace dense widget grid with a card grid (3-up desktop, 1-up mobile). Each card: title, 1 KPI, sparkline, “Open report →”.
- Inside each report: 3 KPI cards above the table.

**Suppliers**
- Confidence chip + last-trained date on each card.
- “Needs training” filter (<10 invoices or <80% confidence) — one-click upload for that supplier.

**Settings / Connectors / Account**
- Move from tabs-only to grouped left rail inside the page (Account · Connections · Billing · Notifications · Team).

---

## 6. Components — global standards

**Modals**
- Widths: sm 480 / md 640 / lg 800 / full-screen on mobile.
- Header: title 18/600 + close ✕. Footer: secondary left, primary right. ESC + backdrop click closes.

**Tables (DataGrids)**
- Keep TanStack + 32 px row height (memory rule).
- Header: muted bg, semibold, uppercase tracking-wide.
- Zebra striping, no vertical borders, hover bg, sticky header.
- Empty state: centred illustration + 16/600 message + 14/muted helper + single CTA.

**Forms**
- Label above input (13/medium). Helper text below (12/muted).
- Focus ring: 2 px teal + 1 px offset.
- Error: red border + red helper.
- All inputs ≥ 44 px tall on touch.
- Custom Select component everywhere (no native).

**Toasts**
- All saves/publishes/errors → toast top-right, 4 s auto-dismiss, icon + message.
- One source: extend existing `sonner` config.

**Empty states**
- One reusable `<EmptyState icon title body cta />`.

---

## 7. Mobile / iPad

- All tables: horizontal scroll with sticky first column, never crammed.
- Stocktake scan: full-screen takeover.
- Bottom action bars on long forms (Approve, Save, Publish).
- Min tap target 44 px.

---

## 8. Execution order (8 prompts, ~15–18 h total)

Send one prompt per round; verify before next.

1. **Design tokens** — `index.css` + `tailwind.config.ts` + extended `buttonVariants`. _Foundation, blocks all others._
2. **App shell** — `PageHeader`, top bar, breadcrumbs.
3. **Grouped sidebar** — `EmbeddedNav.tsx` + dashboard sidebar (incl. mobile bottom bar groups).
4. **Tables & EmptyState standards** — shared `<DataTableShell>` + `<EmptyState>`; migrate 2 reference screens (Inventory, Reports).
5. **Modal & Form standards** — shared primitives + migrate Invoice modals.
6. **Invoice flow** — stepper, sticky approve bar, two-column enrich, hero publish.
7. **Per-screen pass A** — Inventory, Purchase Orders, Stock Adjustments, Stocktakes.
8. **Per-screen pass B** — Reports hub + each report, Suppliers, Settings/Connectors, remaining tools.

**Acceptance per prompt:** build clean, all routes reachable, no removed functionality, semantic-token-only colours in changed files.

---

## 9. Out of scope (this plan)

- Homepage (`/`) — explicitly excluded.
- Backend / edge function changes — UI-only.
- New features — discoverability only.
