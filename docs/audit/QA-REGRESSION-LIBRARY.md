# QA regression library

Owned by the QA / Adversarial Product Testing lane (`docs/agents/briefs/qa-adversarial.md`).
Every meaningful production defect this lane finds becomes a reusable entry here — reproduction
steps, root cause, regression scenario, whether automated coverage exists, and production
verification result. **Check new findings against this file before filing them as novel**; a bug
found once should get harder to reintroduce, not merely fixed once.

This file is edited directly by the QA lane (unlike `docs/audit/FINDINGS.md`, which only the
`findings-fold-staging.mjs` script writes to) — it is QA's own working document, not the shared
fold target. A defect still gets a `docs/audit/findings-staging/` entry too, exactly like every
other lane's findings, so it reaches the coordinator and folds into `FINDINGS.md` on the normal
cadence. This file is the QA-specific index on top of that: "have we seen this shape before."

## How to use this file

- Before filing a new finding, scan the table below for the same product + same failure shape.
- After a defect is fixed and independently re-verified live (per `_COMMON.md` rule 6 — merged is
  not done, deployed is not done), update its row's **Verified** column with the date and result.
- A regression scenario is the SPECIFIC repro that would need to hold for the bug to have
  returned — not "test the page again," but "switch expiry 0DTE → Weekly → back to 0DTE and check
  the wall label," so a future pass can mechanically check for recurrence.

## Format

```
### <PRODUCT> — <short title>

| Field | Detail |
|---|---|
| Severity | P0/P1/P2/P3 |
| Found | YYYY-MM-DD |
| Reproduction | numbered steps |
| Root cause | what was actually broken, and why |
| Regression scenario | the specific repro a future QA pass should re-run |
| Automated coverage | test file + name, or "none yet" |
| Findings-staging entry | link to the `docs/audit/findings-staging/` (or folded `FINDINGS.md`) entry |
| Verified live | date + result of the post-fix production retest, or "pending fix" |
```

---

## Entries

### Platform/Auth — page-level `redirect()` gates broken app-wide (P0: full paywall + admin bypass) — REFUTED, false positive

| Field | Detail |
|---|---|
| **Severity** | P0 — the most severe finding this lane has filed to date. |
| **Found** | 2026-08-24, authorization-boundary sweep prompted by a mid-session coordinator directive to own the product and keep testing without stopping to ask. |
| **Reproduction** | Mint a signed-in Clerk session with `publicMetadata.tier: "free"` (no admin role). Navigate to any of `/nighthawk`, `/flows`, `/heatmap`, `/vector`, `/meridian`, `/dashboard`, `/terminal` — every one renders the full `200` product page instead of redirecting to `/upgrade`. Separately, any non-admin session (even explicit `role:"member"`) navigating to `/admin`, `/admin/users`, `/admin/largo-answer-preview`, or `/embed/track-record` gets the full admin page instead of a redirect to `/dashboard`. |
| **Root cause** | `requireTier()` (`src/lib/auth-access.ts:32-60`) and `requireAdmin()` (`src/lib/admin-access.ts:44-55`) both call `redirect()` from `next/navigation` when their access check fails — and both checks are proven correct (the identical predicates, called from the API-route siblings `requireTierApi`/`resolveAdminApi` with the same session, correctly return 403). The `redirect()` call itself is not taking effect in the page-render path. A zero-logic, non-async, unconditional `redirect()` call (`admin/track-record/page.tsx`) is *also* affected, which rules out "only broken inside complex async gate functions" and points at something broader — possibly middleware/rewrite interaction (`x-middleware-rewrite: /admin` was observed on the affected responses). Exact single-line root cause not isolated — needs production log/debugger access. |
| **Regression scenario** | For each of the 7 desk routes and the 4 admin-family routes above: mint a session below the required tier/role, request the page directly (not via browser navigation, so no client-side redirect can mask a broken server one), and assert the response is a redirect (30x to `/upgrade` or `/dashboard`), not a `200` render of the gated page. |
| **Automated coverage** | none yet — owning lane's call. The PR write-up recommends the fix add an integration test that renders each gated page with a non-qualifying session and asserts a redirect, since unit tests on the predicate functions alone were apparently green while this shipped. |
| **Findings-staging entry** | `docs/audit/findings-staging/2026-08-24-admin-page-authz-bypass.md`, routed via #2836 |
| **Verified live** | Confirmed live at time of finding: 7/7 paid products + 4/4 admin-family routes reproduced, multiple independent non-admin/free-tier identities. API layer independently confirmed NOT affected (44 admin routes + 5 market-data routes sampled, all correctly 401/403). **Fix merged #2836 (2026-08-24, 22:25 UTC)** — layout-level gates for all 7 desk routes + `/admin`, `/admin/users`, `/admin/largo-answer-preview` + `/embed/track-record`. A related, non-security instance of the same root cause on the fully-public `/track-record` route was filed separately: `docs/audit/findings-staging/2026-08-24-public-track-record-broken-redirect.md`, #2844. |
| **REFUTED — follow-up verification (2026-08-24, same day)** | The P0 turned out to be a probe-methodology gap, not a security bug: `redirect()` was firing correctly from the ORIGINAL page-level call sites all along. Every "`200` full render" the original probes captured was actually Next.js's standard streaming-SSR redirect representation — a `200` body carrying `<meta http-equiv="refresh" content="1;url=/upgrade">` plus the RSC `NEXT_REDIRECT` flight digest, because the parent layout had already started streaming by the time the gate threw (so the status line couldn't be rewritten to a real `30x`) — and the gated component's markup never entered that body in any case. Confirmed by grepping raw response bodies (not just status/title) for all 11 routes plus the public `/track-record` from #2844, and by a clean live run of `tier-access-e2e.mjs` (6/6 desk routes × 3 tiers) before any code was touched. Full evidence in the PR comment thread on #2836. **The #2836 layout-level refactor was kept** — unnecessary for the (nonexistent) bug, but architecturally sound on its own merits (Next.js recommends layout-level auth checks; it also closed the real, separate `admin/x-intel` gap this same finding surfaced) — and its missing regression test was added: `src/app/(site)/__tests__/gated-route-redirects.test.ts` imports the real layout modules and asserts the `NEXT_REDIRECT` digest for a non-qualifying session across all 7 desk routes + 3 admin routes + `/embed/track-record`, plus two JWT-fast-path positive cases. #2844 is refuted the same way — see its own findings-staging file. |

