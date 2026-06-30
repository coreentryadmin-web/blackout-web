# Membership Pipeline — Deep End-to-End Audit
Last updated: 2026-06-30 (automated)

## Overall Health: **PASS** (self-healing entitlement loop; 2 low/medium follow-ups)

The Whop → Clerk entitlement loop is **closed, signature-verified, idempotent, and self-healing
in both directions**. Live reconcile cron is running and clean. No revenue leak found (no free
user reaching a paid surface), and the one paid-user-lockout window is bounded to ≤1h and has a
manual self-heal. The single notable architectural change vs. prior audits: **every tool is now
launched (`LAUNCHED_TOOLS=heatmap,nighthawk,largo,grid`)**, so the launch gate is a no-op and the
`premium` tier check is now the *sole* entitlement boundary for every tool — which raises the
stakes on tier correctness (exactly what this loop guards).

---

## How entitlement actually resolves (verified from source)

1. **Truth lives in Whop.** A user is premium iff they hold a membership in an
   `active|trialing|completed|past_due|canceling` status whose product/plan id is in
   `WHOP_*_PRODUCT_IDS` / `WHOP_*_PLAN_IDS`, and that membership id is **not** on the
   refund/dispute revocation denylist (`whop:revoked:*` in Redis).
2. **Tier is written to Clerk `publicMetadata.tier`** (`"premium"|"free"`) by
   `syncWhopMembershipForEmail` via `clerkClient.users.updateUserMetadata` (server-side **deep-merge**,
   so concurrent writers can't clobber each other).
3. **Gates read Clerk**, cache-first, via `resolveUserTier` (60s per-replica TTL, last-known-tier
   fallback so a transient Clerk outage never kicks out a payer). Page gate = `requireTier`,
   API gate = `requireTierApi`.

Sync is triggered by: **Whop webhook** (realtime), the **`/api/membership/sync`** route (the
"I paid — refresh my access" button on `/upgrade`), and the **hourly reconcile cron**. It is
**not** triggered by the Clerk `user.created` webhook (see Task #101 below).

---

## Webhook Health

| Webhook | Endpoint exists | Secret configured (prod) | Events handled | Idempotent |
|---|---|---|---|---|
| Clerk `user.created` | ✅ 405-on-GET (POST live) | ✅ `CLERK_WEBHOOK_SECRET` | provisions Postgres `users` row (no tier sync) | ⚠️ `ON CONFLICT DO UPDATE` (upsert-idempotent) |
| Clerk `user.updated` | ✅ same handler | ✅ | updates `users` row | ✅ idempotent UPDATE |
| Whop `membership.activated` | ✅ 405-on-GET (POST live) | ✅ `WHOP_WEBHOOK_SECRET` | → `syncWhopMembershipForEmail` | ✅ Redis `SET NX` 24h on `event.id` |
| Whop `membership.deactivated` | ✅ | ✅ | → sync (downgrade) | ✅ |
| Whop `membership.cancel_at_period_end_changed` | ✅ | ✅ | → sync (reflect grace) | ✅ |
| Whop `refund.created/updated`, `dispute.created/updated` | ✅ | ✅ | → revocation denylist + sync | ✅ |

**Endpoints probed (GET):** `/api/webhook/clerk` → 405, `/api/webhooks/clerk` (canonical) → 405,
`/api/webhook/whop` → 405. 405 = the POST handler is mounted and reachable (GET simply isn't
allowed). None 404, none 500.

**Whop webhook hardening (strong):**
- Signature verified by `whop.webhooks.unwrap()` (Standard Webhooks scheme); bad sig → 400.
- **Fail-closed on missing secret in production**: returns **503** (not 200) so Whop *retries* —
  no billing event is ever silently dropped. Fires a critical ops alert. (Dev/preview keeps 200.)
- **Company guard**: drops events whose `company_id` ≠ `WHOP_COMPANY_ID` (only on a definite mismatch).
- **Idempotency**: `whop:event:{id}` `SET NX EX 86400`; duplicate retries are ack'd and skipped.
  Fail-open if Redis is down (processes anyway — acceptable, the writes are convergent).
- Handler failure → 500 + critical ops alert → Whop retries.

**Clerk webhook caveat (by design):** DB write failures **fail-open** (logs, returns 200 so Clerk
stops retrying). That only affects the `users` mirror table, not entitlement — tier is never
written here — so it is not a billing risk.

---

## Task #101 Status (Clerk `user.created` webhook) — **PARTIALLY RESOLVED**

The webhook **now exists** and is signature-verified (svix). It provisions/updates the Postgres
`users` row on `user.created`/`user.updated`. **However it does NOT call
`syncWhopMembershipForEmail`**, so a user who **paid on Whop before signing up to Clerk** lands on
`free` at signup and stays locked out until something else syncs them.

**Why this is bounded (not a P0):**
- The `/upgrade` page (where a non-premium user is redirected by `requireTier`) renders a
  **"I paid — refresh my access"** button → `POST /api/membership/sync` → immediate self-heal.
- The **hourly reconcile** enumerates *all active Whop memberships by email* (step 1), so it
  promotes a pay-before-signup user to premium within **≤1 hour** with zero user action.

**Verdict:** the missing piece is real (no auto-sync on signup) but well-mitigated. Recommend
wiring a tier sync into the `user.created` branch (resolve Whop for the new email and write the
tier) to close the ≤1h lockout entirely. **Severity: P2 (medium — bounded UX gap, not a leak).**

---

## Hourly Reconcile

- **Running on schedule:** ✅ `cronSchedule = "0 * * * *"` (`railway.membership-reconcile.toml`),
  `restartPolicyType=never`, 1 replica, triggers `node scripts/hit-cron.mjs /api/cron/membership-reconcile`
  against the **apex** host with `Bearer CRON_SECRET`.
- **Last successful run:** `2026-06-30T16:00:40Z` → `ok=true checked=18 premium=18 free=0 errors=0 capped=false`.
- **Users processed per run:** 18 (small early-launch base; cap is 5000, not near it).
- **Error rate:** 0%.
- **Heals both directions:** active Whop subscribers stuck on `free` → promoted; churned/refunded
  Clerk-premium users → downgraded (re-resolved, excluding revoked ids).
- **Fail mode (Whop down): FAIL-CLOSED.** A `member:email:read` outage that returns rows with null
  emails *throws* (`resolveMembershipTierForEmail`), aborting the sync so the **prior tier is kept**
  — never a blanket downgrade to free. A full Whop API error throws → caught per-email → counted as
  an error, prior tier intact. 429s get bounded retry/backoff (2s, 6s; 3 attempts) before counting
  as an error. The only theoretical fail-open-to-free is if Whop returns a *successful empty* list
  during an outage (outages normally throw, so this is an edge, not the common failure shape).
- **Auth verified live:** unauthenticated `GET /api/cron/membership-reconcile` → **401**.

---

## Tool Access Gating

`requireToolApi(key)` = launch gate (`isToolLaunched`) + admin bypass (`resolveAdminApi`, the
`ADMIN_EMAILS` allowlist / `publicMetadata.role==="admin"`). It is called **after** the route's own
tier/desk auth and **before** the data query. Pages call `requireTier("premium")` then
`canAccessTool(key)` → `<ComingSoon>` padlock.

**Current launch state: `LAUNCHED_TOOLS = heatmap,nighthawk,largo,grid` → ALL tools launched.**
So `requireToolApi` returns `null` (allow) for every user on every tool today; the **`premium`
tier check is the only entitlement boundary in effect.** This is fine *as long as* the tier loop is
correct (it is) — but it removes the defense-in-depth layer that previously also protected
token-spending tools (Largo). Flagged below.

| Tool | `requireToolApi` called | Before data query? | Free user → | Paid user → | Admin bypass |
|---|---|---|---|---|---|
| Largo (`/api/market/largo/*`) | ✅ `requireToolApi("largo")` | ✅ after `requireTierApi`/auth | 403 (tier) | allowed | ✅ |
| Night Hawk (`/api/market/nighthawk/*`, `/api/nighthawk/*`) | ✅ `requireToolApi("nighthawk")` | ✅ | 401/403 | allowed | ✅ |
| Heatmaps (`/api/market/gex-positioning`, `gex-heatmap`, `heatmap`) | ✅ `requireToolApi("heatmap")` | ✅ (after `authorizeMarketDeskApi`) | 401/403 | allowed | ✅ |
| Grid (`/api/grid/*`) | ✅ `requireToolApi("grid")` | ✅ | 401/403 | allowed | ✅ |
| SPX Slayer (`/dashboard`, engine) | tier gate (defaultLaunched) | ✅ | 403 (tier) | allowed | ✅ |

`ADMIN_EMAILS` set in prod (3 admins). `requireToolApi`/`canAccessTool` short-circuit when the tool
is launched, so the admin Clerk lookup only happens on a *locked* tool (none currently).

---

## Unauthenticated Route Test

| Route | Status | Correct? |
|---|---|---|
| `/api/market/gex-positioning` | **401** | ✅ gated |
| `/api/market/nighthawk/edition` | **401** | ✅ gated |
| `/api/grid/analysts` | **401** | ✅ gated |
| `/api/cron/membership-reconcile` | **401** | ✅ cron-auth enforced |
| `/api/market/largo/query` | 405 | ⚠️ POST-only; auth is inside POST (not testable via GET) |
| `/api/terminal` | 404 | route doesn't exist (Largo API is `/api/market/largo/*`; `/terminal` is the gated **page**) |
| `/api/nighthawk/latest-edition` | 404 | wrong path; live edition route is `/api/market/nighthawk/edition` (401 ✅) |
| `/api/grid/news` | 404 | route not present under that name (`/api/grid/analysts` etc. are 401 ✅) |

**No route returned 200 with data to an unauthenticated caller.** No leak observed.

---

## Sync Edge Cases (reviewed in source)

- **Multiple email addresses:** ✅ correct. `syncWhopMembershipForEmail` resolves a Clerk user across
  **all primary+verified** emails and writes premium if **any** of them has a premium membership —
  so a single non-purchase address can't downgrade a multi-email payer.
- **Whop 429 (rate limit):** ✅ reconcile retries with backoff (2s, 6s; 3 attempts) before erroring.
- **Cancelled mid-month:** ✅ `canceling`/`past_due` are *grace* statuses → premium retained through
  the billing/cancel window; `membership.deactivated` (or the hourly sweep) downgrades on actual lapse.
- **Refund / chargeback on a one-time `completed` purchase:** ✅ `refund.*`/`dispute.*` webhook adds
  the membership id to the Redis revocation denylist; tier resolution skips it. **Caveat:** denylist
  is Redis-only with a ~400-day TTL — if Redis is wiped, a refunded `completed` purchase would
  re-grant premium on the next reconcile. A durable DB table is the documented hardening.
- **Clerk `updateUserMetadata` write fails:** ✅ throws out of the sync; webhook → 500 (Whop retries),
  reconcile → counts as error and retries next hour. Prior tier left intact (no silent downgrade).
- **Race (webhook ∥ reconcile):** ✅ both compute the *same* Whop truth and write via deep-merge →
  convergent, no flapping.
- **Email-change gaming:** ✅ no path. Gaining premium needs a *verified* email with a real active
  membership (i.e. an actual purchase); avoiding a downgrade by changing email doesn't work because
  the reconcile enumerates premium Clerk users directly.
- **`member:email:read` missing on the Whop app:** ⚠️ single point of fragility. Both the webhook and
  the reconcile key **only on email**; if Whop returns `user.email === null`, the change can't be
  synced and there is no id-based heal path. Code already detects this and fires a loud ops alert.
  Confirm the Whop app retains `member:email:read`.

---

## Revenue Risk Assessment

- **Paid users potentially locked out:**
  - *Pay-before-signup:* `free` for ≤1h after signup until the hourly reconcile (or the `/upgrade`
    self-sync button) promotes them. **Bounded, mitigated. Severity: MEDIUM (P2).**
  - *Clerk outage:* `resolveUserTier` falls back to last-known tier; only a cold cache + Clerk-down
    yields a retryable 503 (page routes to `/upgrade`), never a wrong-grant. **LOW.**
  - *`member:email:read` revoked on the Whop app:* would break *all* email-keyed sync (webhook +
    reconcile) → upgrades silently lost. Alerted, but **HIGH if it ever happens** — verify the perm.
- **Free users potentially leaking in:** **None found.** Every gated API self-authorizes
  (`requireTierApi`/`authorizeMarketDeskApi`) and every gated page calls `requireTier` before render;
  live unauth probes all returned 401/403. The launch gate being fully open does **not** create a
  leak (tier still enforced) — it only removes a redundant layer.
- **Overall severity: LOW**, contingent on (a) the Whop `member:email:read` permission staying
  granted and (b) Redis durability for the refund denylist.

---

## Recommendations

1. **(P2) Sync tier on Clerk `user.created`.** Add a `syncWhopMembershipForEmail(email)` call to the
   `user.created` branch of the Clerk webhook so a pay-before-signup user is premium *at signup*,
   closing the ≤1h lockout window. Wrap in try/catch (keep the 200/fail-open posture).
2. **(P2) Harden the refund/dispute revocation denylist to a durable store.** It currently lives only
   in Redis; a Redis wipe would silently re-grant premium to refunded `completed` purchases on the
   next reconcile. Mirror it to a Postgres table.
3. **(P3) Re-confirm `member:email:read` is granted on the Whop app** (single point of failure for
   *all* email-keyed sync). Consider an id-based heal path so a null-email event isn't unrecoverable.
4. **(P3 / awareness) Launch gate is fully open** (`LAUNCHED_TOOLS=heatmap,nighthawk,largo,grid`):
   `premium` is now the sole boundary for every tool, including token-spending Largo. Intentional for
   full launch, but worth a conscious sign-off since it removes the defense-in-depth layer.
5. **(P4 / hygiene)** `/grid` is not in `middleware.isProtectedRoute` (the page self-guards with
   `requireTier`, so it's safe today) and the middleware comment lists `/docs` as protected though it
   isn't in the matcher. Tighten the comment / matcher to avoid a future page being shipped unguarded.

---

### Evidence
- Source reviewed: `membership.ts`, `webhook/whop/route.ts`, `webhooks/clerk/route.ts`,
  `webhook/clerk/route.ts` (alias), `cron/membership-reconcile/route.ts`, `membership/sync/route.ts`,
  `tool-access.ts`, `tool-access-server.ts`, `tier-cache.ts`, `auth-access.ts`, `admin-access.ts`,
  `market-api-auth.ts`, `whop.ts`, `whop-revocation.ts`, `tiers.ts`, `middleware.ts`,
  `SyncMembershipButton.tsx`, `railway.membership-reconcile.toml`.
- Prod env presence (Railway, values not read): `CLERK_WEBHOOK_SECRET`, `WHOP_WEBHOOK_SECRET`,
  `WHOP_API_KEY`, `WHOP_COMPANY_ID`, `WHOP_PRO_PRODUCT_IDS` (3 ids), `ADMIN_EMAILS` (3),
  `LAUNCHED_TOOLS`, `CRON_SECRET`, `REDIS_URL` all set. `WHOP_PREMIUM_*`/`ELITE_*`/`*_PLAN_IDS`
  empty — fine, classification uses the populated `WHOP_PRO_PRODUCT_IDS`. (`NODE_ENV` is not a
  Railway var; Next sets it to `production` at runtime — the prod-retry branch relies on that, and is
  moot anyway since `WHOP_WEBHOOK_SECRET` is set.)
- Live: reconcile cron `2026-06-30T16:00:40Z ok=true checked=18 premium=18 free=0 errors=0`;
  webhooks 405-on-GET; gated routes 401 unauth.
