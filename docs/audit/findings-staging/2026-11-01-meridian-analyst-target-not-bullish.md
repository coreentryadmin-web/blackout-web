> **kind:** FINDING

## Meridian earnings report: a direction-less "price target" mention was counted as a bullish analyst signal — FIXED

**Status:** FIXED (PR, see commit `fix/meridian-analyst-target-not-bullish`)

### Root cause

`buildMeridianEarningsReport`'s `analystLean()` (`src/lib/meridian/meridian-earnings-report-core.ts`)
scored the Street/analyst pillar from each `analyst_revisions[].action`:

```ts
if (a === "upgrade" || a === "target") up += 1;
else if (a === "downgrade") down += 1;
```

`action` is produced by `shapeAnalyst` (`src/lib/meridian/meridian-catalyst-enrich.ts`), which
classifies a Benzinga analyst-note headline by checking keyword branches **in order**:

```ts
if (/upgrade|raises|lift/i.test(title)) action = "upgrade";
else if (/downgrade|cut|lower/i.test(title)) action = "downgrade";
else if (/initiat/i.test(title)) action = "initiation";
else if (/price target|pt /i.test(title)) action = "target";
else if (/reiterat|maintain|affirm/i.test(title)) action = "reiterate";
```

`action === "target"` is reached **only** as a fallback — a headline that mentions a price target
but did NOT already match a raise/lower/upgrade/downgrade/initiation keyword. A real raise
("Firm Raises Price Target to $150") matches the `upgrade` branch and never reaches `"target"`; a
real lower matches `downgrade` and never reaches it either. So by construction, every row that
arrives at `analystLean` with `action === "target"` is a headline whose **direction the classifier
could not determine** — e.g. "Firm Sets $100 Price Target" (initiating a target with no
raise/lower verb) or "Firm Maintains $100 Price Target" (the "price target" phrase is checked
before the "maintain" branch, so it never reaches `"reiterate"` either).

`analystLean` nonetheless counted every `"target"` row as equivalent to an `"upgrade"` — i.e. it
treated "a price target was mentioned" as "the price target was raised" (bullish), with no actual
evidence of direction.

### Evidence

Reproduced directly against `buildMeridianEarningsReport` (before the fix):

```json
// analyst_revisions: [{ title: "Firm Sets $100 Price Target", action: "target" }]
{
  "pillar": "analyst",
  "label": "Street / analysts",
  "lean": "bullish",
  "weight": 1,
  "detail": "1 recent analyst actions skew positive",
  "score": 1
}
```

A headline that carries zero directional information produced a `"bullish"` lean and a `score: 1`
signal, labeled "skew positive" — a fabricated bullish read. This pillar (`weight: 1`) feeds
directly into the composite `score` that drives the report's `verdict`, `confidence`, `headline`,
and `best_play` — a member reading the Meridian earnings desk for this ticker would see an
analyst-pillar bullish tick, and (on a name with otherwise-neutral pillars) could see the whole
report tip into a `"bullish"` verdict, off a headline that said nothing about direction at all.

After the fix, the same input:

```json
{
  "pillar": "analyst",
  "label": "Street / analysts",
  "lean": "neutral",
  "weight": 1,
  "detail": "1 analyst notes — mixed",
  "score": 0
}
```

### Blast radius

`analystLean` has exactly one call site (`buildMeridianEarningsReport`, same file) and
`action === "target"` has exactly one consumer repo-wide (the line fixed here — confirmed via
`grep -rn '"target"' src/lib/meridian src/features/meridian`). No other pillar, panel, or Largo
tool reads `MeridianAnalystRevision.action === "target"` as a direction, so this fix is fully
contained to the one pillar score it was corrupting.

### Fix rationale

Removed `"target"` from the bullish (`up`) branch so it is treated the same as `"initiation"` —
counted in `revisions.length` for the "N analyst notes — mixed" neutral detail, but never scored
as a direction. This mirrors how `"reiterate"` (also direction-ambiguous) is already handled — it
was never counted either. `"upgrade"`/`"downgrade"` are unchanged (confirmed by a regression test
that a real upgrade still scores bullish). No change to `shapeAnalyst`'s classification itself —
that fallback naming ("target") is accurate for what it is (a target mention with no determinable
direction); the bug was solely in how the *consumer* scored it.

### Test

`src/lib/meridian/meridian-earnings-report-core.test.ts` — three new cases:
- a single `action:"target"` revision stays `neutral`/`score:0` (RED before the fix: `bullish`/`1`).
- two `action:"target"` revisions still stay `neutral`/`score:0`.
- a real `action:"upgrade"` revision still scores `bullish`/`1` (regression guard, unchanged).

Confirmed RED→GREEN: reverted the one-line fix (`git stash`), re-ran the suite — 2 of 18 tests
failed exactly as expected; restored the fix — 18/18 pass. `tsc --noEmit` clean.
