## Ask Largo swing play-brief silently returns the WRONG position when a caller asks for the CLOSED play by ticker + `status=CLOSED` alone (no `positionId`)

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo — `GET /api/market/swing/play-brief` (`src/lib/swing/play-brief-resolve.ts`) |
| **Severity** | P2 (a real, live-reproduced identity/absence violation — Largo confidently answers about the wrong contract, not a crash) |
| **Status** | FIXED |
| **Files** | `src/lib/swing/play-brief-resolve.ts`, `src/lib/swing/play-brief-resolve.test.ts` |

**Root cause.** `resolveSwingPlayForBrief` has an explicit, well-documented guard for a caller
supplying `positionId` (either embedded in `playId` or as a separate query param): it tries
`loadClosedPlay` first and, if `status` is `CLOSED`, never falls back to a live OPEN/lane play
(this exact class of ticker-collision bug was already fixed twice before — see the `SWING:INTC`
and multi-roll-chain write-ups earlier in this file's history). But when the caller has **only** a
ticker and an explicit `status=CLOSED` hint — no `positionId` at all — there was no equivalent
guard: the function falls through to `pickLanePlayForBrief(rows, ticker, { status, strike, right,
positionId })`, and that helper (`play-brief-resolve-pure.ts`) **never reads `hints.status` at
all** — it matches purely on ticker (+ optional positionId/strike/right). Lane rows
(`loadLaneRows`'s `rows`) are WATCH/COMMIT/live-candidate reads and never carry a CLOSED status
(confirmed: `serving-lane.ts` has no CLOSED status code path), so any ticker that currently has
BOTH a closed, graded historical position AND a separate, currently-active lane row (a fresh
setup re-triggering on the same name — an ordinary, expected occurrence, not an edge case) would
silently have its explicit CLOSED request answered with the unrelated ACTIVE position's data
instead — a different contract, a different status, a different outcome, presented as if it were
the one the caller asked about.

**Evidence.** Live-reproduced during the standing 5-engine/Ask-Largo monitor cycle, 2026-09-27,
against `blackouttrades.com/api/market/swing/play-brief`:
- `?playId=SWING:HUT&ticker=HUT&status=CLOSED` (no `positionId`) → `headline: "TRIM — HUT 100C
  13DTE"`, `confidence: {level: "moderate", why: "6 sources unavailable this cycle..."}` — an
  ACTIVE TRIM position.
- The identical request **with** `positionId=41` added → `headline: "STOPPED — HUT 106C 8DTE"`,
  `confidence: {level: "high", why: "Closed play — the outcome is the ledger record, not a
  re-derived live read."}` — the actual closed, graded position (`closedDeck` confirms
  `positionId: 41, status: "CLOSED"`).

Two completely different contracts (100C/13DTE vs 106C/8DTE), two different statuses, two
different confidence levels — for the same ticker, same explicit `status=CLOSED` ask, differing
only in whether `positionId` happened to be supplied. This directly violates the Largo Product
Contract's C4 identity principle: the envelope must answer about the specific play identified,
never substitute a different one that merely shares a ticker.

**Why this wasn't caught earlier.** The two prior fixes for this exact bug class (`SWING:INTC`,
2026-09-11; the multi-roll-chain fix, same date) both assumed the caller supplies `positionId` —
their regression tests cover "positionId supplied, ticker also has a live row" but never
"ticker-only + status hint, no positionId at all." That is exactly the shape Largo's own tool
calls can take when it only has a ticker in hand (the route's own doc comment already notes
"Largo tool omits `?ticker=`" as a real caller pattern elsewhere in this file), so the gap was a
real, reachable path, not a hypothetical.

**The fix.** In `resolveSwingPlayForBrief`, skip the `pickLanePlayForBrief` lane-fallback branch
entirely whenever the caller's `status` hint explicitly says `CLOSED` (case-insensitive). Lane
rows can never satisfy that request (they are never CLOSED), so this can only ever route a
CLOSED-hinted request to the correct closed-lookup fallbacks further down (`loadClosedPlay` by
positionId, then the unconditional `loadClosedPlay(ticker, null)` fallback) — it cannot regress
any request that isn't asking for a closed play.

**Blast radius.** Only this one resolution path (`resolveSwingPlayForBrief`'s ticker-only,
positionId-less branch) was affected — `loadOpenTerminalPlay`, `loadClosedPlay`, and the
positionId-guarded branches earlier in the same function were already correct (per the prior
fixes). No other caller of `pickLanePlayForBrief` passes a `status=CLOSED` hint (checked: the
only other call site is inside this same function).

**Fix rationale — what was deliberately left unchanged.** Did not add a `status` check inside
`pickLanePlayForBrief` itself — that function's whole contract is "pick the best LIVE lane
candidate for this ticker," and lane rows never carry CLOSED status, so a status check inside it
would be dead code. Gating at the call site (skip calling it at all for an explicit CLOSED ask)
is the minimal, correct fix and keeps `pickLanePlayForBrief`'s existing unit tests (which never
pass a CLOSED status) unaffected.

**Evidence (tests).**
- New test: `resolveSwingPlayForBrief: ticker-only + status=CLOSED (no positionId) must resolve
  the CLOSED position, not an unrelated live lane row for the same ticker` — RED pre-fix
  (`git stash` the fix, re-run: 1 failure, live-reproducing the exact collision), GREEN post-fix.
  A companion test proves the no-status-hint case is unchanged (still prefers the live lane row).
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-resolve.test.ts` —
  20/20 pass post-fix.
- `npx tsc --noEmit` — clean.

**RTH check.** Not RTH-gated for the mechanism itself (the collision can occur any time a ticker
has both a closed position and a fresh live setup), but the practical trigger — a ticker
re-qualifying for a new swing setup shortly after a prior position on it closed — is most likely
during active RTH discovery. Once deployed: spot-check a few tickers with both a recent closed
position (`swing/record`'s `closedDeck`) and a current live lane row for the same ticker, and
confirm `?status=CLOSED` with no `positionId` now returns `confidence.level: "high"` and the
correct closed contract rather than a live one.
