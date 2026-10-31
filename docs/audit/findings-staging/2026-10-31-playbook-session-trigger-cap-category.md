> **kind:** FINDING

## `classifyGateBlock` miscategorizes playbook session-trigger-cap block as "quality" instead of "risk" — FIXED

**Status:** Fixed, regression test added (`src/features/spx/lib/playbook-gate-categories.test.ts`).

### Root cause

`trade-governor.ts` pushes `` `Playbook ${input.playbook_id} session trigger cap (${max})` ``
(line ~153) when a playbook has fired its maximum allowed triggers for the session — a
session-level risk cap, functionally the same kind of block as the two sibling session caps a
few lines above it:

```ts
blocks.push(`Session entry cap (${maxEntries}) — stand down for today`);   // line ~99
blocks.push(`Session loss cap (${maxLosses}) — revenge-trading lockout`);  // line ~104
...
blocks.push(`Playbook ${input.playbook_id} session trigger cap (${max})`); // line ~153
```

`playbook-gate-categories.ts`'s `classifyGateBlock` correctly routes the first two to `"risk"`
via its `/Session entry cap/i` and `/Session loss cap/i` patterns. The playbook-trigger-cap
message does not match any of `classifyGateBlock`'s `operational` / `playbook_validity` / `risk`
regexes — in particular it does not match `/Session entry cap/i` or `/Session loss cap/i`
(the message starts with `"Playbook"`, not `"Session"`) — so it silently falls through to the
function's default `"quality"` bucket.

This makes `gates.blocks_by_category` / `first_block_category` incoherent with the real nature
of the block: a session risk-management cap is reported in the payload as a mere `"quality"`
issue, and if it is the only block present, `first_block_category` reads `"quality"` instead of
`"risk"` even though the block is semantically identical to the two sibling caps that ARE tagged
`"risk"`.

Reachable only when `PLAYBOOK_LIVE_GATE=1` (default `false` in prod) and a specific playbook's
trigger count has reached `playbookSessionMaxTriggersPerPb()` for the session — this is a
reproducible, deterministic code defect independent of live data or market hours; live
reachability of the `PLAYBOOK_LIVE_GATE` flag was not checked as part of this fix (irrelevant to
whether the classifier itself is wrong).

### Evidence

Direct execution against the real function, before the fix:

```
classifyGateBlock("Playbook PB-01 session trigger cap (3)")       -> "quality"   (wrong)
classifyGateBlock("Session entry cap (3) — stand down for today")  -> "risk"
classifyGateBlock("Session loss cap (2) — revenge-trading lockout") -> "risk"
```

**RED (pre-fix, via a temporary revert of `playbook-gate-categories.ts` only, keeping the new
test):** `src/features/spx/lib/playbook-gate-categories.test.ts` failed exactly as expected —
`AssertionError: expected 'risk', actual 'quality'` on the new playbook-trigger-cap assertion;
4/5 tests in the file still passed (every pre-existing assertion, since the fix touches only one
new branch).

**GREEN (fix restored):** 5/5 tests in `playbook-gate-categories.test.ts` pass
(`npx tsx --experimental-test-module-mocks --test src/features/spx/lib/playbook-gate-categories.test.ts`
on Node 20).

### Blast radius

`classifyGateBlock` is the single source of truth for both `categorizeGateBlocks` (used to build
`gates.blocks_by_category`) and `firstGateBlockCategory` (used to build `first_block_category`) —
both call it internally with no other classification path, so both payload fields are corrected
by this one change with no other call site to touch.

### Fix rationale

Added `/session trigger cap/i` to the existing `risk` pattern list, alongside its two siblings
`/Session entry cap/i` and `/Session loss cap/i`. Chose a case-insensitive substring match (no
`^` anchor) rather than an anchored `/^Playbook .* session trigger cap/i` pattern, because the
risk bucket's existing patterns in this file are already substring matches (`/cooldown/i`,
`/Re-entry lock/i`, `/stand down/i`), not anchored ones, and the literal phrase "session trigger
cap" does not appear in any other gate-block message in the codebase, so a narrower anchor would
add complexity without reducing any real collision risk.

### Deliberately left unchanged

- The `operational` and `playbook_validity` branches — the playbook-trigger-cap message does not
  belong in either category and this fix does not touch them.
- `trade-governor.ts` itself — the message text and the `tier = "halt"` severity it already sets
  are correct; only the categorization of that message string was wrong.