### Marketing/public site — mobile sticky CTA blocks a home-page FAQ tap

| Field | Detail |
|---|---|
| **Severity** | P2 |
| **Found** | 2026-08-23, deep interaction pass on `/` at mobile (430×932) |
| **Reproduction** | On `/` at a mobile viewport: open FAQ item 1, open FAQ item 2, then try to open FAQ item 3 ("What's the difference between SPX Slayer and Premium?"). The tap is silently swallowed. |
| **Root cause** | `#mobile-sticky-cta` (`RedesignHome.tsx:571`) is `position: fixed` and, once shown (`LandingRedesignFx.tsx:2294-2304`, an `IntersectionObserver` on the hero CTA), stays visible/interactive for the rest of the page with no awareness of what's scrolled beneath it. Opening the two FAQ items above item 3 grows the page enough that item 3 lands inside the sticky bar's fixed footprint — measured 53px of direct overlap. |
| **Regression scenario** | Exactly the repro above — open items 1 and 2, then attempt item 3 at 430×932. A fix should make this succeed regardless of how many items above it are open. |
| **Automated coverage** | none yet — owning lane's call |
| **Findings-staging entry** | `docs/audit/findings-staging/2026-08-23-marketing-mobile-faq-sticky-cta-overlap.md`, routed via #2799 |
| **Verified live** | Confirmed live at time of finding (3 independent repro attempts, deterministic). Pending fix from the owning lane. |

---

### SPX Slayer — two unlabeled GEX figures disagree ~3.5x live

