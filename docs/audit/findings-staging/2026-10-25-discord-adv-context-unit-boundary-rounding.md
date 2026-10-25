> **kind:** `FINDING`

## HELIX Discord — `formatAdvContextLine`'s ADV label overflows at the K→M unit boundary — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `src/lib/discord-context-enrichment.ts` (`formatAdvContextLine`) |
| **Severity** | P3 (member-facing cosmetic: Discord dark-pool block alerts' "Size: N% of 20D ~ADV" context line) |

### Root cause

Same bug shape as the Thermal `fmtCompactHeatMoney` fix (#6686, `thermal-discord-card.ts` +
`thermal-compact-matrix.ts`) and the `fmt-money.ts` `fmtPremium` fix (#6690), found during the same
DISCOVERY-lane sweep cycle while checking non-owned-lane money/magnitude formatters for siblings of
that exact defect class: a unit bucket is chosen by comparing the RAW magnitude against
`1_000_000`, then the K-bucket quotient is rounded independently — so a value whose raw `adv` sits
just under 1,000,000 but whose rounded K-quotient reaches `1000` was never promoted to the M bucket:

```js
formatAdvContextLine(500_000, 999_950) → "Size: 50.0% of 20D ~1000K ADV"   // should be "~1.0M ADV"
```

### Evidence

Live repro (`node --import tsx`, pre-fix):
```
formatAdvContextLine(500_000, 999_950) → 'Size: 50.0% of 20D ~1000K ADV'
formatAdvContextLine(500_000, 999_999) → 'Size: 50.0% of 20D ~1000K ADV'
formatAdvContextLine(500_000, 1_000_000) → 'Size: 50.0% of 20D ~1.0M ADV'   (already correct — exactly at the raw threshold)
```

### Blast radius

`formatAdvContextLine` is called from `helix-discord-notify.ts` and `darkpool-discord-notify.ts` —
the ADV context line shown on HELIX dark-pool block alerts posted to Discord. A ticker whose 20D
average daily volume lands in `[999_500, 1_000_000)` shares would show the overflowed `~1000K ADV`
label instead of `~1.0M ADV`.

### Fix rationale

Identical pattern to the three sibling fixes already merged/open this cycle: extracted the bucket
logic into `formatAdvShareLabel(adv)`, round the K-quotient first, then check whether it reached
`1000` before formatting — promoting to the M bucket when it does. The `>= 1_000_000` and
`>= 1_000` raw-magnitude gates are otherwise unchanged; only the K-bucket's own rounded value is now
checked for overflow before being rendered.

### Tests

Added a regression case to `discord-context-enrichment.test.ts` covering the boundary from both
sides (`999_950`, `999_999`, `1_000_000` → all `~1.0M ADV`; `999_499` → `~999K ADV`, confirming the
fix doesn't over-promote). RED→GREEN confirmed: reverting only the source fix (keeping the new
test) fails 1/5 exactly as expected; reapplying passes 5/5.

- `npx tsx --experimental-test-module-mocks --test src/lib/discord-context-enrichment.test.ts` — 5/5 pass
- `npx tsx --experimental-test-module-mocks --test src/lib/darkpool-discord-notify.test.ts` — 1/1 pass (consumer, unaffected)
- `npx tsc --noEmit` — clean
