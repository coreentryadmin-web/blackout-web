## 2026-10-08 — [FINDING, P3 Night Hawk Swings / Ask Largo] `crossDeskCoaching`'s "structure" conflict told a WATCH (pre-entry) candidate to "size down" and wait for its "next trim rail" — positions that don't exist yet — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | Ask Largo swing play-brief — `crossDeskCoaching`/`renderCrossDeskConflict`/`crossDeskResolution` (`src/lib/swing/play-brief-narrative-coaching.ts`), the "Cross-desk friction" trade-manager bullet |
| **Severity** | P3 — member-facing narrative correctness (Largo product contract), no live-trading-path change |
| **Status** | FIXED — branch `fix/swing-crossdesk-watch-trim-language` |
| **Found by** | ASK LARGO × NIGHT HAWK SWINGS standing ownership mandate, 5-engine live monitor cycle, 2026-10-08 01:01 UTC firing |

### Root cause

`collectCoachingBullets` calls `crossDeskCoaching(ctx, play)` unconditionally for both the `"watch"`
(pre-entry candidate) and `"open"` (already-entered HOLD/TRIM/OPEN) buckets — only the `"closed"`
bucket short-circuits before reaching it. When Vector's gamma-regime structure read conflicts with
the swing's own directional thesis, `crossDeskCoaching` renders a "Cross-desk friction" bullet via
`renderCrossDeskConflict`, whose `crossDeskResolution("structure")` branch unconditionally returned:

> "watch for it to flip back before your next trim rail — until then, size down"

This sentence presupposes an EXISTING POSITION: something already sized that could be "sized down",
and a scale-out ladder (`SWING_SCALE_OUT_POLICY`) with a "trim rail" already running. Neither exists
for a WATCH-bucket candidate — no entry has been made, there is no position, and no trim rail has
ever been armed. This is exactly the failure class this same file has already been fixed for twice
before on OTHER sections — `bookContextSection`'s CLOSED-bucket "Adding {ticker} stacks the same
wager" tense bug and its ALREADY-OPEN "Adding..." sibling fix (both FINDINGS 2026-09-12) — just never
audited for THIS specific `crossDeskResolution` line.

### Evidence

Live repro, `GET /api/market/swing/play-brief?playId=SWING:NET&ticker=NET&status=WATCH` (NET WATCH
brief, 2026-10-07 ~21:08 ET, `positionId: null`, `status: "WATCH"`, `setupState: "TRIGGERED"`,
genuinely gated behind TWO unresolved entry gates — `g_s12_halt_feed_stale`, `g_s6_confluence` — so
no entry decision has even been reachable yet, let alone taken):

> **Cross-desk friction** — Vector bearish (POSITION · momentum short on continuation → target put
> wall 342.5). That's live price structure — the same tape this swing itself trades — exactly the
> evidence a **Pullback continuation** setup leans on: watch for it to flip back before your next
> trim rail — until then, size down.

A member reading this on a candidate they have not entered is told to manage a position ("size
down", "trim rail") that does not exist. The sibling OPEN-bucket brief (`SWING:INTC`, an actual HOLD
position) renders the identical text correctly — there the language is accurate, since a real
position and a real trim ladder exist.

New regression tests, `src/lib/swing/play-brief-narrative-coaching.test.ts`:
- `"crossDeskCoaching: WATCH-bucket structure conflict never tells the member to size down or wait
  for a trim rail (no position exists yet)"` — RED pre-fix (`git stash` of only
  `play-brief-narrative-coaching.ts`): the function has no way to distinguish buckets, so the
  WATCH-status fixture renders the same open-position language. GREEN post-fix.
- `"crossDeskCoaching: OPEN-bucket structure conflict still reads size down / trim rail
  (unchanged)"` — companion guard proving the fix is additive, not a rewording of the already-correct
  open-position text.

### Fix

`crossDeskCoaching` now derives the same `"watch" | "open"` bucket split `statusBucket` already uses
elsewhere in this lane (`play-brief.ts`/`play-brief-intel.ts`: `OPEN`/`HOLD`/`TRIM` → `"open"`,
everything else → `"watch"`; `"closed"` is impossible here since that bucket never reaches this
function) and threads it through `renderCrossDeskConflict` into `crossDeskResolution`. Only the
`"structure"` case branches on it — the `"flow"`/`"intraday_scalp"`/`"digest"` resolution texts are
already entry-decision-neutral (they talk about thesis validity/evidence weight, not sizing or trim
mechanics) and were left untouched. WATCH now reads:

> "watch for it to flip back before treating this as confirmation — until then, this isn't a green
> light to enter"

### Fix rationale

Scoped to exactly the one branch that presupposed a position (`"structure"`) rather than threading
bucket-awareness through every resolution kind, since the other three already read correctly for
both buckets — widening the change would have been scope creep for no behavioral gain. Did not touch
`renderCrossDeskConflict`'s ranking/weighting logic, the 4-desk conflict detection, or the existing
`+N more desks` disclosure (2026-09-19 fix) — all already correct and independently tested.

### Blast radius

Single call site (`crossDeskResolution` is only invoked from `renderCrossDeskConflict`, which is only
invoked from `crossDeskCoaching`). No other narrative section reuses this text. `collectCoachingBullets`'s
consumption of `crossDeskCoaching`'s return value is unaffected — it still receives one nullable
string.

### Gates

`npx tsc --noEmit` clean (Node 20.20.2) · `npx tsx --experimental-test-module-mocks --test
src/lib/swing/play-brief-narrative-coaching.test.ts` 154/154 pass · full `npm test` run — see PR.
