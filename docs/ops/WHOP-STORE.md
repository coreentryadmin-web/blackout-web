# Whop store catalog

Last updated: 2026-07-19

Whop is the billing + Discord entitlement layer. The **website** (`/pricing`, `/upgrade`) and **Whop checkout pages** should stay in sync.

## Live products (store: `whop.com/blackout-2d9c`)

| Product | ID | Route | Price | Grants desk? |
|---------|-----|-------|-------|--------------|
| BlackOut Premium Monthly | `prod_DVboHRgi2jgYP` | `blackout-trading-community` | $199/mo | Yes |
| BlackOut Premium Yearly | `prod_pufR0xUcudHVB` | `yearly-access-c0` | $1,999/yr | Yes |
| BlackOut Discord Community | `prod_hPHU7bWcvWg8T` | `blackout-discord-community` | $75/mo | No (Discord only) |
| ~~Life Time Access~~ | `prod_fSnPbyYQi50Wm` | hidden | retired | **Yes (grandfathered)** |

**Premium entitlements** (`WHOP_PRO_PRODUCT_IDS`): monthly + yearly + **retired lifetime** (`prod_fSnPbyYQi50Wm`) for existing `completed` one-time purchases. Community is never premium on desk.

Lifetime is **hidden/archived in Whop** — do not sell new lifetime via that SKU. To sell new lifetime again, create a **new** Whop product/plan and add its ID here; keep the retired ID for legacy holders.

## Checkout URLs (baked at Docker build)

| Env var | URL |
|---------|-----|
| `NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY` | `https://whop.com/blackout-2d9c/blackout-trading-community` |
| `NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY` | `https://whop.com/blackout-2d9c/yearly-access-c0` |
| `NEXT_PUBLIC_WHOP_CHECKOUT_COMMUNITY` | `https://whop.com/blackout-2d9c/blackout-discord-community` |
| `NEXT_PUBLIC_WHOP_STORE_URL` | `https://whop.com/blackout-2d9c` |

Set as **GitHub Actions secrets** (production image build) and in **AWS Secrets Manager** (`blackout-production/app/env`).

## Remodel script

Source of truth for Whop product headlines, descriptions, plan labels, and hygiene (archive lifetime plan):

```bash
npm run whop:remodel          # apply
npm run whop:remodel -- --dry-run
```

Requires `WHOP_API_KEY` + `WHOP_COMPANY_ID` with `access_pass:update` and `plan:update`.

**Company store pitch** (title “BlackOut Trades”, about blurb) needs `company:update` on the API key or a manual edit in the Whop dashboard → Settings → Store.

After checkout, products redirect to `https://blackouttrades.com/dashboard`. Statement descriptor: `WHOP*BLACKOUT`.

## Manual dashboard-only fields

Whop’s API does not expose product **Features** or structured **FAQ** blocks (dashboard editor only). The remodel script embeds a compact FAQ section in each product `description`. Whop may also show auto-generated FAQ accordions on checkout pages.

To polish further in dashboard: Products → Edit → Features + FAQ items (mirror `src/lib/faq/content.ts` member section).

## Billing support

`billing@blackouttrades.com` — referenced on Whop product copy and site FAQ.
