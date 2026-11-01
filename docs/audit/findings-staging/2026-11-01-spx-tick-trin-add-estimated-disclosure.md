> **kind:** FINDING

## SPX Slayer: TICK/TRIN/ADD score factors cited a breadth-derived proxy as a real exchange print, with zero disclosure — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** live production repro, 2026-11-01 (`GET /api/market/spx/desk` + `GET /api/market/spx/play`,
temp Clerk session via `scripts/audit/lib/audit-auth-fetch.mjs`, released after). Confirmed against
`main` directly, not against memory.

**Root cause:** `computeSpxConfluence()` (`src/features/spx/lib/spx-signals.ts`, TICK block
~L650-658, TRIN ~L662-672, ADD ~L676-686) scored `desk.tick`/`desk.trin`/`desk.add` directly into
`SpxSignalFactor.detail` text ("NYSE TICK +176", "TRIN 0.50 — broad buying", "Advance/decline
+800") with **zero reference anywhere in the function to `desk.internals_estimated`** — the exact
flag `SpxDeskPayload` (`spx-desk.ts:1033`) carries for this purpose. `resolveMarketInternals()`
(`src/lib/market-internals.ts`) sets `internals_estimated.{tick,trin,add}` to `true` precisely
when the real Polygon `I:TICK`/`I:TRIN`/`I:ADD` print was unavailable and a breadth-derived proxy
(`estimateTickFromBreadth`/`estimateTrinFromBreadth`/`estimateAddFromBreadth`, built from
advance/decline counts — **not** the real index) was substituted in its place. That file's own
doc comment states the purpose explicitly: *"The desk payload carries this so the UI can badge
estimated readings instead of presenting a computed proxy in the same field as a real internal
(truth mandate)."*

The only place in the codebase that honored the flag was `spx-internals-display.ts`
(`formatInternalReading`/`internalEstimatedTip`, appends `" est."` + a tooltip) — consumed only by
the raw dashboard internals widget. The scoring/play engine (`GET /api/market/spx/play`, the
surface Ask Largo and the trade-alert panel actually read) never called it, so the same
truth-mandate violation the GEX/VWAP/flow staleness disclosures were built to prevent (three
same-day fixes in `spx-play-engine.ts`: `discloseStaleGexFactors`, `discloseStaleVwapFactor`,
`discloseStaleFlowFactors`) still existed for this fourth data family — and unlike those three
(which only apply in the closed-market branch), this one had **no disclosure wrapper in either
branch**: the live/open-market path (`confluence = computeSpxConfluence(desk)`,
`spx-play-engine.ts:1869-1873`) passed factors straight through untouched.

A 2026-07-21 `FINDINGS.md` entry dismissed this as "not a bug" on the premise that TICK/TRIN/ADD
were "already honestly flagged `internals_estimated` AND not rendered." That premise was already
false at the time it was written — `git log --follow` shows the TICK/TRIN/ADD score-factor
`detail` strings existed since the file's creation commit `62b8ff40d` (2026-06-17), a month
earlier — they ARE rendered, as live-weighted score factors, with the flag silently dropped.

**Live evidence (2026-11-01):** `GET /api/market/spx/desk` returned
`"internals_estimated": {"tick": true, "trin": true, "add": true}` alongside `tick:176, trin:0.5,
add:800`. The paired `GET /api/market/spx/play` scored all three with **zero** staleness/
estimation caveat — `{"label":"TRIN","detail":"TRIN 0.50 — broad buying"}`,
`{"label":"ADD","detail":"Advance/decline +800"}`, `{"label":"TICK","detail":"NYSE TICK +176"}` —
while the SAME response's `"0DTE flow"` factor two lines away correctly disclosed `"— Flow stale,
not live"` for its own (merely old, not synthetic) data. TICK+TRIN+ADD together contributed +15 of
the published score (52% of +29 in one capture, 42% of +36 in an independent re-poll) and were the
only three factors in the response carrying no disclosure at all.

**Fix:** added the disclosure at the single shared root — `computeSpxConfluence()` now appends
`" — estimated, not live"` to each factor's `detail` string when the matching
`desk.internals_estimated.{tick,trin,add}` flag is true, gated per-factor so a real (non-estimated)
reading stays undecorated. Fixing it here (rather than wrapping the closed-market branch like the
GEX/VWAP/flow precedent) reaches every consumer — the open-market branch, the closed-market
branch, and Largo's `get_spx_confluence` tool (`run-tool.ts`, which calls `computeSpxConfluence`
directly) — without a second disclosure mechanism to keep in sync. Deliberately used `"estimated"`
rather than reusing the `"stale"` wording the three sibling fixes use: this isn't lagged data, it's
a different VALUE (a computed proxy) standing in for the real one, so the two should not read the
same to a member.

