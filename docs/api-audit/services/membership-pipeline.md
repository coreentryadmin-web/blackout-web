# Membership Pipeline — Deep End-to-End Audit
Last updated: 2026-06-29 16:13 UTC (automated)

Scope: Whop → Clerk entitlement sync. Code read end-to-end + live production checks
(Railway env presence, cron logs, unauthenticated route probes).

## Overall Health: **PASS (with WARN)**

The pipeline is structurally sound and self-healing in both directions. No active revenue
leak and no path for a free user to reach premium tools. The two open items are a
**latency gap on first sign-up (task #101, still open)** and a **durability caveat on the
refund-revocation denylist**. Neither is an active misconfiguration today.

---

## Webhook Health
| Webhook | Endpoint Exists | Secret Configured | Events Handled | Idempotent |
|---|---|---|---|---|
| Clerk `user.created` | ✅ 405 on GET (POST-only) | ✅ `CLERK_WEBHOOK_SECRET` set (prod) | Inserts/updates Postgres `users` row only | ✅ via `ON CONFLICT DO UPDATE` |
| Clerk `user.updated` | ✅ (same handler) | ✅ | Updates `users` row | ✅ idempotent UPDATE |
| Whop `membership.*` | ✅ 405 on GET | ✅ `WHOP_WEBHOOK_SECRET` set (prod) | `activated`, `deactivated`, `cancel_at_period_end_changed` → re-sync | ✅ Redis `SET NX` 24h on `event.id` |
| Whop `refund.* / dispute.*` | ✅ (same handler) | ✅ | Adds membership id to revocation denylist + re-sync owner | ✅ same Redis dedup |

Notes:
- Clerk webhook is registered at the **singular** `/api/webhook/clerk`, which re-exports the
  canonical `/api/webhooks/clerk`. Both resolve (live: 405 on GET). Fail-closed on bad signature
  (svix verify → 400); fail-**open** on DB error (logs + 200 so Clerk doesn't retry-storm).
- Whop webhook verifies via Standard Webhooks `unwrap()` (webhook-id/timestamp/signature, **not**
  `x-whop-signature`). Missing secret in **production → 503** (Whop retries, no event dropped);
  non-prod → 200 ack. Foreign `company_id` is dropped. Null `user.email` (missing
  `member:email:read` scope) fires a loud Discord ops alert because neither the webhook nor the
  reconcile can heal it (both key on email).
- Idempotency depends on `REDIS_URL` (set in prod ✅). If Redis is down the Whop webhook
  **fails open** (processes anyway) — acceptable because the underlying sync is idempotent.

## Task #101 Status (Clerk user.created → membership sync)
**STILL OPEN.** `src/app/api/webhooks/clerk/route.ts` handles `user.created` by inserting a row
into the Postgres `users` table only — it does **not** call `syncWhopMembershipForEmail` and never
touches Clerk `publicMetadata.tier`. A fresh Clerk user therefore has no `tier` → resolves to
`free` by default (`parseTier(undefined) === "free"`).

A user who **paid on Whop before signing up** is `free` until one of:
1. the **hourly reconcile** picks them up (step 1 enumerates all active Whop memberships and finds
   their email) — bounded to ≤ ~1 hour, **or**
2. they click the manual **Sync Membership** button (only rendered on `/upgrade`,
   `src/components/SyncMembershipButton.tsx`), **or**
3. a later Whop membership webhook fires for that email.

There is **no automatic post-sign-up sync hook** (`/api/membership/sync` is invoked only by the
manual button). Net: a real but **self-healing ≤1h lockout window** for paid-then-signup users.

## Hourly Reconcile
- **Schedule:** `0 * * * *` (top of every hour) — `railway.membership-reconcile.toml`, service
  `Membership-Reconcile`, `CRON_SECRET` present ✅, Bearer-authed via `scripts/hit-cron.mjs`.
- **Running on schedule:** ✅ Logs show clean hourly runs 08:04 → 16:04 UTC on 2026-06-29.
- **Last successful run:** 2026-06-29T16:04:54Z → `ok=true checked=15 premium=15 free=0 errors=0 capped=false`.
- **Users processed per run:** ~15 (active subscribers ∪ current-premium users; not full user base).
- **Error rate:** 0% across the observed window.
- **Fail mode (Whop down):** **FAIL-CLOSED per email.** `resolveMembershipTierForEmail` throws on a
  `member:email:read` outage (rows returned but every `user.email` null), which aborts that email's
  sync so the **existing tier is preserved** — it never downgrades a paying user to `free` on a Whop
  read failure. 429s back off (2s, 6s) over 3 attempts before counting an error.
- **Bidirectional:** heals missed **upgrades** (active Whop membership → ensure premium) and missed
  **downgrades** (currently-premium Clerk users re-checked → free once lapsed/refunded).

## Tool Access Gating
Two independent layers, evaluated **before** any data query in every route checked:
1. **Tier gate** — `requireTierApi("premium")` / `authorizeMarketDeskApi` / `authorizeCronOrTierApi`
   (`src/lib/market-api-auth.ts`). Unauth → 401, free → 403, Clerk-outage-no-cache → retryable 503.
2. **Launch gate** — `requireToolApi(key)` (`src/lib/tool-access-server.ts`). Locked tool → 403
   "coming soon" unless admin.

**Production `LAUNCHED_TOOLS = heatmap,nighthawk,largo,grid`** → combined with the two
default-launched tools (spx, flows), **every tool is now launched**. The launch gate is effectively
a **no-op for all users**; the **tier gate is the live revenue boundary.** Confirmed every gated
route still runs the tier gate first.

| Tool | Tier gate called | Before data query? | Free user → | Paid user → | Admin bypass |
|---|---|---|---|---|---|
| Largo (`/api/market/largo/query`) | ✅ `requireTierApi("premium")` | ✅ (line 220, before body parse) | 403 | data | ✅ (launch gate) |
| Night Hawk (`/api/market/nighthawk/edition`) | ✅ `authorizeCronOrTierApi(premium)` | ✅ (line 105) | 403 | data | ✅ |
| Heatmaps (`/api/market/gex-positioning`) | ✅ `authorizeMarketDeskApi` | ✅ (line 24) | 403 | data | ✅ |
| Grid (`/api/grid/*`) | ✅ `authorizeMarketDeskApi` | ✅ (line 22) | 403 | data | ✅ |
| SPX Slayer (`/api/market/spx/desk`) | ✅ `authorizeMarketDeskApi` | ✅ (line 11) | 403 | data | n/a (default-launched) |

Tier resolution is cached 60s per replica (`tier-cache.ts`) with last-known-tier fallback so a
transient Clerk outage never kicks out a paying user; cache is bounded (LRU, 5k cap).

## Unauthenticated Route Test (live)
| Route | Status | Correct? |
|---|---|---|
| `/api/market/nighthawk/edition` | 401 | ✅ |
| `/api/market/gex-positioning` | 401 | ✅ |
| `/api/grid/analysts` | 401 | ✅ |
| `/api/market/spx/desk` | 401 | ✅ |
| `/api/cron/membership-reconcile` | 401 | ✅ (cron Bearer required) |
| `/api/webhook/clerk` (GET) | 405 | ✅ (POST-only, exists) |
| `/api/webhook/whop` (GET) | 405 | ✅ (POST-only, exists) |
| `/api/terminal` | 404 | n/a — not a real route; Largo API is `/api/market/largo/query` |
| `/api/market/largo/query` (POST) | 301 | probe degraded by a www/trailing-slash redirect (POST→GET); code gates `requireTierApi` first → 401 for unauth |

## Sync Edge Cases
- **Multiple emails per account:** `syncWhopMembershipForEmail` resolves **all** of a Clerk user's
  primary + verified emails and writes `premium` if **any** has a premium membership — a single
  non-purchase address can't downgrade a multi-email payer (launch-path #7). ✅
- **Unverified emails are excluded** from that union, so a user can't claim someone else's paid email
  without verifying it. ✅
- **429 (rate limit):** reconcile retries with backoff (2s/6s, 3 attempts). The webhook sync path
  doesn't retry on 429, but the next reconcile heals. ✅ (acceptable)
- **Cancel mid-month:** `canceling`/`past_due` are treated as grace = premium; `deactivated` webhook
  → free; reconcile confirms once truly lapsed. ✅
- **Clerk write fails:** webhook catches → 500 (Whop retries); reconcile retries 3×. ✅
- **Race webhook vs reconcile:** both write the *same* resolved tier via
  `updateUserMetadata` (Clerk server-side deep-merge, not read-modify-write overwrite), so concurrent
  writes are idempotent. Whop event dedup via Redis. ✅
- **Email-gaming:** tier is derived from Whop membership keyed on email; switching a Clerk email to one
  with no membership downgrades to free on next sync. No upward gaming without a real purchase. ✅

## Revenue Risk Assessment
- **Paid users potentially locked out:**
  1. **Task #101 latency gap** — paid-then-signup user is `free` for up to ~1h until reconcile (or a
     manual sync). Self-healing, bounded. **Severity: MEDIUM.**
  2. **Missing `member:email:read` Whop scope** — would make webhook+reconcile blind (null emails).
     Currently **not** an issue (live reconcile resolves `premium=15`, and the code fail-closes by
     preserving tier rather than downgrading). Monitored via Discord ops alert. **Severity: LOW (latent).**
- **Free users potentially leaking in:**
  - Revocation denylist (refund/chargeback) lives in Redis with ~400-day TTL. If Redis is **wiped**,
    a refunded one-time (`completed`) purchase would re-grant premium on the next reconcile until
    re-revoked. Rare, and the durable-DB-table hardening is already noted in `whop-revocation.ts`.
    **Severity: LOW.**
  - No path for a free user to obtain premium without an actual Whop membership on a verified email. ✅
- **Overall severity: MEDIUM** — driven solely by the #101 sign-up latency gap; no active leak.

## Recommendations
- **P1 — Close task #101.** Either (a) call `syncWhopMembershipForEmail(email)` inside the Clerk
  `user.created` handler (best-effort, fire-and-forget so a Whop hiccup never blocks provisioning),
  or (b) auto-fire `POST /api/membership/sync` once on first authenticated load after sign-up. Removes
  the ≤1h paid-user lockout window. (Webhook path is cleaner — no client dependency.)
- **P2 — Durable revocation store.** Back the refund/chargeback denylist with a Postgres table
  (Redis as cache) so a Redis wipe can't silently re-grant premium on a refunded purchase. Already
  flagged as future hardening in `whop-revocation.ts`.
- **P3 — Confirm `member:email:read` is granted** on the Whop app and keep the existing null-email
  Discord alert wired; it's the single point that would blind both the webhook and the reconcile.
- **P3 — Reconcile cap headroom.** `maxEmails` defaults to 5000 and today's runs process ~15
  (`capped=false`). No action now; revisit if the subscriber base approaches the cap (the run already
  logs a warning on cap).
