## Ask Largo swing brief's shared "is this gate text moot?" check missed 2 of 4 dead-entry states, letting a WATCH brief imply clearing a gate would reopen entry when it wouldn't

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief — `deadPlayReason` (`src/lib/swing/entry-enterability.ts`), consumed by 4 renderers |
| **Severity** | P3 (member-facing narrative correctness — a false-implication bug, same class already fixed 3 times for other dead-entry states) |
| **Status** | FIXED — `fix/swing-entry-enterability-dead-states` |

### Root cause

`deadPlayReason` is the shared check four Largo-facing renderers gate on to know when a WATCH
play's entry mechanics are already moot, independent of gate state — so they can avoid implying
"clearing this gate reopens entry" when it wouldn't. `evaluateSwingEntryEnterability`'s real
decision engine can return `dont_buy` for 4 distinct dead-entry states — INVALIDATED,
deadline-expired, contract-expired (`entryStatus === "EXPIRED"`), and extended-chase
(`setupState === "EXTENDED"` or `entryStatus === "EXTENDED_CHASE"`) — but `deadPlayReason` only
ever recognized the first two.

`entry-verdict.ts`'s own in-code comment on its `dont_buy` branch already documented that
`gateBlocks` stays populated "regardless of which dont_buy reason fired (deadline-expired,
contract-expired, extended-chase)" — the engine itself knew all 3 non-invalidated dead reasons
could coexist with live gate evidence. The shared moot-check consumers were only ever updated for
2 of them.

### Evidence

Confirmed `SwingEntryState` (`taxonomy.ts`) is a real union type including `"EXTENDED_CHASE"` and
`"EXPIRED"`, and `SwingSetupState` includes `"EXTENDED"`. Confirmed 4 real call sites of
`deadPlayReason`: `watchEntrySection` (`play-brief.ts:403`), the top-level Invalidation callout
(`play-brief.ts:879`, `bucket === "watch"` branch), `entryTriggerDeadReason`
(`play-brief-intel.ts:735`), and `gateBlockCoaching` (`play-brief-narrative-coaching.ts:213`).
Both `entryStatus` and `setupState` are already rendered as raw facts by `watchEntrySection`
("Setup: **EXTENDED**" / "Entry geometry: **EXPIRED**"), so a WATCH brief could show one of those
labels alongside an un-qualified "**Gates blocking entry:**" header — the same false implication
already fixed for INVALIDATED (2026-09-14) and deadline-expired (2026-09-17), just never extended
to these two.

### Blast radius

Single function fix (`deadPlayReason`) propagates correctly to all 4 call sites without touching
any of them — each already treats a non-null `deadPlayReason` result as "entry is moot", so
recognizing the 2 additional states there fixes all 4 renderers at once.

### Fix rationale

Extended `deadPlayReason`'s existing if-chain with two more checks, mirroring the exact pattern
already used for INVALIDATED/deadline-expired: `entryStatus === "EXPIRED"` → "contract expired";
`setupState === "EXTENDED" || entryStatus === "EXTENDED_CHASE"` → "extended past the valid entry
window". Added `entryStatus` to the function's narrow structural parameter type (kept deliberately
minimal, not the full `TerminalPlay`, per the function's own existing dependency-cycle-avoidance
convention).

### Verification

- Independent RED→GREEN (reverted only the source file, kept the tests):
  `npx tsx --experimental-test-module-mocks --test src/lib/swing/entry-enterability.test.ts` —
  3/21 failed with source reverted, exactly the new assertions. Reapplied — 21/21 pass.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/entry-enterability.test.ts
  src/lib/swing/play-brief.test.ts src/lib/swing/play-brief-intel.test.ts
  src/lib/swing/play-brief-narrative-coaching.test.ts src/lib/swing/entry-verdict.test.ts` —
  364/364 pass.
- `npx tsc --noEmit` — clean.
- Full `npm test` (Node 20) — 14614/14617 pass, 0 fail, 3 pre-existing skips.
