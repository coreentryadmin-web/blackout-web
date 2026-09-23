> **kind:** FINDING

## `board.lanes.SWING.watch` back-compat array served entry-window-expired names PR #337 was supposed to demote — FIXED

| | |
|---|---|
| **Area** | Ask Largo / Night Hawk Swings board |
| **Severity** | P2 (correctness — member/Largo-facing stale actionable candidate, not a data-availability bug) |
| **Status** | FIXED |
| **File** | `src/lib/swing/serving-board.ts` (`assembleSwingServingLane`) |

### Root cause

PR #337 (2026-09-22, `docs/audit/MARKET-OPEN-VALIDATION.md` entry #337) taught `sectionForSwingPlay`
to route a pre-entry name whose own entry-validity deadline has already passed to `RESEARCH`
instead of leaving it in `WATCH` — closing a gap where a stale, no-longer-enterable name (the
PR's own repro: META, 26+ days past its window) sat #1 in `sections.WATCH` at full prominence.

That fix only touched `sections.WATCH` (the seven-bucket grouping `buildSwingSections` computes).
`assembleSwingServingLane` ALSO derives a separate, independent `watch` field — the flat
back-compat array `GET /api/market/nighthawk/horizons?view=swings` actually serves as
`board.lanes.SWING.watch`, the field this repo's own audit tooling and (per `serving.ts`'s own
header comment) Largo's simpler tool calls read directly. That field was derived with
`plays.filter((p) => p.status === "WATCH")` — a raw status filter that never consulted
`sectionForSwingPlay`/`entryWindowExpiredFromPlay` at all, so it kept serving an expired name at
full prominence exactly the way PR #337 was supposed to stop.

### Evidence

Live repro, 2026-09-23: `GET /api/market/nighthawk/horizons?view=swings` returned exactly one
WATCH candidate, AMZN — `firstSeenAt: "2026-09-08T16:04:33.000Z"` (15 days earlier), `subLane:
"TACTICAL"` (a 2-trading-day entry-validity window, per PR #337's own sub-lane table — 15 days is
unambiguously past it). Pulling `GET /api/market/swing/play-brief?playId=SWING:AMZN&ticker=AMZN&status=WATCH`
for the SAME position showed the play-brief's own Entry section (which reads the router's verdict,
not the back-compat field) correctly said:

```
Serving section: RESEARCH
...
Also gate-blocked (moot — entry-validity window expired):
• research_review: Desk is passing this name — thesis needs more work before it can be served.
```

Two surfaces backed by the same underlying data disagreeing on whether the exact same name is a
live, actionable WATCH candidate or a dead RESEARCH-only one — the classic Largo-contract
consistency violation this toolkit exists to catch.

### Fix

`assembleSwingServingLane` now computes `sections` first and derives the back-compat `watch` field
as `sections.WATCH` directly, instead of independently re-filtering raw `p.status`. This makes it
structurally impossible for the two to disagree — any future router change (a new exclusion
reason, a new section) automatically applies to both surfaces at once. `committed` is deliberately
left untouched (`plays.filter((p) => p.status === "COMMIT")`) — no live-position entry-window-expiry
case exists (the router short-circuits on `liveStatus` before ever consulting entry-window state),
and narrowing the fix's scope avoids risking the correctly-tracked committed count on an unrelated
change.

Regression test added (`src/lib/swing/serving-board.test.ts`): a stale (26-days-past-window,
STANDARD sub-lane) WATCH-status play confirmed RED before the fix (appeared in `lane.watch`) /
GREEN after (excluded from `lane.watch`, still reachable in `lane.sections.RESEARCH` — routed
away, not dropped). An existing test's fixture (`B`/`C` tickers) also needed a `setupState:
"FORMING"` addition — without any setupState at all they route to RESEARCH by the router's own
"unclassified → RESEARCH" rule, so the old fixture was unknowingly exercising a shape the fix
changes; the intent (checking committed/watch counts track real WATCH-routed populations) is
preserved, just with a fixture that genuinely routes to WATCH.

### Blast radius

Single function (`assembleSwingServingLane`), one internal duplicate-computation cleanup
(`sections: buildSwingSections(plays)` called twice in the original — now computed once and
reused). No other call site of `assembleSwingServingLane`/`emptySwingServingLane` changes shape;
`committed` is bit-for-bit unchanged.
