> **kind:** FINDING

## `scanZeroDteBoard`'s primary FLOW-fetch catch block swallowed errors with no CloudWatch log line — FIXED

| | |
|---|---|
| **Status** | FIXED (PR TBD) |
| **File** | `src/lib/zerodte/scan.ts` (~L342-350) |
| **Severity** | P3 — observability gap, not a functional bug |

### What was wrong

`scanZeroDteBoard`'s primary `fetchRecentFlows(...)` call (the FLOW discovery origin's
input — feeds `deriveZeroDteSetups` directly) is wrapped in `.catch(() => { upstreamOk =
false; return []; })`. On a real failure this degrades the board to an empty FLOW origin
and flips `upstream_ok: false` on the board payload — a real, monitored health signal
(`healthcheck:0dte` and the live-monitor triggers read it) — but the catch block itself
never wrote anything to CloudWatch. A recurring failure here would be visible only as a
board-level flag, with zero trace of *why* it failed, unlike its sibling discovery-origin
catches in the same file: the BREAKOUT catch (~L515-524) and the PIN catch (~L565-568)
both set an equivalent health flag (`discoveryHealth.BREAKOUT`/`.PIN = "failed"`) **and**
log a `console.warn` with the caught error. The primary FLOW fetch — arguably the more
load-bearing of the three origins — was the one missing the log line.

### Why it wasn't caught earlier

The failure mode is silent by construction (best-effort degrade, by design — many other
`.catch(() => ...)` blocks in this same file are intentionally silent for genuinely
low-stakes reads, e.g. the multi-day-memory flow fetch at L353-358, `fetchLatestNighthawkEdition`
at L348). This one sits in that same silent-by-default company even though it feeds the
board's primary discovery input, so nothing flagged it as an outlier until a direct
line-by-line comparison against its logged siblings.

### Fix

Added one `console.warn` inside the existing catch, naming the failure and its effect
("board degrades to empty FLOW origin this cycle"), with the caught error attached — no
behavior change, `upstreamOk = false` and the `[]` fallback are untouched. Matches the
exact logging shape already used by the BREAKOUT/PIN catches a few hundred lines below.

### Evidence

- `npx tsc --noEmit` on the file: clean.
- `npx tsx --experimental-test-module-mocks --test src/lib/zerodte/scan.ts`: 42/42 pass
  (no new tests added — this is a pure logging addition with no branch/behavior change to
  assert against; existing tests already cover the `upstreamOk`/`[]` fallback behavior,
  which is unchanged).
- CloudWatch `/ecs/blackout-production` grepped for `TypeError|Unhandled|undefined` over
  the last 15 min (2026-09-19, Saturday, market closed): 0 matches — no active incident,
  this was a proactive consistency fix, not a response to an observed outage.

### Blast radius

None beyond this one catch block — no other call site reads `upstreamOk` besides the
existing `upstream_ok` board-payload field (grep-confirmed, 2 call sites total: the
assignment in the catch and the payload field itself).
