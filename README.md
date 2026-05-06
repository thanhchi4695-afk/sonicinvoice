# Sonic Invoice

AI-powered Retail Operations and Marketing platform for boutique fashion retailers.

## Setup

This project runs on Lovable Cloud (Supabase) with auto-managed frontend env vars. See `.env.example` for the publishable keys exposed to the client. Backend secrets are configured in Lovable Cloud → Backend → Secrets.

## Environment Variables

The following optional secrets can be set in Lovable Cloud → Backend → Secrets to override default external endpoints. All have safe production defaults — set them only if you need to route traffic elsewhere (e.g. self-hosted proxy, regional endpoint, sandbox).

| Secret | Default | Purpose |
|---|---|---|
| `AI_GATEWAY_URL` | `https://ai.gateway.lovable.dev/v1/chat/completions` | Override AI inference endpoint |
| `XERO_BASE_URL` | `https://api.xero.com` | Xero API base |
| `XERO_TOKEN_URL` | `https://identity.xero.com/connect/token` | Xero token exchange |
| `XERO_AUTH_URL` | `https://login.xero.com/identity/connect/authorize` | Xero OAuth |
| `XERO_CONNECTIONS_URL` | `https://api.xero.com/connections` | Xero connections |
| `MYOB_BASE_URL` | `https://api.myob.com/accountright` | MYOB API base |
| `MYOB_TOKEN_URL` | `https://secure.myob.com/oauth2/v1/token` | MYOB token exchange |
| `MYOB_AUTH_URL` | `https://secure.myob.com/oauth2/account/authorize` | MYOB OAuth authorise |

### Required runtime secrets

These are auto-provided by Lovable Cloud and do not need manual configuration:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
- `LOVABLE_API_KEY` (for AI gateway access)

### Integration secrets (set when enabling the integration)

- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` — from Shopify Partner Dashboard
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — for Gmail OAuth
- `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` — for Xero OAuth
- `MYOB_CLIENT_ID`, `MYOB_CLIENT_SECRET` — for MYOB OAuth
