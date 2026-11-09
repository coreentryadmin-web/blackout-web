> **kind:** FINDING

## Helix TickerDrawer fabricated a "100% of flow" Put Premium caption on an all-typeless tape — FIXED

| **Status** | FIXED (PR pending) |
|---|---|

**Where:** `src/features/helix/components/TickerDrawer.tsx` (the per-ticker drawer opened from
`/flows`'s tape, dark-pool panel and leaderboards).

**Root cause.** `FlowAlert.option_type` is a bare `string` on the shared type (`src/lib/api.ts`),
not a `"CALL" | "PUT"` union — an UNKNOWN/typeless/malformed print is a real, live-reachable case
documented repeatedly across this codebase as "gap-#6" (`FlowFeed.tsx`,
`NetPremiumLeaderboard.tsx`, `HelixContextHeader.tsx`, `helix-tape-analytics.ts`,
`flow-strike-stacks.ts`, `bie/flow-brief.ts`). The SPX/SPY index feed in particular carries most
premium with no readable `option_type` at all, so a drawer whose visible flows are entirely
typeless is not an edge case.

`TickerDrawer.tsx` already computed this correctly for `callPct`:

```ts
const total = callPrem + putPrem; // 0 when every visible print is typeless
const callPct = total > 0 ? Math.round((callPrem / total) * 100) : null;
```

— and its own header pill, one screen-width away, already respects that `null`:
`{callPct == null ? "—" : `${callPct}% calls`}`.

But the "Put Premium" summary box rendered its percentage inline as:

```tsx
<p>{100 - (callPct ?? 0)}% of flow</p>
```

On an all-typeless tape (`callPrem === 0`, `putPrem === 0`, `total === 0`, `callPct === null`),
this reads `100 - (null ?? 0) = 100 - 0 = 100`. The Put Premium box then rendered **"$0 · 100% of
flow"** directly beside a Call Premium box reading **"$0 · 0% of flow"** for the exact same
population — two captions that sum to 100% while both underlying dollar figures are zero,
fabricating a put-dominant tape out of data that measured nothing on either side. This is the
same "a measured 0 and an unmeasured absence must never render identically" failure the rest of
this file (the header pill) and every sibling panel named above were already fixed to avoid —
just missed at this one render site.

**Evidence (reproduced the exact pre-fix arithmetic):**

```
callPrem = 0, putPrem = 0, total = 0, callPct = null
OLD: 100 - (callPct ?? 0)  === 100   // renders "100% of flow" beside a real $0 figure
```

**Blast radius.** Checked every other `100 - callPct`-shaped complement in the Helix surface
(`grep -rn "100 - (.*callPct"`): `NightHawkFlowPanel.tsx`'s identical-looking
`{100 - callPct}% P` is guarded by `flowData.totalPremium > 0` for its *entire* render branch, so
`callPct` is only ever computed (and read) when the total is already known positive — not
reachable there. `TickerDrawer.tsx`'s own "Call/put bar" section two blocks below the fix is
likewise guarded by `{total > 0 && (...)}`, so it was never affected either. Only the Premium
summary boxes — gated on `displayFlows.length > 0`, a strictly weaker condition than `total > 0`
— had the gap.

**Fix.** Extracted the split to a pure, unit-tested helper,
`src/features/helix/lib/helix-call-put-split.ts`:

```ts
export function callPutSplitPct(callPremium: number, putPremium: number): CallPutSplitPct {
  const total = callPremium + putPremium;
  if (!(total > 0)) return { callPct: null, putPct: null };
  const callPct = Math.round((callPremium / total) * 100);
  return { callPct, putPct: 100 - callPct };
}
```

`putPct` is derived from the SAME total `callPct` is, inside the same guard — the two can never
independently disagree about whether anything was measured. `fmtSplitPct` renders `null` as the
same honest em-dash the header pill already uses, instead of a fabricated `0%`/`100%`. Both
Premium-summary captions in `TickerDrawer.tsx` now call `fmtSplitPct(callPct)` /
`fmtSplitPct(putPct)`. The "Call/put bar" section (already correctly guarded by `total > 0`) is
untouched — within that guard `callPct`/`putPct` are real numbers, so the behaviour there is
byte-identical.

**Why this fix and not an alternative.** Guarding the Premium-summary block on `total > 0` instead
of `displayFlows.length > 0` was considered and rejected: it would make the two Premium boxes
(and therefore `fmtPremium(callPrem)`/`fmtPremium(putPrem)`, both correctly `$0` already) disappear
entirely on an all-typeless tape, hiding the honest "$0 call / $0 put" fact a member browsing a
quiet/typeless ticker is better served seeing than losing the panel outright. Keeping the boxes and
fixing only the percentage caption (the thing that was actually fabricated) is the minimal correct
change, and matches the file's own established convention (the header pill) rather than inventing a
new one.

**Regression test:** `src/features/helix/lib/helix-call-put-split.test.ts` — 6 cases, including the
exact `(0, 0)` repro that proves the old inline arithmetic produced `100` and the new helper
produces `null`/`"—"`.
