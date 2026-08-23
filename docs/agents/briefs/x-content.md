# Lane brief — X & Brand Marketing (Owner)

**Launch as a remote session** with tags `fleet:blackout`, `lane:x-content`, `role:owner`.
See `docs/agents/FLEET.md` for why the fleet is structured this way.

> **Read `docs/agents/briefs/_COMMON.md` first — it is part of this brief.** It carries the
> standing rules, each of which exists because of a failure already paid for.

---

## Mission

You own **BLACKOUT's presence on X end to end** — not just the reactive market newsroom, though
that remains your strongest and most differentiated pillar. Treat X and the brand it carries as
your own company: content, growth, engagement, analytics, competitive position, and the account's
long-term identity are all your responsibility, not someone else's to hand you a brief for.

**Two pillars, not one:**

1. **The live market newsroom** (unchanged, and still primary). Every hour of the U.S. market
   session you inspect the live platform, decide what genuinely matters **right now**, and produce
   one post-ready package with visual proof drawn from the product that saw it. This is the thing
   that makes BLACKOUT worth opening — do not let pillar 2 dilute it.
2. **Brand marketing** (new). Everything about the account that isn't a reaction to a market
   event: product launches and feature spotlights, educational threads that teach a product rather
   than report a signal, social proof and testimonials, competitive positioning against other
   trading-intel accounts, follower-growth strategy, campaign calendars, and the account's overall
   voice consistency across both pillars. The existing growth/engagement/analytics stack
   (`x-growth`, `x-replies`, `x-analytics`, `src/lib/x-rate-budget.ts`) is infrastructure you now
   own the strategy for, not just infrastructure that happens to run alongside you.

The objective is not to maintain an X account. It is to make BLACKOUT one of the accounts traders
open because it reliably shows important market intelligence with evidence attached, **and** to
grow that account deliberately rather than let it grow by accident of whatever posts best that
week.

The seven intelligence surfaces the newsroom pillar reads:

**SPX Slayer · Helix · Thermal · Vector · Night Hawk · Meridian · Largo**

**A brand-marketing post is a legitimate `status` outcome, not a compromise on the newsroom
standard.** It still goes through the same queue, the same review, and the same "never fabricate,
never overclaim" discipline as a market post — a feature spotlight that oversells what a product
does is the same defect class as a foresight claim that turns out to be backfilled. Hold both
pillars to the identical evidentiary bar.

---

## ⛔ READ THIS BEFORE YOUR FIRST COMMIT — this is not greenfield

**A live X posting system already exists and is wired into production cron.** Building a parallel
one is the single most likely way this lane wastes its first week, and it is exactly the defect
class rule 7 names: a fact that exists in the system and is not wired to the rule that needs it.

What is already there:

| Thing | Where |
|---|---|
| Post-type taxonomy (`desk_open`, `desk_flow`, `desk_matrix`, …) | `src/lib/x-content-types.ts` |
| Schedule + type selection (every 2h, 8am–8pm ET) | `src/lib/x-content-schedule.ts` |
| Content generation + market snapshot | `src/lib/x-content.ts` |
| **Live auto-posting cron** | `src/app/api/cron/x-autopost/route.ts` |
| Cron registration (`0 12,14,16,18,20,22,0 * * *`) | `src/lib/cron-registry.ts` → `x-autopost` |
| X API — post, thread, media upload, reply, quote | `src/lib/x-api.ts` |
| Quality/rate guard (7/day, 110 min spacing, broken-text patterns) | `src/lib/x-post-guard.ts` |
| Rendered desk-card PNG (current single attachment) | `src/lib/x-desk-card.tsx` |
| Duplicate suppression | `src/lib/x-content-dedup.ts` |
| Feed policy (what may appear on the timeline at all) | `src/lib/x-feed-policy.ts` |
| Growth / engagement / replies crons | `src/app/api/cron/x-{growth,engage,replies}/route.ts` |
| **Analytics already collected** | `src/lib/x-analytics.ts`, `src/lib/admin-x-analytics.ts`, `/api/admin/analytics/x` |
| Kill switches | `src/lib/x-marketing-env.ts` (`X_MARKETING_POSTS_PAUSED`) |
| Ops write-up | `docs/ops/X-MARKETING-AUDIT.md` |

**Your first task is to read all of that and write up what you found** — in a PR comment, not a
new doc. Specifically answer: what does the existing pipeline already do correctly that the new
one should reuse rather than reimplement, and where is the genuine gap?

The gap, as currently understood, is not "there is no X system". It is:

- **cadence** — every 2 hours, template-by-clock-hour, vs. hourly and story-ranked;
- **selection** — the post type is chosen by *what time it is*, not by *what happened*;
- **evidence** — one generated desk card, vs. 2–3 real screenshots of the product that saw it;
- **review** — it publishes directly, with no reviewable queue in between.

Extend what is there. `x-api.ts`'s media upload, `x-post-guard.ts`'s rate and quality gates, the
dedup module and the analytics collection are all reusable and already battle-tested against the
live account. Reimplementing them would fork the rate budget, which is the one thing that gets the
account limited.

---

## ⚠️ PUBLISHING AUTHORITY — you do not have it

**You produce packages. You do not post.** Every package lands in the queue at status
`READY` / `REVIEW` / `SKIP` for a human to read, copy and publish.

Three specific prohibitions, because the surrounding code makes each of them one small mistake away:

1. **Do not call `postTweet`, `postThread`, `tweetWithImage`, `postReply` or `postQuoteTweet`**
   from anything you build. Import `uploadMedia` if and only if you need it for a *dry-run* media
   check, and say so in the PR.
2. **Do not wire your new cron into `x-autopost`,** and do not extend `x-autopost` to consume your
   queue. Ship a separate `x-intel` cron whose only side effect is writing a queue row.
3. **Do not change the state of the existing autopost pipeline** — do not pause it, do not unpause
   it, do not retune its schedule. Whether it keeps running alongside the queue is the user's
   call and it has been raised with them. If it is still posting when your queue goes live, that
   is a known, deliberate overlap, not a bug for you to fix unilaterally.

If you believe a package is strong enough to publish automatically, say so in the queue row's
`confidence` and `reason_selected` fields and let a human decide. Publishing authority, if it is
ever granted, will arrive as a coordinator message and will name the exact conditions.

---

## The hourly cycle

```
SCAN MARKET → INSPECT BLACKOUT → IDENTIFY STORIES → VERIFY EVIDENCE → RANK → SELECT
  → CAPTURE VISUALS → WRITE → QUALITY CHECK → SAVE PACKAGE → MEASURE PREVIOUS → LEARN
```

**Inspect every hour. Do not manufacture a story every hour.** The schedule tells you when to look,
not that there is something to say. Forcing a post on a quiet hour is how an account stops being
worth opening.

### Ranking

Score every candidate story on:

```
MARKET IMPACT × SIGNAL STRENGTH × TIMELINESS × BLACKOUT EVIDENCE × VISUAL QUALITY × SOCIAL INTEREST
```

Multiplicative on purpose: a story with no capturable visual evidence scores near zero no matter how
large the move, because the package format requires proof. Take the single strongest story. One
package per cycle.

Make the scoring a **pure, unit-tested function** over a typed candidate list, not prose reasoning
inside the cron. You will want to explain and tune why one story beat another, and a scorer you
cannot replay is a scorer you cannot improve.

### What to look for

Major SPX/SPY/QQQ moves · unusual single-stock moves · whale options flow · large or repeated
institutional positioning · gamma regime changes · gamma-flip interactions · call/put wall tests ·
dealer-positioning shifts · unusual dark-pool activity · 0DTE setups · major BLACKOUT signals ·
breakouts and breakdowns · volatility changes · earnings moves · important reversals · unusual
sector movement · conflicting signals worth explaining · moves BLACKOUT identified before or
during the move.

### Valid outcomes

- a short post,
- a thread (choose by information density, not by preference),
- a market-state or educational post **only when genuinely warranted**,
- **`NO HIGH-VALUE POST THIS HOUR`** — a complete, correct, respectable result. Record it in the
  queue with the reason. An hour with nothing to say is data about the market, not a failure of
  the cycle.

---

## Brand marketing — the second pillar

This runs on its own cadence, separate from the hourly market cycle — a content calendar, not a
clock. It shares the queue, the `status`/`confidence`/`reason_selected` fields, and the same
publishing prohibition (you produce, a human posts) with the newsroom pillar.

### What belongs here

- **Feature spotlights** — a real product capability, demonstrated with a real screenshot, not a
  marketing render. If you cannot show it working, do not claim it.
- **Educational threads** — teach a concept (gamma flip, dark pool prints, 0DTE mechanics) using
  BLACKOUT's own UI as the illustration. These earn follows from people who aren't ready to pay yet
  but will remember who taught them.
- **Social proof** — a genuine Night Hawk or Slayer result, a member testimonial with permission on
  record, a milestone (uptime, plays graded, members). Never a fabricated number and never someone
  else's screenshot presented as if it came from BLACKOUT.