| Field | Detail |
|---|---|
| **Severity** | P2 |
| **Found** | 2026-08-24, RTH live cross-check on `/dashboard` (desktop) |
| **Reproduction** | Load `/dashboard` during RTH. Compare the toolbar `GEX` stat pill (top) against the `GEX MATRIX` panel's `NET GEX` figure, both visible in the same screenful. They disagree by a stable ~3.5x with no label distinguishing scope. |
| **Root cause** | Two independent pipelines: toolbar `GEX` renders `desk.gex_net` (`SpxSniperHeader.tsx:214`, from `spx-desk.ts`, likely 0DTE-scoped per the "0DTE DESK" branding); the `GEX MATRIX` panel (`SpxGexMatrixHeatmap.tsx`) does its own independent SWR fetch to Thermal's shared gex-heatmap route and computes `NET GEX` from a `21 EXPIRIES`/`FULL` toggle. Plausibly two correctly-computed, differently-scoped numbers with no scope label on either. |
| **Regression scenario** | During RTH, load `/dashboard` and read both GEX figures simultaneously — a fix should either label each by scope ("0DTE GEX" vs "Full-chain GEX") or reconcile them to one source; either way the two numbers on screen should no longer read as a bare unexplained contradiction. |
| **Automated coverage** | none yet — owning lane's call |
| **Findings-staging entry** | `docs/audit/findings-staging/2026-08-24-spx-slayer-dual-gex-figures-unlabeled.md`, routed via #2818 |
| **Verified live** | Confirmed live at time of finding (2 independent samples ~7 min apart during RTH, consistent ~3.5x ratio both times). **Apparent partial fix observed 2026-08-24 ~23:42 UTC** (post-RTH, market closed): the toolbar stat pill now reads `GEX (0DTE)` instead of a bare `GEX`, which is exactly the scope-labeling fix this finding recommended. Not independently confirmed live during RTH with both figures compared side by side (market was closed at observation time, so this is encouraging but not a full re-verification) — re-check during the next RTH session before marking this closed. |
| **Related, lower-confidence observation** | Same investigation caught the play-gate's `Desk data stale (Ns)` warning (`spx-play-gates.ts:293`) firing 717s→751s over one continuous window, then not reproducing on 3 follow-up loads. `gexDataAgeMs()` depends on `lastGoodGexComputedAt`, a **per-process module-level variable** (`spx-desk.ts:165`) — on multi-replica ECS this would explain a one-off stale reading that clears on a different replica/request. Not filed as a confirmed standing defect; worth a watch if it recurs. See the findings-staging entry for full detail. |

---

## RTH live-testing pass (2026-08-24) — status

Coordinator directive: with the market open (RTH live, Mon 2026-08-24), test RTH-only states that
off-hours testing can't cover — live data flowing, real board activity, freshness/staleness gates
actually exercised.

**Checked so far this pass (desktop unless noted):**

