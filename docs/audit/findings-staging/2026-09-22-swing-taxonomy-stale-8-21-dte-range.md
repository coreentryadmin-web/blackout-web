> **kind:** FINDING

# `taxonomy.ts`'s STANDARD-lane docs still quoted the pre-2026-09-04 "8–21 DTE" range

| | |
|---|---|
| **Status** | FIXED |
| **Date** | 2026-09-22 |
| **Severity** | P4 (documentation/comment accuracy — no code consumer, zero runtime behavior change) |
| **Surface** | Night Hawk Swings — `src/lib/swing/taxonomy.ts` |

## Root cause

`taxonomy.ts` itself documents (its own header comment) that Swing's DTE ceiling was narrowed
5–30 → 5–15 on 2026-09-04 ("EXTENDED retired 2026-09-04 when Swing Command narrowed to 5–15 DTE").
Two prose strings in the same file were never updated to match:

1. The file's own top-of-file header comment: `"the three contract sub-lanes (2–7 / 8–21 / 22–30 DTE
   are NOT one contract class..."` — stale on BOTH ends (TACTICAL's floor moved 2→5 on the earlier
   2026-08-06 floor move, and STANDARD's ceiling moved 21→15 on the 2026-09-04 narrowing this same
   file names).
2. `SWING_SUB_LANES.STANDARD.contract.note`: `"directional 8–21d, breakeven inside target"` — same
   stale 21, contradicting `STANDARD.dteMax` (`HORIZONS.SWING.dteMax = 15`) a few lines above it in
   the exact same object literal.

Grepped the whole repo for `ContractPreference` (the type carrying `.note`): **zero consumers**
outside `horizons.ts`/`taxonomy.ts` themselves — this field is never rendered to a member or read by
any Largo tool, so this never reached production. But it directly contradicts this same file's own
`dteMin`/`dteMax` values a few lines above, and would mislead any future reader (human or AI) taking
the note at face value — exactly the class of drift `horizons.ts`'s own `dteRangeLabel()` helper was
built to prevent for member-facing copy (FINDINGS 2026-08-07), just not extended to this internal
data field or the header prose.

A third, harmless instance: `contract-ranker.test.ts`'s own descriptive comment on its `mkContract`
test fixture also said "8–21 DTE" (the fixture's actual `dte: 14` default was never wrong — only the
comment describing it was stale). Fixed alongside for consistency since it's the identical drift.

## Fix

- `taxonomy.ts` header comment: `2–7 / 8–21 / 22–30` → `5–7 / 8–15 / 22–30`.
- `SWING_SUB_LANES.STANDARD.contract.note`: `"directional 8–21d..."` → `"directional 8–15d..."`.
- `contract-ranker.test.ts` comment: `8–21 DTE` → `8–15 DTE`.
- New regression test in `taxonomy.test.ts`: parses the `<n>–<n>d` DTE range embedded in each
  sub-lane's `contract.note` and asserts it equals that lane's real `dteMin`/`dteMax` — a ratchet so
  a future DTE-window change (like the 2026-09-04 narrowing) that updates the numeric fields without
  updating the prose fails loudly here instead of drifting silently again.

RED confirmed via `git stash` (test fails: `21 !== 15`); GREEN after restoring. `npx tsc --noEmit`
clean. Full `taxonomy.test.ts` + `contract-ranker.test.ts` sweep: 19/19 pass.

## Blast radius

Three string literals + one new test. No type/shape/behavior change — `contract.note` has no
consumers, and the header comment is prose. Zero risk to any live path.

## Fix rationale

Chose a parsing ratchet test over just fixing the strings, because this is the SECOND time this
exact class of bug has hit this codebase in this immediate area (the 2026-08-06/2026-09-04 DTE
window moves left stale copy behind at least three times now, per `horizons.ts`'s own
`dteRangeLabel()` fix note) — a test that structurally can't pass while the note disagrees with the
real DTE window is cheaper than relying on the next reviewer to notice by eye again.
