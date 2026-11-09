## flow-brief route's inline money/share formatting rounds past the K/M/B boundary without promoting the unit — FIXED

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/app/api/market/flow-brief/route.ts` (the "Ask Largo"-adjacent 15-min shared flow-tape LLM brief) |
| **Severity** | P3 — display/prompt-text correctness, not a trading-decision defect |

### Root cause

`buildPrompt()` in `src/app/api/market/flow-brief/route.ts` formatted dollar premiums and
dark-pool share counts inline, at four separate call sites, by comparing the **raw,
unrounded** value against a K/M/B threshold and then rounding **inside** that unit's own
branch:

```ts
`$${(a.premium / 1e6).toFixed(1)}M`        // massive flow line
`$${(d.premium / 1e6).toFixed(1)}M`        // massive dark-pool block line
`${(d.share_size / 1000).toFixed(0)}K shares`  // block share count
`$${(a.premium / 1000).toFixed(0)}K`       // top-alerts line
`$${(total / 1e6).toFixed(1)}M`            // prompt summary totals
```

A value just under a unit's 1000x boundary rounds **up** past 1000 without the label
being promoted to the next unit:

- `(999_600 / 1000).toFixed(0)` → `"1000"` → renders **`"$1000K"`** instead of `"$1.0M"`.
- `(999_950_000 / 1e6).toFixed(1)` → `"1000.0"` → renders **`"$1000.0M"`** instead of
  `"$1.0B"`.
- `(1_999_750 / 1000).toFixed(0)` → `"2000"` → renders **`"2000K shares"`** instead of
  `"2.0M shares"`.

This is the exact "round-first-then-promote" money-formatter defect class already fixed
in ~20 other call sites across the repo (e.g. `src/lib/helix-discord-format.ts`'s
`moneyShort`, whose in-code comment this fix mirrors pattern-for-pattern, and the sibling
SPX `moneyShort` instances fixed the same day in PRs #7727/#7729/#7731/#7732) — this
local, un-promoted inline formatting in the flow-brief route had not yet been caught.

### Why this is live-reachable, not theoretical

These formatted strings feed the Claude prompt `buildPrompt()` builds, and the prompt's
own rules explicitly instruct the model to **"explicitly name"** massive flow/block
prints and quotes them close to verbatim in the 2-3 sentence brief members read
(`GET /api/market/flow-brief`'s `brief` field, refreshed every 15 minutes and shared
across every member in that window). So a mislabeled unit here can surface as a visibly
wrong number in a real member-facing sentence, not just in internal prompt scaffolding:

- `topAlerts` premiums are only floored at `min_premium: 200_000` with no upper bound —
  alerts landing in the $950K-$999K range (a common cluster near the psychologically
  round $1M mark) hit the K→M boundary directly.
- `share_size` on dark-pool blocks is unfiltered by magnitude at all — a few-hundred-
  thousand-share block on a lower-priced underlying easily lands in the
  1,999,500-1,999,999-share band that hits the K→M boundary.
- `total`/`callPrem`/`putPrem` sum **every** qualifying alert in the window (up to 500
  rows via the DB path, each ≥ $200K) — a session with heavy flow can plausibly sum into
  the $900M-$1B range, hitting the M→B boundary the old code never modeled at all (it
  only had a top "M" tier for these three lines, no B promotion whatsoever).
- `massiveFlows`/`massiveBlocks` premiums are floored at the `MASSIVE_FLOW`/
  `MASSIVE_BLOCK` $15M gate but have no ceiling — an outsized institutional dark-pool
  block landing near $999.95M also hits the M→B boundary.

### Blast radius

Only this one file (`route.ts`) had the un-promoted formatting, at the four call sites
listed above — all share the identical root cause (raw-value threshold compare, round
inside the branch), so all four are fixed together as one issue rather than four separate
PRs.

### Fix rationale

Extracted the formatting into a new pure module, `src/lib/flow-brief-money-format.ts`
(`moneyShort`/`sharesShort`), rather than inlining the fix at each of the four call
sites again — same "round-first-then-promote" guard already proven in
`helix-discord-format.ts`: re-check the **rounded** quotient for the current unit before
committing to its label, and if that rounded value has itself crossed into the next
unit, promote. The module is separate from the route file specifically so it can be
unit-tested directly without pulling in the route's `server-only`-gated imports
(`anthropic`, `db`, `unusual-whales`, etc.), which blow up under `node:test` if the route
module is imported directly. Nothing else in the route changed — below each boundary,
output is byte-identical to before (e.g. `$500K`, `$23.4M`, `450K shares` unaffected).

### Evidence (RED → GREEN)

Added `src/lib/flow-brief-money-format.test.ts` exercising both functions directly:

```
moneyShort(999_600)       // before: "$1000K"     after: "$1.0M"
moneyShort(999_950_000)   // before: "$1000.0M"   after: "$1.0B"
sharesShort(1_999_750)    // before: "2000K"       after: "2.0M"
```

Confirmed RED by temporarily reverting the module to the pre-fix formatting logic
(same math as the old inline code) and re-running the suite — 2 of 5 tests failed with
exactly the symptom above (`expected: '$1.0B', actual: '$1000.0M'`). Restored the fix and
re-ran — all 5 pass:

```
# tests 5
# pass 5
# fail 0
```

`npx tsc --noEmit` clean. `npx eslint` clean on the touched files.

### Scope

Pure display/prompt-text formatting inside an LLM-prompt builder — no gate/commit/scoring
decision logic touched, no `src/lib/zerodte/**`/nighthawk-core/SPX-decision/Largo-tool-
dispatch/BIE-builder/swing-decision/SEO files touched.
