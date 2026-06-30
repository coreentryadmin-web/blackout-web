# Membership Pipeline — Deep End-to-End Audit
Last updated: 2026-06-29 (automated `audit-membership-pipeline` run)

## Overall Health: **PASS** (revenue boundary intact; two P2 residuals)

The Whop → Clerk → tool-access pipeline is sound. The realtime Whop webhook is live and
verified, the hourly reconcile is healthy (24/24 OK in the last 24h, 0 errors), and every
gated tool route enforces a premium tier check *before* serving data. No path was found where
a free user can reach paid data or a paying user is permanently locked out. The two residual
gaps are bounded-window (≤1h) issues, not leaks.

---

## Architecture (as-built)

```
Whop billing event ──► /api/webhook/whop ──► syncWhopMembershipForEmail(email)
                         (signed, idempotent)        │
                                                      ├─ resolve tier from Whop memberships
Clerk sign-up ────────► /api/webhook/clerk ──► (DB users row only; NO tier sync) [P2-A]
                                                      │
hourly cron ──────────► /api/cron/membership-reconcile ──► reconcileAllMemberships()
  (0 * * * *)            (self-heals both directions)      │
                                                           ▼
                                          Clerk publicMetadata.tier = "premium" | "free"
                                                           │
request ──► requireTierApi / authorizeMarketDeskApi ──► resolveUserTier (60s cache) ──► gate
            then requireToolApi (launch gate)         ──► data
```

- **"paid" in Clerk** = `publicMetadata.tier === "premium"` (plus `whop_user_id`,
  `whop_membership_id`). `parseTier` also accepts legacy `"pro"`/`"elite"` as premium.
- **"free"** = `tier` absent or any other value → `parseTier` returns `"free"`.
- **Tier write** is via `clerkClient.users.updateUserMetadata` (server-side deep-merge, not
  overwrite) — eliminates the read-modify-write race between concurrent webhook + reconcile.
- **Premium classification** (`resolveTierFromMembership`): membership status ∈
  {active, trialing, completed, past_due, canceling} AND product/plan id ∈ the
  `WHOP_*_PRODUCT_IDS`/`WHOP_*_PLAN_IDS` allowlists. Throws (fail-closed) if all allowlists are
  empty rather than silently resolving everyone to free.

---

## Webhook Health
| Webhook | Endpoint Exists | Secret Configured (prod) | Events Handled | Idempotent |
|---|---|---|---|---|
| Clerk `user.created` | YES (405 on GET) | `CLERK_WEBHOOK_SECRET` ✓ | DB `users` upsert only — **no tier sync** | N/A (upsert ON CONFLICT) |
| Clerk `user.updated` | YES | ✓ | DB `users` update | N/A (idempotent UPDATE) |
| Whop `membership.activated/deactivated/cancel_at_period_end_changed` | YES (405 on GET) | `WHOP_WEBHOOK_SECRET` ✓ | `syncWhopMembershipForEmail` | **YES** — Redis `whop:event:{id}` SET NX, 24h TTL |
| Whop `refund/dispute .created/.updated` | YES | ✓ | revoke membership id + re-sync owner | YES (same Redis dedupe) |

- **Signature verification:** Clerk uses svix (`wh.verify`, fail-closed 400 on bad sig). Whop
  uses Standard Webhooks via `whop.webhooks.unwrap()` (400 on bad/missing sig). Both verified.
- **Missing-secret behavior (Whop, prod):** returns **503** (not 200-ACK) so Whop *retries* —
  no billing event is silently dropped — plus a critical Discord alert. Outside prod it 200s
  for dev convenience. This is the correct, revenue-safe choice.
- **Company-scoping:** Whop handler drops events whose `company_id` ≠ `WHOP_COMPANY_ID`
  (defense-in-depth against secret reuse), allowing unknown/absent company_id through.
- **Idempotency:** Whop is fully idempotent (Redis NX). If Redis is down it **fails open**
  (processes anyway) — acceptable since the underlying sync is itself idempotent (recomputes
  the same tier from Whop truth). Clerk handler is naturally idempotent (upsert / UPDATE).

### Prod env presence (boolean checks only — no values printed)
`CLERK_WEBHOOK_SECRET` ✓ · `WHOP_WEBHOOK_SECRET` ✓ · `WHOP_API_KEY` ✓ · `WHOP_COMPANY_ID` ✓ ·
`WHOP_PRO_PRODUCT_IDS` ✓ (satisfies the tier-resolution allowlist guard) · `CRON_SECRET` ✓ ·
`ADMIN_EMAILS` ✓ · `LAUNCHED_TOOLS` = `heatmap,nighthawk,largo,grid`.
`WHOP_PREMIUM_PRODUCT_IDS` / `WHOP_ELITE_PRODUCT_IDS` / `WHOP_PREMIUM_PLAN_IDS` are unset — **fine**,
because the resolver checks all of {premium,pro,elite}×{product,plan} and only one needs to be set.

