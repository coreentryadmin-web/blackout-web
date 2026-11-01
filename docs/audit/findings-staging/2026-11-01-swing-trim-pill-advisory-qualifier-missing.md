> **kind:** FINDING

## Night Hawk Swings OPEN/HOLD/TRIM Command Deck pill + Ask Largo headline asserted an un-graduated, system-not-acting-on-it TRIM recommendation with no advisory qualifier — FIXED

**Status:** Fixed, regression tests added (`play-card-lifecycle.test.ts`).

### Root cause

`swingActionDisplay`'s OPEN/HOLD/TRIM branch (`src/features/nighthawk/command-deck/play-card-lifecycle.ts`)
rendered `TRIM ${trigger_pct}%` (or bare `TRIM`) with `tone: "active"` whenever
`play.recommendation === "TRIM"`, with zero reference to `play.manageEnforced`. The existing
2026-09-18 fix (CRWD #39) in this exact branch only decides WHICH rung's `trigger_pct` to cite
(`ladderDriven` — was the TRIM actually driven by `profit_ladder`, or by an unrelated advisory rung
like `catalyst_shift`) — it never checks whether the deciding rung is actually *enforced*.

`manage.ts`'s edge rungs (`profit_ladder` included) are stamped `enforced:false` until that
specific rung graduates the PR-16 calibration ladder (`n>=10`, `delta>=15pt` — see `manage.ts`'s
own header and `calibration.ts`). Until it graduates, `manage-sync.ts`'s `latchSwingLiveStatus`
never actually latches the ledger to TRIM (`verdict.enforced && rung === "profit_ladder"` is
required) — i.e. the system itself takes no action. This is exactly the conflation the file's own
GAP FOUND comment in `play-brief.ts`'s `managementSection` already documents fixing **for the
Management-section prose line** ("Manage engine: TAKE_PARTIAL" + the "_Advisory only..._"
disclosure) — but that fix never touched `swingActionDisplay`/the headline-feeding pill, which is
the part of the brief (and the Command Deck) a member is most likely to read.

The un-qualified `{ label, tone: "active" }` this function returns feeds `swingVerdictVerb()`
(`play-brief.ts:139-142`) verbatim, and `swingVerdictVerb` is reused for THREE other member-facing
surfaces: the envelope `headline`, the Verdict section's own opening line, and `thesis`. So the
single un-qualified pill becomes, in the same brief, the headline, the first line of the Verdict
card, and the one-sentence `thesis` claim — none of which carry any indication that the
recommendation is an unproven, un-acted-on signal rather than a hard, enforced trim.

Live repro (production data, authenticated): `GET /api/market/swing/play-brief?playId=SWING:MRNA&positionId=68`
(status `OPEN`/`HOLD`) returned headline `"TRIM 100% — MRNA 195C 6DTE"` and the Verdict body
`"MRNA 195C 6DTE · LONG · TRIM 100%"`, while the SAME position's manage state (confirmed via
`GET /api/market/nighthawk/horizons?view=swings`) carried `manageAction: "TAKE_PARTIAL"`,
`manageReason: "profit_ladder"`, **`manageEnforced: false`** — i.e. the ladder rung crossed its
percentage trigger but has not graduated calibration, and the live horizons snapshot showed
`SWING.scoreFloorGraduated: false` with not a single committed row carrying `manageEnforced: true`
system-wide at the time. Only the Management section, three sections below the headline/Verdict in
the SAME brief, disclosed "_Advisory only — this signal hasn't graduated to an enforced
recommendation yet; the system itself is not acting on it, the position stays as-is until it
does._" — a member skimming only the headline/Verdict/Command-Deck pill never sees it.

### Evidence

- Confirmed by reading current source: `manageEnforced` is read in exactly one place outside its
  own derivation/type plumbing — `play-brief.ts:266` (`managementSection`'s advisory-disclosure
  line). `swingActionDisplay`'s TRIM branch and `swingVerdictVerb` never reference it (grep
  confirms zero hits in `play-card-lifecycle.ts`).
