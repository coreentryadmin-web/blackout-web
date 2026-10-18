> **kind:** FINDING

## `fetchEcosystemContext`: a hung internal Vector read discarded `gex_positioning` (and every sibling field) — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (member-visible data loss on the swing play-brief, live-confirmed) |
| **Found by** | Ask Largo standing ownership mandate — live play-brief envelope deep-dive, 2026-10-18 |
| **Live repro** | NVDA position #62 (OPEN), `GET /api/market/swing/play-brief?playId=SWING:NVDA:62&ticker=NVDA&positionId=62&status=OPEN` |

### Root cause

`fetchEcosystemContext()` (`src/lib/bie/ecosystem-context.ts`) fetches eleven fields for a ticker
inside ONE shared `Promise.all([...])`, including both `getGexPositioning(upper)` (a fast
cache-reader, no live upstream fetch) and `fetchVectorFullState(upper, "all")` (a call that, on a
cold cache, fans out 8+ provider/DB reads and — per `vector-full-state-inflight.ts`'s own header,
written after an earlier related finding — "routinely takes 4-6s").

The caller, `play-brief-context.ts`, wraps the ENTIRE `fetchEcosystemContext(ticker)` call in a
single `withBriefSourceTimeout` (8,000ms budget). Because every field inside the internal
`Promise.all` shares that one outer deadline, a Vector read that happens to be cold and slow on a
given request can blow the full 8s budget — and when it does, the *whole* `Promise.all` rejects,
discarding every sibling field that had already resolved, `gex_positioning` among them, even though
`getGexPositioning` itself never failed and had almost certainly already returned.

Live confirmation: NVDA#62's play-brief envelope carried BOTH `"ecosystem context: fetch failed"`
AND `"Vector state: fetch failed"` in `unavailableSources`, while `GET
/api/market/gex-heatmap?ticker=NVDA`, read directly and independently at the same moment, returned
a full live matrix (spot 213.75) — the GEX data was never actually unavailable, only entangled with
a slower, unrelated sibling under one shared timeout. Sibling positions in the same session (CRWV,
TSLA) got the full dealer/GEX narrative; NVDA — same session, same cycle — got none, for a reason
that had nothing to do with GEX itself.

This is distinct from (and not fixed by) the existing `dedupeInFlight` mechanism in
`vector-full-state-inflight.ts`: that change stops the SAME Vector compute from being launched
twice (`play-brief-context.ts` calls `fetchVectorFullState` directly, AND `fetchEcosystemContext`
calls it again internally — both now await one shared in-flight promise). It does nothing to
decouple a genuinely cold/slow Vector compute from the unrelated fields riding in the same
Promise.all under one shared timeout — that coupling is what this fix addresses.

### Blast radius

Every field `fetchEcosystemContext` computes was equally at risk under the same failure mode —
`zerodte_today`, `nighthawk_recent`, `recent_audit_entries`, `recent_flow`, `flow_full_state`,
`recent_anomalies`, `spx_play`, `spx_full_state`, `spx_desk_convergence`, and the `arsenal` — not
just `gex_positioning`. This fix targets the one leg with documented, measured slowness (Vector,
4-6s against an 8s budget) and a real live repro; the DB-backed fields and `getGexPositioning`
itself are fast cache/Postgres reads with no comparable risk profile. Every consumer of
`fetchEcosystemContext` benefits (Largo's `get_ecosystem_context` tool, the swing play-brief, the
ticker-verdict engine, the ecosystem narrative), not just the swing brief that surfaced this.

### Fix

Wrapped the internal `fetchVectorFullState(upper, "all")` call (inside `fetchEcosystemContext`'s
own `Promise.all`) in a new, local, bounded sub-timeout (`withEcosystemVectorSubTimeout`,
6,000ms) — short enough to always resolve well inside the caller's 8s outer budget, long enough to
give a warm-cache Vector read a realistic window. On a timeout, the Vector sub-read degrades to
`null`, exactly matching `vector_full_state`'s own documented fail-open-to-null convention ("Null
when there's no live spot for the ticker") — the fix does not change what a timeout means for this
field, only where it happens, so a slow Vector read no longer takes its unrelated siblings down
with it.

Kept as a third small local copy of the same race-against-a-timer shape already duplicated twice in
this codebase (`withBriefSourceTimeout` in `swing/brief-source-timeout.ts`, `withSourceTimeout` in
`nighthawk/cortex/fetch.ts`) rather than importing either — both of those modules' own header
comments give the same reason (a trivial helper isn't worth pulling an unrelated module's import
graph in for), and the same logic applies here.

### Fix rationale — why this, not an alternative

- **Why not just raise the outer 8s budget?** Doesn't fix anything — a cold Vector compute can
  exceed any fixed budget; the real defect is that an unrelated fast field shares its fate with a
  slow one, not that the budget is too tight.
- **Why not move `getGexPositioning` out of the Promise.all entirely (run it first, sequentially)?**
  Would add real latency to the common case (most requests have both fields resolve fast) for no
  benefit — the Promise.all's whole point is running independent reads concurrently; the fix should
  only change behavior on the rare slow-Vector path, not the fast path.
- **Why 6,000ms and not some other number?** Leaves ~2s of margin inside the outer 8s budget for
  the rest of the Promise.all (consistently fast per this cycle's live checks) plus
  Promise.all/serialization overhead, while still giving a warm-but-not-instant Vector read (well
  under the documented 4-6s cold-cache figure) a real chance to land before giving up.
- **Left unchanged**: the `dedupeInFlight` de-dup mechanism (still correct, still saves real
  redundant-fetch cost); every other field in the Promise.all (no comparable measured risk); the
  outer 8s `BRIEF_SOURCE_TIMEOUT_MS` in `play-brief-context.ts` (untouched — still the right overall
  budget for the brief as a whole).

### Tests

`src/lib/bie/ecosystem-context.test.ts`:
- Three unit tests for `withEcosystemVectorSubTimeout`'s own mechanics (never-resolves rejects
  named, fast resolves, genuine rejection propagates unchanged) — mirrors
  `brief-source-timeout.test.ts`'s existing three-case shape for its sibling helper.
- A constant-relationship test: `ECOSYSTEM_VECTOR_SUB_TIMEOUT_MS < 8_000` (the outer budget), so
  the fix's whole premise (inner timeout fires before the outer one) stays enforced.
- An integration regression test at the REAL production constant (6s, not a parameterized
  stand-in): a Vector read that never resolves must degrade `vector_full_state` to `null` without
  losing `gex_positioning` (or failing `fetchEcosystemContext` as a whole).

RED→GREEN proven via `git stash` of `ecosystem-context.ts` alone (source only, tests kept): pre-fix,
the new tests fail with `withEcosystemVectorSubTimeout is not a function`, and the live-repro
integration test genuinely hangs (no internal rescue exists) rather than resolving — confirming the
bug reproduces exactly as described. Post-fix, all 44 tests in the file pass, including the
downstream `play-brief-context.test.ts` suite (14/14, unaffected). `tsc --noEmit`: clean.
