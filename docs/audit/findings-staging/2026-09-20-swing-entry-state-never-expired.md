> **kind:** FINDING

## Night Hawk Swings — entry-state geometry never recognized an expired contract as EXPIRED — FIXED

| | |
|---|---|
| **Lane** | Night Hawk Swings — entry-execution model (`entry-model.ts`) |
| **Severity** | P2 (member-facing display/trust gap — the enterability gate has an independent backstop, see below) |
| **Status** | FIXED — `src/lib/swing/entry-model.ts` |
| **Found by** | Ask Largo × Night Hawk Swings standing ownership mandate (CLAUDE.md), 2026-09-20 |

### Root cause

`entry-model.ts`'s `deriveEntryPlan`/`deriveEntryState` compute where price sits relative to the
entry trigger (`PRE_TRIGGER`/`AT_TRIGGER`/`PULLBACK_TO_ENTRY`/`EXTENDED_CHASE`) — but never checked
whether the option **contract itself** had already expired. `taxonomy.ts` defines a fifth
`SwingEntryState` value, `"EXPIRED"`, and this file's own `entryReason()` switch has a dedicated
case for it ("contract expired — no entry available") — but nothing in the real pipeline ever
produced that value. Confirmed by repo-wide grep: `deriveEntryState` only ever returns the four
price-vs-trigger states; `swingServingMetaFromDossier` (`serving-ingest.ts`) sets `entryStatus`
directly from `deriveEntryPlan(...).entryState`; banger-lane-merge.ts hardcodes `"AT_TRIGGER"`.
`"EXPIRED"` was unreachable everywhere.

Two separate downstream consumers already had dedicated handling for this state, written under the
(reasonable, but false) assumption that it was real:
- `entry-enterability.ts`'s `deadPlayReason()`: `if (play.entryStatus === "EXPIRED") return "contract expired";`
- `entry-enterability.ts`'s `evaluateSwingEntryEnterability()`: a whole branch returning
  `"Contract expired — no entry on this strike/expiry."`

Both were dead code for this specific case.

### Reachability and severity

This module's own header explicitly names the invariant this bug violates: the entry-validity
**deadline** (a few days, sub-lane-scoped) is a *different clock* from the option's **expiry**
(weeks out), and conflating them was called out as the exact bug this file was built to prevent
("Conflating them let stale setups look enterable for the life of the contract"). The contract-
expiry half of that same distinction was never actually implemented.

This is reachable in practice, not theoretical: the standing
`watch-board-stale-expired-candidates-not-pruned` gap (logged 2026-09-12, still open) already
established that nothing prunes stale WATCH candidates from the board — real board rows were found
sitting 46-49 days past their entry-validity deadline. A WATCH candidate that stale plausibly also
has an underlying contract whose *own* expiry has passed. In that case, `deriveEntryPlan` would
still run the ordinary price-vs-trigger geometry and could report `AT_TRIGGER` — the most
misleading state, implying the setup is live and enterable *right now* — for a contract that is
dead. `play-brief.ts`'s `watchEntrySection` renders this field directly to members: `` `Entry
geometry: **${play.entryStatus}**` ``.

**Why this is P2, not P1/capital-preservation-critical (unlike #5292):** `evaluateSwingEntryEnterability`'s
if-chain checks `pastEntryDeadline` (the entry-validity deadline) *before* the `entryStatus ===
"EXPIRED"` branch. Since `deriveEntryPlan`'s deadline is clamped to strictly before the contract's
expiry (`deadlineMs = expMs - DAY_MS` when the unclamped deadline would land on/after expiry), a
contract that has actually expired always has an entry-validity deadline that is *also* already
past — so the real *gate* (`dont_buy`, "Entry-validity window expired") fires correctly regardless
of this bug. Nobody could actually be routed into entering a dead contract. The bug is purely in
the **displayed geometry label** shown alongside that (correct) gate — a trust/clarity gap, not a
path to a bad trade.

### Evidence

New tests in `src/lib/swing/entry-model.test.ts`:
- `EXPIRED: an already-expired contract reports EXPIRED, not a live price-vs-trigger geometry` —
  price exactly at the trigger (the most misleading case: would read `AT_TRIGGER` pre-fix).
- `EXPIRED: fires exactly at the expiry boundary (asOf === expiry midnight UTC)`.
- `not yet EXPIRED: a contract still (barely) alive keeps normal entry-state geometry` — regression
  guard that the fix doesn't over-fire one day early.

RED→GREEN confirmed directly: both new EXPIRED tests failed before the fix (8/10 pass in the file),
passed after (10/10).

**Blast radius surfaced by running the full suite**: three pre-existing tests across
`serving-ingest.test.ts` and `serving-lane.test.ts` used a hardcoded fixture contract expiry
(`"2026-08-14"`/`"2026-08-07"`) with no pinned `asOf`, silently relying on `Date.now()` always
being earlier than that hardcoded date. Once the fix made contract-expiry checking real, those
fixtures — now genuinely stale relative to the sandbox's real "today" (2026-09-20) — started
correctly reporting `EXPIRED`, which cascaded into `serving.ts`'s section router (`entryStatus ===
"AT_TRIGGER"` no longer matched) and broke `COMMIT_NOW`/`setupState` assertions in three tests. Not
a bug in the fix: each fixture was pinned to an explicit `asOf` matching its own dossier's `asOf`
(`"2026-07-24T14:00:00.000Z"`, before the fixture's contract expiry) — the same convention
`entry-model.test.ts`'s own tests already use throughout. This is itself a small piece of evidence
for the fix's correctness: a test fixture with a stale hardcoded expiry is exactly the shape of bug
this change closes.

Full verification: `entry-model.test.ts` 10/10; `entry-enterability.test.ts` +
`serving-ingest.test.ts` + `entry-verdict.test.ts` + `serving.test.ts` + `thesis-health.test.ts`
83/83; `serving-lane.test.ts` 16/16; whole swing lane (`src/lib/swing/**/*.test.ts`) 1462/1462;
full `npm test` on Node 20, 14918/14921 pass / 0 fail / 3 skip; `npx tsc --noEmit` clean.

### Fix

Added a contract-expiry check to `deriveEntryPlan`, evaluated *first*, before the price-vs-trigger
geometry: when `asOf >= contract.expiry`, short-circuit to `entryState: "EXPIRED"`,
`entryLimitPx: null`, `entryDeadline` set to the expiry timestamp itself, and the existing
`entryReason("EXPIRED", dir)` message — making the already-written downstream handling in
`entry-enterability.ts` finally reachable.

### Fix rationale

Reused the existing `entryReason` switch's `"EXPIRED"` case (already correct, already tested by
neither branch actually firing) rather than writing new reason text — the message was already
right, only the state that would trigger it was missing. Put the check first in the function body
(ahead of `deriveEntryState`) rather than folding it into `deriveEntryState` itself, since
`deriveEntryState` is a small, pure, direction-mirrored geometry function with no contract/expiry
awareness in its signature — adding that concern there would widen its responsibility beyond
"where does price sit vs the trigger."

### Blast radius

Single production call site (`swingServingMetaFromDossier`, `serving-ingest.ts`) reads
`deriveEntryPlan(...).entryState`; every renderer of `entryStatus` (`play-brief.ts`'s
`watchEntrySection`, `entry-enterability.ts`'s two EXPIRED-aware functions, `terminal-display.ts`'s
label humanizer, `thesis-health.ts`'s `entryGeometryScore`) now receives a real, reachable
`"EXPIRED"` value instead of never seeing one. Three pre-existing tests updated (fixture staleness,
not logic changes, see Evidence above) — no other production code path touched.
