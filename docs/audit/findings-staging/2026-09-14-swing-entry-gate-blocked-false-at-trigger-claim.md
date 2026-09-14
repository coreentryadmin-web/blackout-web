> **kind:** FINDING

## Ask Largo swing brief claimed a FORMING/PRE_TRIGGER play was "At trigger" whenever it was also gate-blocked — a factually wrong claim contradicted by the brief's own entry-geometry field — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `evaluateSwingEntryEnterability` (`src/lib/swing/entry-enterability.ts`) is an
if-chain that returns the member-facing entry verdict for a swing play. The gate-blocked check
(`gateBlocked.length > 0`) sat as an unconditional early return, evaluated BEFORE the `setup ===
"FORMING"` check and before the `setup === "TRIGGERED" && entry === "PRE_TRIGGER"` check further
down the same function. Gates are evaluated independently of setup/entry maturity, so a play that
has not yet reached its trigger can ALSO be gate-blocked — and when it was, the old code returned
`"At trigger, but commit gates have not cleared — wait before sizing."` regardless of whether the
play had actually triggered. This claim flows straight into `entry-verdict.ts`'s `recNote`, which
both the Verdict headline and the "Trade manager read" narrative section render verbatim.

**Evidence (live reproduction, 2026-09-14, PLTR):** pulled PLTR's live play-brief. The brief's own
"Trade manager read" / Verdict text read:

> At trigger, but commit gates have not cleared — wait before sizing.

But the SAME brief's own fields, a few lines away, stated the opposite:

> Entry geometry: **PRE_TRIGGER**
> Setup: **FORMING**

The play had explicitly NOT reached its trigger price (167.23) — yet the headline asserted it was
"at trigger." A member reading only the headline would reasonably conclude the setup had already
fired and was merely waiting on gate clearance, when in fact price itself hadn't gotten there yet.
Traced to `entry-enterability.ts`'s if-chain ordering: the gate-blocked check (line ~208, pre-fix)
preceded both the FORMING check (line ~216) and the PRE_TRIGGER check (line ~245), so it fired
first for ANY gate-blocked play regardless of setup/entry state.

Existing test coverage (`entry-enterability.test.ts`'s "commit gate block → wait") only exercised
`setupState: "TRIGGERED", entryStatus: "AT_TRIGGER"` — exactly the one case where "At trigger..."
IS accurate — so it never caught the FORMING/PRE_TRIGGER combination.

**Blast radius:** single function — `evaluateSwingEntryEnterability` is the one place this reason
text is generated; every renderer (Verdict headline, "Trade manager read" narrative) reads its
output, so the fix propagates everywhere the text is shown. No other function independently
computes this claim.

**Fix:** moved the gate-blocked check to be scoped INSIDE the branch that already confirms
`setup === "TRIGGERED" && entry` is one of the enterable states (`AT_TRIGGER`/`PULLBACK_TO_ENTRY`)
— i.e., exactly the branch that would otherwise return `buy`/`still_buy`. The check now only ever
fires when the play genuinely IS at trigger and gates are the one remaining blocker, which is the
only case where the "At trigger, but commit gates..." wording is true. The FORMING and PRE_TRIGGER
checks (which have their own accurate, gate-agnostic wording) now run first when applicable, so a
not-yet-triggered gate-blocked play correctly reads "Thesis is still building..." or "Waiting for
price to reach the trigger..." instead.

**Fix rationale:** reordering rather than rewriting keeps every other branch's return values
byte-identical — the two existing gate-blocked tests (`TRIGGERED`+`AT_TRIGGER`) still pass
unchanged, confirming no regression on the one case the old ordering got right. An alternative
(appending a gate-blocked note onto the FORMING/PRE_TRIGGER reason text) was considered and
rejected as unnecessary scope: those states already correctly withhold entry regardless of gate
status, so mentioning gates there would add information without changing the recommendation, and
risks its own wording drift later. Scoping the check to only the branch it's actually true for is
the minimal, correct fix.

**Test:** RED→GREEN proven (git-stashed the source fix only, confirmed both new tests fail without
it — `"At trigger, but commit gates have not cleared"` returned for a FORMING and a
TRIGGERED+PRE_TRIGGER input — restored and confirmed green). Added 2 new tests: FORMING +
gate-blocked → reason matches `/still building/i`, never `/at trigger/i`; TRIGGERED + PRE_TRIGGER +
gate-blocked → reason matches `/trigger/i` (the "waiting for price" wording) but never
`/at trigger/i`. Full `src/lib/swing/*.test.ts` (1119 tests) green, `tsc --noEmit` and `eslint`
clean.