---

## Task #101 Status (Clerk user.created webhook) — **PARTIALLY RESOLVED**
- The Clerk webhook now **exists** (`/api/webhooks/clerk`, aliased from singular `/api/webhook/clerk`)
  and reliably provisions a row in the Postgres `users` table on `user.created`/`user.updated`.
- **However, it does NOT call `syncWhopMembershipForEmail` on sign-up.** It writes no
  `publicMetadata.tier`. So a user who **paid on Whop *before* creating their Clerk account**
  is `free` until the next hourly reconcile observes their active Whop membership (≤1h window).
- Users who **pay *after* signing up** are unaffected — the Whop `membership.activated` webhook
  syncs them in realtime.
- **Verdict:** the "missing webhook" of #101 is resolved for DB provisioning, but
  **immediate entitlement sync on sign-up is still missing** → see Recommendation P2-A.

---

## Hourly Reconcile  (`/api/cron/membership-reconcile`, cron `0 * * * *`)
Source of truth: `cron_job_runs` table (Railway trigger-service logs are churned per-deploy).

- **Running on schedule:** YES — one run per hour, on the hour.
- **Last successful run:** 2026-06-30 00:01 UTC (audit time), `ok`.
- **Last 24h:** **24 runs, all `ok`, 0 failed, 0 skipped.**
- **Users processed per run:** ~15–17 emails (active subscribers ∪ current-premium users).
- **Typical result:** `prem≈15, free=0–1, errors=0, capped=false`, ~6–10s duration.
- **Fail mode (Whop down / `member:email:read` outage):** **fail-CLOSED** — the inner
  `resolveMembershipTierForEmail` throws if Whop returns rows with all-null emails, aborting the
  sync and leaving existing tiers intact (refuses to mass-downgrade to free). 429s are retried
  3× with 2s/6s backoff. Errors are counted, not fatal to the run.
- **Coverage cap:** `maxEmails = 5000`; current base is ~15, so no truncation risk near-term.

---

## Tool Access Gating
Two independent layers, both enforced **before** any data query:
1. **Tier gate** (`requireTierApi("premium")` / `authorizeMarketDeskApi` / `authorizeCronOrTierApi`)
   — the revenue boundary. Reads `resolveUserTier` (60s per-replica cache, last-known-tier
   fallback on Clerk outage, retryable 503 if cold+down — never over-grants).
2. **Launch gate** (`requireToolApi(key)`) — "Launching Soon" padlock + admin bypass.

> **Note:** With `LAUNCHED_TOOLS=heatmap,nighthawk,largo,grid` and spx/flows default-launched,
> **all 6 tools are currently LIVE**, so the launch gate is presently a no-op for entitlement.
> The premium tier gate is therefore the *sole* revenue boundary — and it is correctly placed
> ahead of the launch gate in every route checked.

| Tool | requireToolApi called | Tier gate present + before data? | Free user → | Paid user → | Admin bypass |
|---|---|---|---|---|---|
| Largo (`/api/market/largo/query`) | YES (`largo`) | YES — `requireTierApi("premium")` first | 401/403 | streamed answer | YES |
| Night Hawk (`/api/market/nighthawk/edition`) | YES (`nighthawk`) | YES — `authorizeCronOrTierApi("premium")` | 401/403 | edition JSON | YES |
| Heatmaps (`/api/market/gex-positioning`, `/gex-heatmap`) | YES (`heatmap`) | YES — `authorizeMarketDeskApi` | 401/403 | positioning | YES |
| Grid (`/api/grid/*`) | YES (`grid`) | YES — `authorizeMarketDeskApi` | 401/403 | grid data | YES |
| SPX Slayer (`/api/engine/*`, default-launched) | YES | YES | 401/403 | engine data | YES |

**All 23 routes** that call `requireToolApi` also call a tier/cron/admin gate first — verified
by source scan. No route relies on the launch gate alone for authorization.

---

## Unauthenticated Route Test (live, apex host, redirects followed)
| Route | Status | Correct? |
|---|---|---|
| `/api/market/gex-positioning` | 401 | ✓ (blocked) |
| `/api/market/nighthawk/edition` | 401 | ✓ |
| `/api/grid/analysts` | 401 | ✓ |
| `/api/market/largo/query` (GET) | 405 | ✓ (POST-only; not a leak) |
| `/api/market/largo/query` (POST, no auth) | 401 | ✓ |
| `/api/cron/membership-reconcile` | 401 | ✓ (CRON_SECRET-gated) |
| `/api/webhook/{clerk,whop}` (GET) | 405 | ✓ (exist, POST-only) |

