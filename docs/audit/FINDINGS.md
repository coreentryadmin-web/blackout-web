# FINDINGS — living issue log

(Rebuilt 2026-07-13: the prior log was clobbered to an empty file by a squash-merge
conflict-resolution mishap. Historical entries live in git history — `git log --all --
docs/audit/FINDINGS.md`. New entries append below; keep severity / root cause / file:line /
evidence / fix / status per the CLAUDE.md policy.)

## 2026-07-23 — [HIGH] Offline ratchet grader was EV-optimistic (mark-faithfulness) — FIXED + iron-condor guard

- **Severity:** HIGH for evidence-fidelity (the grader that measures the ratchet exit / would gate the
  banger scale-out was optimistically biased); **LOW blast radius** — every defect lived in the audit
  HARNESS (`scripts/audit/zerodte-sim.mjs`) + one latent guard in `iron-condor.ts`, **not** in any live
  trading path. Surfaced by a 10-agent adversarial audit of this session's new 0DTE code (the banger-live
  cores `banger-scale-out-grade.ts` + the calibration graduation ladder came back CLEAN). **Status: FIXED.**
- **Root cause & fixes (`gradeThroughExitEngine`):**
  1. **(#1, HIGH) best-case fill.** A ratchet/runner FLOOR breach booked `floorPnlPct` — the rule level —
     not the breaching mark. The live engine freezes `pinnedLivePnlPct(entry, mark)`, and by the breach
     condition that mark is at/below the floor (a fast candle undershoots it). So every ratchet exit was
     credited the best-case fill → the ratchet's realized EV was systematically **optimistic by ~20–50 pts
     per floored event**, and the advertised `RATCHET_PROTECT_AT=low|close` bracket only moved the TRIGGER,
     never the fill. **Fix:** the pessimistic bound (`=low`) now books the gap-through fill `pnlAt(bar low)`;
     the optimistic bound (`=close`) keeps the clean-floor `floorPnlPct`. The bracket now varies the fill
     (proven: SPY/QQ/… 2026-07-20 low 43.0% vs close 45.0%, previously identical). plan_stop keeps
     `pnlAt(planStop)` (repo stop convention).
  2. **(#2, MED) post-15:30 grading.** The replay ran bars to 16:00 (960) while the board hard-CLOSES every
     0DTE row at 15:30 (930, `derivePlayStatus`) and fires NO exit after — grading 30 min of trades the
     board forbids, and diverging from the sibling `gradePlanFromBars` (which breaks at 15:30). **Fix:** cap
     the replay at `REPLAY_STOP_ET_MIN = 930`.
  3. **(#3, MED) entry-bar look-ahead.** The entry bar was included (`b.t >= flaggedMs`); entry is its CLOSE,
     so its intrabar HIGH (printed earlier in that minute) could arm a floor/trim off a price the trade
     never had. **Fix:** exclude the entry bar (`b.t > flaggedMs`); the peak latch starts post-entry.
  - **(LOW, #5) iron-condor guard** — `selectIronCondor` never asserted strikes > 0, so a sub-$1.50 spot
    could return a negative-strike condor with `est_win_rate=100`. Fixed + tested in **PR #970** (latent on
    today's index/mega-cap 0DTE universe; load-bearing before the geometry is reused on cheaper bangers).
- **Net effect on the ratchet finding below:** the bias was optimistic TOWARD the ratchet, so correcting it
  did not overturn "hold > ratchet" — it **reinforced** it and made the magnitudes honest (see the updated
  evidence). No production behavior changed; the corrected grader is what the ratchet-finding numbers now cite.

## 2026-07-23 — [MEDIUM] Index 0DTE ratchet exit costs EV vs hold — CONFIRMED finding, live change DEFERRED

- **Severity:** MEDIUM (an EV leak on the live index exit; not a crash/data bug). **Status: CONFIRMED
  FINDING; exit change DEFERRED — larger-sample sweep run with the honest grader still cannot identify an
  optimal config; do NOT flip the live exit yet.**
- **Root cause:** `exit-engine.ts` `EXIT_RULES.ratchet_arm_pnl_pct = 25` arms a **breakeven floor** once
  a play's peak P&L hits +25%. But a 0DTE momentum play reaching +25% is a *continuation* signal, not a
  take-profit one — so the floor scratches at breakeven the exact plays that go on to +100%. The
  scratched-winner cost exceeds the saved-loss benefit.
- **Evidence (mark-faithful grader, larger sample):** graded through the SHIPPED exit
  (`gradeThroughExitEngine`, PR #961), now MARK-CORRECT (the grader-fidelity fixes above — gap-through
  fill, 15:30 cap, no entry-bar look-ahead). Re-swept over a dense Feb→Jul grid: **276 plays / 40 sessions**
  (all names) and **106 index-only plays** (SPY/QQQ/IWM). On the FULL sample **HOLD (−50/+100) beats the
  shipped ratchet**: **+4.1 pts/play** (all), **+2.8 pts/play** (index-only). The ratchet **buys win-rate,
  not EV** — WR climbs 34%→51% as the floors tighten while full-sample EV stays flat-to-worse (a clean
  green≠profitable illustration). Index 0DTE directional buying at 09:45 is ~breakeven-to-slightly-negative
  under EVERY exit config; the exit tune is a second-order lever. CONVERGES with the P3 "let-it-run" result.
- **Why STILL DEFERRED (larger sweep run, config still not identifiable):** the OOS split **disagrees in
  both universes** — calib ranks HOLD best (all +0.2% vs shipped −6.1%; index +1.1% vs −6.1%), the newest
  30% ranks the RATCHET best (all: shipped +3.0% vs hold +0.2%; index: shipped −4.9% vs hold −13.8%). 0DTE
  EV is dominated by a few big winners, so even at n=276/40-sessions the *config* choice is regime-noise.
  The *direction* (hold ≥ shipped ratchet on the full sample) is robust; the *optimal intermediate config*
  is not. Flipping a LIVE risk-management exit on windows that disagree would be reckless.
- **MECHANISM breakthrough (robust, unlike the config question):** the earlier work compared the shipped
  breakeven-FLOOR-EXIT only against pure HOLD (which flipped OOS). Testing the *mechanism* the exit-engine
  header itself hints at — a partial **TRIM**-at-arm instead of a floor-**EXIT** — separates cleanly. Over
  **352 plays / 51 sessions** (mark-faithful grader), a `trim ⅓@+25% + ⅓@+50%, run the last ⅓` beats **both**
  HOLD and the shipped floor-exit in **every** split (calib AND valid) and **both** universes (all-names AND
  index-only), and lifts win-rate 32%→**50%**:
  ```
  exit (all names)          calib    valid    all     win
  HOLD                      -0.8%   -12.1%   -3.7%    33%
  shipped floor arm+25      -4.4%   -10.1%   -5.8%    32%
  trim ⅓@25 + ⅓@50, run     +0.6%    -4.4%   -0.7%    50%   ← dominates both, every window
  ```
  Root: the floor-exit dumps the WHOLE runner on a dip to breakeven (scratching momentum); a partial trim
  banks into strength while letting the rest run — positive-skew-preserving, the same edge as the banger
  scale-out. Honest caveat: the valid regime was bad for 0DTE longs so all configs are negative there; the
  trim just loses least — it makes the exit strictly better and much greener, not the engine profitable.
- **Fix path — leading candidate identified, graduate before flipping:** the partial-trim is the clear
  replacement for the floor-exit, BUT `exit-engine.ts`'s own design says the ratchet thresholds are "v1
  constants … tuned with data" via **the counterfactual LEDGER grader**, not an offline backtest — and my
  evidence is an offline mirror over probed contracts. So the disciplined path is a `recommendExit`-style
  coded verdict that pins per-row floor-vs-trim counterfactuals on the LIVE ledger and graduates the trim
  when the live data confirms (the same calibration-first ladder as confluence/accumulation/scale-out).
  Until then the shipped floor-exit stands; the offline mirror (a `RATCHET_DUMP`-fed exit-variant sweep over
  the cached bar-paths) is reproducible evidence, not a license to hand-flip live risk code. **Do NOT flip
  the live exit off the backtest alone.**

## 2026-07-23 — 0DTE entry-timing correction: unlock 9:45 → 10:00 + timeOfDayFactor recalibration (USER-AUTHORIZED)

- **Root cause:** the G-2 opening-window unlock sat at **9:45 ET** (2026-07-13 directive) and
  `timeOfDayFactor` (`intraday.ts`) **rewarded** the 9:50–11:00 window (+5) while **penalizing** 11:00
  (−5, "lunch chop"). The simulator (25 sessions × SPY/QQQ/IWM, EV by fixed entry time) showed this is
  inverted vs reality: **9:45 −12.1% EV / 26% win (the WORST tested time)**, improving monotonically —
  10:00 −7.8%, 10:30 −9.1%, **11:00 +1.5%**. The gate unlocked at the worst moment and the score nudge
  favored the weak window.
- **Fix (user-authorized 2026-07-23, supersedes the 2026-07-13 directive):**
  (a) `OPENING_WINDOW_UNLOCK_ET_MINUTES` 9:45 → **10:00** (block the demonstrably-worst first 30 min);
  (b) `timeOfDayFactor` recalibrated — opening-chop penalty extends to 10:00, the **+reward moves to the
  10:30–12:30 continuation window**, real lunch chop is 12:30–14:00, afternoon-trend window unchanged.
- **Measured, not blunt:** stopped at 10:00 (not 11:00) because the backtest grader holds to
  stop/target/15:30 and ignores the live exit engine (likely UNDERSTATES early entries), and blocking
  the whole morning would empty the board. The soft 10:00–12:30 gradient is a score nudge, not a gate.
  The gate still buckets every commit by ET time (`gate_calibration_json.committed_at_et`), so the
  **live ledger** — not this backtest — decides whether to push the unlock later.
- **Evidence:** gates + board + 7/13-replay suites updated and green (133/133); the 7/13 replay now
  shows G-2 catching the pre-10:00 entries (AMD 09:50, SPY/MU 09:55) as a corroborating guard while
  G-1 tape-alignment remains the primary killer (F-3 holds). tsc + eslint clean.
- **Status:** SHIPPED (PR next).

## 2026-07-23 — Whole-market banger research + scanner tool (research + tooling)

### Research (docs/audit/0DTE-RESEARCH.md) — evidence-driven map for a top-tier system
- **0DTE grinder:** multi-day vs single-day discovery is a WASH (32% vs 36% WR, n≈30); entry timing is
  a real-but-modest edge (later > open ~13 EV pts; a 7-session "+43%" was OVERFIT, 25-session truth
  +1.5%); **CONFLUENCE is the edge** — 0/1/2 confirmations (VWAP-side + SPY-aligned) ladder −12.5% → 0%
  → **+15.9% EV** @ −50/+100, which resolves the geometry paradox (wide target is best ONLY for the
  confluent subset). The live `timeOfDayFactor`/9:45-unlock look mis-boundaried vs the data (surface to
  user; don't override the 2026-07-13 directive).
- **Whole-market bangers:** Polygon grouped-daily screens EVERY US stock (~12.4k/day). A dumb
  breakout+volume screen surfaces bangers constantly — **75% of movers' cheap OTM weeklies touch ≥2x,
  50% ≥3x, 25% ≥5x** (ANET $0.36→23x). **BUT held to expiry they decay to ~zero** (hold ~1.3x mean).
  The edge is the EXIT: a mechanical scale-out (50%@2x + trail + −60% stop) returns **+47% / +86% / +16%
  realized EV** across the 3 sessions with data (~+50% weighted, n=28, every session positive).

### Tooling — `scripts/audit/market-banger-scan.mjs` (`npm run scan:bangers`)
- Whole-market screen → ranked banger candidates + suggested cheap OTM weekly call; `--grade=DATE`
  measures maxRet vs hold-to-expiry vs REALIZED-under-scale-out. Read-only; secrets from env.
- **Key product truth:** finding bangers is trivial; **exiting them mechanically is the whole edge** —
  where a system beats a human. This is the north star for the whole-market engine.
- **Status:** research + tool committed (PR next). Prioritized plan in the research doc: P1 confluence
  tier → P2 banger scanner→discovery → P3 exit-engine study → P4 regime → P5 timing → P6 learning loop.

## 2026-07-22 — Multi-day flow accumulation wired into the LIVE 0DTE loop (feat, calibration-first)

### feat — the always-on scanner now has multi-day memory
- **Root problem (the user's red flag, confirmed):** `scanZeroDteBoard()` discovered setups from a
  SEVEN-HOUR window only — `fetchRecentFlows({ since_hours: 7, min_premium: 150_000, max_dte: 1 })`
  (`src/lib/zerodte/scan.ts:152`). Single-day amnesia: a name hit on the same directional strike for
  three days running looked identical to a one-off print. Real conviction is ACCUMULATION.
- **Fix:** the scan now also pulls a WIDE multi-day window (`MULTI_DAY_FLOW_HOURS=120` ≈ 5 days, all
  expiries, `min_premium 250k`, best-effort — a failure degrades to "no memory", never breaks the
  intraday scan) and runs the merged multi-day accumulation engine (`flowAccumulationByTicker`, #943)
  over it. New pure module `src/lib/zerodte/flow-accumulation-context.ts` maps DB `FlowRow`s →
  `FlowAlertRow`s (reconstructing the aggressor split from `ask_pct`), computes per-ticker signals,
  and attaches `flow_accumulation` to every `EnrichedZeroDteSetup`: `{direction, strength, days,
  net_signed_premium, magnet_strike, magnet_side, aligned}` — where `aligned` = today's 0DTE
  direction agrees with the multi-day stacked positioning. Flows through the board payload
  (`setups: EnrichedZeroDteSetup[]`).
- **Calibration-first (this codebase's own discipline, `calibration.ts`):** EVIDENCE ONLY. It is
  recorded/surfaced but does NOT yet move the score or gate the board. Whether "aligned with
  multi-day accumulation" predicts wins is a question for the graded ledger — once the bucket is
  large enough and measurably better, the alignment graduates into a scoring input the way G-4/G-6
  did. Never on vibes.
- **Evidence:** new pure module 6/6 unit tests (ask_pct split, missing-split fallback, malformed-row
  drop, alignment logic, end-to-end 3-day build reads bull + aligned, attach match/miss);
  `board.test.ts` 82/82 (no regression); tsc + eslint clean. (DB path itself can't run in-sandbox —
  Postgres TCP is blocked — but the engine was proven on live flow via `sim:0dte`.)
- **Follow-ups (noted, not in this PR — single-issue discipline):** (1) render the badge on the 0DTE
  card (payload already carries it); (2) persist `flow_accumulation` + `aligned` into the ledger
  `entry_context` and extend `calibration.ts` to bucket graded outcomes by alignment → graduate to a
  real scoring boost.
- **Status:** MERGED-pending (PR opens next). This is breakthrough #1 of the 0DTE loop plan.

## 2026-07-22 — 0DTE play SIMULATOR shipped + first structural findings (tooling + P2)

### Tooling — `scripts/audit/zerodte-sim.mjs` (`npm run sim:0dte`)
- **What:** a per-change 0DTE simulator that runs the REAL pipeline functions (imported from
  `src/`, not reimplemented) against REAL data (multi-day UW flow + live Polygon chains + Polygon
  minute bars) and reports, per stage: which tickers become candidates, the exact FUNNEL
  (candidates → score floor → chain → contract → premium → geometry → grounded → built → 0DTE
  filter → published), a per-ticker GATE TRACE (where each candidate died / that it passed), the
  generated plays with real contracts, and — in `--grade=YYYY-MM-DD` backtest mode — a minute-bar
  outcome (doubled / stopped / time-stop) per play.
- **Real code exercised:** `flowAccumulationByTicker`, `buildDeterministicEditionPlays` +
  `pickChainContract` (+ its funnel), `filterPlaysByMaxDte`/`optionsPlayWithinMaxDte`,
  `validatePlayGeometry`, `gradePlanFromBars` + `PLAN_RULES`.
- **Scope boundary (honest):** candidate DISCOVERY here is the accumulation engine itself
  (direction + strength from stacked multi-day flow), not the full production market-wide
  discovery (`candidates.ts` needs UW endpoints + Redis not all reachable from the sandbox). The
  point is to test how accumulation-driven candidates flow through the REAL selector/gates.
  Backtest grading uses an ATM 0DTE strike probed against the option's OWN minute bars on the
  session date (historical per-strike OI isn't available, so the live-OI picker is not used in
  backtest mode).
- **Env:** the script self-defaults `POLYGON_API_BASE` to `https://api.massive.com` when it's the
  unresolved sandbox placeholder. Run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`.

### P2 — Strict `maxDte=1` structurally starves the board on non-Friday sessions
- **Symptom (simulator, live + backtest):** on a Tuesday (`--grade=2026-07-21`) only SPY/QQQ/IWM
  graded; every single-name candidate returned `no_0dte` ("no 0DTE contract"). On a Friday
  (`--grade=2026-07-17`) all 10 candidates graded (the whole weekly universe expires that day).
- **Root cause:** only the big index ETFs (SPY/QQQ/IWM) + a few indices list Mon–Fri **daily**
  expiries; single names (NVDA, AAPL, MU, TSM, …) list weekly (Friday) expiries. `pickChainContract`
  in day mode requires an expiry within `[today, today+maxDte]`, so on Mon–Thu every non-daily name
  becomes stock-only ("— no options data available") and is dropped by `filterPlaysByMaxDte`. In
  today-mode the gate trace shows this precisely (`◐ built but dropped by 0DTE filter — contract
  "TSM — no options data available"`).
- **Evidence:** `npm run sim:0dte -- --grade=2026-07-21` → 2 gradeable (SPY/QQQ), 8 `no_0dte`;
  `--grade=2026-07-17` → 10 gradeable. Live today-mode funnel: 25 candidates → 10 stock-only.
- **Implication (not yet fixed — design decision needed):** a strict same-day-only 0DTE system can
  only trade ~3 ETFs four days out of five. Options to strengthen coverage: (a) widen the day window
  to the nearest listed weekly per-underlying (trade the true front expiry, still short-dated); (b)
  on Mon–Thu, concentrate the single-name universe into Friday 0DTE and only trade ETFs same-day;
  (c) keep strict same-day and accept an ETF-only board Mon–Thu. Flagging for the roadmap; the
  simulator now measures the trade-off of whichever path we pick.
- **Status:** OPEN (design). Simulator committed so any fix can be measured before/after.

### P2 — Grader shows stop-dominated outcomes at a fixed 09:45 ATM entry
- **Observation (backtest):** `--grade=2026-07-17` → 2 doubled / 8 stopped (20% double-rate, avg
  −20%); `--grade=2026-07-21` → 1/1. A fixed 09:45-ET ATM entry with the current PLAN_RULES
  (−50% stop / +100% target / 15:30 time-stop) is stop-heavy — consistent with the earlier live
  debrief (0% win / `target_unreachable` gate). Not a code bug; a tuning signal. The simulator is
  the harness to sweep entry timing / strike offset / stop-target geometry against real bars before
  changing the live rules.
- **Status:** OPEN (tuning) — measure candidate changes with the sim before shipping.

## 2026-07-22 — Auth nav stuck on "Sign in" after login (P1, FIXED live)

### P1 — Cloudflare edge-cached the homepage HTML, so signed-in users saw the anonymous nav
- **Symptom (member-reported):** sign in successfully, but the marketing nav keeps showing
  "Sign in" / "Get access →" instead of "Open desk →" — indefinitely.
- **Root cause — NOT the app.** The origin is correct: `MarketingPageShell`
  (`src/components/landing/MarketingPageShell.tsx:15`) computes `signedIn` per-request via
  `activeClerkUserIdFromRequestCookies()` (`src/lib/clerk-session-cookies.ts`), which decodes the
  `__session` JWT; `cookies()` makes the route dynamic and the origin sends
  `Cache-Control: private, no-store`. The bug was at the edge: a Cloudflare **cache rule**
  (`http_request_cache_settings` ruleset, rule `f261edb0…`) matched
  `path eq "/" or path eq "/upgrade" or starts_with(path,"/learn")` with
  `cache:true, edge_ttl.default=7200, mode=override_origin` — i.e. it **force-cached the HTML for
  2h, ignoring the origin's no-store**. One anonymous snapshot was stored and served to every
  visitor, signed-in included. (`/pricing`, `/faq`, and all `(site)` desk pages were already
  `cf-cache-status: DYNAMIC`, so only these three auth-chrome pages were affected.)
- **Evidence (live, headless Clerk login):** origin fetch of `/` with a cache-buster —
  anonymous → `Get access →` present; with a real `__session` cookie → `Get access →` gone,
  `/dashboard` links +2 (the nav flips to "Open desk →"). So the origin renders both states
  correctly. But the EDGE fetch of the real URL `/` WITH a valid `__session` cookie returned
  `cf-cache-status: HIT` (age climbing 135→136 across requests) — the cached anonymous HTML.
- **Fix (live, root cause):** appended `and (not http.cookie contains "__session")` to the rule's
  expression via the Cloudflare rulesets API (PATCH `…/rulesets/{id}/rules/{ruleId}`). Now any
  request carrying a Clerk session cookie **bypasses** the edge cache and hits the origin (correct
  per-user nav), while anonymous / signed-out (`__client_uat=0`, no `__session`) requests still get
  the fast cached copy — landing-page perf preserved. `__session` is httpOnly but the edge sees it
  (httpOnly hides from JS, not from Cloudflare). Verified post-fix: signed-in edge fetch →
  `cf-cache-status: MISS/DYNAMIC` + correct "Open desk →" nav; anonymous → still `HIT`.
- **Durability / follow-up:** this cache ruleset was created **manually in the Cloudflare dashboard**
  — it is NOT in `blackout-infra` terraform, so the live edit persists and no IaC will revert it. The
  deploy pipeline's `purge_everything` does not reintroduce the bug (first anon request re-caches
  anon; signed-in still bypasses). Remaining risk is a human re-editing the rule and dropping the
  cookie guard → codifying the Cloudflare cache rules in terraform (blackout-infra) is the durable
  belt-and-suspenders follow-up. Any NEW auth-dependent HTML route added to an edge-cache rule must
  carry the same `not http.cookie contains "__session"` guard.
- **Status:** FIXED live + verified. This docs entry is the in-repo record (the fix itself lives in
  Cloudflare, not code).

## 2026-07-21 — Enhancement: Wall Integrity Rings (second visual channel on beads)

### FEATURE — Bead halo now encodes wall confidence (firm/moderate/thin), not just magnitude
- **Gap, not a bug:** a bead's SIZE encodes magnitude (dealer gamma parked at the strike), but a
  member staring at the rail couldn't distinguish a wall that held all session and towers over its
  neighbors from a fat-but-fleeting level sitting in a mushy cluster — both drew as a big bead.
  Integrity was already computed (`vector-wall-integrity.ts`) but only surfaced as text for the
  TOP wall on the desk terminal; the chart threw it away.
- **Fix (additive, zero new plumbing):** generalized `scoreTopWalls` → `integrityByStrike()`
  (scores EVERY wall per side, same math + shared refMaxPct, so ring and terminal never disagree).
  New pure `haloRingForTier()` in `vector-wall-visual.ts` maps the tier onto the halo already drawn
  behind each core dot → the halo becomes a confidence RING (firm: crisp/bright/larger; moderate:
  soft; thin: suppressed → bare dot). `buildWallBeadMarkers`/`applyWallBeadMarkers` thread the map
  from the latest rail sample; GEX lens only (persistence is GEX-scoped). Core dot untouched, so the
  magnitude and confidence channels stay independent.
- **Non-breaking by construction:** unknown tier → neutral {1,1} multiplier, so VEX-lens and
  unscored/legacy rails render byte-identical to pre-ring (unit-tested).
- **Evidence:** 3909/3909 unit tests pass (+7 new: `integrityByStrike` all-wall scoring + shared
  ref + empty-safety; `haloRingForTier` neutral default + firm>moderate>thin ordering). tsc clean.
- **Status:** OPEN PR (fresh branch off main after #876 merged). Live visual validation via the
  Vector E2E screenshot gate after staging deploy.

## 2026-07-13 — Vector bead-rail / DTE-coherence audit (member-driven, RTH live)

### P0 — Bead trails ran full-width from the open; "no new walls all day" (FIXED, live-verified)
- **Root cause:** the recorder stores the full 20-deep-per-side ladder every 15s bucket, and
  `trailsByStrike` drew a bead in EVERY bucket where a strike appeared anywhere in that set.
  Structural round-number strikes never leave a 20-wide set → every trail born at the open; a
  wall that became dominant intraday was invisible as "new". `src/features/vector/lib/vector-wall-history.ts`.
- **Fix:** per-bucket DOMINANCE filter (`DOMINANT_WALLS_PER_BUCKET = 6`, top-N by |gamma| share) —
  honest births/deaths; persistent walls still run full-width. Commit `64f09e6` + regression test.
- **Evidence live:** 10-ticker rail sweep post-deploy: every ticker 2–8 distinct trail origins
  (pre-fix: one shared origin). Rebirth cue + trim-edge birth suppression followed (`21091ef`, `070da8e`).

### P0 — Universe limited to ~21 tickers; ASTS single beads (FIXED, live-verified)
- **Root cause:** the rail inherited the UW-overlay allowlist accidentally — walls are
  Polygon-cache cheap for any ticker; only pre-view recording was missing.
- **Fix:** `backfillRailPrefix` + `reconstructSessionRail` (today's published OI, gamma recomputed
  along the real spot path, ghost-rendered, dominance-filtered; never overwrites observed samples).
  ASTS added to the recorded set. Commit `070da8e`.
- **Evidence live:** PLTR/HOOD/SOFI/RIVN (never recorded) render full first-class Vector pages
  with staggered-birth rails.

### P1 — Wheel zoom snapped back (price-axis autoScale re-forced per tick) (FIXED, live-verified)
- **Root cause:** `refreshTrails`/`refreshOverlays` unconditionally re-applied
  `priceScale().applyOptions({autoScale:true})` every SSE tick, overriding a member's manual zoom
  (#299 had fixed only the time axis). `VectorChart.tsx`.
- **Fix:** `reassertPriceAutoScale` guard (only re-nudge while autoscale still engaged). Commit `35b8485`.
- **Evidence live:** wheel-gesture harness 5/5 — zoomed 103→39 bar-runs, held 39→39 through 12s
  of live ticks.

### P1 — SPX WEEKLY flip narrated 5,996 with spot 7,522 (−20%) while the API said 7,995 (FIXED)
- **Root cause:** banded chain snapshot edge flaps which zero-crossings exist; when the near-spot
  crossing vanished, nearest-spot selection returned the deep-OTM artifact.
  `vector-gex-reconstruct.ts:gammaFlipFromLadder`.
- **Fix:** plausibility band ±12% of spot; none survive → null → blended-flip fallback. Commit
  `75296eb` + regression test. Caught by the DTE grind (UI-vs-API same-instant).

### P1 — "All" horizon meant different things on different surfaces (FIXED)
- **Root cause:** stream-fed surfaces show the warm blended near-term aggregate; a COLD API task
  fell back to an all-expiry CHAIN aggregate (grind: ASTS banner resistance 75 vs dte=all API 90;
  TSLA support 392.5 vs 380). `vector-snapshot.ts:getVectorGexWallsForHorizon`.
- **Fix:** cold path reads the last recorded rail sample from shared Redis first (the numbers the
  stream showed ≤15s ago); chain stays last resort. Commit `75296eb`. Re-grind pending confirmation.

### P1 — AAPL banner "support NaN" (FIXED) + intermittent missing put side (OPEN lead)
- **Fix shipped:** `deriveVectorRegime` finite-guards wall levels (NaN passes `!= null` and
  toLocaleString renders "NaN"). Commit `f34ccc5` + test.
- **Open lead:** per-expiry gate lets a call-only scoped set win (`vector-snapshot.ts` narrowed
  branch), so "support" intermittently disappears for a horizon while the API (one cache refresh
  later) has a put king. Needs producer-side investigation (thin-chain honesty vs sign/threshold bug).

### P2 — dte= query param was case-sensitive; "0DTE" silently re-scoped to "all" (FIXED)
- `normalizeDteHorizon` now case-folds. Commit `a01f313` + tests. (Found because the hardcore
  harness itself hit it; a member integration could too.)

### P2 — Pivot-P line shared EMA 9's exact color #fb923c (FIXED)
- Two indicators indistinguishable on-chart; also collided pixel-level E2E checks. Pivot-P →
  #f97316. Commit `a01f313`.

### Harness false negatives fixed (testing the tests)
- Terminal capture truncated at 300 chars (cut before king citations); rail-advance poll queried
  `dte=all` without session (empty by route contract), then uppercase `0DTE` (re-scoped to "all"),
  then a DOM date-scrape that could yield null; zoom predicate expected bar-runs to INCREASE on
  zoom-in (they decrease). All four blamed the product falsely; all fixed with comments explaining why.

### Verified-healthy (evidence against suspicion)
- Narrowed recorders: SPX 0dte/weekly/monthly = 319 samples each (full session), AAPL/NVDA 73 —
  direct authed probe. Rail advance re-check: AAPL 85→88 samples in 35s.
- Indicators one-by-one (6 line indicators × 6 tickers): paint alone, clear to 0px on disable.
- Rapid-switch race (0DTE→150ms→MONTHLY): final state is MONTHLY's on all 6 tickers.
- DTE grind totals: 358/364 checks green across SPX/SPY/NVDA/TSLA/AAPL/ASTS.

### Still open (tracked)
- `/api/account/personal-alerts` 502 (origin-side; #304 made the failure honest).
- Night Hawk "Invalid Date" ×2; dashboard hydration #418 (can blank the desk on a cold load —
  escalated toward P0); SPX Slayer "Largo LIVE COMMENTARY" panel blank (pre-existing).
- Ladder "21 UI rows vs 20 API" one-off on AAPL (suspect: spot-divider row class; re-check).
- AAPL missing-put-side producer lead (above).

## 2026-07-13 evening — wall-engine overhaul (member-driven)

### P0 — Mid-session wall births were MATHEMATICALLY IMPOSSIBLE (FIXED — verify at 07-14 open)
- **Root cause (the deepest one):** wall strength = OI × gamma, and OI is published once pre-market
  and frozen all day → the dominant strike set was fixed at 9:30 regardless of session flow. No
  render-side filter could ever produce a mid-day birth. The reference product's walls birth
  mid-day because they accumulate TODAY's flow.
- **Fix:** positioning = OI + today's per-strike traded volume (Polygon day.volume, live) in the
  live per-expiry path; 0-OI contracts that traded today are kept (a brand-new same-day wall).
  Back-projected reconstruction stays OI-only (no fabricated morning walls). `a63f162` + tests.
- **Verification:** scheduled 2026-07-14T14:05Z — screenshots must show trails starting at
  mid-session candles.

### P0 — Narrowed rails contained blended data MISLABELED as the horizon (FIXED)
- TSLA "0DTE" on a Monday (no 0DTE chain exists) drew a full-width static rail — the #301
  blended-fallback recorded blended walls into narrowed rails when the chain was empty. Fallback
  deleted: empty chain → honest gap. `bb4ddeb`. Today's contaminated rows age out at session end.

### Product decisions (user-directed)
- DTE toggle = 0DTE/WEEKLY/MONTHLY only ("All" option removed; back-end "all" APIs intact);
  default weekly. `bb4ddeb` (corrects the over-removal in `b6697e4`).
- King anchor price-lines removed (redundant with king beads). `b6697e4`, visually verified gone.
- DOMINANT_WALLS_PER_BUCKET 6 → 3 (Skylit NODES=3): sparse rails, visible rotation. `bb4ddeb`.

### Process failure logged honestly
- THREE validation runs invalidated by launching inside rolling-deploy windows (mixed replicas
  serve old+new builds for several minutes; per-navigation results flip). Rule going forward:
  after a trunk push, wait ≥6 min AND confirm a marker (e.g. the toggle testids) before treating
  any UI run as evidence.

## 2026-07-14 — Vector data refresh rate optimization (member-reported, real-time responsiveness)

### P2 — Slow Vector data updates (spot every 3s, GEX ladder every 60s, flow/history every 30-60s) (FIXED, pending deploy verify)
- **Root cause:** SWR refresh intervals set conservatively for minimal server load; member reported Vector felt "static" and laggy, not responsive to market moves. Multiple Vector surfaces refreshing at different rates (3s/30s/60s).
- **Requirement:** All Vector data (GEX, VEX, DEX, charm) should update with uniform 15-second cadence across all stocks (universe + non-universe), timeframes, and DTEs. Spot prices 1 second from playbook.
- **Fix:** Standardized all Vector refresh intervals to 15 seconds default:
  - **Commit a3aced5:**
    - VectorDeskTerminal.tsx:61: SPX playbook refresh `3_000` → `1_000` (every 1s)
    - VectorGexLadder.tsx:105: GEX matrix refresh `60_000` → `15_000` (every 15s)
  - **Commit 78cdf74:**
    - VectorChart.tsx:1514: Flow data fetch `30_000` → `15_000` (every 15s)
    - VectorChart.tsx:1982: Wall history fetch `60_000` → `15_000` (every 15s)
    - VectorScanner.tsx:45: Universe scanner refresh `30_000` → `15_000` (every 15s)
- **Impact:** All Vector surfaces now refresh on same 15s cadence; spot prices update every 1s from playbook/SSE stream; gamma Greeks (GEX/VEX/DEX/charm) refresh 4x per minute instead of every 1-2 minutes.
- **Evidence expected:** Post-deploy, GEX/flow/history all update 4 times per minute; consistent refresh across all tickers and horizons; member experience no longer "static".
- **Status:** Fixed (commit 78cdf74), staged on `claude/three-repos-review-36t217`, awaiting staging deployment verification. Full UI validation requires Cognito authentication (https://staging.blackouttrades.com/vector)

## 2026-07-14 — Vector GEX ladder asymmetry (discovered during wall-birth validation)

### P1 — Scoped DTE ladder strikes mismatched chart walls (FIXED)
- **Root cause:** The GEX ladder panel (gex-ladder API endpoint) computed the ladder for narrowed horizons (0DTE/WEEKLY/MONTHLY) using OI-only GEX values, while the chart walls used volumeAdjusted GEX (OI + today's per-strike traded volume). This created an asymmetry: ladder UI showed different strike sets and values than the chart's beads, breaking cross-surface truth.
  - `src/features/vector/lib/vector-dte-walls-server.ts:95` — `getHorizonStrikeTotals()` called `gexLadderAtSpot(filtered, spot, today)` without `volumeAdjusted` flag (defaulted to false).
  - Chart walls used `{ volumeAdjusted: true }` (vector-dte-walls-core.ts:58) for mid-day births.
- **Evidence:** Test failures showed NVDA scoped ladder 44 UI strikes vs 89 API ladder strikes (49% data), banner support rendering NaN, cross-surface disagreement on king strikes (banner 210/NaN vs ladder 215/180). All consistent with unmatched GEX computation.
- **Fix:** Pass `{ volumeAdjusted: true }` to `gexLadderAtSpot()` in `getHorizonStrikeTotals()` (line 95). Since the ladder is fetched every 15s during live session, it must show dynamic walls (OI + dayVolume) that birth mid-day, not static OI-only structures.
  - **Commit 107c450:** Single-line fix + deep-dive comment in PR write-up.
- **Rationale:** The ladder is displayed live alongside the chart and polls every 15s. It should reflect the same volumeAdjusted positioning the chart uses for wall/bead rendering — consistency and honest mid-day births. Reconstruction (historical playback) still uses OI-only (no options passed).
- **Status:** Fixed (commit 107c450). Pending staging E2E re-validation (ladder strike count, banner/king alignment, cross-surface agreement).

## 2026-07-14 — Vector wall death visibility (user-observed)

### P2 — Dead walls not visually distinguished from live walls (FIXED)
- **Observation:** Old walls that dropped below the dominant set (top-3 by strength) were still visible on the chart at the same brightness as active walls, making it unclear which walls were live vs stale/dead.
- **Root cause:** Inactive walls (marked `active: false` when `lastSeen < latest` bucket) were dimmed to only 40% opacity (`STALE_TRAIL_FADE = 0.4`). At 40%, they're still faintly prominent and could read as "still forming" rather than "departed".
- **Code flow (verified correct):**
  - `trailsByStrike()`: Only records points for strikes in the DOMINANT set (top-3 per bucket by |pct| strength)
  - Strikes that drop below top-3 don't get a point in that bucket → `lastSeen` stops
  - `strikeTrailLifecycle()`: Sets `active = (lastSeen === latest)`. A wall is inactive if it's not in the latest bucket.
  - `VectorChart.tsx:740`: Applies `staleFade` multiplier to alpha (40% for inactive)
- **Fix:** Increased wall fade for inactive trails from 40% to 15% opacity (commit 70df3ea). Dead walls now render at the same ghost-opacity as modeled/reconstructed beads, making the "alive vs dead" distinction unmistakable. Visual hierarchy: solid beads (100%) > modeled beads (15%) ≈ dead walls (15%) > background.
- **Status:** Fixed (commit 70df3ea). Visual distinction should now be clear on staging — dead walls fade to a faint historical artifact level instead of remaining visually prominent.

## 2026-07-15 — Night Hawk publish gates too strict off-hours/staging

### P1 — Staging/off-hours Night Hawk editions published zero plays after G-N3 gate merged (FIXED, CI green, deployable)
- **Root cause:** PR-N3 (commit 9c9c122) added publish-gate G-N3 (stale-quote basis check). Price from Polygon fallback to hourly bars (no daily bar) yields `price_session=null`. The gate failed-closed: null=unknown=indistinguishable from stale → BLOCK. All plays blocked on staging (off-hours, no daily bars). Real issue: the gate couldn't distinguish "no daily bar" (legitimate, current data) from "stale quote" (wrong trading day).
- **Fix:** G-N3 now only blocks when `price_session` is KNOWN but STALE (wrong trading day). Null passes — data-gap ≠ staleness proof. `src/features/nighthawk/lib/publish-gates.ts:200,207`. Commit 53e1f67. Test updated (was fail-closed on null; now passes "hourly fallback is valid off-hours").
- **Verification:** (1) All 3487 unit tests pass, including deterministic-edition.test.ts (10/10 green). (2) TypeScript clean (`npx tsc --noEmit`). (3) Test updated: "G-N3 lenient: an UNDATEABLE quote (price_session null) passes — hourly fallback is valid off-hours" asserts `verdict="PUBLISH"`.
- **Blast radius:** Fix is isolated to the G-N3 gate logic in publish-gates.ts; no other code paths reference stale-quote checks. Deterministic edition builder, candidate extraction, and scoring all untouched.
- **Status:** Fixed (commit 53e1f67), deployable; Night Hawk on staging should now publish with plays. Trigger with `?force=1` post-deploy and verify 5 plays generate for tomorrow.

## 2026-07-15 — 0DTE desk bundle cache stampede (architecture audit)

### P3 — No single-flight coalescing on `fetchPolygonOdteDeskBundle` (FIXED)
- **Severity:** P3 (minor — wastes API quota, not data correctness)
- **Root cause:** `fetchPolygonOdteDeskBundle` (`polygon-options-gex.ts:177`) uses a plain `cachedOdteBundle` variable with no inflight guard. During a cache miss (every 5s at the new TTL), N concurrent requests each independently call `loadOdteContracts` → `aggregateGexRows`, producing N redundant Polygon API calls. The main heatmap path (`heatmapInflight` Map at line 1120) already prevents this correctly — the 0DTE path was never given the same treatment.
- **Evidence:** Code inspection — no inflight promise variable existed; the heatmap path has `heatmapInflight = new Map<string, Promise<...>>()` with `.finally(() => delete)` cleanup, but the 0DTE path had no equivalent. Under load (deploy cold start, 5s cache expiry with multiple SSE streams polling), all concurrent callers would independently fetch the same Polygon chain snapshot.
- **Fix:** Added `odteBundleInflight` promise variable (single key — always SPX). When a build is in progress, concurrent callers share the in-flight promise. The promise is cleared in `.finally()` so a thrown build can't wedge the slot. Cache checks (in-memory + Redis) remain outside the guard since they're fast reads. `polygon-options-gex.ts:92,225-247`.
- **Blast radius:** Single caller at line 2932 (`aggregateGexRows` in the SPX desk route). Return type unchanged (`Promise<{ rows, maxPain }>`). The positioning bundle (`fetchPolygonPositioningBundle` at line 3063) has the same pattern but is keyed per-ticker, so stampede risk is distributed — not fixed here, lower priority.
- **Status:** Fixed (this PR).

## 2026-07-16 — Night Hawk overnight edition deep audit (play quality + gate bias)

### P0 — Entry levels anchored at support, not spot — all 5 plays unfillable (FIXED)
- **Severity:** P0 (every published play was unfillable — members cannot trade at the suggested entries)
- **Root cause:** `buildDirectionalStockLevels()` in `play-levels.ts:68-77` set LONG entries at `support * 0.998 – support`, a "buy the pullback" shape. For overnight plays where members act at the next session's open, support is typically far below spot for trending stocks. The entry band sits 6–18% below market — unfillable. All 5 plays failed G-N1 (band_detached, max 3.5%) and G-N2 (target_unreachable, max 2× ATR14). The rescue cascade (PR-N13 `promoteTopBlocked`) correctly surfaced them with `gate_promoted: true` warnings, but the entries remain untradeable.
- **Evidence:** Staging edition 2026-07-17: FHN entry $23.20 vs spot $25.40 (−8.5%), COF $174.07 vs $211.93 (−17.8%), GOOGL $329.87 vs $354.46 (−6.8%), GOOG $333.35 vs $353.81 (−5.7%), ZETA $17.75 vs $21.40 (−17.0%). All 5/5 `gate_promoted: true`.
- **Fix:** Added optional `spot` parameter to `buildDirectionalStockLevels`. When present: LONG entry = spot ±0.5%, target = resistance, stop = support. SHORT entry = spot ±0.5%, target = support, stop = resistance. `resolveLevels()` in `deterministic-edition.ts` now passes spot through. Legacy callers (no spot param) unchanged. 4 new tests.
- **Blast radius:** 2 callers — `resolveLevels` (now passes spot) and `play-backfill.ts` (unchanged).
- **Status:** Fixed (PR #400).

### P0 — No ticker-family dedup — GOOGL + GOOG (same company) both in top 5 (FIXED)
- **Severity:** P0 (halves effective diversification; members get two plays on Alphabet)
- **Root cause:** Zero ticker-family awareness anywhere in the pipeline. `aggregateTickerFlows()` keys by raw ticker string. `rankCandidates()` sorts independently. `capSectorConcentration()` caps at 2/sector but both GOOGL and GOOG fit under that. `cross-edition-governor.ts` does exact string match only. `deterministic-edition.ts` iterates ranked order with no family check.
- **Evidence:** Staging edition 2026-07-17: GOOGL (rank 3, score 67) and GOOG (rank 4, score 63) both published as separate plays on Alphabet Inc.
- **Fix:** Added `TICKER_FAMILIES` map (GOOG→GOOGL, BRK.B→BRK.A, FOX→FOXA, etc.), `canonicalTicker()`, and `deduplicateTickerFamilies()` in `play-constraints.ts`. Wired into both `buildDeterministicEditionPlays` and `buildRescuePlays` — once a family member is selected, subsequent members are skipped. 8 new tests.
- **Status:** Fixed (PR #400).

### P2 — All-LONG structural bias in non-bearish markets (BY DESIGN)
- **Severity:** P2 (by design, but a diversification gap)
- **Root cause:** Five structural biases: (1) direction tie-break `>=` defaults to LONG (`scorer.ts:412`), (2) short-interest score is LONG-only (`scorer.ts:761`), (3) call premiums dominate in normal markets, (4) bearish posture requires 2/3 bearish signals (`bearish-posture.ts:29`), (5) regime multiplier is direction-blind (`scorer.ts:68`).
- **Evidence:** All 5 plays in the 2026-07-17 edition are LONG. The pipeline has no direction-balance constraint analogous to the sector concentration cap.
- **Status:** By design. Documented for future enhancement consideration (min-1-short constraint).

### P3 — Tier inversion: score 77 → B, score 67 → A (BY DESIGN)
- **Severity:** P3 (confusing UX but data-justified)
- **Root cause:** `nighthawk-tiers.ts:137-151` — scores ≥70 are ceiling-capped at B tier. The measured track record shows A+ (≥70) went 0 wins / 1 loss, while B (40-54) averaged +2.99%. The tier engine prices in the overnight inversion.
- **Evidence:** FHN score 77 → B (capped), GOOGL score 67 → A (mid-band, 3+ confirming signals).
- **Status:** By design. No member-facing explanation of the inversion exists (future UX item).

## 2026-07-18 — Production auth redirect validation

### P1 — Authenticated users see sign-in page instead of being redirected (FIXING)
- **Severity:** P1 (UX disruption — authenticated users landing on /sign-in see the form instead of being redirected to /)
- **Root cause:** `src/middleware-clerk.ts:47` — Clerk v7.5.17's `auth()` function in the `clerkMiddleware` callback does not reliably return `userId`, even when the session JWT is valid and `auth.protect()` succeeds. The internal `createMiddlewareAuthHandler` calls `requestState.toAuth()` on each invocation, while `createMiddlewareProtect` uses a pre-computed `rawAuthObject` from the initial `requestState.toAuth()` call. The divergence causes `auth().userId` to be `null` while `auth.protect()` correctly detects the authenticated user.
- **Evidence:** fetch-based validation against `blackouttrades.com` with FAPI-minted Clerk session (JWT `sub` confirmed via Backend API, session status: active). Protected routes return 200 (`auth.protect()` succeeds), but `/sign-in` returns 200 with `x-middleware-rewrite: /sign-in` (our redirect branch never fires). Unauthenticated requests correctly get 307 to `/sign-in?redirect_url=...`.
- **Fix (attempt 2, failed):** `auth.protect()` try-catch (PR #785). Deployed but still broken — `auth.protect()` also throws on `/sign-in` pages (Clerk's `authenticateRequest` produces a different `requestState` for auth pages vs protected pages with the same cookies).
- **Fix (attempt 3):** Bypass Clerk's auth resolution entirely. Decode the `__session` JWT payload directly in middleware (`atob` base64url decode), check `sub` (userId) and `exp` (expiry). The JWT is already cryptographically verified by Clerk's `authenticateRequest` before our handler runs. See issue #789.
- **Status:** Fix shipped (PR #790, hardened #792). Prod validated 2026-07-18.

## 2026-07-18 — 0DTE Command deep system audit (docs-only PR)

### P0 — Persist path ignores MOVED / illiquid / NO_QUOTE (FIXING — PR #788)
- **Severity:** P0 (commit discipline — UI shows SKIP via `resolveFreshFindStatus` but `persistZeroDteScan` only checks `gate.verdict === "COMMIT"`, `scan.ts` ~463–465)
- **Root cause:** Chase guard lives in `plan.ts` (`CHASE_PCT=35` → `entry_status=MOVED`) and board display, not in the one-way commit door.
- **Evidence:** `docs/audit/0DTE-SYSTEM-DEEP-AUDIT-2026-07-18.md` §3; `board.test.ts` MOVED → SKIP; no matching test on persist.
- **Fix:** G-8/G-9 hard blocks in `evaluateZeroDteGates` + persist belt-and-suspenders (PR #788).
- **Status:** Code PR #788 pending merge.

### P1 — G-7 macro hard-block not wired to 0DTE (FIXING — PR #788)
- **Severity:** P1 (event-day risk)
- **Root cause:** SPX Slayer has `macroHardBlock()` in `spx-play-gates.ts`; 0DTE gate spec lists G-7 but no shared module under `src/lib/zerodte/`.
- **Fix:** `macro-hard-block.ts` + wire into `evaluateZeroDteGates` (PR #788).
- **Status:** PR #788 pending merge.

### P1 — intraday_conflict flag not a hard gate (FIXING — PR #788)
- **Severity:** P1
- **Root cause:** `attachIntradayEdge` sets `intraday_conflict` on setup; logged in audit row only — not evaluated in `gates.ts`.
- **Fix:** G-10 in PR #788.
- **Status:** PR #788 pending merge.

### Reference
- **Full analysis:** `docs/audit/0DTE-SYSTEM-DEEP-AUDIT-2026-07-18.md` (architecture, loser forensics, API roadmap, phased build plan).
- **Implementation track:** PR #786 Night Hawk UI + 1s live lane; PR #788 precision gates.

## 2026-07-21 — Wall / bead / matrix-drift end-to-end validation (live prod, RTH)

### Live validation result: walls + beads + matrix % drift are numerically correct (PASS)
- **Method:** minted one temp prod Clerk admin/premium user (deleted after), swept SPX/SPY/NVDA/ASTS ×
  0DTE/WEEKLY/MONTHLY/ALL against the clean JSON APIs, independently RECOMPUTED the wall pick + pct
  share + drift-% formulas, and cross-checked against Polygon ground truth. 312 assertions PASS / 0 FAIL.
- **Walls:** served king wall == ladder argmax(+g)/argmin(−g) on every ticker×horizon; king pct ==
  independent |g|/Σ|g|; magnitude∈[0,1]; ≤1 king/side; flip within ±12% of spot; no malformed floats.
- **Beads:** recorded rails present (e.g. SPX 957 samples), times ascending/unique, all nodes finite &
  pct-valid, genuine mid-session births (SPX 11/17 strikes born after the first bucket — not back-filled).
- **Matrix % drift:** `shiftPercentForStrike` = (Δ/|current−Δ|)·100 is finite, sign-tracks-Δ, non-absurd
  across all strikes; drift keys ⊆ matrix strikes (2 minor out-of-window strikes on NVDA/ASTS — cosmetic).
- **Parity:** SPX≈10×SPY (10.034); app spot vs Polygon last within 0.14% (SPY/NVDA/ASTS); ladder advanced live in 35s.

### P2 — Put-wall proximity callout inverted the trade bias when support broke (FIXED, tested)
- **Severity:** P2 (member-facing narration; narrow ≤0.5% band, crossed-side case only). No numeric wall/bead value affected.
- **Root cause:** `src/features/vector/lib/vector-wall-proximity.ts` — for `side==="put"`, `above = signed>=0`
  means the put-wall STRIKE is at/above spot, i.e. spot has fallen THROUGH its largest-negative-gamma
  support (support breaking). The branch printed "reclaimed support, dip-buy zone" — a bullish dip-buy at
  the exact moment support was lost. The `!above` (intact support) branch was already correct, which made
  the inversion clear. The distance word ("% above") was also geometrically wrong for a below-spot wall.
- **Blast radius:** surfaced in the Vector desk terminal (`VectorChart`), `VectorPageShell`, AND the Largo
  AI read (`src/lib/bie/vector-full-state.ts`) — three member-facing consumers of the same string.
- **Fix:** `above` put branch now reads "Lost the {strike} put wall ({dist}% overhead) — support gave way …";
  `!above` distance corrected to "% below". Regression test added (spot under put wall must not narrate
  dip-buy/reclaimed). `npx tsx --test vector-wall-proximity.test.ts` → 7/7 pass.

### P2 — Gamma flip used a per-strike crossing, not the cumulative zero-gamma boundary (FIXED, tested)
- **Root cause:** `gex-cross-validation-core.ts:zeroGammaFlip` (Heat Map / positioning / intraday-adjust /
  odte-scope) picked the PER-STRIKE net-gamma sign crossing nearest spot, while `gammaFlipFromLadder`
  (reconstruct rail) and `gamma-desk.ts:computeGammaFlip` (SPX desk) used the CUMULATIVE zero-gamma crossing.
  On a net-short-across-the-book chain the per-strike path interpolates a spurious crossing below spot; the
  `spot >= flip ? "long" : "short"` posture in `computeGexRegime` then reads "long gamma" on a book that is
  short gamma everywhere. Evidenced by unit ladder {698:-2e9,700:-3e9,710:+1e8,720:+2e9,730:-1e8} @ spot 715:
  per-strike → 709.68 (→ "long"), cumulative → null (honest: no long-gamma regime).
- **Scope discipline:** `zeroGammaFlip` is ALSO the generic per-strike zero-level detector for the VEX flip and
  DEX/CHARM zero-levels (polygon-options-gex.ts:2395/2403/2414), where bidirectional per-strike crossing is the
  correct definition (a deliberate prior fix). So `zeroGammaFlip` was LEFT UNCHANGED; a dedicated
  `cumulativeGammaFlip` was added and wired to the four GAMMA sites only (gexFlip 2384, cross-validation
  gammaFlip, intraday `flipAdjusted`, odte-scope scoped flip). All surfaces now share one gamma-flip definition.
- **Live pre-validation (RTH 2026-07-21):** recomputed old-vs-new on 16 live ticker×horizon chains — the
  cumulative flip sits at spot (SPX/SPY/NVDA narrowed 0.00–0.29% from spot vs the old ~13pt-below-spot bias)
  and NEVER blanked. Unit tests: net-short→null (+ per-strike contrast), ±12% band rejection, <2 strikes→null.

### P3 — Third gamma-flip implementation (gamma-desk) folded onto the shared cumulative flip (FIXED, tested)
- **Follow-on to the 2026-07-21 flip unification.** `gamma-desk.ts:computeGammaFlip` (SPX desk + Nighthawk
  positioning, via `/api/market/gex-positioning`) was a THIRD cumulative flip impl that detected a cumulative
  sign change in EITHER direction plus terminal zero-touches (no plausibility band). It agreed with the
  heatmap flip on normal books but diverged on inverted/boundary profiles (e.g. [100:+8,110:-12]→106.67;
  [100:+10,105:0,110:-10]→110).
- **Fix:** `computeGammaFlip` now delegates to the shared `cumulativeGammaFlip` (convert ranked_levels →
  strike-total record). One gamma-flip definition across heatmap, SPX desk, reconstruct rail, and Nighthawk:
  net-short→net-long crossing nearest spot, ±12% band, null when the book never turns net-long. Behavior
  change is confined to inverted/net-short/boundary books (now null or the near-spot crossing instead of a
  long→short crossing / terminal zero-touch). Tests updated + net-short→null case added; gamma-desk suite 15/15.

## 2026-07-21 — SPX Slayer live CTO audit (99 samples, RTH) — fixes batch 1

Deep live audit of the SPX Slayer desk (poll every 15s, 18:54–19:35 UTC, cross-checked vs Polygon).
No P0: 0 correctness violations across 99 samples (above_flip, flip/maxpain band, SPX≈10×SPY 10.032–10.035,
price-vs-matrix ≤1.61pt). Cadence healthy (desk/matrix as_of advance ~every poll ≈5s). Beads forming
(wall-history 976→992). This batch fixes the two clean backend data-correctness findings.

### P1 — "GEX stale" pill never fired even at 3-min-old dealer gamma (FIXED, tested)
- **Root cause:** `spx-desk.ts` canonical desk-GEX path returned `gex_stale: false` HARDCODED while
  computing a real `gex_age_ms = now − pos.asof`. When the UW positioning snapshot lagged, the desk
  served stale GEX flagged as fresh. The fallback path derived staleness correctly, so the two paths
  disagreed. **Evidence:** live sample 19:08:25 had `gex_age_ms = 183,827` (183s, 6× the 30s
  `GEX_STALE_MS`) with `gex_stale:false`; 0/99 samples ever flagged stale.
- **Fix:** extracted `gexStaleFromAge(ageMs)` (pure, `spx-desk-numerics.ts`) = `age==null || age>GEX_STALE_MS`;
  both desk-GEX paths now derive `gex_stale` from it. Unit-tested incl. the exact 183,827ms case.

### P2 — /api/market/spx/pulse leaked unrounded floats (FIXED, tested)
- **Root cause:** `buildSpxDeskPulse` returned every numeric RAW; `buildSpxDeskFull` rounds via
  `roundDeskNum`. The header ribbon merges both lanes, so the pulse lane surfaced unrounded floats.
  **Evidence (every one of 99 samples):** `vwap 7500.4571055…`, `ema20 7490.6383…`,
  `lod 7467.860000000001`, `sma200 6994.99535…` (desk lane served these rounded). CLAUDE.md systemic
  "round at the data layer".
- **Fix:** `roundPulseNumerics(pulse)` (pure, `spx-desk-numerics.ts`) rounds all price-class fields to
  2dp; applied to the pulse result at return (after regime/above_vwap are computed from raw values, so
  no derived flag shifts). Unit-tested (rounds the live leak values; preserves nulls; price stays number).

### Deferred (logged, not in this batch)
- P2 `gap_pct` is not a gap in RTH — `gap-proxy.ts:resolveDeskGap` uses `gapFromPrice(current, prior)`,
  so it tracks live price and equals `spx_change_pct` (confirmed: changed 9× in 8 min in lockstep). NOT
  rendered on the SPX ribbon (backend field → lotto engine); fix needs the session-open price. Hold.
- P2/UX same concept, different number on one screen: ribbon flip (~7598, near-term aggregate) vs embedded
  chart flip (~7504, 0DTE); desk king 7600 vs 0DTE ladder king ~7515; ribbon EMA 20/50/200 vs chart EMA
  9/21/50. Needs scope labels / design decision.
- P3 flip level jitter (7578–7607, ±18pt on a 4pt-quiet tape — sensitive near the concentrated 7600 wall);
  consider display smoothing. TICK/TRIN/ADD estimated (`add` clamp) + not rendered. Matrix poll comment
  stale (says 8s/20s; actual 5s).

## 2026-07-21 — SPX Slayer audit fixes batch 2

### P2 — gap_pct was the live change, not a gap, during RTH (FIXED, tested)
- **Root cause:** `gap-proxy.ts:resolveDeskGap` RTH branch used `gapFromPrice(spx_price, prior_close)`
  — the LIVE price — so `gap_pct` drifted every tick and was identical to `spx_change_pct` (audit
  evidence: changed 9× in 8 min in lockstep). A gap is the OPENING dislocation, frozen at the open.
- **Fix:** `resolveDeskGap` now takes `rth_open` and, in RTH, computes the gap from the session open
  (frozen `sessionStatsFromMinuteBars(...).open`, first-bar open), falling back to spot only before
  the first bar prints. Threaded through both the desk (`session.open`) and pulse (added `open` to
  `PulseStructureCache`, populated from the same session stats → `structure.open`). Consumers (lotto
  engine) now get a true opening gap. Test: `gap-proxy.test.ts` 4/4 — proves the gap stays frozen as
  spot moves and is NOT the live change; null-open falls back; null prior → null.

### P2/UX — same concept, two numbers on one screen (FIXED — ribbon flip label)
- Ribbon γ-flip (near-term aggregate, ~7598) vs the embedded chart's 0DTE flip line (~7504) read
  differently; both are internally correct (different scopes). **Fix:** the ribbon flip tooltip now
  states its scope explicitly ("NEAR-TERM aggregate … the chart's flip line is 0DTE-scoped, so the two
  can read differently"). EMA/SMA are already period-labeled (20/50/200 vs 9/21/50), self-disambiguating.
  The matrix king already carries the multi-expiry disclaimer. Text-only, no layout risk.

### P3 — stale matrix-poll comment (FIXED)
- `SpxGexMatrixHeatmap.tsx` DeskProps comment claimed "8s RTH / 20s off"; actual is 5s in both
  (`SPX_MATRIX_POLL_RTH_MS === SPX_MATRIX_POLL_OFF_MS === 5000`). Comment corrected.

### Deferred with rationale (NOT forgotten)
- **P3 flip-jitter smoothing:** the flip jitters ±~15pt near a concentrated wall on a quiet tape. A
  server-side deadband is unreliable here — the desk value is cached 5s and served by any of 8+
  replicas, so there is no dependable "previous displayed flip" to hold against. Correct fix is
  CLIENT-side (the continuous SSE/SWR view owns a stable prior value) — a larger, separate change.
- **TICK/TRIN/ADD "wire real internals":** `market-internals.ts` computes these as PROXIES from
  adv/dec ("TICK-like reading", "TRIN proxy"); there is no real TICK/TRIN/ADD feed wired. They are
  already honestly flagged `internals_estimated` AND not rendered. So this is not a bug to fix —
  surfacing them requires integrating a real intraday internals feed (data-integration project),
  which should precede any UI. Left estimated-and-gated, as designed.

## 2026-07-22 — SPX Slayer bead rail: "too light" + thin semantics (P2, FIXED — full SPX audit)

### P2 — Wall/bead rail rendered too faint and encoded only ONE dimension three times
- **Symptom (member-reported):** beads "too light on rendering"; the rail "just paints" instead
  of representing wall dynamics.
- **Root cause:** in `src/features/vector/lib/vector-wall-visual.ts`, core opacity, bead size, and
  glow ALL keyed off the same frame-relative strength `t = (pct/maxPct)^REL_CONTRAST_EXP`, with
  `REL_CONTRAST_EXP = 2.0` (squared) and floor `ALPHA_MIN = 0.05`. A half-king wall therefore sat
  at t=0.25 → ~0.29 alpha (near-dead), and early-session modeled beads were ghosted to
  `MODELED_ALPHA_SCALE = 0.15` — the "too light" report. Absolute magnitude, growth/decay velocity,
  and death were not encoded at all (birth was; death was only a whole-trail dim).
- **Evidence:** live authenticated probe (SPX desk `/api/market/spx/pin` + `gex_walls`) confirmed
  per-strike shares in the 5–7% band so the frame-relative king is ~7% and secondaries fall to
  25–30% of it → the exact regime the squared curve crushes. Opacity math corroborated in
  `vector-wall-visual.test.ts`.
- **Fix (`vector-wall-visual.ts` + `VectorChart.tsx`):**
  - Brightness: new `REL_ALPHA_MIN = 0.14` floor for the bead rail (separate from the legacy
    absolute `ALPHA_MIN`, so absolute-path tests are untouched); `REL_CONTRAST_EXP 2.0 → 1.6`;
    `MODELED_ALPHA_SCALE 0.15 → 0.26`. Half-king wall now ~0.42 alpha.
  - New **absolute-magnitude glow channel** (`magnitudeGlowBoost`): a genuinely massive wall halos
    up to ~1.7× wider regardless of frame rank — magnitude gets its own voice, distinct from the
    (frame-relative) size/opacity, so the frame-contrast regression tests still hold.
  - New **growth/decay velocity channel** (`growthModulation`): a bead compares its share to the
    previous bucket — a wall being STACKED flares brighter+fatter, one bleeding out dims+narrows
    (capped so a single burst can't blow out). The rail now visibly breathes.
  - New **death dissipation halo**: the last bucket of a departed (inactive) wall gets a wide, dim
    ring so it reads as "dissolved here," completing the birth→build→fade→death lifecycle.
- **Tests:** `vector-wall-visual.test.ts` extended (brightness retune, growthModulation building/
  fading/neutral/cap, magnitudeGlowBoost monotonicity) — 23 pass; `tsc --noEmit` clean.
- **Status:** FIXED (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — GEX matrix "built/melted" verb inverted on the put side (P2, FIXED)

### P2 — Shift leaders labeled build/decay by raw delta sign → building put walls read "melted"
- **Symptom:** in the Dealer Gamma Map shift strip + cell badges, a put wall that is actively
  BUILDING (its net dealer GEX going more negative) was labeled "melted" (and a decaying put wall
  "built"), and put-side % showed the wrong sign. Root of the user's "top-3 calls/puts don't look
  right" question.
- **Root cause:** `GexMatrixShiftBadge.tsx` / `GexShiftLeadersStrip.tsx` derived the verb from
  `delta > 0` and bucketed side by the leader's delta sign. For a put strike (negative net GEX),
  building means delta < 0, so `built = delta > 0` inverted it; and a melting put wall (delta > 0)
  was bucketed as a "call". The % came from `shiftPercentForStrike` (delta/|baseline|), whose sign
  follows the raw delta — correct on the call side, inverted on the put side. The arithmetic was
  fine; the SEMANTICS were wrong.
- **Evidence:** live desk screenshot showed puts as "-62% / -21% / -27%" (all melting) during a
  session where those put walls were building; audit of `shift-math.ts:4-8` (documents the
  delta-sign convention) + `GexMatrixShiftBadge.tsx:33` (`built = leader.delta > 0`).
- **Fix:** new `wallStrengthShift(currentValue, delta)` in `shift-math.ts` — compares |current| vs
  |baseline| so `built` = the wall's magnitude grew, side-agnostic, with the % signed by growth
  (+ heavier / − lighter), always consistent with the verb. Wired into both display components;
  side is now the strike's OWN net-GEX sign (`currentValue >= 0` → call/yellow) not the delta
  direction, so a melting put wall stays purple under P. `shiftPercentForStrike` left intact for
  any other consumer. Deeper follow-up (noted): move the side bucketing into `pickGexShiftLeaders`
  so Thermal/Vector surfaces inherit the same correction at the source.
- **Tests:** `shift-math.test.ts` extended (call/put build+melt, verb⇔sign consistency, guards) —
  12 pass; `tsc --noEmit` clean.
- **Status:** FIXED (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — SPX 0DTE gamma flip fragmented across panels (P1, FIXED — data unification)

### P1 — Four independent gamma-flip engines; pin used a volume-poisoned SIGNED ladder
- **Symptom (member-reported, screenshot):** the gamma flip showed FOUR different values on one
  page — header Γ FLIP 7,600.71, Vector chart 7,524.02, EOD Pin Forecaster 7,513, Dealer Gamma Map
  "FLIP (0DTE)" ~7,531.5 — and two panels gave contradictory regime reads (chart "sitting ON the
  flip, undecided" vs pin "above the flip, long gamma").
- **Root cause:** every panel recomputes the flip independently with a different expiry scope /
  positioning basis / spot snapshot. Two are genuine bugs:
  1. **Pin forecaster (7,513):** `pinLadderAtSpot` (`spx-pin-forecast-core.ts:105`) built the SIGNED
     net-GEX ladder from `openInterest + max(0, dayVolume)`. Volume is UNSIGNED, so folding it into a
     signed cumulative zero-crossing poisons the sign — the exact regression the Vector 0DTE path
     documents (`vector-dte-walls-core.ts`: volume "dragged the flip from ~7,522 to ~7,000"). The pin
     re-committed it, dragging its flip ~11 pts off the chart's OI-only flip.
  2. **GEX matrix (7,531.5):** `SpxGexMatrixHeatmap.tsx:305` interpolated the 0DTE crossing at
     `matrixSpot` (the matrix payload's own, several-seconds-stale snapshot spot) instead of the live
     stream spot — a ~7 pt skew vs the chart.
  The header's 7,600 is a DIFFERENT measure (near-term 8–15 expiry aggregate) and is correctly
  labeled — not a bug.
- **Evidence:** cross-surface trace (SpxSniperHeader/spx-desk near-term aggregate vs
  getVectorGammaFlipForHorizon 0DTE OI-only vs pinFlip OI+vol vs matrix 0DTE column at stale spot);
  live authenticated probe confirmed pin.flip=7510.95 while chart flip ~7524 same instant.
- **Fix:**
  1. `pinLadderAtSpot` → **OI-only** (drop dayVolume from the SIGNED ladder). Walls (`oiWalls`) +
     max-pain keep volume — those are unsigned concentration measures where intraday build is signal.
  2. Matrix 0DTE levels → **`overlaySpot` (live)** instead of `matrixSpot` (stale snapshot).
  Result: chart, pin, and matrix converge on one SPX 0DTE gamma flip; header stays the labeled
  aggregate. First step of the broader "unify every SPX value" mandate.
- **Tests:** `spx-pin-forecast-core.test.ts` — new OI-only invariance test (lopsided put volume must
  not move the flip); 8 pass. `tsc --noEmit` clean.
- **Status:** FIXED (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — Full GEX/VEX matrix table (feature — SPX desk)

### Dealer Gamma Map was truncated to 6 expiry columns; user wants the full table
- **Request:** show the complete GEX/VEX matrix (every expiry as a column), not the shortened rail.
- **Root of the truncation:** `SpxGexMatrixHeatmap.tsx` sliced columns to `MAX_EXPIRY_COLS = 6`
  (`displayExpiries = expiriesAll.slice(0, 6)`). The payload already ships the FULL expiry axis
  (near-term ≤15 + far-dated monthlies ≤8 ≈ 23 columns) in `cells` — the cut was purely client
  display, so no provider/fetch change is needed. Strikes were never client-truncated.
- **Fix (`SpxGexMatrixHeatmap.tsx`):**
  - Default to the FULL table (all expiries); a compact **Near/Full toggle** collapses back to the
    6-column rail (only shown when there are >6 expiries).
  - **Two-tier color peak** — far-dated monthly OpEx cells are orders of magnitude larger than
    near-term ones, so a single shared peak would wash the near-term block flat. Near-term and
    far-dated columns now each scale to their OWN peak (`nearPeak`/`farPeak`, split by
    `near_term_expiries`), so both blocks show gradient. The Net column (a near-term aggregate)
    keeps the near-term peak.
  - Added `near_term_expiries` to the client `GexHeatmapResponse` type (already served by the route
    via `...heatmap`; only the client type omitted it).
- **Known display caveat (documented, not a bug):** the "Net" column is the near-term aggregate
  per strike, so once far columns are visible it is not the sum of the on-screen cells — a labeled
  follow-up if members find it confusing.
- **Verification:** `tsc --noEmit` clean; brand lint clean.
- **Status:** DONE (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — Header label collisions + VWAP tone/value split (P2, FIXED — consistency)

### P2 — "Regime" meant two things; max-pain horizon undisclosed; VWAP tone could contradict value
- **Symptom:** the desk "said different things" for the same label. (1) Header "Regime" pill = TREND
  (price vs EMAs) while the chart banner + EOD pin show GAMMA regime (spot vs flip) — one word, two
  concepts. (2) Header Max Pain = near-term aggregate while pin/chart use 0DTE — undisclosed (γ-flip
  had a disclosure, max-pain didn't). (3) VWAP pill TONE was driven by the raw pulse `above_vwap`
  flag while the VALUE/arrow use the sticky merged `desk.vwap` — when `pulse.vwap` momentarily nulls,
  a bear tone could paint over a VWAP drawn below spot.
- **Fix (`SpxSniperHeader.tsx`):**
  - Relabel the trend pill "Regime" → **"Trend"**, and expand its tooltip to explicitly contrast it
    with the gamma regime on the chart/pin — same word no longer implies the same measure.
  - Add the near-term-vs-0DTE horizon disclosure to the **Max Pain** tooltip (mirrors γ-flip).
  - Derive the VWAP **tone from the displayed value** (`spot >= desk.vwap`), falling back to
    `above_vwap` only when vwap is null — tone, arrow, and value can no longer disagree.
- **Rationale:** these are intentionally DIFFERENT concepts (daily trend vs gamma regime; near-term
  vs 0DTE), so the correct unification is precise labels, NOT forcing different measures equal (that
  would itself be wrong data). Verified `tsc --noEmit` clean.
- **Status:** FIXED (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — EOD pin cone painted ZERO uncertainty at the bell (P2, FIXED — accuracy)

### P2 — Analytic confidence cone collapsed to a point (p10=p50=p90) at 16:00
- **Symptom:** the EOD pin forecaster's confidence cone pinched to a single point at the close,
  asserting perfect certainty the model hasn't earned (settlement/auction still moves the close).
- **Root cause:** in `medianPath` (`spx-pin-forecast-core.ts`), the diffusion sigma
  `spot·atmIv·√(tYearsRemain)` → 0 as time-to-close → 0, so the last cone step had
  `p10 = p50 = p90 = pin`. Verified LIVE twice via authenticated probe: `cone[last]` =
  `{tMin:0, p10:7517.74, p50:7517.74, p90:7517.74}` (and again 7518.13).
- **Fix:** floor the cone sigma at `CONE_RESIDUAL_FRAC = 0.12 ×` the session's OPENING sigma, so the
  cone stays honestly narrow into the bell instead of collapsing to a line. Kept under the ~15%
  confidence floor (so confidence still reads a hair tighter than the drawn cone) and well under the
  35% "cone pinches into the close" contract the tests assert.
- **Tests:** `spx-pin-forecast-core.test.ts` — the pinch test now also asserts the bell cone keeps
  non-zero width and stays ordered p10<p50<p90; 8 pass. `tsc --noEmit` clean.
- **Follow-ups (noted):** the MC diffusion ×tFracAt over-suppresses late-session noise; the
  trend-day degrade never fires live (recentReturns not passed) — both tracked for a later PR.
- **Status:** FIXED (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — Commentary rail never announced a pin/max-pain migration (P2, FIXED — signal gap)

### P2 — 0DTE pin (max-pain magnet) drift was silent in the live commentary
- **Symptom (from the left-pane audit):** `detectSpxVoiceEvents` fired on γ-flip crosses, king-wall
  migrations, wall build/fade, VWAP, EMA, HOD/LOD etc., but had NO event for the max-pain (pin)
  magnet stepping — even though for a 0DTE desk a pin drifting into the close is exactly what a
  trader watches. Max pain surfaced only as a static "watch level," never announced when it moved.
- **Fix (`spx-live-voice.ts`):** new `pin-migrate` event kind. When `maxPain` steps ≥ one SPX strike
  (`MAXPAIN_STEP_MIN = 5`) between snapshots, the rail emits `◎ pin 7,500→7,510 — max-pain magnet
  stepped UP → close-drift target higher` (bull on up-step, bear on down-step). Sub-strike jitter is
  suppressed; the existing per-key cooldown dedupes repeats.
- **Tests:** `spx-live-voice.test.ts` — up-step (bull), down-step (bear), sub-strike jitter ignored;
  53 pass. `tsc --noEmit` clean.
- **Related gap noted (not fixed here):** the `rsi` event kind is dead on the live rail (the desk
  feed carries no `rsi`, so overbought/oversold never fires) — a follow-up (wire RSI or remove).
- **Status:** FIXED (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — EOD pin projected close + band drawn ON the price chart (feature)

### Move the EOD pin onto the chart (user chose "on-chart cone + slim panel")
- **What:** the SPX Vector chart now draws the EOD pin's **projected 0DTE close** as a solid gold
  price-line + the **pin band** edges as dashed gold lines, in price space next to the candles —
  the 0DTE close-target a trader watches, no longer only in the side panel.
- **Implementation (`VectorChart.tsx`):** `applyPinProjection` mirrors the proven
  `applyExpectedMoveBand` (idempotent signature ref; `createPriceLine`; cleared when disabled). A
  new effect **gated to `ticker === "SPX"`** self-fetches `/api/market/spx/pin` at the 5s desk
  cadence (one fetch off-hours) and repaints via `paintOverlays`; `/vector` and other tickers never
  fetch or draw it. Refs cleared on the same ticker-change teardown as the expected-move band.
- **Scope:** the *levels* (close + band) ship now via the battle-tested price-line infra; the shaded
  time→close **cone** is a follow-up (needs a canvas primitive). Panel-slimming (drop the redundant
  levels, keep why/scenarios) is a follow-up too — the on-chart lines are additive for now.
- **Validation caveat:** this is a client-canvas change; it CANNOT be pixel-verified from the
  sandbox (headless browser egress is blocked — proven: ERR_CONNECTION_RESET to example.com; and the
  CI screenshot path needs a repo CLERK secret that isn't set). Logic is typecheck-clean and reuses
  proven infra (worst case is a cosmetic misplacement, never a broken chart). Needs a glance on the
  deployed build.
- **Verification:** `tsc --noEmit` clean; brand lint clean.
- **Status:** DONE (levels); cone + panel-slim = follow-ups. Branch `claude/wall-beads-data-validation-4re5wo`.

## 2026-07-22 — Pinned bias prose named stale walls after a king migration (P3, FIXED)

### P3 — Bias card kept citing an old king wall for up to 5 min after it stepped
- **Symptom (left-pane audit item A):** the pinned bias narrative bakes specific wall/pin numbers
  into prose ("7,530 put wall is the line…"), but `deriveSpxBias.key` excluded the king-wall strikes
  and max-pain, so the card only re-voiced on a direction change or the 5-min periodic refresh. After
  a king migration the "Recent shifts"/tape feed showed the move while the pinned paragraph kept
  naming the OLD wall — internally contradictory on the same card.
- **Fix (`spx-live-voice.ts`):** add the king call/put strikes + max-pain to the bias key, so the
  pinned card re-voices the moment a NAMED level migrates (still not on plain price ticks — those
  aren't in the key). It's a re-voice trigger, not a bias flip (direction/conviction unaffected).
- **Tests:** `spx-live-voice.test.ts` — key changes on king-call + max-pain migration, direction
  unchanged, price-tick invariance still holds; 54 pass. `tsc` clean.
- **Status:** FIXED (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — SPX desk: 4-panel layout (EOD pin own rail) + drop chart max-pain line (member-directed)

### Layout — EOD pin split into its own 4th panel so the matrix gets full height
- **Request:** "4 panels with EOD pin forecaster as the new panel so we can get full view of the
  matrix table"; and "remove the Max Pain from the chart, not needed".
- **Change:**
  - `SpxDashboard.tsx`: the `SpxPinForecast` was stacked UNDER the matrix in the same column,
    squeezing the (now full) Dealer Gamma Map. Split it into its OWN `aside.spx-left-pin` rail.
    Desk is now **Largo | Matrix | EOD Pin | Vector** (4 rails); the matrix gets the full column
    height. On the compact/iOS shell the pin rides the "matrix" segment (kept together there).
  - `globals.css`: `desk-v3` grid → 4 columns `"largo matrix pin vector"` (chart still the widest,
    minmax(0,…) so the canvas shrinks — no h-overflow); focus mode → 4 tracks (3 rails collapse,
    chart fills); new `.spx-left-pin { grid-area: pin }` + desk-fill height rules.
  - `VectorChart.tsx`: removed the amber "⊗ Max Pain" price line (`applyMaxPainLine(..., null)`);
    the value is kept in `maxPainValueRef` so it still feeds the confluence zone stack.
- **Verification:** `tsc --noEmit` clean. Client-canvas/layout change — needs a look on the deployed
  build (will capture via spx-live-check). Stylelint pre-existing error at :7945 is unrelated.
- **Status:** DONE (branch `claude/wall-beads-data-validation-4re5wo`).

## 2026-07-22 — On-chart pin → Monte-Carlo source + relax over-tight MC diffusion (member-directed)

### The on-chart pin now uses the Monte-Carlo projection; MC late-session cone widened to be honest
- **Request:** "do the monte carlo EOD pin so it looks like a curve on chart instead of the analytic
  one"; and the conceptual Q: do analytic & MC give the same pin? (Usually yes — both pull to the
  dominant magnet — but MC diverges when the close distribution is bimodal, which is the point of MC.)
- **Changes:**
  - `VectorChart.tsx`: the on-chart pin line + band now read `montecarlo.pin` / `montecarlo.pinBand`
    (empirical modal close + band), falling back to the analytic base when the MC overlay is absent.
  - `spx-pin-forecast-core.ts`: relaxed the MC Brownian-bridge diffusion — was `× tFracAt`, which
    drove step variance to ~0 at the bell (on top of √dt) and manufactured an over-tight MC cone /
    over-confident pin. Now `× (MC_BRIDGE_NOISE_FLOOR=0.35 + 0.65·tFracAt)`, so late-session
    settlement noise stays real (the MC analogue of the analytic cone-floor fix). Verified: the MC
    cone still narrows from its mid-session bulge (51.6→45.2, 0.88×) instead of collapsing to a thread.
- **Tests:** MC test updated to assert the cone narrows from the peak AND keeps honest residual width
  (>0.5× max); 8 pass. `tsc` clean.
- **Follow-up (next PR):** the SHADED time→16:00 converging cone as a canvas primitive (needs future
  whitespace so it maps past the last candle) — this PR does the levels + honest width.
- **Status:** DONE (levels + width). Branch `claude/wall-beads-data-validation-4re5wo`.
