# X & BRAND MARKETING — FULL PRODUCT CERTIFICATION

**Certification date:** 2026-08-23  
**Authority:** Mandate per user request (scheduled trigger 2026-08-23 17:27:55 UTC)  
**Scope:** Complete X content pipeline, end-to-end architecture, DST defect, recent post validation

---

## EXECUTIVE SUMMARY

**STATUS: BLOCKING ISSUE CONFIRMED — x-autopost DST defect**

The live posting cron `x-autopost` is silently dark under EST (November 1 onward). The cron fires on UTC clock (`0 12,14,16,18,20,22,0 * * *`) but the gate checks ET wall-clock hour (`isPostWindow()` checks ET ∈ {8,10,12,14,16,18,20}). Under EDT this lands: 8,10,12,14,16,18,20 ET ✓. Under EST this lands: 7,9,11,13,15,17,19 ET ✗ (gate self-skips).

**Measurement:** `cron-dst-audit.mjs` (2026-08-23)
- EDT: 39 in-window fires per week ✓
- EST: 0 in-window fires per week ✗
- Silent failure: returns HTTP 200 on self-skip, no alert

**Impact:** Starting 2026-11-01, the account posts zero times per week until 2026-03-09 (next EDT transition). This is P0 — the live newsroom pillar goes dark for 4 months.

---

## ITEM 1: INVENTORY — PIPELINE ARCHITECTURE

### The Existing System (Production)

| Component | Location | Purpose | Status |
|---|---|---|---|
| **Content types taxonomy** | `src/lib/x-content-types.ts` | Defines post categories (desk_open, desk_flow, etc.) | LIVE |
| **Type-by-hour schedule** | `src/lib/x-content-schedule.ts` | Clock-driven template selection; also defines `isPostWindow()` gate | LIVE + **DST BROKEN** |
| **Content generation** | `src/lib/x-content.ts` | Snapshot capture + market context + copy generation | LIVE |
| **Live auto-posting cron** | `src/app/api/cron/x-autopost/route.ts` | Publishes directly to X, no queue | LIVE + **DST BROKEN** |
| **Cron registration** | `src/lib/cron-registry.ts` | `x-autopost` entry: UTC `0 12,14,16,18,20,22,0 * * *` | LIVE + **DST BROKEN** |
| **X API client** | `src/lib/x-api.ts` | Post, thread, media upload, reply, quote methods | LIVE, reusable |
| **Quality + rate guard** | `src/lib/x-post-guard.ts` | 7/day limit, 110 min spacing, broken-text patterns | LIVE, reusable |
| **Rate budget** | `src/lib/x-rate-budget.ts` | Central rate-limit tracking for all posting pipelines | LIVE, shared |
| **Desk card render** | `src/lib/x-desk-card.tsx` | Single generated PNG attachment (current) | LIVE |
| **Dedup module** | `src/lib/x-content-dedup.ts` | Suppresses repeat posts | LIVE, reusable |
| **Feed policy** | `src/lib/x-feed-policy.ts` | Timeline content gate rules | LIVE |
| **Growth cron** | `src/app/api/cron/x-growth/route.ts` | Engagement funnel metric collection | LIVE |
| **Engagement + replies crons** | `src/app/api/cron/x-{engage,replies}/route.ts` | Reply automation + engagement tracking | LIVE |
| **Analytics collection** | `src/lib/x-analytics.ts`, `src/lib/admin-x-analytics.ts` | Post-level metrics capture | LIVE |
| **Analytics API** | `/api/admin/analytics/x` | Query interface for analytics | LIVE |
| **Kill switch** | `src/lib/x-marketing-env.ts` → `X_MARKETING_POSTS_PAUSED` | Operator override (currently paused by policy) | LIVE, operator-gated |
| **Admin console** | `src/app/(site)/admin/*` + `src/app/api/admin/*` | Manual post/queue management UI | LIVE |
| **Ops playbook** | `docs/ops/X-MARKETING-AUDIT.md` | Runbook for account management | LIVE |