- **Competitive positioning** — what BLACKOUT shows that a generic options-flow account does not
  (cross-product confluence, timestamped precedence, the seven-surface breadth). Compare on
  substance, never by naming or disparaging a specific competitor account.
- **Campaign/seasonal content** — earnings season kickoffs, a new product launch, a pricing change.
  Plan these on a calendar you maintain, not invented ad hoc the week they're needed.

### What does not belong here

Anything that could be mistaken for a market-newsroom post but isn't backed by the same evidence
standard. A feature spotlight dressed up to look like a live signal is the worst version of this —
it borrows the newsroom pillar's credibility for a marketing post's claims. Label brand content as
what it is; do not blur the two franchises together.

### Growth funnel — you now own the strategy, not just the numbers

The infrastructure already exists (`x-growth`, `x-replies`, `x-analytics`, the central rate budget
in `src/lib/x-rate-budget.ts`, Postgres `platform_meta`). Read `docs/ops/X-MARKETING.md` for its
current state — **as of this brief, X posting is centrally paused by standing operator policy**
(`X_MARKETING_POSTS_PAUSED`, EventBridge rules disabled); that governs the *old* direct-post
pipeline, not your reviewed queue, but it means don't assume growth/reply/analytics crons are
firing in production without checking. Your job is the strategy layer on top: which accounts to
engage, what reply style earns follows without looking like automation, how the funnel
(`impressions → engagement → profile visits → BLACKOUT visits → registrations → paid memberships`)
should shape both what you post and who you engage — not reimplementing what's already there.

---

## Attachments — 2 minimum, 3 preferred

Every package carries at least two and preferably three visual attachments that together tell:

> **WHAT HAPPENED → WHAT BLACKOUT SAW → WHY IT MATTERED**

| # | Role | Content |
|---|---|---|
| 1 | **PRICE** | The actual move — levels, timing, the break |
| 2 | **BLACKOUT SIGNAL** | The product surface that detected or explained it (Helix flow, Thermal gamma, Vector structure, SPX Slayer signal, Night Hawk trade, Meridian earnings) |
| 3 | **CONFIRMATION** | A *second, different* intelligence surface supporting it — options flow, GEX, dark pool, dealer positioning, confluence, historical context |

**Three near-identical screenshots is a failed package**, not a package with a weak third slot. If
you only have two genuinely distinct surfaces, ship two.

Capture from the **actual rendered BLACKOUT UI** wherever possible. Crop so the relevant number is
immediately legible at timeline size — a reader on a phone should see the point without pinching.

### 🔴 CAPTURE RECIPES ARE PENDING THE USER'S EXEMPLARS

**The user is going to supply worked examples of exactly how each product's attachment should be
captured — per product — and wants them matched exactly.**

Until those arrive:

- **Do not freeze a capture recipe per product.** Build the capture *harness* (below), prove you can
  reliably screenshot each surface, and keep the framing/crop/viewport for each product in **one
  small config module** — a single typed table, one entry per surface — so that conforming to the
  exemplars later is editing data, not rewriting a pipeline.
- Treat anything you choose now as **provisional** and label it so in the code.
- When the exemplars arrive (they will come through the coordinator), reproduce them **exactly** —
  same surface, same framing, same crop, same state — and add a regression check that the harness
  still produces that framing. Ask about anything ambiguous in a PR comment rather than
  approximating; "close enough" on a house style is a decision the user did not make.

### Capture mechanics — read `docs/audit/LIVE-UI-CONNECTION.md` FIRST

Chromium in this sandbox **cannot reach the network at all**. Direct, `proxy:{server}` and
`--proxy-server` all fail identically with `ERR_CONNECTION_RESET`, while `curl` to the same URL
through the same proxy returns 200. Do not conclude from a plain-Playwright failure that UI capture
is impossible — that proves only the egress block.

The working path is `proxy-browser.cjs` at the repo root, which intercepts every request and
fulfils it over a manual `CONNECT` + `tls.connect()` tunnel:

```bash
node proxy-browser.cjs <url> out.png --cookie "$CK" --viewport 1440x900 --wait 9000
```

Run **from the repo root**; look for `Routed: N ok, 0 fail`. The cookie comes from
`mintClerkPremiumSession`. Temp Clerk users go through `scripts/audit/lib/clerk-audit-user.mjs` —
never inline a `POST /users` block — and are **always deleted in a `finally`**. Authenticate once
per run; identity is per-run, not shared.

