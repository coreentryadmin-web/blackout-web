> **kind:** `FINDING`

## Ask Largo swing brief flattened a specific sell reason to a generic "thesis broke" phrase — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo (`src/lib/swing/play-brief*.ts`) |
| **Severity** | P3 (narrative-quality gap — a real, already-computed detail was discarded in favor of generic prose, not a crash/incorrect-number bug) |
| **PR** | fix/swing-manage-reason-detail |

### Root cause

`evaluateSwingManagement`'s `SwingManageVerdict.reason` (`src/lib/swing/manage.ts:161`) is computed
on every management tick with fully specific prose. `structuralStopBroken()` (manage.ts:177-213)
builds an exact sentence, e.g. `` `underlying ${comparePx} ≤ structural stop ${stop} — LONG thesis
broken in underlying terms${adj}` `` — naming the actual observed price, the actual stop level, and
the direction. `manage-sync.ts:399` persists this verbatim onto every snapshot's
`event_json.reason`.

But `live-plays.ts`'s `manageObservablesFromEvent` (its own doc comment at lines 184-186 explicitly
calls it "the sole reader of that event_json") only ever extracted `rung`/`action`/`thesis_state` —
never `reason`. The DB field was write-only: computed, persisted, never read. `play-brief-narrative.
ts`'s `sellReasonClause` (lines 348-378), for the two most consequential SELL reasons —
`structural_stop`/`thesis_stop`, an actual thesis break rather than a time-based force-manage —
rendered only the hardcoded generic `" — thesis broke"`, and the `default` fallback carried the same
genericness even when a real rung existed.

This is a different shape of gap than the six prior fixes this session (which each surfaced a
distinct field that was computed/pinned but never read at all). Here the field WAS eventually read
into the brief's data model, but the specific text was thrown away in favor of a canned phrase — the
exact "narrative reads as a disconnected bullet dump instead of connected trade-manager prose"
category CLAUDE.md's Ask Largo mandate explicitly calls out as a valid gap, separate from missing
data.

### Evidence