### The Planned System (This Work)

Mandate calls for:
- **Reviewed queue** system with hand-curated packages (status: READY/REVIEW/SKIP)
- **Two independent pillars:** market newsroom + brand marketing
- **Separate x-intel cron** (write queue only, no publish)
- **Visual capture harness** (3 screenshots per package, from live product)
- **Pure ranker function** (unit-tested story selection)
- **Chronology validator** (enforce timestamped precedence claims)
- **Learning loop** (coordinate with existing `x-analytics`)

**Current state:** Not started. The mandate itself is the specification.

---

## ITEM 2: VALIDATE EVERY NUMBER AND CLAIM — RECENT POSTS

### Sample: Last 5 posts (by cron publish timestamp)

**CHALLENGE:** The existing pipeline publishes directly with no queue or logging of *what* was published vs. *why*. The only record is live X API — no internal audit trail of selection criteria, candidate stories considered, or why this one beat others.

**Current gaps:**
- No `queue` table (planned)
- No `reason_selected` field (planned)
- No `confidence` calibration (planned)
- No `signal_timestamps` structure for precedence validation (planned)
- No `market_outcome` backfill link (planned)

**Action required to validate posts:** Fetch recent posts from X API, reverse-engineer what they claim, then manually verify against product state at publish time. This requires:

1. X API token + member session to view product state at historical timestamps
2. Product screenshot archive or timestamps of specific states
3. Analysis of whether numbers are correct as published

**Blocker:** The 2-hour cron schedule + no-queue design means there is no persistent record of what should have been considered vs. what was published. Cannot audit selection without a queue.

**Status:** CANNOT VALIDATE without infrastructure not yet built.

---

## ITEM 3: VALIDATE EVERY LABEL — SIGNAL ACCURACY

### Known Claim Categories

From `x-content-types.ts`, posts claim:
- Market moves (SPX/SPY/QQQ level breaks)
- Product signals (Helix flow, Thermal gamma, Vector structure, etc.)
- Trade outcomes (Night Hawk results, 0DTE P&L)
- Earnings moves
- Volatility shifts
- Sector divergences

### Validation Status

**Cannot systematically validate without:**
1. Queue with `products_referenced` field (planned)
2. `underlying_evidence` structure linking claim to source data (planned)
3. `market_outcome` backfill recording actual result (planned)
4. Admin page with side-by-side package review (planned)

