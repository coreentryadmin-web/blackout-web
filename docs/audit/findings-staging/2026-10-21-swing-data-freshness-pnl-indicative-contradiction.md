## 2026-10-21 — [FINDING, swing] "Data freshness" told the reader to "treat P&L as indicative" when the Position section in the SAME brief showed P&L as entirely unknown

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (Largo C9 precision — self-contradiction between two sections of the same envelope) |
| **Surface** | `src/lib/swing/play-brief-intel.ts` — `dataFreshnessSection()`'s sync-quote-without-timestamp branch |

### Root cause

`dataFreshnessSection`'s else-if branch rendered a fixed string whenever `play.markIsSync &&
playExpectsLiveOptionMark(play.status)`:

```js
} else if (play.markIsSync && playExpectsLiveOptionMark(play.status)) {
  lines.push("**Mark age unknown** — sync quote without timestamp; treat P&L as indicative");
}
```

That condition covers two genuinely different states, which the codebase already distinguishes
elsewhere via the exported `optionMarkGenuinelyUnknown` predicate (`play-brief-absence.ts:531-533`:
`markIsSync === true && playExpectsLiveOptionMark(status) && pnlPct == null`) — already imported
into this same file and already used a few lines above to gate the stop/target-rail cushion
percentages:

1. A real mark/P&L exists, just without a timestamp (`pnlPct` non-null) — "treat P&L as indicative"
   is accurate here.
2. No live tick has landed at all (`pnlPct` null) — there is no P&L figure to be "indicative" of
   anything.

The Position section (`pnlSection`, `play-brief.ts`) already branches on exactly this predicate and
renders `Mark: unknown` / `P&L: —` / `Peak: —` / `Trough: —` for case 2 — but `dataFreshnessSection`
rendered the same "treat P&L as indicative" text regardless, so a member could read "P&L: —" two
sections earlier and "treat P&L as indicative" two sections later in the identical brief.

### Evidence

Live repro (Ask Largo deep-dive, 2026-10-21, 3 independent OPEN-bucket plays — PONY, TDOC, SBET —
all freshly-committed EOD positions with no live tick yet):

```
## Position
Mark: **unknown** _(sync quote, no live price yet — do not read as flat)_
P&L: **—**
Peak: **—** _(no live tick yet)_
Trough: **—** _(no live tick yet)_

## Data freshness
**Mark age unknown** — sync quote without timestamp; treat P&L as indicative
```

Verified against the actual TypeScript source (not just the claim): `dataFreshnessSection`'s branch
(`play-brief-intel.ts:2976-2978`) never references `play.pnlPct`; `optionMarkGenuinelyUnknown`
(`play-brief-absence.ts:531-533`) is already imported and already used at two other call sites in
the same file. A prior FIXED finding (2026-09-11, "bias is never directional") touched this exact
line to fix a wrongly-directional bias pill, explicitly stating the `markIsSync &&
playExpectsLiveOptionMark` condition itself was "correct and unchanged" — that pass predates this
file's own `optionMarkGenuinelyUnknown` extraction (2026-09-12 per its doc comment) and never
evaluated the `pnlPct`-null sub-case, so this contradiction survived it undetected.

Added two tests to `play-brief-intel.test.ts`: one RED repro (`pnlPct: null`, the PONY/TDOC/SBET
shape) asserting the body does NOT say "treat P&L as indicative"; one control (`pnlPct: 12.3`)
confirming the existing wording is preserved when a real P&L actually exists. RED→GREEN confirmed
via `git stash` on the source file alone. `play-brief-intel.test.ts`: 317/317 pass. Broader sweep
`play-brief*.test.ts`: 1125/1125 pass. `tsc --noEmit` clean.

### Blast radius

Single branch, single call site — `dataFreshnessSection` is the only renderer of this specific
"Mark age unknown" line. The existing "bias is never directional" test (which happens to use a
`pnlPct`-null fixture, undetected until this pass) only ever asserted on `bias`, never the wording,
so it had no coverage of this contradiction and continues to pass unchanged (both branches keep
"Mark age unknown" as a common substring).

### Fix

Branch the message on the already-imported, already-used `optionMarkGenuinelyUnknown(play)`
predicate, mirroring the Position section's own distinction — no new logic, reusing the exact
helper this file already relies on elsewhere for the identical state split.

### Why not a bigger fix

Did not touch `optionMarkGenuinelyUnknown` or `pnlSection` (already correct) or the stop/target-rail
guards elsewhere in this file that already use this predicate. The defect was isolated to this one
branch not yet consulting the shared helper that already exists specifically to prevent this class
of drift (per its own doc comment, written for a different call site this same file already fixed).
