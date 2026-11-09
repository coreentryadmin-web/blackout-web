> **kind:** FINDING

## `sharesShort` in `flow-brief-money-format.ts` rounds sub-1,000-share dark-pool blocks to "0K"/"1K" — FIXED

**Area:** `src/lib/flow-brief-money-format.ts` (shared with `src/app/api/market/flow-brief/route.ts`)

| **Status** | FIXED |
|---|---|
| **Severity** | P3 — real, member-facing LLM output defect; narrow but reachable input range |
| **Found by** | Round 489 audit sweep (follow-up to round 488's db.ts millisecond-truncation sweep; pivoted after the two other genuine `new Date(String(...))` hits outside `db.ts` were both in excluded directories — `src/lib/bie/nighthawk-edition-read.ts` and `src/lib/largo/run-tool.ts`) |

### Root cause

`sharesShort()` is the share-count sibling of `moneyShort()` in the same file, and the file's
own header comment says it "mirrors" the K/M/B round-first-then-promote pattern fixed roughly
20 times elsewhere in this repo (e.g. `darkpool-discord-format.ts`'s `fmtShares`). It does mirror
the K→M promotion-boundary fix — but it is missing the tier underneath it that every sibling
formatter has: a plain "return the raw count" branch for `n < 1,000`.

Before the fix:

```ts
export function sharesShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  const kRounded = Math.round(n / 1_000);
  if (Math.abs(kRounded) >= 1_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${kRounded}K`;
}
```

Every `n < 1,000` falls straight into the "K" branch and gets rounded to the nearest **whole
thousand**, not rendered as a small number:

- `sharesShort(25)` → `Math.round(25 / 1000)` = `Math.round(0.025)` = `0` → renders `"0K"` for a
  genuine, nonzero 25-share print.
- `sharesShort(500)` → `Math.round(500 / 1000)` = `Math.round(0.5)` = `1` → renders `"1K"`, a
  **2000% overstatement** of a real 500-share print.
- `sharesShort(999)` → same shape → `"1K"`.

Compare the sibling `fmtShares` in `src/lib/darkpool-discord-format.ts`, which has the tier this
function is missing:

```ts
function fmtShares(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1)}M shares`;
  if (n >= 1_000) { /* K branch, with its own round-first-then-promote guard */ }
  return `~${Math.round(n).toLocaleString("en-US")} shares`;   // <- the missing tier
}
```

### Why this is reachable in production, not just a theoretical boundary

`sharesShort`'s one real call site (`src/app/api/market/flow-brief/route.ts`, the dark-pool
block line in `buildPrompt`) only gates on **premium**:

```ts
const massiveBlocks = darkPrints
  .filter((d) => d.premium >= MASSIVE_BLOCK)   // premium >= $15M, NOT share-count gated
  .slice(0, 4)
  .map((d) =>
    `${d.ticker} ${d.side.toUpperCase()} ${moneyShort(d.premium)} block${d.share_size ? ` (${sharesShort(d.share_size)} shares)` : ""}`
  );
```

`share_size` is an independent upstream field, not derived from the premium threshold. For an
ordinary-priced stock a $15M+ block is tens of thousands of shares, safely inside the K/M tiers.
But for an ultra-high-priced name (the obvious real example: **BRK.A**, which trades north of
$600,000/share), a genuine $15M+ dark-pool block is on the order of **25 shares** — squarely in
the broken sub-1,000 range. That block would render in a real member-facing flow-brief sentence
(fed to Claude, which is instructed to "explicitly name" and quote these prints close to verbatim)
as `"BUY $15.0M block (0K shares)"` — a plausible-looking but false number, understating the real
share count by three orders of magnitude while giving no indication anything is wrong.

### Fix

Added the same `< 1,000` raw-count tier `moneyShort` (same file) and `fmtShares`
(`darkpool-discord-format.ts`) already have:

```ts
export function sharesShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) {
    const kRounded = Math.round(n / 1_000);
    if (Math.abs(kRounded) >= 1_000) return `${(n / 1_000_000).toFixed(1)}M`;
    return `${kRounded}K`;
  }
  return `${Math.round(n)}`;
}
```

The existing K→M promotion-boundary logic (already correct) is untouched — only the missing
bottom tier was added, matching every sibling formatter's shape.

### Evidence (RED → GREEN)

Added `src/lib/flow-brief-money-format.test.ts` cases for `sharesShort(25)`, `sharesShort(500)`,
`sharesShort(999)`. Confirmed RED pre-fix (stashed only the source change, kept the new tests):

```
not ok 6 - sharesShort sub-1,000 shares render the real count, not a rounded-to-zero/one K label
  Expected values to be strictly equal:
  '0K' !== '25'
```

GREEN post-fix: `6 pass / 0 fail`. `npx tsc --noEmit` clean.

### Blast radius

`sharesShort` has exactly one call site (`flow-brief/route.ts`'s dark-pool block prompt line),
so this fix's effect is scoped to that one LLM-prompt sentence. No other formatter in the repo
shares this exact defect — every sibling K/M/B formatter checked this round (`moneyShort` in the
same file, `fmtShares` in `darkpool-discord-format.ts`, `fmtOi`/`fmtMoney` in the Helix formatters,
`fmtCompactRevenue` in `meridian-revenue-format.ts`, `fmtGex` in `vector-crosshair-format.ts`,
`fmtNotional` in `helix-contract-notional-format.ts`, `formatDealerDollars` in
`swing/format-nonzero.ts`, `moneyShort` in `helix-discord-format.ts`) already has the sub-1,000
raw-count tier — this was the one holdout.

### What was checked this round and found clean/out-of-scope (not re-fixed)

- Round 488's named follow-up (`new Date(String(X)).toISOString())` outside `db.ts`): exactly two
  genuine hits exist outside `db.ts`/the already-open `#7758` fix — `src/lib/bie/
  nighthawk-edition-read.ts:995,10507` (`pulled_at`) and `src/lib/largo/run-tool.ts:539` — both
  inside directories this repo's exclusion policy marks hands-off (`src/lib/bie/**` read-only
  reference; `src/lib/largo/**` AI tool-dispatch layer). The other three hits
  (`scorer.ts`/`dossier.ts`'s `congressTradeDecayMultiplier`/`parseTradeDate`,
  `flow-timestamp.ts`'s `toIso`) parse upstream JSON string/epoch fields, not a re-stringified
  Postgres `Date` object, so they are not instances of the same lossy-millisecond shape.
- Swept the money/share-formatter family broadly (see Blast radius above) — only `sharesShort`
  had the gap.
