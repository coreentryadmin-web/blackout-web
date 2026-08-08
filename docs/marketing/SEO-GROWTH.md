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
| 6 | No downgrade/pause offer or cancellation-reason capture | ⛔ | — | Reason capture + Discord ops notification is codeable now; a pre-cancel save-offer isn't (cancellation happens entirely on Whop's external portal — no in-app interception point) |
| 7 | No exit-intent/email capture anywhere | 🟢 | [#1896](https://github.com/coreentryadmin-web/blackout-web/pull/1896) | Resend picked and wired (domain verified, API key in Secrets Manager — not yet in the ECS task def, needs a deploy decision). Exit-intent modal → GEX cheat-sheet lead magnet ships in #1896. Images (logo, Discord/X badges, product screenshots) are real inline CID attachments, not hosted URLs — see `lib/email/inline-assets.ts` |
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
| 5-email welcome sequence has no send mechanism | 🟡 | [#1898](https://github.com/coreentryadmin-web/blackout-web/pull/1898) | Day 0/2/4/6/8 drip, Clerk `user.created`-triggered, sent via Resend. Rewritten with bold "trading-floor" copy voice (multi-draft + judge pass) and real product screenshots per the founder's direct design feedback. **Only step 1 (day 0) actually sends today** — `processDueWelcomeSequenceSteps`'s only caller is `/api/cron/welcome-sequence`, and that route has no EventBridge rule (absent from every `railway.*.toml`, `CRON_SERVICE_NAMES`, and `CRON_JOBS`), so steps 2–5 never fire; rows just sit with `next_send_at` in the past. Needs the same infra go-ahead as the ECS `RESEND_API_KEY` wiring above before calling this 🟢 — see #1898 review thread |
| `cold-email` / `prospecting` / `revops` / `sales-enablement` | ✅ N/A | — | Not applicable — self-serve B2C product, no sales team |

### Billing lifecycle emails (not an original audit finding — added 2026-08-07 per direct request)

| Email | Trigger | Status | PR | Notes |
|---|---|---|---|---|
| Welcome to SPX Slayer | `membership.activated`, free→community | 🟢 | [#1901](https://github.com/coreentryadmin-web/blackout-web/pull/1901) | |
| Welcome to Premium | `membership.activated`, →premium (dual-opener: fresh vs upgraded-from-SPX-Slayer; annual flourish when billing interval resolves to yearly) | 🟢 | [#1901](https://github.com/coreentryadmin-web/blackout-web/pull/1901) | Billing interval isn't tracked anywhere (no DB column, not on the webhook payload) — resolved via a live `whop.plans.retrieve(planId)` call, cached in-memory per plan id |
| Downgrade confirmed | `membership.activated`, premium→community | 🟢 | [#1901](https://github.com/coreentryadmin-web/blackout-web/pull/1901) | |
| Access ended | `membership.deactivated`, any paid tier→free | 🟢 | [#1901](https://github.com/coreentryadmin-web/blackout-web/pull/1901) | The real "exit" email — deliberately zero guilt-trip / zero dark-pattern retention pressure, per explicit brand direction |
| Cancellation scheduled | `membership.cancel_at_period_end_changed`, cancel_at_period_end=true | 🟢 | [#1901](https://github.com/coreentryadmin-web/blackout-web/pull/1901) | Not a tier change (access continues until period end) — handled directly off the webhook payload boolean, not the tier-diff path |
| Cancellation reversed | `membership.cancel_at_period_end_changed`, cancel_at_period_end=false | 🟢 | [#1901](https://github.com/coreentryadmin-web/blackout-web/pull/1901) | |
| Payment failed (dunning) | `payment.failed` / `invoice.past_due` | 🟢 | [#1901](https://github.com/coreentryadmin-web/blackout-web/pull/1901) | Gated on `!wasAlreadyInGrace` (checked via the existing dunning-grace cache before marking it) so a retry within the same grace window doesn't re-send |

Tier-transition detection (`lib/billing-lifecycle-email.ts`) diffs the `users` table's tier immediately before each sync against the tier the sync resolves — no new DB table needed, and it self-dedups across webhook retries *and* the hourly reconcile cron for free. Deliberately wired into the real-time webhook path only, **not** `reconcileAllMemberships` — a first-run reconcile correcting a backlog of stale rows would otherwise fire a flood of misleading "you just upgraded!" emails.

### Resend platform capabilities (not an original audit finding — added 2026-08-08 per direct request: "start on tracking, fix all the other ones too")

| Capability | Status | PR | Notes |
|---|---|---|---|
| Delivery/open/click/bounce tracking | 🟢 | [#1903](https://github.com/coreentryadmin-web/blackout-web/pull/1903) | New `email_events` table + `webhook/resend` route, verified via the Resend SDK's built-in `webhooks.verify()` (Svix-based). Every send now carries a `tags: [{name:"template", value:...}]` so events can be broken down per-template. Minimal admin JSON surface at `/api/admin/email-events` (counts by template/event-type + last 100 raw events) — a visual dashboard is a reasonable follow-up once there's a few weeks of real data, deliberately not built yet |
| Real one-click unsubscribe (RFC 8058) | 🟢 | [#1903](https://github.com/coreentryadmin-web/blackout-web/pull/1903) | HMAC-signed per-email token (`lib/email/unsubscribe-token.ts`, reuses `RESEND_API_KEY` as key material — no new secret/deploy step needed), `List-Unsubscribe` + `List-Unsubscribe-Post` headers, real footer link. **Scoped to marketing-category sends only** (welcome sequence + exit-intent cheat sheet) via a per-contact Resend **topic** opt-out, deliberately NOT the account-wide suppression list — suppression blocks every future send including billing/account-state emails (payment failed, access ended) that aren't optional. This was flagged as a follow-up when the exit-intent PR (#1896) shipped a one-time send; now that a real multi-email sequence exists, closing it stopped being optional |
| Contact/segment sync (broadcast infra) | 🟢 | [#1903](https://github.com/coreentryadmin-web/blackout-web/pull/1903) | `lib/resend-contacts.ts` keeps a Resend contact + tier segment (Free/SPX Slayer/Premium) in sync on signup and every tier change, so an admin can compose/send a broadcast straight from **Resend's own dashboard** (Contacts → filter by segment → Broadcasts) — deliberately no custom in-app campaign composer, that would just duplicate what Resend already provides. ⚠️ "Premium" segment reuses a pre-existing "General" segment (created before this session, name not changed) — the account's plan caps segments at 3 and one slot was already spent, see the file's header comment |
| Topics / preference distinction | 🟢 | [#1903](https://github.com/coreentryadmin-web/blackout-web/pull/1903) | One topic, "Product & Market Updates" (`defaultSubscription: opt_in`), wired into marketing sends via `topicId` so Resend automatically respects a contact's per-topic opt-out. Scoped down from a full multi-topic preference *center* (deliberately — billing emails stay non-optional/out of the topic system entirely, so there's currently only one real preference to expose) |

**Both account-side setup steps are now live (completed 2026-08-08, on explicit go-ahead):**
1. **Resend webhook subscription registered** — `create-webhook` → `https://blackouttrades.com/api/webhook/resend`, 12 events (`email.sent/delivered/delivery_delayed/complained/bounced/opened/clicked/failed/suppressed` + `contact.created/updated/deleted`). Webhook ID `0a1c6218-ee8c-40aa-a15f-719b84b48c6a`.
2. **5 config values written to the `blackout-production/app/env` Secrets Manager secret**, verified present post-write (`RESEND_WEBHOOK_SECRET` from step 1, plus `RESEND_TOPIC_MARKETING_ID`, `RESEND_SEGMENT_FREE_ID`, `RESEND_SEGMENT_SPX_SLAYER_ID`, `RESEND_SEGMENT_PREMIUM_ID` — same IDs as above). Written via `aws secretsmanager put-secret-value --secret-string file://...` (file-reference form, never inlined on the command line) after merging into a local copy of the existing 91-key secret (96 keys post-merge) — secret value never printed to any log or persisted beyond the immediate write; scratch files deleted right after.

Topic + all 3 segments were already created in the live Resend account via the MCP tools in the same session. **Note:** the running ECS tasks won't pick up these new env vars until the next deploy (Secrets Manager values are read at container start) — this will happen naturally when #1898/#1901/#1903 merge and `ecr-push-production.yml` force-deploys, so no separate action is needed unless the webhook needs to be live before that merge.

## Measurement

| Finding | Status | PR | Notes |
|---|---|---|---|
| Attribution (UTM capture on signup/checkout) | ✅ Already shipped | PR #1882 | X pixel + UTM attribution merged 2026-08-07 |

---

### Infra notes (from pre-implementation research, 2026-08-07)

- **Email sending: now live via Resend** (`resend` npm package, `lib/email/resend-client.ts`). Domain `send.blackouttrades.com` verified. `RESEND_API_KEY` is in the `blackout-production/app/env` Secrets Manager secret but **not yet wired into the ECS task definition** (per-key secret references) — needs a deploy decision before sends actually go out in production. Clerk still sends its own auth emails separately. All lifecycle email images (logo, Discord/X badges, product screenshots) are embedded as real inline CID attachments (`lib/email/inline-assets.ts`), not hosted URLs — renders correctly regardless of deploy timing or a recipient's "load remote images" setting.
- **Whop API**: `@whop/sdk` is wired (`src/lib/whop.ts`, `getWhopClient()`), currently only used for membership/tier resolution. `client.promoCodes.create(...)` is available and unused — this unblocks referral rewards without new infra.
- **DB**: raw `pg` (no ORM). New tables go in `runMigrations()` in `src/lib/db.ts` (the authoritative copy — auto-runs on cold start), optionally mirrored as a numbered doc file in `src/lib/migrations/`.
- **Public GEX data**: `computeGexWalls()` (`src/lib/providers/gex-wall-levels.ts`) is a reusable pure function, but **no unauthenticated public market-data route exists today** — a public lead-magnet endpoint would be the first of its kind. Follow the rate-limit pattern in `src/lib/ip-rate-limit.ts`.
- **Discord webhook helper**: `src/lib/discord-post.ts` (`postDiscordWebhook`) is generic and reusable for ops notifications (e.g. cancellation-reason alerts) with zero new infra.
- **Track record data is real**: `buildPublicTrackRecord()` (`src/lib/track-record-public.ts`) reuses the exact same aggregation as the internal premium desk and is already PII/headline-sanitized. It used to be served publicly at `src/app/api/public/track-record/route.ts`; that route is now admin-only. Restoring public access is an auth/rate-limit decision, not a data-integrity one.
- **No A/B/feature-flag rollout pattern exists** — closest precedent is `tool-access.ts`'s binary launch-gate CSV, not a percentage bucketer.
