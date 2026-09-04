## 2026-09-04 — [P2, tail latency] `zerodte-warm` cron raced live member requests for the UW rate-limiter ceiling on a false premise ("platform-local, not a UW REST fan-out") — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P2 — real tail-latency contributor, not a correctness bug. Directly explains a pattern measured live in production the same day. |
| **Found by** | Tracing `scanZeroDteBoard`'s call tree while following up on PR #3759's first live queue-wait data (RUN-LOG.md, 2026-09-04 22:16 UTC entry) |
| **Status** | FIXED |

### Root cause

`zerodte-warm/route.ts` dispatches `warmZeroDteBoard()` and `refreshZeroDteBoardSnapshot()` on
every cron tick (~every 1-5 min during market hours, plus an in-app leader that heals stale runs
sooner). The route's own comment explicitly justified NOT wrapping this dispatch in
`runWithBackgroundUwSweep` (the helper the four Vector-family crons already use to reserve one
concurrency slot for live traffic): *"warmZeroDteBoard reads the HELIX flow tape from Postgres —
not a UW REST fan-out — and the board snapshot rebuild is platform-local."*

That premise was wrong on both counts:
- `warmZeroDteBoard()` calls `scanZeroDteBoard()` internally (`scan.ts` line ~2257).
- `refreshZeroDteBoardSnapshot()` → `buildZeroDteBoardPayload()` → `scanZeroDteBoard()` hits the
  same path.
- `scanZeroDteBoard()`'s own top-rank enrichment loop calls `fetchTickerDossier`
  (`nighthawk/lib/dossier.ts`, which imports `runUwPooled` from `uw-rate-limiter.ts`) in bounded
  parallel batches for every enriched setup — the surrounding code comment even says so
  ("dossier in bounded parallel batches so UW budget stays predictable"), directly contradicting
  the cron route's "not a UW REST fan-out" claim sitting a few hundred lines away in a sibling
  file.

A test (`zerodte-warm/route.test.ts`) encoded the wrong premise as a named ratchet:
`"zerodte-warm intentionally omits runWithBackgroundUwSweep (HELIX DB tape, not UW REST
fan-out)"`, asserting the ABSENCE of the wrap.

### Evidence

Live, same-day: PR #3759's queue-wait instrumentation (merged ~21:39 UTC) showed a 30-second
window (22:13:20–22:13:49 UTC) of near-continuous UW admissions taking 10.5–19s, the large
majority **not** tagged `(background sweep)` — meaning they were competing for the FULL rate
limiter ceiling instead of the four-crons'-worth of reserved-slot protection. `[zerodte-scan]`
log lines from `scan.ts` appear on the SAME ECS task/log stream in the SAME window (see RUN-LOG.md
2026-09-04 22:16 UTC entry, which flagged this as a plausible-but-unconfirmed correlation).

Confirmed via source, not correlation alone: `grep -n "throttleUw\|uw-rate-limiter"
src/features/nighthawk/lib/dossier.ts` → `import { runUwPooled } from
"@/lib/providers/uw-rate-limiter"`. `scanZeroDteBoard()` calls `fetchTickerDossier` for the
top-ranked setups every scan cycle. `warmZeroDteBoard()` calls `scanZeroDteBoard()` directly.

RED (`git stash` on just the source fix, test kept applied): 1/8 tests fail — the old ratchet
correctly flags the premise it encoded as now wrong. GREEN after restoring: 8/8 pass, including
the corrected test.

### Fix

Wrapped the cron's own dispatch — `Promise.allSettled([warmZeroDteBoard(),
refreshZeroDteBoardSnapshot()])` — in `runWithBackgroundUwSweep`, exactly matching the pattern the
four existing Vector-family crons (`vector-full-state-snapshot`, `vector-dark-pool-warm`,
`bie-full-state-snapshot`, `vector-pick-sweep`) already use. Corrected the now-proven-wrong
comment to document the real call chain. Replaced the old ratchet test (asserting the wrap's
absence) with one asserting its presence, plus a companion assertion that the LIVE read path
(`/api/market/zerodte/board`'s route, which also calls into `scanZeroDteBoard` via
`getZeroDteBoardPayload` but must stay untagged since those callers genuinely are live traffic)
is NOT wrapped — mirroring the existing precedent's own "wrap only the cron's dispatch, never the
shared function" design.

### Blast radius

Single file (`zerodte-warm/route.ts`) plus its test file. `warmZeroDteBoard`/
`refreshZeroDteBoardSnapshot`/`scanZeroDteBoard`/`buildZeroDteBoardPayload` themselves are
unchanged — this only changes which concurrency ceiling the CRON's OWN dispatch competes against
(one slot smaller than the full ceiling, per `reserveForLiveTraffic`'s existing, already-tested
math), via `AsyncLocalStorage` propagation through the async call chain the cron kicks off. Live
read paths through the identical shared functions (`/api/market/zerodte/board`,
`/api/market/nighthawk/horizons`) are outside the `runWithBackgroundUwSweep` context and therefore
completely unaffected — verified by a dedicated test assertion, not just by reasoning about it.

### Fix rationale

Wrap only the cron route's dispatch, not the shared `scanZeroDteBoard`/
`buildZeroDteBoardPayload`/`getZeroDteBoardPayload` functions themselves — those are also called
from genuinely live, member-facing routes that must keep competing for the FULL ceiling. This is
the exact same reasoning `runWithBackgroundUwSweep`'s own doc comment already states for the four
existing crons ("AsyncLocalStorage... because these sweeps call many layers deep into shared
library code... that cannot practically be threaded with an explicit flag"), applied to a fifth
cron whose exemption from that pattern turned out to be based on a stale/incorrect premise rather
than a real architectural difference.

### What was deliberately left unchanged

Did not touch `scanZeroDteBoard`, `fetchTickerDossier`, `ENRICH_BATCH_SIZE`, or any UW
concurrency/RPS constant — this fix only changes which ceiling the cron's OWN dispatch is measured
against, using the exact primitive (`runWithBackgroundUwSweep`) already built, tested, and proven
for this exact problem shape on four sibling crons. Root-causing WHY individual `scanZeroDteBoard`
runs are slow (separate from the ceiling-sharing problem this fixes) is out of scope, same as the
still-open `vector-pick-sweep` investigation this finding builds on.