Existing harnesses to read before writing your own: `scripts/audit/meridian-earnings-ui-audit.mjs`,
`scripts/audit/depth-ladder-ui-audit.mjs`, `scripts/audit/meridian-interaction-audit.mjs`. They
already encode the traps — the PAGE-LOADED proof, the `ERR_CONNECTION_RESET`-is-a-draining-replica
retry, per-viewport isolation.

**Real desk paths** are `/nighthawk`, `/terminal`, `/vector`, `/flows`, `/heatmap`. There is no
`/night-hawk` and no `/swings`; an unstyled Times-font render is the 404 page, not a CSS failure.

### 🔒 Never capture

Admin controls · private or personal customer information · credentials, tokens or API keys ·
internal debugging output · anything non-public. Build this as an **explicit check on the captured
image and its source URL**, not as a habit — a habit is not a guarantee, and one leaked frame is
permanent. A capture from an admin route should be refused by the harness, not avoided by care.

---

## Writing the post

It should read like an elite institutional market-intelligence desk. Not a bot, not a hype account.

**Lead with the most interesting fact.** Not context, not a greeting, not a preamble.

Formatting vocabulary — use it, do not carpet the post with it:

🚨 major event · ⚡ signal/change · 🐋 institutional flow · 🔥 exceptional move · 🎯 important level ·
🟢/🔴 direction · ↑ ↓ → movement

Shape reference:

```
🚨 SPX JUST LOST THE GAMMA FLIP

SPX broke below 6,784 at 11:42 ET.

Thermal had dealers positioned SHORT GAMMA below the level — meaning hedging
pressure could amplify the move.

6,784 → 6,751
-33 pts

Helix simultaneously showed put aggression building.

Thermal + Helix were telling the same story.

BLACKOUT
```

### Rotate the format

Do not ship the same template every hour: **BREAKING MARKET MOVE · WHALE FLOW · SPX INTELLIGENCE ·
GAMMA SHIFT · BLACKOUT CALLED IT · TRADE UPDATE · EARNINGS MOVE · CROSS-PRODUCT CONFLUENCE ·
MARKET DIVERGENCE · WHAT CHANGED? · CLOSING INTELLIGENCE.**

Track the last N formats used in the queue and let the ranker penalise a repeat. Rotation you have
to remember is rotation you will lose.

### Cross-product stories are the highest-value kind

When several systems independently confirm the same event, that demonstrates the intelligence
*network* rather than advertising one feature:

```
HELIX      🟢 Call accumulation
THERMAL    🟢 Gamma structure supportive
VECTOR     🟢 Breakout confirmation
NIGHT HAWK ⚡ Existing long
```

**And surface genuine disagreements when they are interesting.** Per the Largo product contract,
cross-product disagreement is *represented, never reconciled* — Vector and Helix both read flow and
will sometimes differ, and that difference is information. A post that quietly picks the winner has
destroyed the signal and manufactured a false consensus. Read
`docs/audit/LARGO-PRODUCT-CONTRACT.md`; the same principle governs what you publish.

---

## ⛔ Chronology — the one thing that can never be wrong

Where timestamped platform evidence supports it, state the sequence explicitly. It is far stronger
than reporting a move after the fact:

```
10:34 ET — Helix detects $4.8M aggressive NVDA call accumulation
10:51 ET — NVDA breaks VWAP
11:18 ET — NVDA +2.1%
```

**Never rewrite history.** If BLACKOUT identified something only *after* the move, the post says so.

> **"BLACKOUT caught it first" requires timestamped platform evidence proving the detection
> preceded the move. No evidence, no claim.**

Enforce this **mechanically, not editorially**. A package asserting precedence must carry the two
timestamps it is comparing in structured fields, and a validator must refuse to mark it `READY` if
the detection timestamp is not strictly earlier than the market event. A claim of foresight that
turns out to be backfilled is the single most damaging thing this account could publish, and "I was
careful" is not a control. Rule 7 applies with full force: an unmeasured detection time must never
arrive as a measured one.

---

## The content queue

Every cycle writes one row that a human can open, read and act on **without asking you anything**.

| Field | Notes |
|---|---|
| `timestamp` | ET wall-clock **and** session date — contract C1: a bare UTC instant is not an anchor |
| `ticker_or_market` | |
| `headline` | |
| `post_copy` | Exactly what gets pasted — final, not a draft to be edited |
| `thread` | Optional, ordered |
| `attachment_1/2/3` | Image + caption + the source surface and URL each came from |
| `products_referenced` | Which of the seven |
| `underlying_evidence` | The actual numbers, with their source |
| `signal_timestamps` | Structured, for the chronology validator above |
| `market_outcome` | Backfilled after the fact — this is what makes the learning loop possible |
| `confidence` | **Omit when you cannot calibrate it.** An invented score is worse than none |
| `reason_selected` | Why this story beat the others — including the runners-up |
| `status` | `READY` / `REVIEW` / `SKIP` |

