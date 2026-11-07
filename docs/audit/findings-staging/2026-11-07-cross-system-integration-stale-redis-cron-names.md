> **kind:** FINDING

## 2026-11-07 — `docs/audit/CROSS-SYSTEM-INTEGRATION.md` §5 named Redis keys and cron jobs that never existed in `main` — FIXED (docs)

| **Status** | FIXED on `fix/cross-system-integration-cron-redis-stale` (docs-only) |
| --- | --- |

**Symptom:** `docs/audit/CROSS-SYSTEM-INTEGRATION.md` §5 ("Shared Infrastructure") states, as
fact (not as an open ⚠️/⏳ question like most of the rest of the document), a specific set of
Redis cache keys and cron job names/intervals shared across the four trading systems. Checked
every one against current source and found most of them fabricated or wrong:

- **Redis keys** — claimed `nighthawk:board:snapshot:v1`, `swing:board:snapshot:v1`,
  `banger:board:snapshot:v1`, `zerodte:marks:*`. A repo-wide `grep -r` for each literal string
  returns **zero matches** for all four. The real keys are `zerodte:board:snapshot:v1`
  (`BOARD_SNAPSHOT_KEY`, `src/lib/platform/zerodte-service.ts`), `swing:serving:latest:v1`
  (`SWING_SERVING_CACHE_KEY`, `src/lib/swing/serving-lane.ts`), and
  `banger:watch:v1:<sessionDate>` (`CACHE_KEY`, `src/lib/banger/watch-cache.ts`). No key matching
  a `zerodte:marks:*` pattern exists anywhere in `src/`.
- **Cron jobs** — claimed `nighthawk-live-sync` (RTH, every 5 min) and `swing-live-sync` (RTH,
  every 10 min). Neither job exists in `src/lib/cron-registry.ts`. The real jobs are
  `zerodte-warm` ("0DTE Command Warm", ~every 5 min market hours) and `swing-active-refresh`
  ("Night Hawk Swing Refresh", every 15 min market hours, not 10). `banger-live-sync` is a real
  job name but its real interval is ~every 5 min (`schedule_cron_utc: "*/5 11-21 * * 1-5"`), not
  every 10 min as the doc claimed. `swing-discovery` and `banger-discovery` were both labeled
  "(RTH)"; both actually run **post-close** (`swing-discovery` is phase-anchored post-close-first,
  `banger-discovery` fires at 4:15 PM ET) — the opposite of "RTH".

This matters because this section is written as an inventory other lanes could reasonably use
when reasoning about cross-system load/concurrency (the doc's own §5 "Recommendation" asks for a
load test of exactly these jobs) — a reader taking the job names/keys at face value would
instrument or reason about infrastructure that does not exist, and miss the real jobs/keys
entirely.

**Root cause:** The document (dated 2026-08-23) was written as a speculative validation
*framework* — most of it is explicitly open ⚠️/⏳ questions and illustrative example payloads,
never claimed as verified. §5's "Shared keys" and "Daily cron schedule" bullets are the one place
specific identifiers were stated as plain fact rather than flagged as illustrative, and they were
apparently invented/guessed by pattern-matching plausible-looking names (`<system>:board:snapshot:v1`,
`<system>-live-sync`) rather than read from `src/lib/cron-registry.ts` or grepped from the cache
call sites. The document was never flagged stale because nothing else in this session's
methodology had read it until now (named by round 377 as the top unread candidate).

**Fix (docs-only):** Replaced both bullet lists with verified values, citing the exact
file/constant each one comes from, and explicitly noted which previously-cited names/keys do not
exist. Added a short dated note at the top of the document scoping the correction to §5 only —
the rest of the document (illustrative API schemas in §2, the open questions throughout) was
written as hypothetical from the start and is explicitly NOT re-verified or re-certified by this
fix, so a future reader doesn't mistake "§5 corrected" for "whole document verified."

**Blast radius:** `docs/audit/CROSS-SYSTEM-INTEGRATION.md` only — no source files changed, no
behavior changed.

**Evidence:**
```
$ grep -rn "nighthawk:board:snapshot:v1\|swing:board:snapshot:v1\|banger:board:snapshot:v1\|zerodte:marks:" src/
(no output — zero matches for any of the four)

$ grep -n "BOARD_SNAPSHOT_KEY" src/lib/platform/zerodte-service.ts
const BOARD_SNAPSHOT_KEY = "zerodte:board:snapshot:v1";

$ grep -n "SWING_SERVING_CACHE_KEY" src/lib/swing/serving-lane.ts
export const SWING_SERVING_CACHE_KEY = "swing:serving:latest:v1";

$ grep -n "CACHE_KEY" src/lib/banger/watch-cache.ts
const CACHE_KEY = (sessionDate: string) => `banger:watch:v1:${sessionDate}`;

$ grep -n "path:\|schedule_label\|schedule_cron_utc" src/lib/cron-registry.ts | grep -iA2 "zerodte-warm\|swing-discovery\|swing-active-refresh\|banger-discovery\|banger-live-sync"
# zerodte-warm: "~Every 5 min (market hours; ...)"
# swing-discovery: "Phase-anchored (post-close first; wide-band fire, route decides)"
# swing-active-refresh: "Every 15 min (market hours)"
# banger-discovery: "4:15 PM ET weekdays (post-close)", schedule_cron_utc "15 20,21 * * 1-5"
# banger-live-sync: "~Every 5 min (market hours)", schedule_cron_utc "*/5 11-21 * * 1-5"
# no "nighthawk-live-sync" or "swing-live-sync" path exists anywhere in the file
```
Docs-only change; no `npm test`/`tsc` impact expected, run as a sanity check before merge anyway.

Found via lead #1 in the round-378 prompt (`docs/audit/CROSS-SYSTEM-INTEGRATION.md`, named by
round 377 as the top unread candidate; proven-5x methodology of reading a cross-cutting
`docs/audit/*.md` doc in full and cross-checking present-tense claims against current source).
