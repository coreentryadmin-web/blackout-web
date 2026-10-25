> **kind:** FINDING

## Legacy→Swing commit bridge fabricated `halted:false`/`dailyBarComplete:true` for every candidate, silently satisfying G-S12 and the daily-bar-completeness gate — FIXED

| **Status** | Fixed (PR, see branch `fix/swing-legacy-bridge-halt-dailybar-fabricated-false`) |
|---|---|

### Root cause

`legacyCommitCandidatesFromSnapshot` (`src/lib/swing/legacy-confirm-promote.ts`) — the "graduation
bridge" that lets a Legacy-promoted (Night Hawk) thesis become a real `SwingCommitCandidate` once
it reaches the same `TRIGGERED`/`AT_TRIGGER` bar an organic candidate needs — hardcoded three
fields on every candidate it built:

```ts
earningsInWindow: false,
halted: false,
dailyBarComplete: true,
```

`discovery.ts`'s commit loop (the one real caller) computes **real** per-ticker halt state
(`haltActive`, via `readSwingHaltStateForTickers`) and **real** whole-market grouped-daily bars
(`grouped`) for the exact same scan pass, and correctly wires both into every *organic* candidate
a few lines above (`halted: haltActive.has(...)`, `dailyBarComplete: tickerHasGroupedDailyBar(grouped,
...)`) — but never passed either into the Legacy bridge, which fabricated the always-pass value
instead.

Both `v2/gates.ts` gates read these fields literally:
- `evaluateEarningsGate`/G-S3 and the halt check (G-S12) treat `halted !== true` as "not halted" → pass.
- The daily-bar-completeness check treats `dailyBarComplete !== false` as "complete" → pass.

So a Legacy-sourced commit candidate could sail through G-S12 (and the daily-bar check) with zero
real evidence, even while the underlying was genuinely halted or missing a bar in the real feed
that session — exactly the kind of real-time, capital-preservation gate this bridge's own file
header explicitly reasons through NOT weakening (it already took care not to invent a fake G-S6
confluence kind for this exact reason). This was the same failure mode, just on two gates nobody
had traced through.

### Evidence

Confirmed via source trace, not a live incident: `discovery.ts:1028-1035` computes `haltActive`
(real halt feed) and `discovery.ts:758` computes `grouped` (real Polygon grouped-daily), both used
correctly for organic candidates at lines 1072-1075, in scope at the Legacy-bridge call site
(`discovery.ts:1090-1101`) — but never threaded through. New regression tests confirm the gap
RED→GREEN: a Legacy candidate built with a real `haltActive` set containing its own ticker read
`halted:true` only after the fix; a `grouped` feed missing the ticker's own row read
`dailyBarComplete:false` only after the fix; a full-lifecycle test through the real, unmodified
`computeSwingCommitPlan` with `v2: { enforceHalt: true }` confirmed the candidate is now correctly
blocked (`committableCount: 0`, `blockedBy` includes `gate:G-S12:halted`) where it previously
committed (`committableCount: 1`).

### Blast radius

Only `legacyCommitCandidatesFromSnapshot` and its one real caller (`discovery.ts`'s commit loop)
were touched. `earningsInWindow` is a **known, disclosed, separate gap** left unfixed here: a
Legacy-promoted dossier is built from synthetic structural reads (`swingReadsForLegacy`), never a
real catalyst/earnings fetch, so there is no real signal available yet to thread through — fixing
it needs a new fetch path (mirroring `fetchLegacyPromoteCloses`'s pattern), which is a second,
separate change, not bundled into this surgical fix (one issue per PR). Logged in the live journal
for a future cycle.

### Fix rationale

Added `haltActive`/`grouped` as optional parameters to `legacyCommitCandidatesFromSnapshot`'s
`opts`, computing real `halted`/`dailyBarComplete` values when supplied and degrading to the prior
safe defaults (`false`/`true`) when omitted — so no other caller (tests included) breaks. Updated
the one real caller to pass its already-computed, zero-new-IO `haltActive`/`grouped` through.
`hasGroupedDailyBar` is a small local duplicate of `discovery.ts`'s `tickerHasGroupedDailyBar`
(not imported — `discovery.ts` imports *from* this file, so importing back would cycle), matching
this codebase's established pattern for tiny pure helpers shared across a would-be-circular
boundary.

### Tests

Added to `src/lib/swing/legacy-confirm-promote.test.ts`: a real-halt-not-fabricated-away test, a
missing/present grouped-daily-bar test pair, a no-regression test for callers that omit the new
params, and a full-lifecycle test through the real `computeSwingCommitPlan` with
`v2: { enforceHalt: true }` proving G-S12 now genuinely blocks. RED→GREEN confirmed (3 new failures
pre-fix, all green post-fix). `discovery.test.ts`'s own Legacy-bridge tests (31/31) and the full
`legacy-confirm-promote.test.ts` suite (33/33) stay green; `npx tsc --noEmit` clean; full
`npm test` (Node 20): 16916 pass / 0 fail / 3 pre-existing skips.
