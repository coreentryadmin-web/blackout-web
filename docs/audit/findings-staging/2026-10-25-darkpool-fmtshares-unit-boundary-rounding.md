> **kind:** `FINDING`

## Helix — `fmtShares` overflows at K→M unit boundary, in both the Discord formatter and the live `/flows` desk panel — FIXED

| Field | Detail |
|---|---|
| **Status** | FIXED (PR #6730, merged to `main`) |
| **Area** | `src/lib/darkpool-discord-format.ts` (`fmtShares`) and `src/features/helix/components/DarkPoolPanel.tsx` (its own, separately-defined `fmtShares`) |
| **Severity** | P3 (member-facing/Discord display overflow, no data corruption) |

### Root cause

Both functions bucket a share count by comparing the raw magnitude against `1_000_000`/`1_000`,
then round the K-quotient independently. A raw share count just under 1,000,000 whose rounded
K-quotient reaches `1000` was never promoted to M:

```js
fmtShares(999_600) → "~1000K shares"   // should be "~1.0M shares"
fmtShares(999_999) → "~1000K"          // should be "1.0M"
```

Same bug shape (and same fix pattern: round the quotient first, then check whether it crossed the
next unit) as `moneyShort`'s own K→M fix shipped earlier today (#6727) in `helix-discord-format.ts`
— `darkpool-discord-format.ts` already imports that fixed `moneyShort`, but its own locally-defined
`fmtShares` sibling had the identical gap, never caught in the same pass.

### Evidence

```
> fmtShares(999_600)   → '~1000K shares'
> fmtShares(999_999)   → '~1000K shares'
```

No existing test exercised a value near a unit boundary — the Discord-side `fmtShares` wasn't
directly tested (not exported; covered through `buildDarkpoolDiscordEmbed`'s rendered output), and
the live-UI component's `fmtShares` had zero test coverage at all (no test file existed for
`DarkPoolPanel.tsx` before this fix).

This K→M boundary is highly reachable for ordinary dark-pool block sizes — a sub-$10/share stock
trading a $5-10M block easily lands a share count in `[999_500, 1_000_000)` — distinct from a
previously-flagged, dismissed-as-low-reachability "no billion-shares bucket" gap in this same
function (that one requires a sub-penny-stock-scale print).

### Blast radius

Every Discord dark-pool embed (single-print alert, top-blocks digest, ticker-burst alert) AND the
live `/flows` desk's `DarkPoolPanel` share-size chip.

### Fix

Round the K-quotient first, then check whether it reached 1000 before formatting — promoting to M
when it does. Applied identically to both independent `fmtShares` implementations (they are not a
shared function; each file defines its own).

### Tests

- `darkpool-discord-format.test.ts` — new case through `buildDarkpoolDiscordEmbed` (the function
  itself isn't exported). RED→GREEN confirmed (11/12 → 12/12).
- `DarkPoolPanel.test.tsx` (new file, no prior test existed for this component) — exports
  `fmtShares` for direct testing. RED→GREEN confirmed (0/2 fail pre-fix since the function wasn't
  exported → 2/2 pass).
- `discord-eod-recap.test.ts` (consumer) — 7/7 pass, no regression.
- `npx tsc --noEmit` — clean.
