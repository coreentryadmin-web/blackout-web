## Night Hawk Swings: `counterThesisLine()`'s HELIX put-led/call-led reason has no dedup against `crossDeskCoaching()`'s "Cross-desk friction" bullet — the same flow fact gets cited twice in one brief

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Live-production audit, Ask Largo × Night Hawk Swings standing ownership mandate, 2026-10-26 |
| **Scope** | `src/lib/swing/play-brief-narrative.ts` (`counterThesisLine()`, ~lines 1111-1172 and its caller at ~line 1762); `src/lib/swing/play-brief-narrative-coaching.ts` (`crossDeskCoaching()`, ~lines 832-905) — both feed `tradeManagerNarrativeSection`'s "Trade manager read" section |

### Root cause

`counterThesisLine()`'s sibling Vector-bias check (the previous `#5351`/2026-09-09-fixed case) is
gated by a `vectorConflictAlreadyNoted` flag threaded in from the caller specifically because
`crossDeskCoaching()` (`play-brief-narrative-coaching.ts`) independently derives the same
Vector-vs-swing-direction misalignment earlier in the same bullet list and already names it in its
own "Cross-desk friction" bullet. The caller's dedup check, however, was a bare regex —
`bullets.some((b) => /Vector (?:also reads )?(bearish|bullish)/.test(b))` — that only ever matched
the literal word "Vector".

`crossDeskCoaching()` checks **four** desks for conflicts, not just Vector — Night Hawk, 0DTE,
Vector, and HELIX (`play-brief-narrative-coaching.ts` lines ~878-879: `if (play.direction ===
"LONG" && putHeavy) conflict("HELIX", "put-led", "flow"); if (play.direction === "SHORT" &&
callHeavy) conflict("HELIX", "call-led", "flow")`), using the exact same `trustedHelixFlow()` input
and 1.3x call/put-premium ratio threshold `counterThesisLine()`'s own HELIX check (a few lines
below the Vector check, ungated) uses. `renderCrossDeskConflict()` renders this as `"HELIX
put-led"`/`"HELIX call-led"` when HELIX is the lead conflict, or `"HELIX also reads
put-led"`/`"...call-led"` when demoted to a `rest` entry — neither form contains the word "Vector",
so the existing dedup regex never matched it. Whenever `crossDeskCoaching()` named HELIX as a
conflict, `counterThesisLine()`'s separate, ungated HELIX push re-cited the identical flow numbers
as a second, independent-sounding "corroborating read" a few bullets later in the same "Trade
manager read" section — the same double-citation shape the 2026-09-09 NRG repro fixed for Vector,
just on the sibling desk that fix never covered.

Reproduced directly against the current source with a regression test before the fix (RED): a
LONG play with put-heavy HELIX flow (1.5x ratio, clearing the shared 1.3x gate on both sides) and
no Vector/Night-Hawk/0DTE data produced:

```
Cross-desk friction — HELIX put-led. ...
...
Counter-thesis (bear case) — corroborated across 3 independent reads — HELIX put-led ($1.5M vs
$1.0M calls) · call wall 101.00 overhead (1.0%) · dealer long-gamma pins rallies. ...
```

"HELIX put-led" / the identical `$1.5M vs $1.0M` figures appear in both bullets of the same
document.

### Fix

Added a sibling `helixConflictAlreadyNoted` flag to `counterThesisLine()`, gating its HELIX
put-led/call-led push exactly the way the existing `vectorConflictAlreadyNoted` flag already gates
the Vector push. The caller now also computes `bullets.some((b) => /HELIX (?:also reads
)?(call|put)-led/.test(b))` — covering both the lead-conflict phrasing (`"HELIX put-led"`) and the
demoted "rest" phrasing (`"HELIX also reads put-led"`), matching the same lead/demoted distinction
the existing Vector regex already handles — and passes it through as the new 5th argument. The
other counter-thesis reasons (Night Hawk, 0DTE, GEX walls, EMA/MACD/structure, dealer posture,
fading pillar) are independent evidence and stay untouched — only the HELIX-specific reason is
omitted when `crossDeskCoaching()` already named it.

### Regression test

Added `tradeManagerNarrativeSection: Counter-thesis omits the HELIX reason when crossDeskCoaching
already named it, but keeps other reasons` to `src/lib/swing/play-brief-narrative.test.ts`,
directly beside the existing Vector-dedup test it mirrors. Feeds a LONG play with put-heavy HELIX
flow (1.5x ratio) plus an independent call-wall reason (GEX fallback, no Vector data) and asserts:
exactly one "Cross-desk friction" bullet (naming "HELIX put-led"), exactly one "Counter-thesis"
bullet, the Counter-thesis bullet does **not** re-cite "HELIX put-led", but **does** keep the
independent call-wall reason — proving this isn't a blanket suppression.

### Verification

- RED→GREEN proof: the new test failed against the unfixed source (`doesNotMatch(counter[0],
  /HELIX put-led/)` failed — "HELIX put-led" present in both the Cross-desk-friction and
  Counter-thesis bullets, byte-identical flow figures `$1.5M vs $1.0M calls` in both). Applying the
  fix (gate + regex extension) turned it GREEN with no other test affected.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative.test.ts`
  (Node 20) — 159/159 pass (158 pre-existing + 1 new).
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