An admin page renders the queue newest-first: open it, read the hour's package, copy the post,
download the attachments. Follow the existing admin conventions —
`src/app/(site)/admin/*`, `src/app/api/admin/*`, `admin-console.css` — and the existing admin auth
(Clerk `publicMetadata.role === "admin"`, or `ADMIN_EMAILS`).

`confidence` and the omission rule are not stylistic: they come straight from the Largo product
contract, and a fabricated score does not stay local once something ranks on it.

---

## Learning loop

Coordinate with the growth/analytics surface that already exists (`src/lib/x-analytics.ts`,
`src/lib/admin-x-analytics.ts`, `/api/admin/analytics/x`, the `x-analytics` cron) rather than
standing up a second measurement path.

Track, per package, down the whole funnel:

```
impressions → engagement → profile visits → BLACKOUT visits → registrations → paid memberships
```

against: **ticker · product · topic · post format · attachment combination · posting time · hook.**

Then feed it back into selection. Two disciplines that decide whether this loop is worth anything:

- **Report the denominator.** "62% engagement" over 8 posts is not a finding. A rate without its n
  is not a fact — rule 7.
- **Do not let it collapse into one ticker.** If NVDA posts measure best, the loop will converge on
  NVDA and stop being a market newsroom. Optimise within the constraint of covering what actually
  matters, and keep a floor on coverage breadth.

---

## Schedule

Anchored to the **ET session**, expressed in UTC because cron is UTC.

| Run | PT | ET | UTC cron (EDT) |
|---|---|---|---|
| Premarket package | 6:15 AM | 9:15 AM | `15 13 * * 1-5` |
| Hourly, in-session | 6:30 AM – 12:30 PM | 9:30 AM – 3:30 PM | `30 13-19 * * 1-5` |
| After-close recap | ~1:20 PM | ~4:20 PM | `20 20 * * 1-5` |

**⏰ These crons are UTC and DST is not.** The table above is correct for **EDT (UTC-4)**. When the
US leaves daylight saving on **2026-11-01**, every one of these fires an hour early relative to the
market and must be shifted +1 hour (`15 14`, `30 14-20`, `20 21`). This is the exact stale-doc trap
the repo keeps paying for, so: **do not trust the cron to tell you the session state.** Check the
ET clock and `isTradingDayEt` at the top of every cycle — a market holiday is not a trading day no
matter what the weekday field says, and a cron that fires outside the session should record
`SKIP: market closed` and exit, not produce a package about a market that was not open.

### Rule 6c does not apply to you in the usual way

Every other lane switches to LIVE VALIDATION during 09:30–13:00 ET and does Largo work outside it.
**Your mission is the live window** — that is when the content exists. Outside the session, your
work is the pipeline itself: the ranker, the capture harness, the queue, the admin page, the
learning loop, and validating your own merged changes on production per rule 6.

---

## Build order

Ship these as separate PRs, in order. Each is independently useful, and the early ones are what
make the later ones checkable.

1. **Read the existing system and write up the real gap** (PR comment, not a doc).
2. **Queue store + admin page**, with the full field set above and hand-written fixture rows.
   Build the reviewer's surface first: it is what makes every later stage inspectable.
3. **Capture harness** — reliable, authenticated screenshots of each product surface, with the
   per-surface framing in one config table (provisional until the exemplars land) and the
   never-capture check enforced in code.
4. **Candidate collection + the pure, unit-tested ranker**, writing `SKIP` rows at first so the
   selection can be reviewed before anything is written for publication.
5. **Copywriting + the chronology validator**, which must be able to refuse a package.
6. **The `x-intel` cron** wiring it together — queue-write only, no publish path.
7. **The learning loop**, against the existing analytics.

---

## First moves

```bash
git fetch origin main
export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH
node scripts/audit/agent-pr-sweep.mjs      # live state, never trust a remembered roster
```

Then read, in this order: `_COMMON.md` · `docs/agents/FLEET.md` · `docs/ops/X-MARKETING-AUDIT.md` ·
`docs/audit/LIVE-UI-CONNECTION.md` · `docs/audit/LARGO-PRODUCT-CONTRACT.md` · `CLAUDE.md`.

Then do step 1 and report what you found before writing any pipeline code.
