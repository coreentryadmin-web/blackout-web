> **kind:** FINDING

## Degraded SPX play fallback still served the hardcoded "Desk warming" headline at a second call site during live RTH — FIXED

| | |
|---|---|
| **Status** | FIXED — PR (this branch) |
| **Severity** | P2 — member-facing false "desk is cold" claim during a fully live RTH session, also propagates into Ask Largo's `get_spx_play` answer |

### Root cause

`degradedPlayPayload()` (`src/features/spx/lib/spx-play-payload.ts`) defaults `headline`/
`idle_message` to the literal string `"Desk warming — play state unavailable"`. A 2026-10-16 fix
overrode this text at ONE call site — `src/app/api/market/spx/play/route.ts`'s catch block, which
fires on a thrown `ServerCacheTimeoutError` — substituting the honest
`"Play scan still catching up — retry shortly"`.

A second call site, `spxPlayReadDegraded()` in `src/features/spx/lib/spx-service.ts`, builds its
`degradedPlayPayload()` extras with ONLY `session_phase` overridden (added in a 2026-10-21 fix for
the sibling `session_phase: "closed"` bug) and never touched `headline`/`idle_message` — it still
fell through to the bare "Desk warming" default. `spxPlayReadDegraded()` is reached via the normal,
non-throwing 200-OK path (`evaluateSpxPlayStateCrossReplica` losing the cross-replica Redis lock
with no stale cached snapshot or peer result arriving in time, or `spxPlayReadFallback` finding
neither) — the function's own header comment calls this a routine outcome, not a rare one.

This is the second time the exact same bug shape has shipped: one call site gets an honest
override, a sibling keeps the old hardcoded default, because the fix lived as inline literals
rather than one shared definition (the first instance was `session_phase`, fixed independently at
both call sites on 2026-10-21).

### Evidence

Live-reproduced 2026-10-26 during RTH: `GET /api/market/spx/play` at `2026-10-26T13:37:52Z`
returned `available:false, assessed:false, headline:"Desk warming — play state unavailable",
idle_message` identical, `session_phase:"cash"` (correct — the 2026-10-21 fix held),
`degraded:true`. A parallel `GET /api/market/spx/desk` call at the same moment returned
`market_open:true`, `polled_at` only ~45 seconds old — the desk itself was fully live; only the
play-eval pipeline's cross-replica coordination degraded for that one request.

### Blast radius

- `headline`/`idle_message` feed `spx-play-verdict-bar.ts`'s `statusLine`
  (`play.headline || play.thesis || play.idle_message || ...`) — the SPX desk's Play Verdict Bar.
- `spx-slayer-badge-map.ts`'s `unavailable_reason` — the Night Hawk board's SPX Slayer badge
  tooltip.
- Ask Largo's `get_spx_play` reads from the same `getSpxPlayState()` cache, so a Largo answer asked
  about SPX during one of these routine cross-replica-lock-loss windows would also have quoted
  "Desk warming" while the real desk was live.

### Fix

Added one shared helper, `degradedPlayCatchingUpMessage()`, in `spx-play-payload.ts` — the single
definition of "what to say when the eval pipeline, not the desk, failed to produce a result in
time." Both call sites now spread it into their `degradedPlayPayload()` extras instead of each
carrying its own inline literal (route.ts) or nothing at all (spx-service.ts):

- `src/app/api/market/spx/play/route.ts`: replaced the two inline `"Play scan still catching up —
  retry shortly"` literals with `...degradedPlayCatchingUpMessage()`. Behavior for this call site is
  unchanged (same message, same `ServerCacheTimeoutError` gate, `session_phase` override logic
  untouched) — this is a pure dedup at this call site.
- `src/features/spx/lib/spx-service.ts`'s `spxPlayReadDegraded()`: now spreads
  `degradedPlayCatchingUpMessage()` unconditionally (this path is always reached because the
  pipeline didn't finish in time — there's no error-type gate to condition it on, unlike route.ts),
  alongside the existing conditional `session_phase` override from the desk peek.

Chose the shared-helper approach over a second inline literal at the second call site specifically
because this is the second instance of the same drift — a single, exported, documented definition
removes the ability for a third call site (or a future edit to either existing one) to repeat it.
A regression test asserts both call sites reference the same exported symbol, not just that each
independently contains some non-"Desk warming" string.

### Tests

- `src/features/spx/lib/spx-play-payload.test.ts`: new unit tests for
  `degradedPlayCatchingUpMessage()` (returns the honest message, never "Desk warming") and for
  `degradedPlayPayload(degradedPlayCatchingUpMessage())` actually overriding both fields away from
  the bare default.
- `src/features/spx/lib/spx-service.play.test.ts`: new regression test asserting
  `spxPlayReadDegraded()`'s body calls `degradedPlayCatchingUpMessage()` (RED against the
  pre-fix source, GREEN after — proven via `git stash` of the implementation files only, tests
  left in place: 4 failures pre-fix, 0 post-fix), plus a cross-file test asserting both route.ts
  and spx-service.ts reference the same shared helper (prevents a third-site drift from passing
  silently).
- `npx tsx --experimental-test-module-mocks --test` on the affected files plus the wider SPX/Largo
  suite (spx-slayer-badge, spx-play-hysteresis, spx-desk-convergence, session-anchor,
  ecosystem-context, admin-spx-health, signals-projection): all green (110/110 across both runs).
- `npx tsc --noEmit`: clean (Node 20.20.2).
- Full `npm test` run in progress/verified as part of this PR's CI (`verify` check).
