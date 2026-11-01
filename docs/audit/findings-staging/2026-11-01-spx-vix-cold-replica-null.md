> **kind:** FINDING

## SPX Slayer `desk.vix`/`vix_change_pct` intermittently null on a cold ECS replica — FIXED

| | |
|---|---|
| **Status** | Fixed |
| **Severity** | P2 |
| **Surface** | SPX Slayer (`GET /api/market/spx/desk`, `GET /api/market/spx/play`) |
| **Found by** | five-engine + Ask Largo cycle-66 live audit workflow (wf_5779683c-a66), `health:spx` agent |

### Root cause

`mergePulseIntoDesk()` (`src/features/spx/lib/spx-desk-merge.ts`) resolved `vix` as a flat
two-tier fallback: `pulseVixLive ? pulse.vix : base.vix`. Every sibling structural field this
function merges — `vwap`/`pdh`/`pdl`/`ema20`/`ema50`/`ema200`/`sma50`/`sma200`, and (since
2026-10-31) `hod`/`lod` — already routes through `stickyStructureLevel()`, a THIRD tier backed
by a cross-instance, Redis-persisted "last-known-good" cache (`lastGoodStructure`,
`seedStructureCacheFromBase`/`loadStructureFromRedis`/`publishStructureToRedis`). `vix` never
got that third tier.

This matters specifically because `deskShellFromPulse()` (`spx-desk.ts`) builds its fallback
shell as `mergePulseIntoDesk(emptyDeskPayload(...), pulse)` — a cold ECS replica (right after a
deploy, a cache miss, or a cache stampede) serves `emptyDeskPayload()` as `base`, which seeds
`vix: null`. When that same cycle's `pulse.vix` also comes back unavailable (e.g. off-hours, or
a transient upstream hiccup), BOTH fallback tiers are null and `vix`/`vix_change_pct` served a
bare `null` right next to other populated numeric fields (`available:true`, `price:7580.07`) on
the exact same payload.

### Evidence

Live-reproduced by the cycle-66 `health:spx` audit agent against `https://blackouttrades.com`
(2026-11-01, market closed/Sunday): polling `GET /api/market/spx/desk` in a tight burst
returned `vix:null`/`vix_change_pct:null` on **25/30 polls**, cycling through 5 distinct
recurring `as_of` timestamps (consistent with round-robin across ~5 ECS replicas behind the
ALB), while a separate poll seconds earlier (a different replica) returned `vix:19.42`. Every
other field on the same failing payload (`available`, `price`, `market_status`) was populated
and internally consistent — this was not a general outage, just this one field on this one
fallback path.

### Fix

Route `vix` through `stickyStructureLevel("vix", ...)` as the third-tier fallback, identical to
every other structural field in the same function — never fabricates a value no replica has
ever actually seen (the sticky cache itself starts `null`), only prevents a transient
cold-replica/cold-pulse overlap from serving `null` next to an otherwise fully-populated desk.
`vix_change_pct` is deliberately left honest (`null`) whenever the sticky tier is what supplied
`vix` — a change% is only meaningful against a value computed fresh *this* cycle, and fabricating
one against a sticky-carried level would misrepresent it as live.

Added `vix: number | null` to the `lastGoodStructure` cache record (and the
`seedStructureCacheFromBase` param type) so it gets the same cross-instance Redis persistence
every sibling sticky field already has — this specifically closes the cold-replica case, where
local in-process state alone wouldn't help (the replica that eventually sees a real pulse/base
vix needs to publish it for the OTHER replicas currently serving the empty shell).

### Blast radius

Single call site (`mergePulseIntoDesk`); no other function computes `vix` for this merged desk.
`deskShellFromPulse` (the fallback-shell builder) and the normal full-desk-build merge path both
flow through this one function, so both are covered by the same fix.

### Tests

`src/features/spx/lib/spx-desk-merge.test.ts` — two new tests added to the existing
"mergePulseIntoDesk off-hours derived-field fallback" describe block:
- `falls back to the cross-instance sticky cache when BOTH pulse.vix and base.vix are
  unavailable (cold-replica/cold-pulse overlap)` — confirms `vix` still resolves to the
  last-known-good value, and `vix_change_pct` stays honestly `null`.
- `never fabricates a vix the sticky cache has also never seen (honest absence, no
  regression)` — confirms the fix never invents a number when nothing has ever been seen.

RED→GREEN verified via `git stash` of only the source fix: 24/25 pass (1 fail) without the fix,
25/25 pass with it. Full `npm test` (Node 20) and `npx tsc --noEmit` both clean on the fix
branch.
