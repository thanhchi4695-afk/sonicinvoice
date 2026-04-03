
# Shopify App Store Compliance Plan

## Phase 1: Fix Authentication (Real Supabase Auth)
- Remove `authed = true` bypass in Index.tsx
- Make email/password form use real `supabase.auth.signUp` / `supabase.auth.signInWithPassword`
- Add proper session management with `onAuthStateChange`
- Add forgot password flow
- Add loading states for auth

## Phase 2: Embedded Session Token Auth
- When app loads embedded (shop + host params), use App Bridge `getSessionToken()` to get a Shopify session token
- Create new edge function `shopify-session-verify` that:
  - Decodes the session token JWT
  - Verifies it against SHOPIFY_API_SECRET
  - Looks up or creates a Supabase user for the shop
  - Returns Supabase access/refresh tokens
- Auto-authenticate embedded users without showing login screen
- Handle reinstall flow (existing user, new session)

## Phase 3: Shopify Billing API
- Create edge function `shopify-billing` that:
  - Creates an `appSubscriptionCreate` GraphQL mutation
  - Single plan: e.g. $29/month with 14-day free trial
  - Returns confirmation URL for merchant approval
  - Handles `appSubscriptionLineItemUpdate` for upgrades
- Add billing status check on app load
- Add plan selection / upgrade UI in Account screen
- Store billing status in a new `shopify_subscriptions` table

## Phase 4: OAuth Callback Fix for Embedded Mode
- Fix redirect after OAuth — use `APP_URL` env var instead of `origin` header
- When embedded, redirect to `https://admin.shopify.com/store/{shop}/apps/{api_key}`
- Ensure reinstall flow works cleanly

## Phase 5: Quality & Error Handling
- Add loading states for all async operations
- Add error boundaries
- Handle edge cases: empty upload, invalid invoice, API failures
- Remove console errors
- Ensure no blank screens

## Phase 6: Final Review Checklist
- Verify HTTPS (already covered by hosting)
- Verify GDPR webhooks (already done)
- Verify correct scopes
- Verify no ads/promotions in admin UI
- Test all flows end-to-end

## Database Migration Needed
- `shopify_subscriptions` table for billing status tracking
