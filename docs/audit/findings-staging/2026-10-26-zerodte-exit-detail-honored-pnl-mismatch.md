## Night Hawk 0DTE: `exit_detail`'s embedded P&L percentage disagrees with the row's own persisted `pnl_pct`/`managed_pnl_pct` whenever a protective floor/stop is honored (`mark_honored:true`)

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Live-production audit, Ask Largo × Night Hawk Swings standing ownership mandate (0DTE/Night Hawk Command "keep digging" sub-mandate on the 0DTE/Largo surface), 2026-10-26 |
| **Scope** | `src/lib/zerodte/exit-engine.ts` (`buildExitContext`); consumed by `src/lib/platform/zerodte-service.ts` (`ledger[].exit_detail` on `GET /api/market/zerodte/board`, rendered verbatim as a tooltip by `ZeroDteBoard.tsx`) and `src/lib/zerodte/record.ts`/`play-timeline.ts` (`entry_context.exit.detail` on `GET /api/market/zerodte/record`, which Largo's `get_zerodte_record`/`get_zerodte_plays` tools quote as the play's narrative) |

### Root cause

`evaluateExitState`/`decideTrimScale` compute a decision's `detail` narrative string — e.g.
`` `Mark ${fmtMark(currentMark)} (${fmtPct(pnlPct)}) is at/below the ${fmtPct(floor)} floor...` ``
— at DECISION time, from the RAW observed mark/`pnlPct` (`currentMark`, `pinnedLivePnlPct(entryPremium,
currentMark)`). This happens **before** `resolveExitMark`/`buildExitContext` ever run.

Separately, `buildExitContext` (which persists the row's official `pnl_pct`/`mark`) calls
`resolveExitMark`, which — for a ratchet/runner-floor/trim-scale-dead-zone-floor EXIT — takes
`mark = max(observedMark, floorMark)`: when the floor price beats a worse real print
(`mark_honored: true`), the OFFICIALLY RECORDED `pnl_pct` is computed off this better, HONORED mark,
not the raw observed one. But `detail: decision.detail` was passed through **unchanged** — never
regenerated to reflect the honored mark/pnl — so the frozen, member-facing narrative and the
persisted numeric record disagree for the exact same exit event, and the narrative *always*
understates the truth (honoring, by construction via `Math.max`, can only improve on the raw print).

Confirmed live in production, 2026-10-26, `GET /api/market/zerodte/record?days=1` (3 of 4 graded
plays that session carried `mark_honored:true`):
- **SPXW**: `detail` "Mark 14.1 (+17.5%) is at/below the +18.33% floor..." vs the row's own
  `pnl_pct`/`managed_pnl_pct` **18.33%** (0.83pp understatement) — and the sentence reads
  self-contradictory: it names the +18.33% floor right next to a +17.5% that is supposedly
  "at/below" it, when 17.5 < 18.33 is literally the trigger condition, not the credited result.
- **SPY**: `detail` "Mark 1.275 (+12.83%)..." vs recorded **15.04%** (2.21pp understatement).
- **TSLA**: `detail` "Mark 1.355 (+6.69%)..." vs recorded **7.87%** (1.18pp understatement).
- Control row **QQQ** (`mark_honored:false` — the observed print never gapped past the floor):
  `detail` "+7.25%" = recorded 7.25%, no divergence — confirming the bug is specific to the
  honored-floor path, not a generic formatting issue.

This is a **different** defect from PR #6873 (`fix: round live option mark to 2dp in exit-narrative
detail strings`, merged 2026-10-26) — that PR only wraps the *displayed* `currentMark` in
`.toFixed(2)` (`fmtMark`) and its own write-up explicitly states `fmtPct(pnlPct)`'s computation is
untouched. It fixed a cosmetic precision issue, not this percentage-disagreement bug: the embedded
PERCENTAGE itself is stale/wrong whenever `mark_honored` is true, independent of how many decimals
it is displayed with.

It is also the honored-branch counterpart of the 2026-09-04 CRCL finding (`docs/audit/FINDINGS.md`)
that fixed the same shape of disagreement for the NON-honored branch (`pnl_pct` must not be computed
from the cent-rounded `mark`) — that fix's own write-up says the floor-honored branch was "unaffected
by design," which was true only for the NUMERIC field (`pnl_pct`); the `detail` string's own embedded
number was never checked against it, which is exactly the gap this finding closes.

### Fix

Added `regenerateExitDetailForHonoredMark(detail, honored, mark, pnlPct)` in `exit-engine.ts`: when
`buildExitContext` resolves `markHonored === true`, it re-interpolates the leading
`` `Mark <fmtMark> (<fmtPct>)` `` clause of `decision.detail` with the SAME honored `mark`/`pnlPct`
values it persists as `ctx.mark`/`ctx.pnl_pct` — a targeted regex substitution on the one leading
clause, leaving the rest of the sentence (the floor/peak values, the banked-tranches clause, etc.)
untouched. Scoped safely: `resolveExitMark`'s own reason allowlist (`ratchet*`/`runner_floor`/
`trim_scale_dead_zone_floor`, both of which share this exact leading-clause template at their one
EXIT call site each, in `decideTrimScale` and `evaluateExitState`) is the only set of reasons that
can ever be `honored`, so gating on the caller's own `honored` boolean is sufficient — no separate
reason check is needed, and no other decision shape (thesis break, plan_stop, plan_target,
flat_theta_bleed, HOLD/RAISE_FLOOR) is ever touched. A non-honored exit's `detail` is passed through
byte-for-byte, exactly as before.

### Regression test

Extended `src/lib/zerodte/exit-engine.test.ts`:
- New test asserting a ratchet-mode floor-honored exit's regenerated `detail` embeds the SAME
  percentage as the persisted `ctx.pnl_pct` (not the raw observed one baked into
  `decision.detail`).
- Extended the existing `trim_scale_dead_zone_floor` honored-exit test (the `decideTrimScale`
  sibling code path) with the same detail-vs-pnl_pct assertion.
- Extended the existing non-honored thesis-exit test with an explicit `ctx.detail === decision.detail`
  byte-equality assertion, locking in that only a `mark_honored` exit is ever regenerated.

### Verification

- RED→GREEN proof: reverted only `src/lib/zerodte/exit-engine.ts` to its pre-fix state (keeping the
  new/extended test assertions), re-ran the test file — exactly the 2 new/extended assertions failed
  (`not ok 42`, `not ok 53`), all 112 other tests still passed. Restored the fix — all 114 tests pass.
- `node --import tsx --experimental-test-module-mocks --test src/lib/zerodte/exit-engine.test.ts`
  (Node 20) — 114/114 pass.
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
- Full `npm test` (Node 20) — see PR for the run's final tally.
