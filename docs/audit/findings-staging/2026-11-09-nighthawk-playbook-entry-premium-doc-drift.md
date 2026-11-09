# 2026-11-09: PlaybookPlay.entry_premium doc comment stale at the pre-PR-N15 $20 cap, 15+ since the live cap was raised to $35

> **kind:** `FINDING`

| **Status** | FIXED — this PR. |
|---|---|

## Summary

`src/features/nighthawk/lib/types.ts`'s `PlaybookPlay.entry_premium` field carried a TSDoc comment
reading `/** Per-share option entry premium (must be ≤ $20). */`, but the actual, currently-enforced
ceiling (`MAX_OPTION_PREMIUM_PER_SHARE` in `src/features/nighthawk/lib/constants.ts`, and the
`PLAYBOOK_PREMIUM_CAP_LINE` prompt string built from it) is **$35**, not $20 — it was deliberately
raised via PR-N15, per that constant's own in-code comment: "Raised from $20 to $35 (PR-N15): the
$20 cap blocked every ATM option on stocks above ~$250, silently eliminating the strongest
institutional-flow names from the playbook." The doc comment on the type was never updated when the
cap was raised. Found and adversarially confirmed by this cycle's live 5-engine audit.

## Root cause

A doc comment duplicating a numeric business rule (the dollar cap) in prose, with no mechanism
tying it to the actual exported constant that enforces that rule. When `MAX_OPTION_PREMIUM_PER_SHARE`
was deliberately raised 20 → 35 (PR-N15), nothing forced the TSDoc on `PlaybookPlay.entry_premium`
to move with it, so the comment silently drifted stale while the enforced behavior changed under it.

A repo-wide `grep -rn "≤ \$20|<= \$20|\$20/share"` across `src/` found exactly one stale reference —
this one — confirming the drift is isolated to this single doc comment and not a wider inconsistency.

## Evidence

- `src/features/nighthawk/lib/constants.ts:111`: `export const MAX_OPTION_PREMIUM_PER_SHARE = 35;`
  — the live, currently-enforced value, with `PLAYBOOK_PREMIUM_CAP_LINE` (constants.ts:114) built
  from it reading "Entry option premium MUST be ≤ $35/share... If no suitable contract exists under
  this cap, skip the ticker and substitute the next-ranked candidate."
- Live confirmation the $35 figure is what's actually enforced, not the stale $20: a real
  `GET /api/market/nighthawk/edition?date=2026-11-04` response served a TLN play with
  `entry_premium: 22.6, premium_cap_ok: true` — 22.6 is above $20 but at/under $35, proving the
  system correctly enforces the $35 cap today. This is purely a stale doc-comment bug, never a
  live enforcement defect — no production behavior changes with this fix.
- This exact drift class bit the repo before: a 2026-10-24 FINDINGS.md entry describes
  `scripts/full-site-deep-audit.mjs` having its own stale `entry_premium > 20` literal, fixed by
  pinning a local constant plus a cross-check regression test — but that fix only ever touched the
  audit script, never this `types.ts` doc comment, which kept drifting independently.

### RED → GREEN

RED (pre-fix): `npx tsx --experimental-test-module-mocks --test src/features/nighthawk/lib/types.test.ts`
failed — `types.ts's entry_premium doc comment says $20, but the live enforced cap (constants.ts
MAX_OPTION_PREMIUM_PER_SHARE) is $35`.

GREEN (post-fix): same test passes; full `src/features/nighthawk/lib/*.test.ts` suite —
1614/1614 pass, 0 fail; `npx tsc --noEmit` clean. All run on Node 20.20.2 per this repo's
environment-realities note.

## Fix

1. Updated the doc comment on `PlaybookPlay.entry_premium` (`types.ts`) to say $35, and to name
   `MAX_OPTION_PREMIUM_PER_SHARE`/PR-N15 so a future reader finds the real source of truth instead
   of a hand-copied number.
2. Added `src/features/nighthawk/lib/types.test.ts`, a regression test in this repo's established
   source-scan idiom (`readFileSync` + regex, same pattern as `nighthawk-pinning-contract.test.ts`
   and `db.test.ts`, used because this property has no runtime behavior to exercise directly — it's
   a relationship between a doc comment's prose and an exported constant's value). It extracts the
   dollar figure quoted in each file via regex (never a literal hand-copied on either side of the
   assertion) and asserts they're equal. This closes the recurring drift class: if
   `MAX_OPTION_PREMIUM_PER_SHARE` is ever changed again (e.g. raised to $50), this test fails the
   moment that happens, until the doc comment is updated to match — rather than the two silently
   diverging again for weeks, as happened here.

### Fix rationale

Scoped to exactly the one doc comment named in the finding, per the task's own instruction — did
not touch `constants.ts`'s actual enforced value, `PLAYBOOK_PREMIUM_CAP_LINE`, or
`scripts/full-site-deep-audit.mjs` (which already has its own, separate cross-check test from the
2026-10-24 fix). Considered a `{@link MAX_OPTION_PREMIUM_PER_SHARE}` TSDoc tag instead of a plain
dollar literal, but no other doc comment in this file uses `{@link}` for a cross-file constant
reference (checked: every doc comment in `types.ts` that references another file names it in plain
prose — e.g. "the value the publish gate G-N2 already measured and pinned (publish-gates.ts:226..."
on `target_atr_multiple`), so a plain dollar figure plus a named-constant pointer in prose matches
the file's existing convention rather than introducing a new one.

## Blast radius

One doc comment, one new test file. `entry_premium`'s actual runtime value and enforcement are
untouched — `pickChainContract`/the publish gates/the live board all already correctly enforce $35
and did before this fix; only the comment describing that enforcement to a future reader (and any
tool, including Largo, that might read TSDoc for context) was wrong.
