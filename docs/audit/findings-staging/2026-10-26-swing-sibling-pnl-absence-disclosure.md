> **kind:** `FINDING`

## Night Hawk Swings — `siblingPositionsNote` rendered a bare "P&L —" with zero disclosure of why, instead of the same genuinely-unknown/stale caveat `pnlSection` already gives the primary play — FIXED

| | |
|---|---|
| **Severity** | P3 (Largo C3 absence-without-reason violation — a null/aged sibling P&L read as an unexplained dash rather than a disclosed data state; no wrong numbers shown, just missing context a member needs to interpret the dash correctly) |
| **Surface** | `src/lib/swing/play-brief.ts` — `siblingPositionsNote()` ("Other concurrent position(s)" section of the Ask Largo swing play-brief) |
| **Status** | FIXED |

### Root cause

`siblingPositionsNote` rendered each sibling row's live P&L as:

```ts
const pnl = r.livePnlPct != null ? fmtPct(r.livePnlPct) : "—";
```

A bare em-dash with no indication of *why* the figure is missing. `r` here is a `HorizonPlay`
(`src/lib/horizon-plays.ts`) — it carries `markAsOf` and `livePnlPct` exactly like the fields the
PRIMARY play's own `pnlSection` (a few hundred lines up in the same file) already reads via
`optionMarkGenuinelyUnknown`/`optionMarkStaleCaveat` (`play-brief-absence.ts`) to distinguish "no
live tick has synced yet since commit" from "the quote is stale" — every one of the primary play's
own Mark/P&L/Peak/Trough/Spread/Exec-P&L lines already uses this disclosure idiom. This one
sibling-line call site was simply never wired to either helper.

Live repro (2026-10-26, `GET /api/market/swing/play-brief?playId=SWING:MRNA:68`): the "Other
concurrent position(s)" section showed `210C 2026-10-30 — entered 2026-10-26 16:15 ET, entry
$3.85, P&L —` for a position opened 5 minutes after the prior close — 3+ hours later with no live
mark synced and no caveat explaining that absence.

### Why the fix needed a type change, not just a call-site patch

`optionMarkGenuinelyUnknown`/`optionMarkStaleCaveat`/`optionMarkIsStale` were all typed to take a
full `TerminalPlay` (`features/nighthawk/command-deck/types.ts`), because every existing caller
passes the brief's own primary `TerminalPlay`. A `HorizonPlay` sibling row has no `markIsSync`
field of its own — that flag is synthesized only once `terminalPlayFromHorizon` (adapters.ts)
builds a `TerminalPlay` from its source `HorizonPlay` (`markIsSync: src.markAsOf == null`,
adapters.ts:1190). Re-deriving the caveat wording a second time for a `HorizonPlay` shape would
have risked exactly the "two readers, one of them drifts" trap this file's own comments warn
against repeatedly (e.g. the `optionMarkStaleCaveat` extraction comment itself).

Instead, the three functions' parameter type was widened from `TerminalPlay` to a new minimal
`OptionMarkFreshnessSource` interface (`play-brief-absence.ts`) — exactly the four fields they
actually read (`status`, `markIsSync`, `markAsOf`, `pnlPct`). `TerminalPlay` already satisfies this
interface structurally, so every existing call site (all of which pass a real `TerminalPlay`) is
byte-for-byte unaffected — confirmed by `tsc --noEmit` clean and the full pre-existing test suite
passing unchanged.

The call site then builds a small adapter per sibling row:

```ts
const pnlCaveat = optionMarkStaleCaveat(
  {
    status: r.liveStatus ?? null,
    markIsSync: r.livePnlPct == null,
    markAsOf: r.markAsOf ?? null,
    pnlPct: r.livePnlPct ?? null,
  },
  ctx.readMs ?? Date.now(),
);
```

`markIsSync` is derived from `r.livePnlPct == null`, not from `r.markAsOf == null` (the rule
`adapters.ts` uses for the primary play). This is deliberate: `livePnlPct(entry, mark)`
(`live-plays.ts` / `banger-lane-merge.ts`) is null **exactly** when no real `mark` has ever
landed — `entry` is already guaranteed non-null by `siblingPositionsNote`'s own `siblings` filter,
so `livePnlPct == null` for a filtered sibling row is precisely the "no live tick yet" signal this
lane needs, independent of whatever a `markAsOf` timestamp happens to say. Driving `markIsSync` off
`markAsOf == null` instead would have left a real gap: a fixture with a *recent* `markAsOf` and a
still-null `livePnlPct` would compute `markIsSync: false` and fall through every branch of
`optionMarkStaleCaveat` silently, reproducing the exact bare-dash bug for that shape — this was
caught while writing the regression tests, not assumed.

### Evidence

Two new tests in `src/lib/swing/play-brief.test.ts`:

- `"composeSwingPlayBrief: a same-ticker sibling with no live P&L yet discloses WHY, not a bare
  dash"` — a sibling with `livePnlPct: null`, `markAsOf: null` (just-opened position, no live tick
  synced). Asserts the section body never matches a bare trailing `P&L —` and does match the same
  `"no live tick since commit"` wording `pnlSection` already uses for the primary play.
