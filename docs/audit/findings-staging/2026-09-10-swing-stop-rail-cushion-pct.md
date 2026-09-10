> **kind:** FINDING

## Ask Largo swing brief — Premium stop rail showed only the dollar level, not the live cushion — ENHANCEMENT SHIPPED

| | |
|---|---|
| **Status** | FIXED (enhancement, not a defect) |
| **Lane** | Night Hawk Swings / Ask Largo play-brief, AGGRESSIVE MODE improvement-hunting |
| **Severity** | P3 — genuine UX gap, no incorrect data |
| **Found by** | Live forensic sweep, full ten-point LARGO-PRODUCT-CONTRACT pass on CRWD, 2026-09-10 |

### What was missing

`watchForSection` (`src/lib/swing/play-brief-intel.ts`)'s "What to watch" section for an OPEN
swing position rendered the premium stop level as a bare dollar figure:

```
Premium stop rail: **$6.66** — thesis breaks if mark closes below
```

The member already sees the current mark elsewhere in the same brief (the "Position" section's
`Mark: **$19.57**`), but nothing in the brief states how much room remains between the current
mark and the stop — a member has to do that subtraction themselves every time they check a
position, on every ticker, every cycle. This is a genuine trade-manager gap, not a data-
correctness bug: the underlying `stop_premium` and `mark` values were both already correct and
already displayed, just never connected into the one number a trader actually wants at a glance
("how close am I to getting stopped out").

### Fix

`watchForSection` now computes a cushion percentage — `(mark - stop) / mark * 100` — the same
spot-relative-distance framing `fmtDist` already uses elsewhere in this file for gamma-flip/wall
distances, applied here to the premium stop level:

```
Premium stop rail: **$6.66** — 66% cushion from current mark — thesis breaks if mark closes below
```

Additive only: the existing dollar level and "thesis breaks if mark closes below" wording are
byte-identical to before. The cushion note is appended only when `mark` is available and strictly
above the stop (the normal case for a genuinely OPEN row) — omitted, never fabricated or shown as
a confusing negative/zero, when `mark` is missing or a stale-mark edge case puts it at/below the
stop level.

### Evidence

New tests in `src/lib/swing/play-brief-intel.test.ts`:
- "Premium stop rail shows the live cushion percentage above the stop, not just the dollar level"
  — real numbers from the live CRWD brief this pass audited (mark $19.575, stop $6.66 →
  (19.575-6.66)/19.575×100 = 65.96% → displayed as 66%). RED before the fix (old code had no
  cushion text at all), GREEN after.
- "Premium stop rail omits the cushion note when mark is unavailable (never fabricated)" —
  confirms the omission path.

Full `npm test` (Node 20) + `npx tsc --noEmit`: clean.

### Blast radius

Single call site (`watchForSection`'s OPEN-bucket stop-rail line). No other section reads or
displays `stop_premium` with this framing, so nothing else needed updating. `fmtDist` itself was
read for the pattern but not modified or reused directly (its own string is hardcoded to "from
spot" phrasing that doesn't fit a premium-vs-stop context) — a small local computation was
written instead rather than generalizing a shared helper for one caller.

### Why this and not something bigger

Considered surfacing the cushion as a separate structured `levels[]` entry (the envelope's
first-class levels array) instead of inline prose — deferred: every other invalidation/stop level
in this brief (gamma flip, GEX walls) is currently prose-only too, so promoting just the premium
stop to structured levels would be inconsistent with the rest of the section rather than a genuine
improvement; a broader structured-levels pass across all of `watchForSection` is a larger, separate
piece of work than this one-line addition earns.
