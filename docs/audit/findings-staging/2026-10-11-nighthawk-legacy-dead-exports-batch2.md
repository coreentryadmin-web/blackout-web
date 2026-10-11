> **kind:** FINDING

## Night Hawk Legacy — 3 more dead exports (legacyUsesOptionPnl, formatIndexDossierBlock, priorEt) — FIXED

**Symptom:** Three more zero-caller exports found sweeping the Night Hawk Legacy cluster:
- `legacyUsesOptionPnl` (`legacy-primary-pnl.ts`) — only referenced by its own direct unit
  test (`assert.equal(legacyUsesOptionPnl(play({ pnlPct: 10 })), true)`), never by
  production code or by another test exercising a different function.
- `formatIndexDossierBlock` (`index-dossier.ts`) — zero callers anywhere, not even a test
  file. Its sibling `fetchIndexDossiers` (same file) IS the real, live export —
  `edition-builder.ts` imports and calls it; `formatIndexDossierBlock` never got wired
  into whatever consumes that output.
- `priorEt` (`session.ts`) — a thin same-signature wrapper around `priorEtYmd()`
  (`spx-session.ts`). Zero callers anywhere, including `session.test.ts` (which exists
  and tests every other export in this file).

**Root cause:** All three are unadopted exports with a live sibling doing the real job —
same shape as this cycle's other dead-code findings, not a correctness regression.

**Evidence:** `grep -rn "<name>"` per function, repo-wide, before the fix: each matched
only its own definition (plus, for `legacyUsesOptionPnl`, its own self-testing assertion).
Checked internal call sites within each file too (the lesson from this cycle's
`timeframe.ts` near-miss) — none of the three is called by a sibling function in its own
file either.

**Note on a related candidate NOT removed:** `isNightHawkView` (`nighthawk-view.ts`) was
also checked and looked like the same pattern (zero production callers), but
`nighthawk-view.test.ts:185` uses it as the assertion in "the token set and the parser
cannot drift apart" — a genuine cross-check (every `KNOWN_NIGHTHAWK_VIEW_TOKENS` entry
must parse to a real view), not mere self-testing. Removing it would mean re-implementing
the same union-membership check inline in that test rather than reusing the one exported
guard. Left alone.

**Fix:** Removed all three plus their now-orphaned imports — `legacy-primary-pnl.test.ts`'s
import line and one assertion inside an existing test (not a whole test block, since that
test also covers `legacyPrimaryPnlPct`); `session.ts`'s now-fully-unused
`priorEtYmd`/`todayEtYmd` import (note: `todayEtYmd` was *already* dead before this fix —
`todayEt()` in the same file calls `formatEtDate(now)`, not `todayEtYmd()` — removing the
import line catches both at once).

**Fix rationale:** Pure deletion in all three cases; each had either a live sibling doing
the real job (`fetchIndexDossiers`, `priorEtYmd` directly at call sites elsewhere) or no
real job being done at all (`legacyUsesOptionPnl`'s boolean check is inlined wherever
needed, nowhere).

**Blast radius:** `legacy-primary-pnl.ts` (+test), `index-dossier.ts`, `session.ts` only.

**Regression guard:** None needed — no removed function had production behavior to guard;
the self-testing assertions removed had no value beyond re-confirming the deleted
function's own one-line body.
