> **kind:** FINDING

## SPX Slayer: GEX/VWAP/flow staleness disclosure wired only into the closed-market branch — the live BUY/WATCH/SCANNING path (RTH) could show stale data with zero disclosure — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** live production correctness audit, 2026-11-01. Confirmed against `main` directly
(`src/features/spx/lib/spx-play-engine.ts`), not against memory.

**Root cause:** `spx-play-engine.ts` defines three disclosure helpers —
`discloseStaleGexFactors` (~L1642), `discloseStaleVwapFactor` (~L1674), `discloseStaleFlowFactors`
(~L1708) — each of which appends a `"— <X> stale, not live"` clause to a factor's own `detail`
text when `desk.gex_stale` / `desk.vwap_stale` / `isFlowDataStale(desk.flow_data_age_ms,
desk.flow_cluster_live)` is true. Until this fix, all three were called from exactly **one** place:
the `!desk.market_open && !premarket` closed-market early-return branch inside
`evaluateSpxPlayCore`. They were never called on the path that feeds `evaluateOpenPlay` /
`evaluateFlatPlay` — the real member-facing BUY/WATCH/SCANNING payload served during RTH.

This is not merely a closed-market edge case. The underlying staleness conditions are reachable
live:
- `desk.gex_stale` flips `true` once the GEX snapshot age exceeds `GEX_STALE_MS` (30s default,
  `spx-desk-numerics.ts`'s `gexStaleFromAge`) — computed unconditionally, with no `market_open`
  gating, every time the canonical/fallback GEX snapshot paths build the desk payload
  (`spx-desk.ts`, both call sites).
- The only other live-path consumer of GEX staleness, `evaluatePlayGates`'s `"Desk data stale
  (Xs)"` block (`spx-play-gates.ts`), does not fire until `deskStaleSec > playGexStaleMaxSec()`
  (90s default, `spx-play-config.ts`) — leaving a real, reachable **30–90s window** where
  `desk.gex_stale` is already `true` but the gate stack has not yet blocked anything, during which
  a GEX-derived factor ("GEX support"/"GEX resistance"/"King node · GEX anchor") could be shown
  with a specific strike/level and zero staleness disclosure anywhere in the response.
- `desk.vwap_stale` (`spx-desk-merge.ts:355` — `pulse.vwap == null && base.vwap == null &&
  vwap != null`, the cross-request sticky-fallback signal) carries **no `market_open` gating at
  all**, so it can be set during RTH the same way it is off-hours.
- Flow staleness (`isFlowDataStale`, `spx-play-gates.ts`) only hard-blocks a **BUY**-intent entry
  past 300s, and only emits a generic, non-factor-tied warning past 120s — it never touches the
  "0DTE flow"/"HELIX sweeps"/"Live tape"/"Net prem" factor `detail` text itself, and WATCH/SCANNING
  reads never even evaluate the BUY-intent gate, so a stale-flow factor could render fully
  undisclosed on those states regardless of age.

Confirmed by source inspection: `grep -rn
'discloseStaleGexFactors|discloseStaleVwapFactor|discloseStaleFlowFactors'` finds the only
non-definition call sites all inside the `if (!desk.market_open && !premarket) { ... }` block, and
`spx-play-engine.test.ts`'s existing coverage for these three functions was built entirely on
`market_open:false` fixtures — no open-market equivalent test existed before this fix (confirmed
by `src/features/spx/lib/spx-play-engine.test.ts`'s test list pre-fix).

**Fix:** mutate `confluence.factors` once, immediately after `computeSpxConfluence(desk)` resolves
inside `evaluateSpxPlayCore` (before the live path fans out into `evaluateOpenPlay`'s and
`evaluateFlatPlay`'s many `factors: confluence.factors` call sites), applying the exact same three
disclosure helpers under the exact same gating the closed-market branch already uses: only
disclose a data family that actually produced a factor, so a live read with no GEX/VWAP/flow
factor present never grows a confusing clause about data it never showed. This reaches every
downstream consumer of `confluence.factors` (both `evaluateOpenPlay` and `evaluateFlatPlay`, every
branch of each) through the one shared mutation point, the same "extract once, consult from both
paths" idiom this file already uses for `mixedTapeGateMessage`/`isFlowDataStale`, rather than
duplicating the three staleness checks at each call site. None of the three `discloseStale*`
helpers touch a factor's `.label`/`.weight` — only `.detail` — so `computeWeightedConflicts`
(`spx-play-conflicts.ts`) and `reclassifyConfluenceScore` (`spx-signals.ts`), both of which read
only `.label`/`.weight` off these same factors downstream of this mutation, are unaffected: score,
grade, direction and conflict counts cannot change as a result of this fix.

**Fix rationale — why mutate once rather than wrap each consumer:** `evaluateOpenPlay` and
`evaluateFlatPlay` both build their response payload's `factors` field directly from
`confluence.factors` at many call sites (SCANNING/WATCHING/HOLD/BUY/SELL branches in each). Wrapping
each call site individually would require locating and keeping in sync every one of those sites
across both functions, in both current and future code — exactly the kind of drift the closed-market
branch's own comments warn against ("so the two can never drift apart"). Mutating the shared
`confluence` object once, at the single point both functions already receive it from, makes the
disclosure a property of "this confluence read", not a property of "this particular branch that
happened to remember to apply it."

**Blast radius:** both `evaluateOpenPlay` (management of an already-open position) and
`evaluateFlatPlay` (SCANNING/WATCHING/BUY) read `confluence.factors` for their member-facing
payload — both now carry the disclosure. The closed-market branch's own disclosure
(`discloseStaleGexFactors`/`discloseStaleVwapFactor`/`discloseStaleFlowFactors` applied to
`closedConfluence!.factors`) is untouched and unaffected, since it operates on a separately-computed
`closedConfluence` object, not the live-path `confluence` this fix touches. Largo's
`get_spx_confluence` tool and any other direct caller of `computeSpxConfluence()` are also
unaffected — this fix is in `spx-play-engine.ts`'s dispatcher, not in `computeSpxConfluence()`
itself, so it only changes what the play-evaluation payload serves, not the raw confluence engine
output.

**Evidence (RED → GREEN):**
- Added 4 regression tests to `src/features/spx/lib/spx-play-engine.test.ts`, the live-path
  siblings of the existing closed-market disclosure tests, covering `desk.gex_stale:true`,
  `desk.gex_stale:false`/absent (negative control), `desk.vwap_stale:true`, and stale flow
  (age past threshold, no live cluster heartbeat) — all with `market_open:true` and no premarket
  override, exercising the real `evaluateFlatPlay` dispatch.
  - These tests bypass the two DB-backed resolvers `evaluateFlatPlay` otherwise calls
    (`refreshOrBreakMemory`'s `loadOrBreakMemory`, whose `getMeta()` call has no `dbConfigured()`
    guard and would attempt a real Postgres connection under this test file's `DATABASE_URL=""`
    setup, and `resolveGuardedPlaybookMatch`) via the exact public bypass `evaluateSpxPlay` already
    exposes for this purpose (`EvaluateSpxPlayOptions.or_break_memory` /
    `.playbook_resolved` — "Shared OR memory from caller" / "Pre-resolved playbook match — skips
    redundant resolver when set"), not a test-only shim.
- **RED** (pre-fix, verified via `git stash` isolating just `spx-play-engine.ts`'s diff):
  `npx tsx --experimental-test-module-mocks --test spx-play-engine.test.ts` → 16 pass, 3 fail — the
  three new "stale" tests failed with the factor's `detail` showing the bare text (e.g. `actual:
  'At 0DTE support node 7675 (+5 pts)'`, `'Below VWAP 7580.87 — sellers pressing'`, `'Call premium
  leading 0DTE tape'`) not matching the staleness-clause regex — exactly reproducing the live
  defect. The negative-control test passed both before and after (correctly: nothing to disclose).
- **GREEN** (post-fix, same command): 19/19 pass.
- Blast-radius sweep (every test file touching `computeSpxConfluence`/`evaluateSpxPlay`'s
  downstream consumers alongside `spx-play-engine.test.ts`: the `spx-signal-log-*` suites,
  `spx-signals.test.ts`, `spx-play-gates.test.ts`, `spx-play-conflicts.test.ts`): 122/122 pass.
- `npx tsc --noEmit`: clean (exit 0).

All tests run on Node 20 (`/opt/node20/bin`) per this repo's standing sandbox note, with
`node_modules` symlinked from the primary checkout (identical `package-lock.json`).