> The `www` host returns **301 → apex**; all checks were re-run against `blackouttrades.com`
> directly (Cloudflare on `www` also strips `Authorization`, so authed cron calls must use apex).

---

## Sync Edge Cases
| Scenario | Handling | Verdict |
|---|---|---|
| User has multiple emails | `syncWhopMembershipForEmail` resolves a Clerk user across **all** verified emails; premium if **any** has a membership | ✅ Safe — single non-purchase address can't downgrade a multi-email payer |
| Reconcile downgrade vs. multi-email | Step 2 enqueues only the *primary* email, but step 3's `syncWhopMembershipForEmail` re-checks **all** emails of the matched user | ✅ Mitigated (code comment is stale/over-cautious) |
| Whop 429 (rate limit) | Reconcile retries 3× (2s/6s backoff); webhook throws → 500 → Whop retries | ✅ |
| Membership cancelled mid-month | `past_due`/`canceling` are grace statuses (keep premium); `deactivated` webhook + reconcile downgrade on true lapse | ✅ Intentional grace policy |
| Clerk metadata write fails | Webhook → 500 → Whop retries; reconcile retries next hour; uses deep-merge `updateUserMetadata` | ✅ |
| Webhook ↔ reconcile race | Both deep-merge and both derive the same tier from Whop truth → convergent | ✅ |
| User changes email to game tier | Requires a *verified* email that owns a Whop membership; churned users can't dodge downgrade (reconcile re-resolves from Whop) | ✅ Low risk |
| Whop `user.email` null (missing `member:email:read`) | Webhook **cannot** sync and logs + Discord-alerts; reconcile also keys on email → no id-based heal path | ⚠️ P2-B (perm is granted in prod today — reconcile shows live emails — but the pipeline is one Whop-app-permission change away from silent loss) |
| Tier allowlist env emptied | `resolveTierFromMembership` **throws** → sync aborts → prior tier kept (fail-closed) | ✅ |
| Clerk outage at request time | `resolveUserTier` returns last-known cached tier; cold+down → retryable 503, never default-grant | ✅ |

---

## Revenue Risk Assessment
- **Free users leaking into paid tools:** **None found.** Every gated route enforces a premium
  tier check before data, ahead of the (currently no-op) launch gate. Unauth requests are 401.
- **Paid users locked out:**
  - **P2-A (≤1h, bounded):** a user who *pays before signing up* stays `free` until the next
    hourly reconcile, because `user.created` doesn't sync membership. No permanent lockout.
  - **P2-B (conditional):** if the Whop app ever loses `member:email:read`, realtime webhook
    syncs and reconcile both go blind (both key on email). Fail-closed prevents mass-downgrade,
    but new activations would stall. Currently healthy (prod emails resolve).
- **Over-grant on outage:** None — every fallback path fails closed or keeps last-known, never
  defaults to premium.
- **Severity:** **LOW.** No active leak; residuals are bounded-window and self-healing.

---

## Recommendations
- **P2-A — Sync tier on `user.created` (closes the #101 gap fully).** In
  `/api/webhooks/clerk` `user.created` branch, fire-and-forget `syncWhopMembershipForEmail(email)`
  after the DB upsert so a pay-then-signup user is `premium` immediately instead of waiting up to
  an hour. Wrap in try/catch (never 500 the webhook) — reconcile remains the safety net.
- **P2-B — Add an id-based heal path / verify `member:email:read` is permanently granted.**
  The entire pipeline keys on `user.email`; a single Whop-app permission change makes both the
  webhook and reconcile blind. Either (a) add a `whop_user_id`-keyed reconciliation fallback, or
  (b) add a startup/health assertion that `member:email:read` is present and alert if it lapses.
- **P3 — Tidy the stale reconcile comment** (lines ~250–253 of `membership.ts`): the
  "uses primary email → could downgrade multi-email payer" caveat is no longer accurate because
  step 3 re-resolves across all emails. Update the comment to avoid future confusion.
- **P3 — Watch the `maxEmails = 5000` reconcile cap** as the user base grows; today's base
  (~15) is far below it, but the cap silently slices — the existing `capped` warning log is the
  tripwire.

---

### Audit method (reproducibility)
Source read: `membership.ts`, `whop.ts`, `tiers.ts`, `tier-cache.ts`, `market-api-auth.ts`,
`tool-access.ts`, `tool-access-server.ts`, `middleware.ts`, both webhook routes, the reconcile
cron route. Live: apex-host endpoint/gating probes; Railway prod env presence (booleans only);
`cron_job_runs` query for reconcile health. No secrets, user emails, or user ids were printed.
