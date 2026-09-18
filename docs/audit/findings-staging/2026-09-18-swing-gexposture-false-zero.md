> **kind:** `FINDING`

## Ask Largo swing "GEX posture" section rendered a real net GEX as a false "0.0M" zero — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Ask Largo swing play-brief (`src/lib/swing/play-brief-intel.ts`) — found via the Ask Largo standing mandate's deep-dive follow-up on PR #5227 |
| **Severity** | P2 (real, false-absence display defect over correct data) |
| **PR** | fix/swing-gexposture-false-zero |

### Root cause

`gexPostureSection` (`play-brief-intel.ts`) independently computes `gex.net_gex / 1_000_000` and
renders it via a bare `.toFixed(1)`. Any real, signed `net_gex` with magnitude under ~$50,000
(common on lower-priced/small-cap tickers) rounds to `"0.0"` — the string reads as "no dealer
exposure" when a real signed value exists.

This is the exact same defect already root-caused and fixed earlier the same day in a sibling call
site: `play-brief.ts`'s `tradeManagerNarrativeSection` computes the identical ratio from the
identical `gex.net_gex` field (PR #5227, live ABTC $10.15 repro) and was fixed there with
`formatFixedNonZero`. That fix only touched the one narrative call site it was found in;
`gexPostureSection` — a separate, independently-rendered "GEX posture" evidence block gated on
`!stale` — computes the same ratio from the same field and had the identical unguarded
`.toFixed(1)`, never touched by the earlier fix.

### Evidence

- Found by a follow-up Ask Largo deep-dive subagent specifically re-scanning `play-brief*.ts` for
  other instances of the same bug class just fixed in PR #5227.
- RED→GREEN independently reproduced via `git stash` (fix isolated to `play-brief-intel.ts`):
  169/170 fail pre-fix (the new test), 170/170 pass post-fix.
- `src/lib/swing/play-brief-intel.test.ts` full file: 170/170 pass.
- Full swing suite (`src/lib/swing/*.test.ts`): 1351/1351 pass.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Single line (`gexPostureSection`'s `Net GEX:` line). This section is the authoritative, staleness-
gated "current GEX posture" evidence block for OPEN/WATCH plays — distinct from the trade-manager
narrative `play-brief.ts` builds, so the two sections could previously disagree: the narrative
could correctly show a small nonzero net GEX (post-#5227) while the posture evidence block right
below it showed a contradicting "0.0M" for the identical underlying number.

### Fix rationale

Reused the same `formatFixedNonZero` helper `play-brief.ts` and
`play-brief-narrative-coaching.ts` already import from `./format-nonzero`, applied at the one
unguarded call site — no new logic, matching the established fix pattern exactly.

### Verification

Independently re-verified from scratch on a fresh branch off actual latest `origin/main` —
RED/GREEN independently reproduced via `git stash`; the full swing test suite and `tsc --noEmit`
both clean.
