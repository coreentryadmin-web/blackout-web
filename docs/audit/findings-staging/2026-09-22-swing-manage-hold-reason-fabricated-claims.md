> **kind:** FINDING

## Swing manage engine: fallback HOLD reason claimed unverified premium/time facts — FIXED

| **Status** | FIXED |
|---|---|

**File:** `src/lib/swing/manage.ts` (`evaluateSwingManagement`)

### Root cause

`evaluateSwingManagement`'s own file header states the NULL-HONESTY principle plainly: *"every rung
evaluates ONLY when its own inputs are present; a missing feed skips the rung, never fabricates a
signal... With nothing evaluable we return HOLD/insufficient_data — we do not act on a hollow
read."*

The final fallback branch violated that principle. When no gate/edge rung fired, the function
returned a single hardcoded reason string asserting three specific claims regardless of whether
any of them were actually checked:

```ts
return mk("HOLD", "hold", `thesis intact, premium above the ${SCALE_OUT_RULES.hard_stop_mult}× backstop, ample time — hold`);
```

The gate deciding between this "confident hold" and the honest `insufficient_data` verdict
(`anyEvaluable`) only requires that **some** input among a long list be non-null — not that the
*specific* dimensions named in the reason string (premium, structural/thesis, DTE/lane) were
evaluable. `sessionsHeld` alone (pure date arithmetic off the commit timestamp, essentially always
computable for a real position) is enough to satisfy `anyEvaluable`.

So on a tick where the live mark and underlying-price reads both fail — a documented, recurring
pattern in this repo (provider blips / "board degraded" states referenced repeatedly in
`docs/audit/nighthawk-swings-live-journal.json` and the parallel 0DTE journal; the CBRS:1234
play-brief pulled live this session literally reads *"Vector spot not wired on this tick"*) — the
manager would still emit "thesis intact, premium above the 0.4× backstop, ample time — hold" even
though premium was never usable that tick (no `lastMark`), structural evaluability required
`underlyingPrice`/`structuralStopLevel`/`direction` all present and wasn't (no `underlyingPrice`),
and `thesisBroken` was unknown (`null`, not confirmed `false`).

This reason string is durably written into every management snapshot's `event_json`
(`manage-sync.ts`'s `planManageSync`, "an append-only snapshot carrying the full verdict... so the
desk/grader see WHY") — a fabricated compound claim landing in the audit trail the grader and
future audits read as evidence, the same C6-class violation (LARGO-PRODUCT-CONTRACT.md:
*"confidence must be OMITTED when a product cannot calibrate it... fabricated certainty... is not
[honest]"*) already fixed three times this session in `thesis-health.ts` and once in
`vector-lane-enrich.ts` — a fifth instance, in a different file, same shape: partial data producing
over-confident output text.

### Evidence (RED → GREEN)

Added a regression test: `dossier: LONG_STD` (real direction, non-null) with only `sessionsHeld: 2`
supplied — no `dte`, no `entryPremium`/`lastMark`, no `underlyingPrice`/`structuralStopLevel`, no
advisory flags.

- **Before:** `v.reason === "thesis intact, premium above the 0.4× backstop, ample time — hold"` —
  all three claims fabricated (assertion failure confirmed pre-fix).
- **After:** the reason omits any claim that wasn't actually evaluable.

Added a second regression test confirming the reason is **unchanged** when all three dimensions
genuinely ARE evaluable (the common, real-position case) — proving the fix is additive honesty, not
a behavior change for the normal path.

`manage.test.ts` 22/22. Full collateral suite (`manage-sync-q36/q37`, `roll`, `roll-plan`,
`live-plays`, `play-brief`, `play-brief-narrative`, `thesis-health`, `serving`, `serving-board`,
`serving-ingest`, `serving-lane`) — 395/395. `npx tsc --noEmit` silent.

### Fix

Build the hold reason from only the dimensions actually evaluated this tick:

```ts
const structuralEvaluable =
  numOrNull(input.underlyingPrice) != null &&
  numOrNull(input.structuralStopLevel) != null &&
  input.dossier.direction != null;
const timeEvaluable = spec != null && dte != null;
const holdParts: string[] = [];
if (structuralEvaluable || input.thesisBroken === false) holdParts.push("thesis intact");
if (premiumUsable) holdParts.push(`premium above the ${SCALE_OUT_RULES.hard_stop_mult}× backstop`);
if (timeEvaluable) holdParts.push("ample time");
const holdReason =
  holdParts.length > 0
    ? `${holdParts.join(", ")} — hold`
    : "no gate/edge rung fired this tick on a partial read — hold (null-honesty)";
```

`thesisBroken === false` (not `!= null`) is deliberate: only an explicitly-confirmed-false read
justifies "thesis intact" — `null` means unknown, not confirmed-intact, and by this point in the
function `thesisBroken === true` has already returned via the `thesis_stop` gate above, so `false`
or `null` are the only remaining possibilities.

### Blast radius

Checked whether `verdict.reason` for the `"hold"` rung specifically reaches the member-facing UI:
`play-brief-narrative.ts`'s `trimReasonClause`/`sellReasonClause` (the two functions that render
`manageReasonDetail` into prose) are only invoked for TRIM/SELL recommendations, never HOLD — so
this text is internal (event_json / admin-visible `TerminalPlay.manageReasonDetail`) for the hold
case, not currently narrated to members. Grepped for any other string-matching against the exact
old phrases ("premium above the", "ample time", "thesis intact") — none found outside unrelated
files (0DTE, command-deck labels). Only the final fallback branch changed; every other rung's
reason string, the four capital-preservation gates, and the advisory-rung precedence order are
untouched.

### Fix rationale

Kept the fix additive/conservative: when all three dimensions are genuinely evaluable, the output
is byte-identical to before (proven by the second regression test), so this changes behavior only
in the partial-read case the bug was actually about. Chose to build the reason from evaluated
sub-claims rather than just rewording the empty case, since the bug wasn't limited to the "nothing
at all known" extreme — any ONE-of-three-missing partial state (e.g. premium usable but structural
not) would have silently kept the fabricated claim for whichever dimension WAS missing.