Grep evidence (pre-fix, on `origin/main`, which already includes #5186):
- `manage.ts:161`: `reason: string;` on `SwingManageVerdict`.
- `manage.ts:207`: `` reason: `underlying ${comparePx} ≤ structural stop ${stop} — LONG thesis broken
  in underlying terms${adj}`, `` (and the SHORT-side mirror at manage.ts:213).
- `manage-sync.ts:399`: `reason: verdict.reason,` persisted onto the snapshot insert.
- Zero pre-existing hits for `manageReasonDetail` or `manageEvent.reason` in `live-plays.ts` or
  `play-brief-narrative.ts` prior to this fix, verified by isolating the 6 non-test source files via
  `git stash` (only unrelated pre-existing `reason` usages — `dteMigration.reason`,
  `gateBlocks?.[0]?.reason` — matched).

RED→GREEN proof (independently reproduced on a fresh `fix/swing-manage-reason-detail` branch off the
actual latest `origin/main`):
- Reverted the 6 non-test source files, kept the tests. `npx tsx --experimental-test-module-mocks
  --test src/lib/swing/play-brief-narrative.test.ts`: **1 failure** (the new test, asserting the
  specific detail string is absent) — the expected "field/detail doesn't exist yet" shape. 88/89
  pass, nothing pre-existing broke.
- Reapplied. Re-ran the same file plus the directly-related sweep (`live-plays.test.ts`,
  `horizon-plays.test.ts`, `play-brief-resolve.test.ts`, `play-brief.test.ts`,
  `adapters.test.ts`): **300/300 pass** (89 + 211 across the two invocations).
- `npx tsc --noEmit -p .` on Node 20: clean.
- Full `npm test` suite (Node 20): result appended below once complete.

### Blast radius

Same additive plumbing shape as the six prior Ask Largo fixes this session, for a `reason`-detail
field already sitting on the management snapshot:
- `src/lib/swing/live-plays.ts` — `manageObservablesFromEvent` reads `manageEvent.reason`;
  `livePlayFromSwingPosition` threads it onto the returned `HorizonPlay`.
- `src/lib/horizon-plays.ts` — new `manageReasonDetail?: string | null` field on `HorizonPlay`.
- `src/lib/swing/play-brief-resolve.ts` — threaded through `horizonRowToDeckSource`.
- `src/features/nighthawk/command-deck/adapters.ts` — `HorizonDeckSource.manageReasonDetail` +
  `terminalPlayFromHorizon` mapping.
- `src/features/nighthawk/command-deck/types.ts` — same field on `TerminalPlay`.
- `src/lib/swing/play-brief-narrative.ts` — `sellReasonClause` takes an optional `reasonDetail`
  param; used only for `structural_stop`/`thesis_stop`/the `default` fallback, and only when
  present — the exact old generic text is the unconditional fallback otherwise.

Deliberately did NOT touch `trimReasonClause` or the other SELL rungs
(`expiry_risk`/`premium_stop`/`catalyst_shift`/`regime_shift`/`time_stop`) — their existing canned
wording is either intentionally member-clean (should not be replaced by raw internal engine prose)
or already specific, so widening the fix to those would risk regressing deliberately-chosen phrasing
outside this fix's scope.

### Fix rationale

Additive per the Largo product contract: a new optional field, nothing flattened or replaced when
the detail is absent — the exact prior generic text remains the fallback, so this fix strictly adds
specificity where it's available and changes nothing when it isn't. No fabricated confidence: the
detail is the engine's own already-computed sentence, never a guessed or synthesized elaboration.

### Verification

- Independent re-verification performed from scratch on a fresh branch off actual latest
  `origin/main` (which already includes #5186), not the originating research agent's own
  working-tree state — diff applied cleanly, RED/GREEN reproduced independently, tsc clean.
- Full suite result to be appended once the background run completes.

### Post-open peer review — floating-point display artifact (fixed pre-merge)

A peer review on this PR flagged a real, previously-invisible formatting defect this PR newly
surfaces: `structuralStopBroken()` (`manage.ts:177-213`) interpolates `comparePx`/`stop` directly
into `verdict.reason` with no rounding. On an ex-dividend session, `comparePx` comes from
`underlyingPriceForStructuralStop()` (`ex-dividend-adjustment.ts:38-40`), which computes
`price + cash` via raw floating-point addition — a real (price, cash) pair can produce a visible
artifact like `10.790000000000001` (reviewer sampled ~18.5k realistic pairs: 17.3% produce one).
`verdict.reason` was write-only before this PR (computed, persisted, never displayed) — CLAUDE.md's
"round at the data layer" caution never applied because nothing rendered it; this PR's
`manageReasonDetail`/`sellReasonClause` wiring is what makes it reach a member-facing sentence.

Verified independently before fixing: reproduced the exact artifact (`10.74 + 0.05` in Node),
confirmed all four interpolation sites in `structuralStopBroken()`, confirmed the underlying
comparison logic (`comparePx <= stop`) is untouched by the review's own hypothesis. Fixed with
`.toFixed(2)` at the four reason-string interpolation sites only (Q39 fail-safe line, LONG/SHORT
breach lines, the ex-div-adjusted-from clause) — display-only, per the reviewer's own suggested
root-cause location (rounding at the source in `manage.ts` fixes it for every reader of
`verdict.reason`, not just this PR's new narrative path; string-parsing `reasonDetail` defensively
in `sellReasonClause` would have been fragile).

Regression coverage added: a test reproducing the exact `10.74`/`0.05` ex-div pair and asserting no
run of 3+ decimal digits appears anywhere in `verdict.reason`, plus a plain non-ex-div LONG/SHORT
symmetry test. RED→GREEN independently reproduced (revert `manage.ts`, keep tests: 2/18 fail with
the exact expected shape; reapply: 18/18 pass). Broader sweep (manage + play-brief-narrative +
live-plays + ex-dividend-adjustment): 155/155 pass. `tsc --noEmit` clean.

### Tooling note (not part of this fix, disclosed for future sessions)

While independently reproducing RED, ran the new/modified test file with a 60s timeout as a
precaution after the originating research round reported a reproducible Node 20 `--test` runner hang
when using `assert.ok(x.includes(y))` (as opposed to `assert.equal(x.includes(y), true)`) inside this
specific ~2000-line test file. The actual RED and GREEN runs here completed normally in well under a
second each — no hang was observed in this independent re-verification — but the new test was written
using the safer `assert.equal(...)` pattern regardless. Flagging this for future sessions touching
`play-brief-narrative.test.ts`: prefer `assert.equal(x.includes(y), true)` over `assert.ok(x.includes
(y))` in this file until the root cause (if real) is understood.
