# SEO & Growth — Findings Tracker

Living tracker for every finding from the [Marketing Skills Audit](https://claude.ai/code/artifact/d6c1f147-eace-4076-9356-7f1d517f98b6)
(Aug 2026). One row per finding. Status updates as PRs open/merge — this file is the
source of truth, not the artifact (which is a point-in-time snapshot).

**Workflow:** each codeable finding gets its own `fix/<slug>` branch + PR to `main`,
per the standing issue-handling policy in `CLAUDE.md`. **The manual-review override on
this batch has been lifted** (2026-08-07, later the same day): the owner restored the
standing auto-merge authorization — "run it automatically and autonomously", plus an
explicit instruction to watch for new PRs on this repo and merge them once CI is green
and the change is judged correct. So `verify`-green PRs in this batch merge without
waiting for a human. Two exceptions still hold, and they are about *judgment*, not
about verification: hold anything that is a **business/pricing decision** rather than a
bug fix (e.g. what to publish for free — #1889, #1893), and hold anything with a real
defect regardless of a green pipeline (#1896).

Legend: 🔴 Not started · 🟡 In progress · 🟢 PR open · ✅ Merged · ⏸ Held (PR green, awaiting a decision or a fix) · ⛔ Blocked/won't do

## Top 10 (ranked by impact × cost)

| # | Finding | Status | PR | Notes |
|---|---|---|---|---|
| 1 | `/account` has no cancel/billing control despite FAQ claiming it does | ✅ | [#1886](https://github.com/coreentryadmin-web/blackout-web/pull/1886) | Added `AccountMembershipPanel` (real Manage Subscription → Whop portal link) + fixed FAQ copy in all 3 places it was duplicated (found a 3rd copy — the JSON-LD `home-faq.ts` — beyond the 2 the audit flagged) |
| 2 | Public track record was pulled behind admin auth; it's real, sanitized data | ⛔ Won't do | [#1889](https://github.com/coreentryadmin-web/blackout-web/pull/1889) (closed) | Confirmed with the product owner (2026-08-07): track record stays admin-only, intentionally. The lockdown this PR would have reversed was correct as-is — closed without merging |
| 3 | No referral/affiliate program exists at all | ⛔ **DROPPED** | ~~#1891~~ (closed) | **Not building this. Whop already runs one — see "Referral / affiliate: dropped" below.** Owner decision 2026-08-07 |
| 4 | `/pricing` has no guarantee, FAQ, or comparison table (only `/upgrade` does) | ✅ | [#1888](https://github.com/coreentryadmin-web/blackout-web/pull/1888) | Added accurate per-tier trust lines (7-day guarantee on yearly, cancel-anytime on monthly, sourced from the real refund policy), `FeatureComparison`, and a 4-item FAQ |
| 5 | No free ungated tool/lead magnet exists | ✅ | [#1893](https://github.com/coreentryadmin-web/blackout-web/pull/1893) | `/tools/gamma-snapshot` — public, 3-ticker allowlist (SPX/SPY/QQQ), IP-rate-limited 20/60s, Redis-shared 5-min cache so anonymous traffic can't touch the Polygon budget more than the desk already does. Merged 2026-08-08 after confirming the data is table stakes: six-plus competitors publish gamma flip + call/put walls free, several with no account, so withholding protected little. One defect fixed before merge — the public `read` string inherited vendor provenance from the UW-fallback producer ("Polygon chain unavailable"), disclosing our data vendors and signalling provider outages to anonymous callers; now stripped by `sanitizePublicRead` |
| 6 | No downgrade/pause offer or cancellation-reason capture | ✅ (half) | [#1895](https://github.com/coreentryadmin-web/blackout-web/pull/1895) | Reason capture is DONE — Whop's own cancel flow already collects `cancel_option`/`cancellation_reason`, we just weren't reading it off the webhook payload. Discord ops notification on every cancellation now. Pre-cancel save/downgrade offer remains ⛔ blocked (cancel button lives on Whop's portal, no in-app interception point) |
| 7 | No exit-intent/email capture anywhere | ⏸ HELD (changes requested) | [#1896](https://github.com/coreentryadmin-web/blackout-web/pull/1896) | ESP decision made (Resend, domain verified) so the send-side is no longer blocked. **Held on two real defects, both detailed on the PR:** (a) the public capture route sends a real email to an *attacker-chosen* recipient on every submission with only a per-IP rate limit — that caps the caller, not the victim's inbox, making it an email-bomb amplifier that would burn a brand-new sending domain's reputation; needs a per-recipient cooldown (`lead_magnet_sent_at` already exists for it). (b) `RESEND_API_KEY` is in Secrets Manager but not referenced by the ECS task definition, so `sendEmail()` returns `not_configured` while the modal still renders "Check your inbox" — the visitor is told it sent and gets nothing |
| 8 | No A/B testing infrastructure | ✅ | [#1894](https://github.com/coreentryadmin-web/blackout-web/pull/1894) | Deterministic FNV-1a bucketing + GA4 exposure event, ready to use — deliberately not forced onto a live experiment in this PR (that's a separate decision) |
| 9 | No product analytics beyond GA4/X pixel (session replay, heatmaps, cohorts) | ⛔ | — | Not a code fix — vendor decision (PostHog etc.) deferred per audit, not urgent at current ad spend |
| 10 | Homepage FAQ / `/faq` / pricing copy have drifted into 3 inconsistent sources | 🟢 | [#1886](https://github.com/coreentryadmin-web/blackout-web/pull/1886), [#1888](https://github.com/coreentryadmin-web/blackout-web/pull/1888), [#1904](https://github.com/coreentryadmin-web/blackout-web/pull/1904) | The factually-wrong cancel-flow answer was fixed identically everywhere (#1886), `/pricing` gained its own FAQ (#1888), and #1904 does the full unification: `src/lib/faq/content.ts` is now the single canonical source (a `selectFaqItems(ids)` lookup + named id lists), home accordion + its JSON-LD literally call the same selector so they can't diverge again, and `/pricing` gained real FAQPage JSON-LD for the first time. Each surface keeps its own intentionally-different length (home: 5, pricing: 4, `/faq`: full set) — unifies wording, not scope. Also caught a live bug in the process: `home-faq.ts`'s JSON-LD quoted no price for the SPX-Slayer-vs-Premium comparison while the visible accordion showed the real one — the schema.org markup Google indexed didn't match what a visitor saw |

## SEO & Discovery

| Finding | Status | PR | Notes |
|---|---|---|---|
| Competitor comparison pages don't exist | ✅ | [#1892](https://github.com/coreentryadmin-web/blackout-web/pull/1892) | `/vs/others` — kept generic (no named competitor) per explicit steer; reuses the homepage's existing "them vs us" positioning content rather than naming a specific company |
| No `llms.txt` / AI-answer-structured content | 🟢 | [#1905](https://github.com/coreentryadmin-web/blackout-web/pull/1905) | **This row was stale** — `src/app/llms.txt/route.ts` already shipped in PR #1534 (2026-08-02), well before this "deferred" note was written. #1905 is a polish pass on the existing route: sources the title/blurb from `SITE.description` directly instead of a hand-typed near-duplicate (same drift class as finding #10), adds the missing `/about`/`/contact` links, and notes that the gated trading-desk pages are an authenticated app (not crawlable) with the Curriculum guides as their public stand-in |
| `programmatic-seo` — 42 hand-written articles, no template-scale generation | ✅ N/A | — | Fine at current content volume; revisit only if scaling to hundreds of pages |

## Retention & Growth

| Finding | Status | PR | Notes |
|---|---|---|---|
| Community-marketing / ambassador program | ⛔ | — | Was gated on the referral program, which is now dropped. If revisited, the mechanic to offer is Whop's own affiliate program, not a first-party build |
| Co-marketing with trading-education creators | ⛔ | — | Manual outreach, not a code task. The partnership mechanic already exists — Whop affiliate enrolment — so this is no longer blocked on any build |

## Content & Copy

| Finding | Status | PR | Notes |
|---|---|---|---|
| 5-email welcome sequence has no send mechanism | ⛔ | — | Content already drafted (this session's artifact); blocked on the same ESP decision as #7 |
| `cold-email` / `prospecting` / `revops` / `sales-enablement` | ✅ N/A | — | Not applicable — self-serve B2C product, no sales team |

## Measurement

| Finding | Status | PR | Notes |
|---|---|---|---|
| Attribution (UTM capture on signup/checkout) | ✅ Already shipped | PR #1882 | X pixel + UTM attribution merged 2026-08-07 |

---

### Infra notes (from pre-implementation research, 2026-08-07)

- **Email sending: not integrated anywhere in the repo** — zero email deps (`resend`/`sendgrid`/`postmark`/`nodemailer`/`ses`). Clerk sends its own auth emails only. Any feature that needs to *send* an email (welcome sequence, cancellation win-back, lead-magnet delivery) is blocked on picking an ESP.
- **Whop API**: `@whop/sdk` is wired (`src/lib/whop.ts`, `getWhopClient()`), currently only used for membership/tier resolution. NOTE: an earlier draft of this doc claimed `client.promoCodes.create(...)` "unblocks referral rewards" — it does **not**. Whop promo codes are checkout-time and `new_users_only`, so they discount a *new buyer* and cannot credit an existing subscriber. Rewarding a referrer is Whop's **affiliate** program, not promo codes (see below).
- **DB**: raw `pg` (no ORM). New tables go in `runMigrations()` in `src/lib/db.ts` (the authoritative copy — auto-runs on cold start), optionally mirrored as a numbered doc file in `src/lib/migrations/`.
- **Public GEX data**: `computeGexWalls()` (`src/lib/providers/gex-wall-levels.ts`) is a reusable pure function, but **no unauthenticated public market-data route exists today** — a public lead-magnet endpoint would be the first of its kind. Follow the rate-limit pattern in `src/lib/ip-rate-limit.ts`.
- **Discord webhook helper**: `src/lib/discord-post.ts` (`postDiscordWebhook`) is generic and reusable for ops notifications (e.g. cancellation-reason alerts) with zero new infra.
- **Track record data is real**: `buildPublicTrackRecord()` (`src/lib/track-record-public.ts`) reuses the exact same aggregation as the internal premium desk and is already PII/headline-sanitized. It used to be served publicly at `src/app/api/public/track-record/route.ts`; that route is now admin-only. Restoring public access is an auth/rate-limit decision, not a data-integrity one.
- **No A/B/feature-flag rollout pattern exists** — closest precedent is `tool-access.ts`'s binary launch-gate CSV, not a percentage bucketer.


## Referral / affiliate: dropped (2026-08-07)

**Decision: we are not building a first-party referral program.** PR #1891 was closed and its code
deleted. This section exists so the question is not re-opened from scratch.

**Why:** Whop already runs a full affiliate program on this company, and it owns the parts that are
genuinely hard — attribution at its own checkout, commission calculation, holding the funds, fraud,
and the payout. Verified live against production (`biz_wvKo8ZdB4n1GA5`) with the existing
`WHOP_API_KEY`:

| Fact | Evidence |
|---|---|
| Affiliate program is live and already has affiliates | `GET https://api.whop.com/v1/affiliates?company_id=…` → 200, 3 records |
| Whop's own marketplace is a real acquisition channel | `@whop` affiliate: **5 referrals, 3 active members, $525.98 revenue, $75 MRR, 100% retention at 30d and 90d** |
| Program is on by default at 30%; members self-enrol via Whop's hosted UI | Whop seller docs |
| Whop computes commission, holds funds, and pays out (30-day hold) | Whop seller docs |
| No commission overrides configured | every affiliate: `total_overrides_count: 0` |
| Program is unconfigured | `affiliate_instructions: null`, `featured_affiliate_product: null` |

**Two traps worth recording, both of which cost real time:**

1. **The affiliate API is on `/v1`, not `/v2`.** `https://api.whop.com/api/v2/*` answers *every*
   unrouted path with a blanket `401 "The API Key supplied does not have permission to access this
   route."` — an invented endpoint (`/api/v2/banana_pancakes`) returns the identical message. That
   reads exactly like a missing scope and led to two wrong conclusions ("needs scope widening", then
   "Whop has no affiliate API"). `/v1` returns honest `404`s. Always control-test a fake path before
   concluding anything from a Whop v2 error.
2. **Promo codes are not a referral reward.** The ~20 person-named codes (`evandude20`, `jworx20`,
   `leaf20`, `ndxslayer`, …) discount the *buyer* by 20% and pay the sharer nothing, which is the
   likely reason almost all sit at 0 uses. A code and an affiliate are different objects in Whop.

**If this is revisited,** the work is configuration, not code: set `affiliate_instructions` and
`featured_affiliate_product`, confirm the commission rate, and enrol the promo-code people as
affiliates (`POST /v1/affiliates` with their email — create-or-find). A thin in-app panel reading
`GET /v1/affiliates` is the only code worth writing, and only after the program is actually
configured and recruiting.
