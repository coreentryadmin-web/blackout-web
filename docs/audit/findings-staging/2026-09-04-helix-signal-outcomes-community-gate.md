> **kind:** `FINDING`

## HELIX signal-outcomes follow-through tracker served at community tier instead of premium — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P1 (paywall bypass / access control, CWE-863) |
| **File** | `src/app/api/market/helix/signal-outcomes/route.ts`, regression test in the new `route.test.ts` |
| **Found by** | Autonomous parallel bug-hunt workflow (8-dimension scan + adversarial verify), 2026-09-04 |

### Root cause

`GET /api/market/helix/signal-outcomes` (the HELIX "follow-through tracker" panel, part of the
premium-only `/flows` desk) was gated with `authorizeMarketDeskApi`, which authorizes at the
**community** tier ($49/mo). Every other HELIX/flows route in the codebase — `flows/route.ts`,
`flows/stream/route.ts` — is gated with `authorizePremiumDeskApi` (**premium**, $199/mo), and
`authorizePremiumDeskApi`'s own doc comment names "HELIX flows (/flows)" explicitly as a route that
must use it. `authorizeMarketDeskApi`'s own doc comment even documents the exact vulnerability
class this route reproduced: "Twenty premium routes (HELIX flows, Thermal heatmap, all of Vector,
the premium briefs) were wired to this community gate, letting a $49 community member pull $199
premium data by hitting the API directly (CWE-863)." This route was evidently added or missed after
that class-wide fix and never got the same correction.

Next.js middleware only matches page paths, not `/api/market/*` — the API layer is the sole
enforcement point for tier — so this was a real, live data-access bypass: any signed-in community
subscriber could call this endpoint directly and pull the premium follow-through ledger the
`/flows` desk's HELIX conviction-score panel serves.

### Fix

Swap the import and call from `authorizeMarketDeskApi` to `authorizePremiumDeskApi` — the same gate
every sibling HELIX/flows route already uses. One line changed (plus the import).

### Evidence

RED→GREEN: added `route.test.ts` (source-scan pattern already used by
`vector/daily-regime/route.test.ts` for this exact class of bug) asserting the route source
contains `authorizePremiumDeskApi` and not the community-tier gate. Reverted the fix
(`git stash`) — test failed (`must not use the community-tier gate`). Restored the fix — test
passes. `npx tsc --noEmit` clean.

### Blast radius

Single route — confirmed via `grep` across every `src/app/api/market/**/route.ts` that this was the
only HELIX/flows-tier route still on the community gate; every other HELIX/Vector/Thermal/Meridian
premium route already uses `authorizePremiumDeskApi`.

### What was deliberately left unchanged

No change to `authorizeMarketDeskApi`/`authorizePremiumDeskApi` themselves, to the ledger writer
cron, or to the response shape — this is purely a one-line tier-gate correction.
