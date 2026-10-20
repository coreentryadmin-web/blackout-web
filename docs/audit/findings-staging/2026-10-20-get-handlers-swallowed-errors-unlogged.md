> **kind:** FINDING

## Five member-facing GET routes swallowed DB/query errors with zero logging — FIXED

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, DISCOVERY-lane error-handling/retry-logic sweep, via a background
Explore-agent audit of non-owned-lane API routes.

**Root cause:** a recurring pattern across five GET routes — a bare `catch { return
<fail-state> }` with no `console.error`, no telemetry, nothing — meant a real Postgres outage or
query error was indistinguishable from "legitimately no data yet" for both the client and ops.
Confirmed in:
- `src/app/api/coaching/alerts/route.ts` → `{ alerts: [] }` (200)
- `src/app/api/market/regime/route.ts` → `{ available: false }` (200)
- `src/app/api/market/anomalies/route.ts` → `{ anomalies: [] }` (200)
- `src/app/api/track-record/plays/route.ts` → `{ available: false }` (503)
- `src/app/api/brief/premarket/route.ts` → `{ available: false }` (200)

Each of these files' own **POST** handler a few lines below already does
`console.error("[route] POST failed:", err)` on the exact same kind of failure — the asymmetry
between a logged write path and a silent read path reads as an oversight, not a deliberate
fail-open decision (this codebase's genuinely-intentional fail-open catches elsewhere, e.g. Redis
reads in `market/largo/query/route.ts`, explain themselves in a comment; none of these five did).

**Live impact:** low-to-moderate — none of these are hard outages (every route still returns a
coherent fail-state to the client), but a genuine DB problem on any of these five paths would have
produced zero signal anywhere, making it effectively undiagnosable from logs/alerts until a member
noticed missing data and reported it.

**Fix:** changed each `catch {` to `catch (err)` and added the matching
`console.error("[route] GET failed:", err)` line, mirroring each file's own POST-handler
convention exactly. No behavior change for callers — same status codes, same response shapes.

**Blast radius:** five files, one line each. No other change.

**Test:** `src/app/api/get-handler-error-logging.test.ts` (new file) — asserts each route's GET
catch block binds the error and logs it, anchored on the first `} catch` in the file (the POST
handler's own, already-logging catch comes later) so the check targets the right block.
RED→GREEN proven via `git stash` on all five route files together (5/5 fail against the pre-fix
sources; 5/5 pass restored). Combined with the two routes' own existing test files
(`market/anomalies`, `market/regime`): 15/15 clean. Repo-wide `npx tsc --noEmit` clean.
