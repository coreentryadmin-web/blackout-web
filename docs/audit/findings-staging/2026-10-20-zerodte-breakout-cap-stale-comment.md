## `src/lib/zerodte/breakout-cap.ts` — two comments still say `0.30` after `POOL_PCT` moved to `0.4`

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | REPORTED, NOT FIXED — in the zerodte owned lane, left for that lane to fix |
| **Severity** | P4 (comment-only drift — logic is correct, reads the live constant) |
| **Surface** | `src/lib/zerodte/breakout-cap.ts` |

### What's wrong

DISCOVERY-lane re-verification sweep (checking an old FINDINGS.md/INTENTIONAL-DESIGN.md claim
against current `main`) surfaced this while reading the file, separate from what was being
checked. `POOL_PCT` was deliberately raised from `0.30` to `0.40` (the file's own top-of-file
note, line 37: `"ceiling raised 150→220 and POOL_PCT 0.30→0.40"`), and the constant itself is
correctly `0.4` (line 47). But two other comments in the same file still read the old `0.30`:

```
11: // FORMULA: N = clamp(ceil(qualifying * 0.30), floor, ceiling). floor=40 preserves today's worst-case
...
97:  * - Enabled (default): `max(floor, min(ceiling, ceil(qualifyingMovers * 0.30)))` — a thin day never
```

The actual computation (line 116, `Math.ceil(args.qualifyingMovers * POOL_PCT)`) reads the live
`POOL_PCT` constant, so there is **no behavior bug** — a future reader relying on the comment's
literal formula to reason about the cap size would get the wrong number, though.

### Fix (for the owning lane)

Update both comments from `0.30` to `0.40` to match `POOL_PCT`'s current value. One-line-each,
self-contained, zero behavior change — not done here since the file is in the zerodte owned lane.
