# FINDINGS — living issue log

(Rebuilt 2026-07-13: the prior log was clobbered to an empty file by a squash-merge
conflict-resolution mishap. Historical entries live in git history — `git log --all --
docs/audit/FINDINGS.md`. New entries append below; keep severity / root cause / file:line /
evidence / fix / status per the CLAUDE.md policy.)

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
