> **kind:** FINDING

# Helix flow table: toggling the Time column to ascending never changed the row order — FIXED

| | |
|---|---|
| **Area** | Helix — `/flows` desk, desktop print table |
| **Status** | FIXED |
| **Severity** | P3 (correctness/UX — a control silently does nothing) |
| **File** | `src/features/helix/components/HelixFlowTable.tsx` |

## Root cause

`HelixFlowTable`'s own `filtered` useMemo special-cased the Time column:

```ts
const filtered = useMemo(() => {
  const base = typeFilter === "ALL" ? typed : typed.filter((f) => f.option_type?.toUpperCase() === typeFilter);
  if (sortKey === "time") return sortFlows(base, "time", "desc");
  return sortFlows(base, sortKey, sortDir);
}, [typed, typeFilter, sortKey, sortDir]);
```

Every OTHER sortable column (`ticker`, `premium`, `strike`, `score`, `dte`, `expiry`) passes the
live `sortDir` state through to `sortFlows` and sorts correctly in both directions — `sortFlows`
itself has always honored `"asc"` correctly for every key including `"time"` (see the existing
"sortFlows orders premium descending" test, and `cmp(...) * mul` in the switch). Only `"time"`,
which happens to be both the DEFAULT sort key and the only column rendering a live ▲/▼ indicator
driven by `sortDir`, was hard-forced to `"desc"` regardless of what the user had just clicked.

`toggleSort("time")` runs the exact same code path as every other column — it flips `sortDir`
between `"asc"`/`"desc"` in state and the header's `aria-sort` + ▲/▼ glyph update immediately — but
the actual row order underneath never moved, because `filtered` threw the direction away one line
later. The control read as live (the arrow visibly flips) while doing nothing to the data it
describes.

**Secondary symptom, same root cause:** `isNew = i === 0 && sortKey === "time" && sortDir === "desc"`
(the "flash the newest print" highlight) went dark the instant a member toggled to ascending, even
though — because the real order never changed — row 0 was *still* the newest print. The highlight
logic was reading `sortDir` honestly; the bug just made that state lie about what was on screen.

Present since the initial migration commit (`a05cf3245`, #770) — there is no later commit that
introduced the `if (sortKey === "time") ...` branch deliberately, and nothing in the file's
otherwise extensive inline commentary (which documents several OTHER deliberate design choices in
this exact component) explains or defends it.

## Evidence

Added `filterAndSortFlowsForTape` (the exact filter+sort pipeline, pulled out of the component so
it is testable without rendering it) to `src/features/helix/lib/helix-flow-format.ts`, with a RED→
GREEN regression test in `helix-flow-format.test.ts`:

```ts
test("filterAndSortFlowsForTape honors ascending order on the time column (regression)", () => {
  const rows = [
    flow({ ticker: "OLDEST", alerted_at: "2026-07-11T14:00:00.000Z" }),
    flow({ ticker: "NEWEST", alerted_at: "2026-07-11T16:00:00.000Z" }),
    flow({ ticker: "MIDDLE", alerted_at: "2026-07-11T15:00:00.000Z" }),
  ];
  const asc = filterAndSortFlowsForTape(rows, "ALL", "time", "asc");
  assert.deepEqual(asc.map((r) => r.ticker), ["OLDEST", "MIDDLE", "NEWEST"]);
  // ...desc case too
});
```

- **Before the fix** (re-adding the old `if (sortKey === "time") return sortFlows(base, "time",
  "desc");` branch to the extracted function, run via `npx tsx --experimental-test-module-mocks
  --test src/features/helix/lib/helix-flow-format.test.ts`): **27 pass / 1 FAIL** — the new
  regression test failed with the rows still in newest-first order under an explicit `"asc"` sort.
- **After the fix**: **28 pass / 0 fail.**
- Full `src/features/helix/lib/*.test.ts src/features/helix/components/*.test.*` run: **354 pass /
  0 fail** (no regression elsewhere).
- `tsc --noEmit`: clean.
- `eslint` on the three touched files: 0 errors, 2 pre-existing warnings unrelated to this change
  (an a11y warning on an unrelated row in the same file, present before this diff).

## Blast radius

Single call site. `sortFlows` itself was never wrong and is unchanged. No other component imports
or duplicates this filter+sort logic (`HelixMobileFlowTape.tsx`, the mobile sibling, filters/sorts
its own tape independently and was not checked as part of this fix — out of scope for this finding,
worth a look separately). The `isNew` "flash" flag needed no code change: it was already reading
`sortDir` correctly, it only ever *looked* buggy because the row order was lying to it.

## Fix rationale

Removed the special case entirely rather than, say, making the override conditional on something
else — nothing in the surrounding code or comments suggested the `"desc"`-forcing was intentional,
and the one-line removal makes the Time column behave exactly like every sibling sortable column
(user's `sortDir` state drives the actual order, full stop). Extracted the combined
filter+sort pipeline (`typed` → type filter → `sortFlows`) into a new pure, exported
`filterAndSortFlowsForTape` in `helix-flow-format.ts` rather than fixing the one line in place,
because the component itself has no test coverage (it renders via `useVirtualizer` and framer-
motion, same reason every other Helix component in this lane tests via extracted pure helpers, per
`HighScorePrints.test.ts`'s `scoreTone`/`rowStyle` pattern) — this was the only way to pin the fix
with a real RED→GREEN test rather than asserting it by inspection.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PzDkDzjR3bJQsFbXENzsVz
