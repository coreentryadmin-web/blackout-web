> **kind:** FINDING

## Swing Command Deck + Ask Largo play-brief claim "trim banked" on positions still fully exposed at HOLD — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings — `terminalPlayFromHorizon` (`src/features/nighthawk/command-deck/adapters.ts`), consumed by both the live Command Deck terminal panel and Ask Largo's `swing/play-brief` (`src/lib/swing/play-brief-resolve.ts` builds the same `TerminalPlay` via the same function) |
| **Severity** | P1 (member-facing risk-exposure misstatement on live open capital) |

### Root cause

`buildTerminalExitLadder` (`src/lib/zerodte/terminal-ladder.ts`) marks a trim rung `fired` purely
mechanically: `peakPremium >= entry × (1 + trigger_pct/100)`. Its own doc comment claims this
"matches the live status machine (derivePlayStatus, marks-math.ts), which is what drives the card
the member is looking at" — true for 0DTE, where `derivePlayStatus` (`zerodte/plan.ts`) *is* that
same mechanical peak-crossing rule, so the ladder and the row's real status can never disagree.

Swing is different. Its real live status is set by `manage-sync.ts`'s `mapVerdictToStatus`, which
gates `TRIM` behind `verdict.enforced` — deliberately, per that file's own comment: "an un-enforced
TAKE_PARTIAL is advisory only — nothing actually sold a tranche... latching TRIM off an
un-enforced advisory would silently and permanently disable capital-preservation" (the flag flips
only once the PR-16 calibration ladder graduates that specific rung). A row's `peakPremium` can
clear the mechanical trim level while `manage-sync` still holds it at `HOLD` for calibration
reasons — and `terminalPlayFromHorizon` was calling `buildTerminalExitLadder` and using its raw
`fired` flags unconditionally, ignoring that gate entirely.

**Live reproduction, 2026-09-10, positionId 34 (NRG, LONG, STANDARD sub-lane):** entry premium
$4.90, peak premium $11.40 (+132.7%, well past the +100% single-rung trim trigger at $9.80,
`SWING_SCALE_OUT_POLICY`), current mark $6.85 (+39.8%, a ~70% relative retracement from peak).
`GET /api/market/nighthawk/horizons?view=swings` returned this row's authoritative
`liveStatus: "HOLD"` — no trim was ever enforced, the full original position is still exposed to
the stop. `GET /api/market/swing/play-brief?playId=SWING:NRG&ticker=NRG&status=COMMIT` for the
*same position, same instant* rendered:

- Management section: `Trim ladder: +100% ✓`
- Trade manager read: `**Manage plan** — **all trims banked** — runner only · ... **50% runner**
  after trims`
- `trimsFired: 1` (top-level response field)

Both surfaces derive from the identical `TerminalPlay.exitPolicy` object — `play-brief-resolve.ts`
calls the exact same `terminalPlayFromHorizon` the Command Deck UI adapter uses — so this was not
an Ask-Largo-only narrative bug: the live Command Deck terminal panel for this position showed the
same false "✓" on its trim ladder. A member reading either surface would reasonably believe half
the position had already been sold and de-risked, when in fact 100% of the original position was
still live and exposed to the full stop distance from entry.

### Blast radius

One call site produces `TerminalPlay.exitPolicy` for every SWING/LEAPS row on both consumers
(`terminalPlayFromHorizon`, `adapters.ts`) — fixed once, both surfaces correct. 0DTE's separate
`terminalPlayFromZeroDte` path and `zerodte-service.ts`'s own `buildTerminalExitLadder` call are
untouched and out of scope: 0DTE's mechanical rule genuinely is its status machine, so no
divergence exists there. `SWING_SCALE_OUT_POLICY` currently defines exactly one trim rung, so this
was a binary "banked or not" misstatement, not a partial-rung ambiguity — but the fix is written
generally (any not-yet-`TRIM` row gets every rung forced to `fired: false`) in case a second rung
is ever added to the swing ladder.

### Fix

In `terminalPlayFromHorizon`, gate the raw ladder's `fired` flags on the row's own resolved
`status`: pass `rawExitPolicy` through unchanged once `status === "TRIM"` (the mechanical read is
real once manage-sync has actually enforced it), otherwise force every `trim_levels[].fired` to
`false`. No change to `buildTerminalExitLadder` itself (0DTE still uses its raw, correct output)
and no change to `manage-sync.ts`'s enforcement logic — this only stops a second, disconnected
"did it fire" computation from contradicting the first.

### Evidence

RED→GREEN: `src/features/nighthawk/command-deck/adapters.test.ts` — new test
`"horizon adapter: swing trim ladder is NOT fired while liveStatus is still HOLD..."` reproduces
the exact NRG numbers above; failed pre-fix (`true !== false` on `trim_levels[0].fired`), passes
post-fix, and asserts the ladder still reads `fired: true` once `liveStatus` genuinely reaches
`TRIM` (no regression to the real, enforced case). Full suite: 13432 pass / 0 fail / 3 skipped
(Node 20, `npm test`). `npx tsc --noEmit` clean.

### What was deliberately left unchanged

`manage-sync.ts`'s `enforced`/calibration-ladder gating itself — that design is intentional
(documented in its own comments) and not the bug; this fix only makes the ladder DISPLAY agree
with what that gate already decided, rather than silently overriding it with a second answer.
