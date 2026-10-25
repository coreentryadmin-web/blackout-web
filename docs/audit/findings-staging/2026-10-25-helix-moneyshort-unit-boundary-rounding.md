## Helix — `moneyShort` overflows at K→M unit boundary — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED (PR #6727) |
| **Surface** | `src/lib/helix-discord-format.ts` (`moneyShort`) |
| **Severity** | P3 (member/community-facing label overflow, no data corruption) |

### Root cause

`moneyShort` bucketed by raw magnitude (`abs(n) >= 1e6` for M, `>= 1e3` for K) then rounded the
K-quotient independently, so a value whose raw size sits just under 1,000,000 but whose rounded
K-quotient reaches 1000 was never promoted to M:

```js
moneyShort(999_600) → "$1,000K"   // should be "$1.00M"
```

Same bug shape as five other unit-boundary fixes shipped earlier the same day across Thermal's
`fmtCompactHeatMoney`, `fmt-money.ts`'s `fmtPremium`, and `discord-context-enrichment.ts`'s
`formatAdvContextLine` — this is the sixth confirmed instance.

### Evidence

```
> moneyShort(999_600)   → '$1,000K'
> moneyShort(999_999)   → '$1,000K'
```

`moneyShort` had zero existing test coverage before this fix.

### Blast radius

`moneyShort` is imported directly by `src/lib/discord-eod-recap.ts` and
`src/lib/darkpool-discord-format.ts` (fixed transitively) — every HELIX Discord embed/digest, the
EOD recap, and dark-pool block alerts that print a dollar figure in `[999_500, 1_000_000)`. Two
OWNED-lane files (`src/features/spx/lib/spx-play-terminal-lines.ts`,
`src/features/spx/lib/spx-odte-intel-feed.ts`) define their OWN local `moneyShort` with the
identical bug shape but were intentionally left untouched — out of scope for this (non-owned) lane.

### Fix

Round the K-quotient first, then check whether it reached 1000 of the unit before formatting,
promoting to M when it does — same pattern as the five sibling fixes.

### Tests

New case in `helix-discord-format.test.ts`. RED→GREEN confirmed: reverting only the source change
(keeping the new test) fails 16/17 exactly as expected; reapplying passes 17/17. Consumer suites
(`discord-eod-recap.test.ts`, `darkpool-discord-format.test.ts`) — 18/18 pass, no regression.
`npx tsc --noEmit` clean.