**Blast radius — two other call sites found with the identical root cause, both fixed in this PR:**
1. `src/features/spx/lib/spx-play-confirmations.ts`'s `"Internals"` confirmation check — reads
   `desk.tick` directly into `detail: "TICK +176"` with the same zero-disclosure gap. This check
   IS member-rendered (`SpxDeskTerminal.tsx`/`SpxTradeAlerts.tsx` read
   `confirmations.checks[].detail` directly), so the same truth-mandate gap applied there too.
2. `src/lib/bie/spx-desk-brief.ts`'s `internalsLine()` — the member-facing "Live Desk AI brief"
   (the deterministic AI-commentary surface behind `/api/market/spx/commentary`) cites `desk.tick`/
   `desk.trin` in its `INTERNALS` line the same undisclosed way. Fixed with the shorter `" est."`
   suffix (matching `spx-internals-display.ts`'s existing convention) rather than the longer
   `spx-signals.ts` phrasing, since this is a compact one-line brief format.

**Explicitly NOT fixed in this PR (follow-up, different fix shape):** `src/lib/largo/
largo-live-feed.ts`'s SPX-structure "Internals:" summary line (fed by `get_spx_structure` /
`summarizeSpxDesk()`) has the same undisclosed-TICK/TRIN/ADD symptom, but a different, deeper root
cause: `SpxDeskSummary` (`src/lib/platform/types.ts`) — the type `summarizeSpxDesk()` builds and
every consumer of `getSpxDeskSummary()` reads (Night Hawk's edition builder, the platform
snapshot, Meridian earnings intel, `get_spx_structure`) — never carries `internals_estimated` at
all. Fixing that requires widening a shared summary type with several independent consumers, not
copying the one-line disclosure fix applied above; left as a separate, scoped follow-up rather than
bundled into this fix.

**Evidence (RED → GREEN):**
- Added 2 regression tests to `src/features/spx/lib/spx-signals.test.ts` reproducing the exact
  live bug shape (`tick:176, trin:0.5, add:800, internals_estimated:{tick:true,trin:true,add:true}`)
  plus a negative-control test (absent/false flag stays undecorated).
- Added 2 regression tests to `src/features/spx/lib/spx-play-confirmations.test.ts` for the
  "Internals" check.
- Added 2 regression tests to `src/lib/bie/spx-desk-brief.test.ts` for the `INTERNALS` brief line.
- **RED** (verified via `git show origin/main:<file> > <file>` on `spx-signals.ts` alone, pre-fix):
  `npx tsx --experimental-test-module-mocks --test spx-signals.test.ts` → 15 pass, 1 fail — the new
  "TICK/TRIN/ADD factors disclose..." test failed with `actual: 'NYSE TICK +176'` not matching
  `/estimated, not live/`, exactly reproducing the live defect.
  **GREEN** (post-fix, same command): 16/16 pass.
- Full blast-radius run (`spx-signals.test.ts` + `spx-play-confirmations.test.ts` +
  `spx-desk-brief.test.ts`): 34/34 pass.
- Wider call-site sweep (every test file importing `computeSpxConfluence`: `spx-play-engine.test.ts`,
  `spx-desk-merge.test.ts`, `spx-play-conflicts.test.ts`, `spx-play-payload.test.ts`, the
  `spx-signal-log*`/`bie.test.ts`/`confluence-outcomes.test.ts`/`spx-confidence-boundary.test.ts`
  suites): 268/268 pass, no golden-fixture regressions (the existing `spx-signals.test.ts` golden
  fixture never sets `internals_estimated`, so its byte-for-byte assertion is unaffected by this
  change by construction).
- `npx tsc --noEmit`: clean (exit 0).

All tests run on Node 20 (`/opt/node20/bin`) per this repo's standing sandbox note, with
`node_modules` symlinked from the primary checkout (identical `package-lock.json`).