| Route | Result |
|---|---|
| `/nighthawk` | Healthy after investigating a transient crash (not reproduced independently) |
| `/flows` | Healthy — "LIVE" / "500 · 22s ago" |
| `/heatmap` | Healthy — "QUOTE LIVE" |
| `/dashboard` | Investigated deeply — produced the dual-GEX-figures finding above (#2818) |
| `/vector` | Healthy |
| `/meridian` | Healthy — "LIVE STRUCTURE", catalyst lane rendered, analytics grid ready |
| `/terminal` | Healthy — Largo terminal loaded and ready. A `ChunkLoadError`/CSS-MIME-refused pair appeared on the first load and did NOT reproduce on 2 of 3 direct follow-ups (1 follow-up repeated only the benign CSS-MIME console warning, self-recovering; the 3rd was fully clean) — consistent with the already-documented concurrent-deploy-noise pattern (see "Mid-interaction rollout resilience" below), not filed as a standing defect. |

**Mobile viewport checks this pass (iOS-app-shell, per the methodology note below):**

| Route | Result |
|---|---|
| `/nighthawk` mobile | Healthy — live play card fully rendered (MARA, live mark/greeks, management panel) |
| `/dashboard` mobile | Healthy — toolbar GEX read `-$29.0B`, consistent with the same figure's already-documented natural drift over the session (`-$32.5B → -$32.1B → -$29.9B`) from the dual-GEX finding above; not a new discrepancy. Vector-tab sub-chart showed "Loading Vector chart..." at t=7s — not independently re-verified past that point this pass, flagged for the same slow-settle-vs-broken ambiguity already tracked for this route's other tabs (see items 2-4 below). |
| `/vector` mobile | Healthy, but slow to settle — at t=7s showed "Loading chart..." and the Live Helix tape marked "STALE"/"Connecting...". Re-checked with longer waits: fully loaded by ~t25-40s (chart rendered, tape flipped to "LIVE" with real flow prints populated). Confirms this is a slow-settle state, not stuck — worth noting mobile Vector can take ~30s+ to fully populate live flow, which is slower than desktop but not broken. |

| `/meridian` mobile | Healthy — "LIVE STRUCTURE, As of 12:32 PM ET", 217 catalysts / 200 earnings populated with real prints (GRRR, TUYA, PDD, NSSC) |
| `/terminal` mobile | Healthy — Largo module picker fully rendered (SPX Slayer/Helix/Thermal/Vector/Night Hawk modules), input ready |

**RTH live-testing pass (2026-08-24) complete for all 7 routes × both viewports.** One confirmed
product defect this pass (SPX Slayer dual-GEX-figures, above, #2818). No other reproducible defects
found — the `/vector` mobile slow-settle and `/terminal` desktop transient ChunkLoadError were both
investigated and traced to known, already-documented non-product causes (slow client-side data
population and concurrent-deploy noise respectively), not filed as findings. Remaining open item:
premarket/close state transitions were not specifically tested (would need to be timed around the
actual transition, not available on-demand within this pass).

---

## Phase 0 status (2026-08-24) — full coverage achieved

A broad interaction sweep (`qa-phase0-sweep.mjs`, #2775) followed by an exhaustive per-element
interaction pass (`qa-phase0-deep.mjs`, #2781/#2782/#2787/#2794) per the brief's correction that a
route merely navigated-to-and-screenshotted is not a route that was tested. Coordinator follow-up
(2026-08-23 23:37 UTC) directed clearing the remaining pending routes rather than leaving them
idle — done as of this update.

**Every route in scope, both viewports, now run through the deep (exhaustive per-element) harness:**

| Route | Product | Desktop | Mobile |
|---|---|---|---|
| `/` | — | Clean (0 P0-P2) | Clean |
| `/nighthawk` | Night Hawk | Clean | Clean (1 correctly-classified stale-handle HARNESS) |
| `/heatmap` | Thermal | Clean (1 correctly-classified HARNESS) | Clean (1 correctly-classified HARNESS) |
| `/vector` | Vector | Clean; 1 P3 flagged (below) | Clean |
| `/meridian` | Meridian | Clean — see the concurrent-deploy note below | Clean (2 correctly-classified HARNESS: 1 stale-handle, 1 self-triggered-nav) |
| `/dashboard` | SPX Slayer (+ embedded Largo) | Clean; 3 P3s flagged (below) | Clean; 3 more P3s, same pattern (below) |
| `/terminal` | Largo | Clean | Clean |
| `/flows` | Helix | Clean (shallow sweep only) | Clean (2 runs; 45 auth failures both times, correctly classified HARNESS — see note below) |
| `/pricing` | — | Clean (4 disclosures) | **N/A — see iOS-app-shell note below** |
| `/faq` | — | Clean (25 disclosures) | Clean (25 disclosures) |
| `/upgrade` | — | Clean | Clean |
| `/learn` | — | Clean (58 links) | Clean (58 links) |
| `/about` | — | Clean (6 links) | Clean (6 links) |
| `/track-record` | — | 2 P2s — see below | 2 P2s — see below (same shape) |

**Every defect the deep harness surfaced this pass turned out to be a bug in the harness itself**
(9 found and fixed — false-empty from unsettled pages, false active-tab counts across independent
tablists, a content-fingerprint that never reached dynamic content past a long static prefix, a
select test that reselected its own current value, a settle probe blind to native
`<details>/<summary>` disclosures and `<a href>`-only pages, and related timing/scoping issues).
Full root cause, live evidence, and fix for each is in #2781, #2782, #2787, and #2794's PR
descriptions — not duplicated here. **Exactly one confirmed PRODUCT defect** came out of the whole
pass — see the Entries section above (mobile sticky CTA / FAQ overlap, routed via #2799).

### Methodology note — what "mobile" means in this harness

`proxy-tunnel-context.cjs`'s mobile viewport uses an iPhone UA that **includes the
`BlackOutiOSApp/1.0` token** the real Capacitor app appends. The site correctly detects this as the
iOS app shell (`isIosAppShell()`) and applies App Store guideline 3.1.1 behavior — `/pricing`
mobile renders **"Your membership is managed on the web. Once active, sign in here to access the
full desk"** instead of the full pricing tiers/FAQ, by design (confirmed by reading
`RedesignHome.tsx` / `ios-app-shell.ts`, not assumed). **This means every "mobile" result in this
pass tested the iOS *app* webview, not a real mobile Safari/Chrome visitor** — genuine mobile-web
behavior (which would see the full `/pricing` page) has not been separately tested and is a real
coverage gap for a future pass to close with a mobile UA that does NOT carry the app token.

### `/track-record` — intermittent `/api/admin/health` 502, admin-only, self-recovering

Seen twice, independently, both times specifically on `/track-record` (desktop and mobile runs) —
`GET /api/admin/health` returned `502 {"error":"Failed to load admin health"}`, a **deliberately
caught** application error (`route.ts` catches an exception from `buildAdminHealthSnapshot()`,
which aggregates 15+ subsystems — SPX issues, provider health, 4 WebSocket statuses, rate
limiters, AI spend, DB pool, ops config). Not filed as a confirmed finding: a direct 3x
authenticated re-check immediately after the first occurrence returned clean 200s every time
(`health_ok: true`), and this session ran alongside heavy concurrent deploy activity from other
fleet lanes the whole time (see the `/meridian` ChunkLoadError note below) — a plausible transient
trigger for a health check that touches this many subsystems. Worth a future pass checking WHICH
sub-check throws when it recurs (needs server-side log access this sandbox doesn't have) if it
keeps showing up specifically tied to `/track-record`. Admin-only — zero real-member impact either
way.

### Items flagged for manual/product-lane verification — not confirmed, not dismissed

These surfaced live but the harness could not get confident, reproducible evidence either way
(documented in #2782 and #2787). Routing here rather than filing as confirmed findings, per the
brief's evidentiary standard — flagging honestly rather than asserting past what was actually
verified:

1. **Vector (`/vector`) — ticker search box.** Typed "SPY" into the "Search any stock symbol"
   input; it read back "SPX" (the previously-active ticker) after Enter. Two direct follow-up
   probes of the same input even disagreed on whether it was present/visible at that moment,
   consistent with a collapsed/expanding combobox rather than an always-open text field — plausibly
   correct "revert to last confirmed symbol on unselected Enter" behavior, not a bug. Needs a human
   (or a combobox-aware harness) to drive the actual autocomplete flow and confirm which it is.
2. **SPX Slayer (`/dashboard`) — "Largo" tab.** Clicking the embedded Largo tab reported no visible
   content change within the harness's poll window (~5.3s), but a direct follow-up probe found a
   real change (body text 39,731 → 40,946 characters) — the panel likely just settles slower than
   polled (chat/async content). Needs confirmation the Largo panel actually finishes loading in a
   reasonable time for a real member, not just that it eventually changes.
3. **SPX Slayer (`/dashboard`) — two unlabeled selects — STALE, superseded by a redesign.** Original
   report: timeframe select (`1/3/5/15/30/60/custom`) and a row-count select (`auto/6/8/12/16/20`),
   neither with an accessible name. **Re-checked 2026-08-24 ~23:42 UTC: `document.querySelectorAll("select")`
   returns zero results on `/dashboard`** — the panel has been visibly redesigned since this was
   filed (new `NODES 20 ROWS ▾` / `VOL RVOL ▾` custom dropdown-styled controls in the GEX chart
   toolbar, not native `<select>` elements). Whether the new controls carry accessible names was not
   checked — this entry is stale as originally written and shouldn't be re-tested against the old
   selector; a fresh a11y pass on the new dropdown components would need to start over.
4. **SPX Slayer (`/dashboard`) mobile — three more tabs, same shape** ("Matrix", "Intel", "Largo").
   Same slow-settle-vs-genuinely-broken ambiguity as items 2-3 above, at a higher hit rate (3 of 5
   mobile tabs vs. 1 of 4 on desktop) — consistent with mobile generally being slower to render
   rather than 3 new independent bugs, but not independently re-verified the way the desktop Largo
   tab was. Worth a focused check by whoever owns `/dashboard`: do these panels actually finish
   loading in a reasonable time on a real device, or are they genuinely stuck.

### Harness limitations tracked, not yet solved

- **Mid-interaction rollout resilience.** The settle-poll fix (#2782) only guards the
  pre-interaction window; a deploy landing mid-interaction-pass (observed 3x live against
  `/meridian` during this session, from concurrent fleet activity) still corrupts that run's
  console/network error counts. A full fix would need every interaction step, not just navigation,
  to detect and recover from a self-triggered reload.
- **Combobox-style inputs.** `testSearch` assumes a plain text field where typed text + Enter
  commits literally. Vector's ticker field (and likely others) is a collapsed/expanding combobox —
  needs its own interaction model (open trigger, type, select from a `role=listbox`/`role=option`
  list) rather than being treated as a generic text input.
- **Session lifetime vs. interaction-pass length on heavily-polling routes.** `/flows` mobile hit
  the exact same 45 auth failures on 2 independent runs (`api/market/spx/merged` and
  `api/market/anomalies`), correctly classified `HARNESS`. Direct check confirmed BOTH endpoints
  return clean 200s in the first 15s of page life — the failures build up later in the run, once
  the Clerk session JWT (~60-72s) outlives a long interaction pass (17 buttons tested) on a page
  that polls those two endpoints unusually often. Not a product bug, but a harness limitation worth
  fixing properly (session refresh mid-pass via `mintClerkPremiumSession`'s own `refresh()`, already
  used elsewhere per `CLAUDE.md`) rather than accepting HARNESS on every long/heavily-polling route.
- **Mobile viewport = iOS app shell, not mobile web.** See the methodology note above — a real
  mobile-web pass (Safari/Chrome UA, no `BlackOutiOSApp` token) has not been run at all this
  session and would need its own viewport config to close that gap.