- **RED (pre-fix):** two new tests in `play-card-lifecycle.test.ts` asserting a `manageEnforced:
  false` TRIM renders with an advisory qualifier failed against the pre-fix code
  (`swingActionDisplay — BUY / WAIT / manage vocabulary` suite: 58 pass / 2 fail).
- **GREEN (fix applied):** same suite, 60/60 pass; full file `play-card-lifecycle.test.ts`, 0 fail.
- Cross-checked the other 4 files that already assert exact TRIM pill labels
  (`play-brief-narrative.test.ts`, `play-brief.test.ts`, `adapters.test.ts`,
  `terminal-display.test.ts`) — none of their existing fixtures set `manageEnforced: false`, so all
  pass unchanged (they exercise `manageEnforced: undefined`/absent, which this fix deliberately
  treats identically to the pre-fix behavior — see Fix rationale).
- `npx tsc --noEmit` clean on the whole project.
- Full `npm test` (`node scripts/run-tests.mjs`, Node 20) run clean (see PR for the exact pass
  count on this sandbox's documented Node-20 baseline).

### Blast radius

- `src/features/nighthawk/command-deck/play-card-lifecycle.ts` — `swingActionDisplay`'s OPEN/HOLD/
  TRIM branch only, both the ladder-driven (`TRIM {pct}%`) and generic-reason (bare `TRIM`) label
  paths.
- `src/lib/swing/play-brief.ts` — NOT edited; `swingVerdictVerb`, the envelope `headline`, the
  Verdict section's opening line, and `thesis` all consume `swingActionDisplay`'s return value
  verbatim, so they inherit the fix for free without any change of their own. Checked directly:
  `swingVerdictVerb` is `action?.label ?? play.recommendation ?? play.status` — once `action.label`
  itself carries the qualifier, every downstream reuse does too.
- `zeroDteActionDisplay` (same file, 0DTE's own TRIM branch) was checked and is NOT affected —
  0DTE's exit model carries no `manageEnforced`/calibration-graduation concept of this shape; its
  TRIM ladder IS the enforced status machine (ratchet), so widening this fix there would be scope
  creep onto an unrelated engine.

### Fix rationale

Added an `advisoryOnly = play.manageEnforced === false` check inside the existing TRIM branch,
alongside (not replacing) the pre-existing `ladderDriven` check. When advisory-only: tone downgrades
from `"active"` to `"watch"` (the same tone this very function already uses one branch down for
other informational, not-yet-actioned states — `STILL BUY`/`BUY`), and the label gets an explicit
`(ADV)` suffix (`"TRIM 100% (ADV)"` / `"TRIM (ADV)"`). `manageEnforced` is tri-state
(`true`/`false`/`null`) by design (absent snapshot vs. explicitly un-graduated vs. explicitly
graduated); only an explicit `false` downgrades — `null`/`undefined` (no live manage tick yet, or
an older snapshot shape) keeps the pre-existing `"active"`/un-qualified behavior exactly as before,
mirroring the same discipline the `ladderDriven` check already applies to `manageReason == null`
for the identical reason (never silently downgrade a row this function has no real signal about).

A short bracketed suffix was chosen over a longer sentence because this label is reused as a
compact Command Deck pill with no room for prose, and over a brand-new `StatusTone` (e.g.
`"advisory"`) because that would also require new CSS (`DeckStatusBadges.tsx`/`globals.css`) for a
color that does not yet exist, widening the PR's blast radius for a correctness fix that does not
need new visual design — the existing `"watch"` tone (amber) already reads correctly as "worth
watching, not yet actioned" and is already used for exactly that purpose one branch below in the
same function.

### Deliberately left unchanged

- The Management-section advisory sentence in `play-brief.ts` (`managementSection`) — it already
  correctly discloses the same fact; this fix adds the disclosure to the headline/pill/Verdict/
  thesis surfaces that were missing it, it does not replace or duplicate that sentence.
- `zeroDteActionDisplay`'s TRIM branch (see Blast radius) — a different engine with no
  `manageEnforced` concept.
- The `ladderDriven`/`next` trigger-pct selection logic itself (2026-09-18 fix) — untouched; this
  fix only adds a layer on top (advisory qualifier) orthogonal to which rung's percentage gets
  cited.