- `"composeSwingPlayBrief: a same-ticker sibling with a real P&L but a stale quote discloses
  staleness"` — a sibling with a real `livePnlPct: 40.0` but a `markAsOf` 3+ hours stale (past the
  18-minute `SWING_OPTION_MARK_STALE_MS` cadence-aware threshold). Asserts the body renders
  `P&L +40.0%` followed by the same `"stale — same quote Mark flagged above"` caveat `pnlSection`
  uses — proving the fix reuses the shared helper end-to-end (both branches of its logic), not just
  the null-P&L case.

RED→GREEN confirmed via `git show HEAD:<file> > <file>` to restore pre-fix content (never a bare
`git stash` — this sandbox's shared git working directory makes that unsafe), re-run, then restore
the fix:
- **Before the fix:** 185/187 pass, 2 fail — both new tests, each showing the exact bug shape in
  their failure output (`P&L —` with no caveat; `P&L +40.0%` with no stale caveat).
- **After the fix:** 187/187 pass.

Full `src/lib/swing/*.test.ts` suite: **2148/2148 pass** (31 suites) — no regressions anywhere else
in the swing lane. `npx tsc --noEmit` clean repo-wide (Node 20).

### Blast radius

`optionMarkIsStale`/`optionMarkStaleCaveat`/`optionMarkGenuinelyUnknown` are reused as-is by their
existing callers in `play-brief.ts`, `play-brief-intel.ts`, and `play-brief-narrative-coaching.ts`
— all pass a real `TerminalPlay`, so the widened parameter type changes nothing for them (verified:
full `src/lib/swing/*.test.ts` suite passes unchanged, `tsc --noEmit` clean). The only new behavior
is the single `siblingPositionsNote` call site this finding targets.

### Fix rationale

Reusing the shared helper (rather than inventing a parallel disclosure string for `HorizonPlay`)
was chosen specifically because the task required matching the existing idiom exactly — the
wording for "genuinely unknown" vs "stale" now lives in exactly one place, and a sibling with a
real-but-aged P&L gets the identical stale-quote caveat the primary play's own P&L line gives, for
free, from the same logic.

An alternative considered and rejected: reimplementing the genuinely-unknown/stale checks directly
against `HorizonPlay`'s own fields inside `play-brief.ts`. Rejected because it would duplicate
logic that already exists once in `play-brief-absence.ts`, reintroducing exactly the kind of
divergence risk this codebase's own prior fixes to these three functions explicitly called out and
tried to close.

### Tests

`src/lib/swing/play-brief.test.ts` (2 new tests, described under Evidence above). Full
`src/lib/swing/*.test.ts` suite: 2148/2148 pass. `npx tsc --noEmit` clean (Node 20,
`/opt/node20/bin`).