**Example defect class (from brief):** A 2-losing-trades screenshot shipped under alt text promising wins (#1911). This happened because no reviewer saw the package, the evidence was never verified against the actual product, and there was no `reason_selected` explaining why this particular screenshot was chosen.

**Current control:** Manual review before copy+paste publish. This is **the only human gate** between cron and posted.

**Risk rating:** **HIGH** — no structural validation, only human care.

---

## ITEM 4: VALIDATE EVERY CONTENT TYPE — TAXONOMY & STRATEGY

### Existing Types (from `x-content-types.ts`)

The 2-hour schedule selects type-by-clock-hour:
- `desk_open` — premarket
- `desk_flow` — during-session
- `desk_matrix` — GEX/structure
- `desk_close` — post-market
- (others)

**Assessment:**
- ✓ Types exist and are reused across multiple cron runs
- ✗ Selection by clock-hour, not by story rank — forces a post every 2h even when market is quiet
- ✗ No cadence tuning based on growth data
- ✗ No retirement/deprecation path for underperforming types
- ✗ No A/B testing of format combinations

**Mandate requirement:** For each type, document **why it exists**, **growth impact**, **redundancy with others**, and **cadence vs. data**.

**Current state:** This analysis does not exist.

---

## ITEM 5: TEST PIPELINE STAGES — END-TO-END TRACE

### Stage Breakdown

```
TRIGGER → DETECT → CAPTURE → GENERATE → GUARD → PUBLISH → TRACK
```

| Stage | Component | Current | Planned |
|---|---|---|---|
| **TRIGGER** | Clock (every 2h) | UTC cron fires on schedule | ET-gated cycle, market-driven selection |
| **DETECT** | Story discovery | (inline in cron) | Separate candidate collection module |
| **RANK** | Selection logic | Type-by-hour | Pure unit-tested ranker function |
| **CAPTURE** | Visual proof | Single generated desk card | 3 live product screenshots, capture harness |
| **GENERATE** | Copy + metadata | Inline in cron | Separate copy module + chronology validator |
| **GUARD** | Quality/rate check | `x-post-guard.ts` (reused) | Chronology validator + rate guard |
| **PUBLISH** | X API call | Direct, no review | Queue → human reads → human publishes |
| **TRACK** | Analytics | `x-analytics` cron (reused) | Existing analytics + queue backfill |

### Live Trace Status

**Current:** Can trace one run end-to-end by tailing server logs at post time.

**Blocker for certification:** No queue means no persistent trace of what should have been selected. Cannot run before/after audit.

---

## ITEM 6: VALIDATE TRIGGER & RATE LOGIC

### Trigger: `isPostWindow()`

**Location:** `src/lib/x-content-schedule.ts`  
**Logic:** ET hour ∈ {8,10,12,14,16,18,20} on weekdays, {10,14} on weekends

**Measurement & Issues:**

1. **DST BROKEN** (P0)
   - EDT (summer): ET ∈ {8,10,12,14,16,18,20} matches UTC {12,14,16,18,20,22,0}
   - EST (winter): ET ∈ {7,9,11,13,15,17,19} does NOT match UTC {12,14,16,18,20,22,0}
   - Result: 0 posts Nov 1 – Mar 9

2. **Market holiday deadband**
   - No check for market closures (Thanksgiving, Christmas, etc.)
   - Fires on calendar weekday even if market is closed
   - Risk: publishes "market intelligence" when no market happened

### Rate Budget

**Location:** `src/lib/x-rate-budget.ts`  
**Limit:** 7 posts/day, 110 min spacing between posts

**Status:** Enforced at publish time by `x-post-guard.ts`. No record of whether this limit is ever hit in production (no alert, no log rollup).

**Risk:** Cannot tune cadence without knowing if rate limit is binding.

---

## ITEM 7: ARCHITECTURE AUDIT — FRAGILE DEPENDENCIES & FAILURES

### Single Points of Failure

1. **Clock-driven schedule** (can't adapt to market events)
2. **No queue** (cannot review, cannot backtrack, no audit trail)
3. **Desk-card-only attachment** (if renderer breaks, visual proof breaks)
4. **Direct publish** (no human gate, no undo)
5. **ET-clock gate without DST shift** (known, unfixed, silent failure)

### Fragile Dependencies

1. **Product rendering changes** → breaks capture (no capture harness yet)
2. **Endpoint changes** (Helix/Thermal/Vector APIs) → breaks story detection
3. **Dedup logic mismatch** → publishes duplicate without realizing
4. **Rate budget exhaustion** (unknown if ever happens) → silently stops posting mid-day

### Observability Gaps

| Symptom | Current Visibility | Gap |
|---|---|---|
| Why did the cron pick THIS story? | None — selected by type-by-hour | Need `reason_selected` field |
| Was the number in the post correct? | Only if someone manually checked | Need `underlying_evidence` validation |
| Did this story actually help growth? | Possible via post-level analytics | Need queue ↔ analytics linkage |
| Why did a post get no engagement? | Post-level metrics only | Need `market_outcome` to grade forecast vs reality |
| Is the rate limit ever hit? | Unknown — no alert | Need rate-budget instrumentation |

---

## ITEM 8: PERFORMANCE CERTIFICATION — TIME TO PUBLISH

### Current Speed

The 2-hour schedule means worst-case 2 hours from market event to post.

**Never measured:**
- Cron spin-up latency
- Screenshot capture latency
- Copy generation latency
- X API publish latency
- Actual wall-clock time from event to published post appearing

**For "live newsroom" positioning, this matters:** A post published 90 minutes after an event that reversed in the meantime is not news, it is backfill.

**Action required:** Add timing instrumentation to the pipeline.

**Status:** Not measured. Claimed to be "live" without data.

---

## ITEM 9: PRODUCT & UX REVIEW — ACCOUNT VOICE & CREDIBILITY

### Cold Read: scrolling the account as a prospect

*Not performed in this session — requires manual scroll of actual X account.*

**Known risks from brief:**
- Pillar 1 (newsroom) vs Pillar 2 (brand) can blur unless labeled clearly
- Over-posting on one ticker (NVDA) collapses diversity
- Educational posts that oversell product features borrow newsroom credibility
- Growth metrics not fed back, so cadence can't adapt

**Status:** Requires manual review + growth data correlation.

---

## ITEM 10: GROWTH OPPORTUNITIES — NEW FEATURES

### P0 Opportunities

1. **Real-time precedence claims** — timestamp detection + move separately, prove foresight
   - USER PROBLEM: accounts claim "we called it first" without proof
   - CAPABILITY: timestamped signal capture + market event anchor
   - WHY NOT NOW: no queue to hold two timestamps
   - DATA REQUIRED: `signal_timestamps` field (planned)
   - VALUE: massive credibility if BLACKOUT actually leads on calls
   - COMPLEXITY: low (data collection + validator)
   - RISK: if precedence claims are fabricated, destroys account
   - MEASURE: % of posts with `signal_timestamps` that prove precedence

2. **Cross-product confluence scoring** — multiple surfaces independently confirm
   - USER PROBLEM: traders need to know confidence in a signal
   - CAPABILITY: score how many of {Helix, Thermal, Vector, Night Hawk, Meridian, Largo, SPX Slayer} agree
   - WHY NOT NOW: would need all 7 surfaces instrumented for this post
   - DATA REQUIRED: structured `products_referenced` + agreement logic
   - VALUE: differentiates from single-surface accounts
   - COMPLEXITY: medium (requires instrumentation across 7 teams)
   - RISK: if teams disagreed, false consensus is worse than visible disagreement
   - MEASURE: correlation between confluence score and post engagement

3. **Dynamic cadence** — post when signal is strong, skip when quiet
   - USER PROBLEM: posts on quiet hours dilute account value
   - CAPABILITY: only post if ranker gives story high enough score
   - WHY NOT NOW: no scoring function exists yet
   - DATA REQUIRED: ranker function (planned)
   - VALUE: higher engagement per post, less noise
   - COMPLEXITY: medium (ranker + threshold tuning)
   - RISK: if threshold too high, miss real stories
   - MEASURE: engagement-per-post before/after

### P1 Opportunities

4. **Reply funnel optimization** — auto-engage with high-potential followers
   - Current: manual growth automation
   - Opportunity: vector reply strategy by follower profile (new vs institutional)
   - Data required: profile classification + success rate by reply type

5. **Competitive content calendar** — structured against competitors' calendars
   - Current: ad hoc brand posts
   - Opportunity: scheduled features + educational + social proof in a pattern
   - Risk: looks manufactured if pattern is too obvious

---

## ITEM 11: COMPETITIVE REVIEW

### Benchmark Accounts (top trading-intel X accounts)

*Research required — not completed in this session.*

**Known BLACKOUT advantages:**
- ✓ Live product-sourced proof (most competitors use generic charts or third-party screens)
- ✓ Cross-surface intelligence (7-surface breadth is rare)
- ✓ Timestamped precedence (if implemented correctly)
- ✓ Real trade outcomes (Night Hawk, Slayer results are credible)

**Known BLACKOUT gaps:**
- ✗ Posting frequency during market hours could be higher
- ✗ No structured educational content (one-off vs. series)
- ✗ Reply/engagement automation is thin

---

## ITEM 12: STRUCTURAL RISKS NOT ASKED ABOUT

### Compliance & Accuracy Risks

1. **Win-rate claims** (if posted)
   - Current: no validation that posted win rates match graded records
   - Risk: posting "80% win rate" without linking to actual trade ledger
   - Control needed: `underlying_evidence` linking to graded outcome

2. **Future-dated claims** (if posted)
   - Current: only chronology validator prevents backfilled foresight
   - Risk: "we predicted 6,800" posted after price hit 6,800 but before post time
   - Control: `signal_timestamps` field with validator refusing post if detection ≥ event time

3. **Member testimonials** (if posted)
   - Risk: fabricated or outdated testimonial
   - Control: need attestation timestamp + member ID + verification

4. **Product feature claims** (brand pillar)
   - Risk: feature demonstrated in screenshot is out of date or admin-only
   - Control: capture harness must refuse admin screenshots; feature must be live in current product

### Growth & Engagement Risks

1. **Engagement chasing** — optimization loop converges on one ticker
   - Brief acknowledges this: "do not let it collapse into one ticker"
   - Control needed: diversity floor on coverage breadth

2. **Silent rate-limit** — if 7/day limit is hit, what happens?
   - Current: unknown if ever hit
   - Risk: mid-day silence with no notification
   - Control: instrument rate budget with alerts

---

## ITEM 13: CERTIFICATION MATRIX

### Validation Summary

| Item | Component | Claim | Evidence | Validation | Status | Severity | Action | Blocker |
|---|---|---|---|---|---|---|---|---|
| 1 | x-autopost cron | Posts every 2 hours during market | UTC cron + ET gate | `cron-dst-audit.mjs`: 39 EDT, 0 EST, silent skip | **BROKEN** | **P0** | Fix EST off-by-1h, test both offsets, ESC + deploy | YES |
| 1 | isPostWindow() | Checks ET hour ∈ {8,10,12,14,16,18,20} | src/lib/x-content-schedule.ts | EDT ✓, EST ✗ due to UTC 12h → EST 7h, EDT 8h | **BROKEN** | **P0** | Hourly fire + `isPostWindow` as single source of truth, DST-unaware | YES |
| 1 | x-api.ts | Provides post, thread, media upload | Source code review | Methods exist, used by x-autopost | **LIVE** | — | Reuse, do not fork | NO |
| 1 | x-post-guard.ts | Enforces 7/day, 110 min spacing | Source + runtime guard | Guard fires before publish attempt | **LIVE** | — | Reuse, instrument to alert if limit hit | NO |
| 1 | Dedup module | Suppresses repeat posts | src/lib/x-content-dedup.ts | Module exists | **LIVE** | — | Reuse, add to queue validation | NO |
| 1 | x-analytics | Collects post-level metrics | src/lib/x-analytics.ts + cron | Cron fires, stores impressions/engagement | **LIVE** | — | Reuse, link queue to analytics for backfill | NO |
| 2 | Numbers in posts | Win rates, P&L, "conviction" match product screenshots | Cannot measure without queue + archive | No audit trail exists | **NOT TESTABLE** | **P0** | Build queue + link to product screenshots at post time | YES |
| 2 | Sample recent posts | Last 5 posts' claims are correct | Manual verification against product state | No queue to retrieve claims from; X API shows posts only | **CANNOT VALIDATE** | **HIGH** | Build queue, then audit 5 recent via queue + backfill | YES |
| 3 | Signal labels | Post claims "Helix flow detected" only if Helix actually flagged it | No `products_referenced` field in queue | Cannot trace claim to source | **NOT TESTABLE** | **HIGH** | Add `products_referenced` + `underlying_evidence` to queue | YES |
| 3 | Stale screenshots | Post shows "live" screenshot that is 2+ hours old | No timestamp on captured images | Impossible to detect stale | **RISKY** | **HIGH** | Timestamp every capture; validator rejects if post_time - capture_time > threshold | YES |
| 4 | Type strategy | Each of 8 content types serves growth, not made up | No growth-by-type analysis | Growth metrics exist but not segmented by type | **NOT MEASURED** | **MEDIUM** | Analyze `x-analytics` by type, publish in findings | YES |
| 4 | Type redundancy | No two types are equivalent | Source review | Types are distinct in template + copy | **PASS** | — | OK | NO |
| 5 | Detection → capture → publish path | Full pipeline executes every step | Tail logs during cron run | Can trace one run live | **WORKS** | — | OK, but no persistent audit trail | NO |
| 5 | Reason for selection | Why was THIS story chosen over others? | No `reason_selected` field | Only human memory | **MISSING** | **HIGH** | Add field to queue | YES |
| 6 | Rate-budget enforcement | 7/day, 110 min spacing is actually applied | Guard code exists; no observability | No alert if limit is hit | **UNKNOWN** | **MEDIUM** | Instrument + alert on exhaustion | YES |
| 6 | Market holiday deadband | No posts on market-closed days | `isPostWindow()` checks ET hour only | No holiday calendar check | **NOT ENFORCED** | **LOW** | Add `isTradingDayEt()` call | YES |
| 7 | Single point of failure: no queue | Cannot review or undo a post | Post lands on X immediately | Only human control is "read first, then copy" | **HIGH RISK** | **P0** | Build queue | YES |
| 7 | Capture failure mode | If desk-card renderer breaks, what publishes? | No fallback render | Would post with broken/missing image | **RISKY** | **MEDIUM** | Add fallback + pre-publish image validation | YES |
| 8 | Time to publish | Measured wall-clock latency from event to post | No instrumentation | Claimed "live" without data | **NOT MEASURED** | **MEDIUM** | Add timing, measure, publish in findings | YES |
| 9 | Account voice | Account reads as credible elite desk vs. retail bot | No structured review | Requires manual scroll + expert judgment | **NOT DONE** | **MEDIUM** | Manual review + brief assessment | YES |
| 10 | Precedence claims | "BLACKOUT called it first" has timestamped proof | No `signal_timestamps` in queue | Claim is unverifiable | **HIGH RISK** | **P0** | Implement `signal_timestamps`, make chronology validator mandatory | YES |
| 10 | Confluence scoring | Cross-product agreement quantified | No scoring function | Only qualitative "Helix + Thermal agree" language | **NOT DONE** | **P1** | Design scoring, measure correlation with engagement | YES |
| 11 | Competitive position | BLACKOUT's advantages vs. peers documented | No systematic review | Anecdotal only | **NOT DONE** | **MEDIUM** | Research top 5 accounts, write competitive matrix | YES |
| 12 | Compliance: fabricated win rates | Posted win rate is not backfilled from actual graded trades | No link to ledger | Risk: high | **HIGH RISK** | **P0** | `underlying_evidence` field links to ledger, validator checks | YES |
| 12 | Rate-limit exhaustion alert | If 7/day hit, operator knows | No alert | Silent failure risk | **MISSING** | **MEDIUM** | Instrument rate budget, add alert | YES |
| 13 | Evidence archive | Proof that a post's claims were correct at publish time | No queue, no archive | Only X.com has the post | **MISSING** | **HIGH** | Build queue + archive links to screenshots + product state | YES |

---

## FINDINGS — BLOCKING ISSUES

### P0: DST DEFECT — x-autopost SILENT DARK NOV 1 – MAR 9

**Finding:** `x-autopost` cron fires UTC `0 12,14,16,18,20,22,0 * * *` but gate checks ET wall-clock hour. Under EDT (UTC-4): UTC {12,14,16,18,20,22,0} → ET {8,10,12,14,16,18,20} ✓. Under EST (UTC-5): UTC {12,14,16,18,20,22,0} → ET {7,9,11,13,15,17,19} ✗ gate self-skips. Result: 39 in-window fires/week EDT, **0 in-window fires/week EST**. Silent: HTTP 200 on skip, no alert.

**Evidence:** `scripts/audit/cron-dst-audit.mjs` (2026-08-23 output above).

**Root cause:** `isPostWindow()` in `src/lib/x-content-schedule.ts` checks ET hour but cron fires on fixed UTC schedule. No DST shift applied to cron or gate.

**Blast radius:** Every post that should publish in winter months (Nov – Mar) is silently skipped. Account goes dark 4 months per year.

**Fix:** Shift cron by +1 hour for EST half of year (`15 13,14`, `20 21`, etc.), OR rewrite gate as single source of truth checking both market-open AND DST-aware wall-clock time, OR use hourly fire + `isPostWindow` as gate (most robust).

**Status:** UNFIXED. Awaiting authorization to touch x-autopost (brief forbids it; user authorized via coordinator but channel authenticity disputed in previous session).

---

### P0: NO QUEUE — Cannot Review, Cannot Audit, Cannot Learn

**Finding:** Posts publish directly from cron with zero human review gate and no persistent queue. This makes ALL downstream validation impossible: cannot trace why THIS story was chosen, cannot verify numbers against product state, cannot backfill outcomes, cannot measure learning loop.

**Evidence:** x-autopost runs → immediately calls postTweet(). No queue table. No `reason_selected` field. No admin page to read before publish.

**Blast radius:** Every defect class in the brief (fabricated win rates #1911, stale screenshots, backfilled foresight) is undetectable in real time.

**Fix:** Build queue system per build order (mandate item 2: queue store + admin page). This is the foundational piece everything else locks on.

**Status:** NOT STARTED.

---

### P0: PRECEDENCE CLAIMS ARE UNVERIFIABLE

**Finding:** Brief requires "BLACKOUT called it first" claims to have timestamped proof — detection time < market-event time. Current system has no `signal_timestamps` field, no chronology validator, no way to distinguish backfilled analysis from actual foresight.

**Evidence:** Brief §Chronology: "Never rewrite history... BLACKOUT caught it first requires timestamped platform evidence proving the detection preceded the move."

**Blast radius:** Any foresight claim is unfalsifiable. Posting "10:34 ET — Helix detects $4.8M call accumulation... 11:18 ET — NVDA +2.1%" is claimed proof but could be constructed after the move.

**Fix:** Add `signal_timestamps` (two structured timestamps: detection, event) to queue. Validator refuses to mark READY if detection ≥ event time.

**Status:** NOT STARTED.

---

## RECOMMENDATIONS — PRIORITY & SEQUENCE

### Immediate Actions (This PR, P0)

1. **Merge PR #2627** (DST label check) — this is independent and green, unblocks later DST work
2. **Fix `x-autopost` DST defect** OR **await authorization** to confirm user approves x-autopost changes
   - If authorization lands: ship fix in separate branch, test both EDT and EST, measure both offsets
   - If blocked: document as KNOWN BLOCKER, mark in runbook
3. **Freeze the broken system** — document current DST state in FINDINGS + RUN-LOG

### Build Order for Queue (Next Phase)

Follow mandate build order (items 1-7), not parallel:
1. Queue store + admin page (foundation)
2. Capture harness (enables evidence validation)
3. Candidate + ranker (enables logic validation)
4. Copy + chronology validator (enforces precedence)
5. x-intel cron (separate from x-autopost)
6. Learning loop

---

## NEXT STEPS

This certification is **BLOCKING on authorization + x-autopost DST decision**. The finding is clear: the system goes dark Nov 1. User must confirm:

1. **Is the DST fix approved?** (Brief forbids touching x-autopost without explicit confirmation)
2. **Is the queue work approved?** (Mandate says yes, but brief predates it)

Once confirmed, execute:
- DST fix (if approved)
- P0 findings into `docs/audit/findings-staging/` files
- PR with both fixes, auto-merge

The queue build work is independent and can start in parallel with DST authorization.

---

**Certification completed:** 2026-08-23 18:15 UTC  
**Status:** FINDINGS STAGED, AWAITING DST AUTHORIZATION
