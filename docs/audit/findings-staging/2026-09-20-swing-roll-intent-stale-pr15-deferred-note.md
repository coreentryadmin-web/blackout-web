## Swing `detectRollCandidate`'s reason string falsely claimed roll execution was still deferred to PR-15 — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing engine — `detectRollCandidate` (`src/lib/swing/manage.ts`) |
| **Severity** | P4 (internal API contract hygiene — no live member-facing blast radius, verified) |
| **Status** | FIXED |

### Root cause

`detectRollCandidate` (PR-7, `manage.ts`) predates `roll.ts`'s roll EXECUTOR (PR-15, described in
`roll.ts`'s own header as "the FINAL swing engine PR", fully implemented with an all-or-nothing
transactional child-insert + parent-grade guard). When PR-7 shipped, a roll was genuinely
intent-only — nothing acted on it yet — so `detectRollCandidate`'s positive-case return literally
said:

```
reason: `roll intent — ${migration.reason} (INTENT ONLY; execution deferred to PR-15)`
```

PR-15 has since shipped and is live: `roll.ts`'s `decideRollAction`/`closeAndRollSwingPosition` read
`verdict.rollIntent.roll` on every management tick and actually execute the roll (freeze+close the
parent as ROLLED, open a linked child) when it fires. The reason string was never updated — it kept
asserting the opposite of what the shipped system does.

### Evidence

Confirmed via `roll.ts`'s own header and `decideRollAction` (line 157, `return { action: "ROLL",
reason: \`gating rung '${verdict.rung}' with a still-valid-thesis roll — ${verdict.rollIntent.reason}\`
}`) — this executor is fully implemented and reads `rollIntent.roll` as its authoritative signal,
proving PR-15 is not deferred.

Two SEPARATE call sites already independently discovered this exact staleness and worked around it
rather than fixing it at the source: `live-plays.ts` (`manageObservablesFromEvent`) and
`horizon-plays.ts` (`HorizonPlay.rollCandidate`'s own doc comment) both explicitly route
member-facing prose through `dteMigration.reason` (member-clean) instead of `rollIntent.reason`
verbatim, each with its own comment naming the stale "(INTENT ONLY; execution deferred to PR-15)"
text as the reason why. So **no member ever actually saw this string** — traced the full path
(`play-brief.ts:150`'s "Roll watch" line, the only place `TerminalPlay.rollCandidate.reason` is
rendered) and confirmed it always receives the clean `dteMigration.reason`, never the raw
`rollIntent.reason`. Also traced `roll.ts`'s own `RollOutcome.reason` (which does embed the stale
string verbatim via `decideRollAction`) through its one consumer,
`swing-active-refresh/route.ts`'s Discord terminal notification (`notifySwingTerminalFromOutcome`,
`discord-trade-notify.ts`) — that function uses `roll.action`/`roll.childId`/`roll.parentGraded` to
drive the notification flow but never quotes `roll.reason` in the actual Discord message text, so
that path is also clean.

### Blast radius

Zero live blast radius today (confirmed both consumer paths above are unaffected) — this is a
genuinely-false internal string and two docstrings, not a currently-visible defect. Worth fixing
anyway: it is verifiably false information sitting in an internal API contract other code could
reasonably start consuming directly in the future (the two existing workarounds exist specifically
*because* engineers already had to notice and route around this), and `roll.ts`'s own
`decideRollAction` embeds it verbatim in its ROLL action's internal reason today.

### Fix rationale

Removed the `(INTENT ONLY; execution deferred to PR-15)` suffix from `detectRollCandidate`'s
positive-case reason string and updated its docstring to describe the current, accurate state (PR-15
shipped, `roll.ts` is the live executor). Left the `live-plays.ts`/`horizon-plays.ts` preference for
`dteMigration.reason` over `rollIntent.reason` completely unchanged — that routing is still the right
call regardless of this fix, since any snapshot row persisted **before** this fix still carries the
old stale text frozen in its stored `event_json` forever (a historical DB row is never rewritten), so
a future read of an old row's `rollIntent.reason` would still be stale. Updated both files' comments
to state this precisely, rather than removing them (the workaround itself must stay).

### Tests

One new test in `manage.test.ts` asserting the reason string never matches `/INTENT ONLY|deferred to
PR-15/`. RED→GREEN proven via `git stash` isolating the source fix from the test: reverting only
`manage.ts` reproduces exactly 1 failure (the new test); restoring the fix returns to 19/19 pass in
that file. Also ran `live-plays.test.ts`/`horizon-plays.test.ts`/`roll.test.ts` (the three files whose
comments referenced this staleness) — 75/75 pass, no regressions (none of them assert on this exact
string). `npx tsc --noEmit`: clean. Full `npm test` (Node 20): 14894 pass / 0 fail / 3 skipped
(pre-existing, unrelated).
