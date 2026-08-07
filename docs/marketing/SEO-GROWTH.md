# SEO & Growth — Findings Tracker

Living tracker for every finding from the [Marketing Skills Audit](https://claude.ai/code/artifact/d6c1f147-eace-4076-9356-7f1d517f98b6)
(Aug 2026). One row per finding. Status updates as PRs open/merge — this file is the
source of truth, not the artifact (which is a point-in-time snapshot).

**Workflow:** each codeable finding gets its own `fix/<slug>` branch + PR to `main`,
per the standing issue-handling policy in `CLAUDE.md`. **PRs are NOT auto-merged for
this batch** — user reviews and merges manually (explicit override of the standing
auto-merge authorization, requested 2026-08-07).

Legend: 🔴 Not started · 🟡 In progress · 🟢 PR open · ✅ Merged · ⛔ Blocked (needs human input/decision)

## Top 10 (ranked by impact × cost)

| # | Finding | Status | PR | Notes |
|---|---|---|---|---|
| 1 | `/account` has no cancel/billing control despite FAQ claiming it does | 🟢 | [#1886](https://github.com/coreentryadmin-web/blackout-web/pull/1886) | Added `AccountMembershipPanel` (real Manage Subscription → Whop portal link) + fixed FAQ copy in all 3 places it was duplicated (found a 3rd copy — the JSON-LD `home-faq.ts` — beyond the 2 the audit flagged) |
| 2 | Public track record was pulled behind admin auth; it's real, sanitized data | 🟢 | [#1889](https://github.com/coreentryadmin-web/blackout-web/pull/1889) | ⚠️ Reverses a previously *deliberate* lockdown (git history is squashed, couldn't find the original reason) — flagged prominently in the PR, please confirm no compliance/legal concern before merging |
| 3 | No referral/affiliate program exists at all | 🟢 | [#1891](https://github.com/coreentryadmin-web/blackout-web/pull/1891) | Full tracking/attribution/conversion shipped. Reward is manual-for-now (Discord ops ping) — Whop's promo-code API turned out to be checkout-time/new-users-only, doesn't cleanly credit an existing subscriber's renewal; see PR body |
| 4 | `/pricing` has no guarantee, FAQ, or comparison table (only `/upgrade` does) | 🟢 | [#1888](https://github.com/coreentryadmin-web/blackout-web/pull/1888) | Added accurate per-tier trust lines (7-day guarantee on yearly, cancel-anytime on monthly, sourced from the real refund policy), `FeatureComparison`, and a 4-item FAQ |
| 5 | No free ungated tool/lead magnet exists | 🔴 | — | `computeGexWalls()` reusable; needs new public no-auth rate-limited route (first of its kind) |
| 6 | No downgrade/pause offer or cancellation-reason capture | 🟡 | [#1895](https://github.com/coreentryadmin-web/blackout-web/pull/1895) | Reason capture is DONE — Whop's own cancel flow already collects `cancel_option`/`cancellation_reason`, we just weren't reading it off the webhook payload. Discord ops notification on every cancellation now. Pre-cancel save/downgrade offer remains ⛔ blocked (cancel button lives on Whop's portal, no in-app interception point) |
| 7 | No exit-intent/email capture anywhere | ⛔ | — | Capture UI + DB storage is codeable now; **actually emailing captured leads needs a new ESP (no email-sending infra exists at all — zero email deps in the repo)** — needs your call on provider (Resend recommended) before the send-side can ship |
| 8 | No A/B testing infrastructure | 🔴 | — | No existing rollout/bucketing pattern found — building minimal cookie-hash layer from scratch |
| 9 | No product analytics beyond GA4/X pixel (session replay, heatmaps, cohorts) | ⛔ | — | Not a code fix — vendor decision (PostHog etc.) deferred per audit, not urgent at current ad spend |
| 10 | Homepage FAQ / `/faq` / pricing copy have drifted into 3 inconsistent sources | 🟡 | [#1886](https://github.com/coreentryadmin-web/blackout-web/pull/1886), [#1888](https://github.com/coreentryadmin-web/blackout-web/pull/1888) | The factually-wrong cancel-flow answer is now fixed identically everywhere it appeared (#1886), and `/pricing` gained its own (now-correct) FAQ (#1888). Full source-of-truth unification across all 4 surfaces (home accordion / `/faq` / `/pricing` / JSON-LD) is a larger refactor — deliberately not done, each is a different curated length by design — ⛔ deferred |

## SEO & Discovery

| Finding | Status | PR | Notes |
|---|---|---|---|
| Competitor comparison pages (e.g. `/vs/spotgamma`) don't exist | 🔴 | — | Homepage already has a "them vs us" table to source from |
| No `llms.txt` / AI-answer-structured content | ⛔ | — | Lower priority, deferred |
| `programmatic-seo` — 42 hand-written articles, no template-scale generation | ✅ N/A | — | Fine at current content volume; revisit only if scaling to hundreds of pages |

## Retention & Growth

| Finding | Status | PR | Notes |
|---|---|---|---|
| Community-marketing / ambassador program | ⛔ | — | Deferred until referral program (#3) ships — natural follow-on |
| Co-marketing with trading-education creators | ⛔ | — | Manual outreach, not a code task — deferred until referral program exists to offer as the partnership mechanic |

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
- **Whop API**: `@whop/sdk` is wired (`src/lib/whop.ts`, `getWhopClient()`), currently only used for membership/tier resolution. `client.promoCodes.create(...)` is available and unused — this unblocks referral rewards without new infra.
- **DB**: raw `pg` (no ORM). New tables go in `runMigrations()` in `src/lib/db.ts` (the authoritative copy — auto-runs on cold start), optionally mirrored as a numbered doc file in `src/lib/migrations/`.
- **Public GEX data**: `computeGexWalls()` (`src/lib/providers/gex-wall-levels.ts`) is a reusable pure function, but **no unauthenticated public market-data route exists today** — a public lead-magnet endpoint would be the first of its kind. Follow the rate-limit pattern in `src/lib/ip-rate-limit.ts`.
- **Discord webhook helper**: `src/lib/discord-post.ts` (`postDiscordWebhook`) is generic and reusable for ops notifications (e.g. cancellation-reason alerts) with zero new infra.
- **Track record data is real**: `buildPublicTrackRecord()` (`src/lib/track-record-public.ts`) reuses the exact same aggregation as the internal premium desk and is already PII/headline-sanitized. It used to be served publicly at `src/app/api/public/track-record/route.ts`; that route is now admin-only. Restoring public access is an auth/rate-limit decision, not a data-integrity one.
- **No A/B/feature-flag rollout pattern exists** — closest precedent is `tool-access.ts`'s binary launch-gate CSV, not a percentage bucketer.
