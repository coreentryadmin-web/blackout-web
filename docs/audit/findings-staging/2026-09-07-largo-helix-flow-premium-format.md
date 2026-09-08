# Largo swing brief — HELIX flow evidence used raw 2-decimal dollars while narrative used k/M

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-helix-flow-format |
| **Severity** | P2 |
| **Area** | Largo / Night Hawk Swings |
| **Status** | FIXED |

## Symptom

Same HELIX 24h flow aggregate appeared as two different strings in one brief:
- Evidence chip: `calls +$1000000.00 · puts +$500000.00` (`play-brief.ts` 2-decimal `fmtUsd`)
- Trade manager / intel sections: `calls $1.0M · puts $500K` (k/M scaling)

Violates Largo product contract **precision** — one fact must render as one number.

## Root cause

`play-brief.ts` evidence builder used a local 2-decimal `fmtUsd` for aggregate HELIX premiums.
`play-brief-narrative.ts` had a separate k/M `fmtUsd`. `play-brief-intel.ts` used 2-decimal.

## Fix

Route all HELIX aggregate flow / dark-pool notional formatting through `fmtPremium` from
`@/lib/fmt-money` (platform single source of truth). Narrative wraps via `fmtFlowUsd`.

## Tests

`play-brief.test.ts` HELIX flow evidence assertion updated to expect `$1.0M` / `$500K`.
Full `play-brief*.test.ts` suite: 122/122 pass.

## Market-open check

Open a committed swing row with HELIX flow >$100k and confirm evidence + trade-manager read
show identical k/M strings (e.g. both `$1.2M`, not `$1200000.00` vs `$1.2M`).
