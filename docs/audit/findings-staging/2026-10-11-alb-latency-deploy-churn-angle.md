> **kind:** FINDING

## ALB tail-latency investigation — new angle measured (ECS rolling-deploy churn correlation), two call sites ruled out — investigation-status update, no source change

| Field | Value |
| --- | --- |
| **Status** | Investigation-status update only — no code fix, no source change. The underlying recurring ALB `TargetResponseTime` Max tail-latency symptom (same standing P1 this file has tracked since at least 2026-09-02) is still open. |
| **Severity** | P1 (tracking the already-open P1, not introducing a new one) |
| **Component** | Investigation-tracking only: this entry + `docs/audit/MARKET-OPEN-VALIDATION.md`'s existing ALB-latency section. No `src/` change. |

### What this is / is not

Not a new defect and not a fix. This is a DISCOVERY-lane contribution to the already-open,
long-running ALB tail-latency investigation this file has tracked across many distinct root causes
(lock TTLs, UW RPS-stage reservation, GEX-heatmap-loop event-loop yielding, `vector/universe`
cache-miss rebuilds, `bie-full-state-snapshot` overlap, etc. — see the 2026-10-08 "REOPENED" entry
and its own linked chain). Tonight's measurement adds a genuinely new angle (ECS rolling-deploy
churn) not covered by any of those, plus two negative results (call sites ruled OUT as the direct
blocking cause) that save a future session the same re-derivation.

### New angle: ECS rolling-deploy churn correlates with the spike pattern

Measured live 2026-10-11, ~01:00-04:20 UTC, during this session's own merge wave (9 PRs merged in
under an hour, each triggering its own `ecr-push-production.yml` deploy). `AWS/ApplicationELB
TargetResponseTime` on `blackout-production-app` (1-min granularity) showed the familiar signature —
Max spiking to 41-44s every few minutes, p50/Average staying under ~0.8s (tail-latency, not fleet
capacity) — **1:1 time-correlated** with `blackout-production-web`'s own ECS service events, which
showed near-continuous one-task-at-a-time rolling replacement (register → drain → stop → start,
cycling every ~2-3 min) throughout the entire window, confirmed via `ecs.describe_services`'
`events` list.

Right after one spike (ALB bucket 03:35:00-03:36:00, Max=42.17s), CloudWatch Logs showed a burst of
17 `[polygon-gex] full-chain escalation ADOPTED` lines across 17 distinct tickers (WFC, JNJ, C, VST,
JPM, FAST, BAC, MS, BNY, MRSH, PLD, TFC, PNC, USB, SCHW, TRV, CB) within ~16 seconds — the same
market-wide multi-ticker discovery-fan-out signature `web-boot-warm.ts`'s 2026-10-08 fix (see that
file's own header comment, and `web-boot-warm.test.ts`) already root-caused for `getZeroDteBoardPayload()`'s
cold-rebuild path. That fix gated ONLY boot-warm's own call behind `isEtExtendedWarmHours()` —
`getZeroDteBoardPayload()` has **7 other callers** unaffected by that gate (`/api/market/zerodte/board`
route, `/api/market/nighthawk/horizons`, `nighthawk-seed-props.ts` SSR, `play-similarity.ts`,
`pre-earnings-pack.ts` — `grep -rn "getZeroDteBoardPayload" src/` for the full list), any of which
hitting off-hours still pays the "shared snapshot >10min stale → cold rebuild" cost the 2026-10-08
fix only closed one door on.

### Two call sites ruled OUT as the DIRECT 42s-blocking cause (new negative evidence)

Checked whether `getZeroDteBoardPayload()` itself could be the request the ALB measured at 42s —
**ruled out**: it's capped at `zerodteBoardMaxBlockMs()` = 3000ms default (`src/lib/providers/config.ts:62-67`)
via `Promise.race` against a timeout that resolves to a Redis snapshot / last-good-local-board /
minimal-empty-fallback — structurally cannot block a caller past ~3s. The GEX escalation burst
observed is almost certainly `runColdBoardBuild()`'s **background** work (kicked via
`kickColdBoardBuild()`/`refreshSharedBoardInBackground()`, single-flight via `sharedCacheSetNx`),
decoupled from whatever specific HTTP request the ALB actually measured — i.e. the escalation burst
and the 42s spike are both real and co-occur, but are not provably the same event.

Also checked `seedGexHeatmapFromRedis` (boot-warm's OTHER GEX-touching call) — ruled out: it is
Redis-GET-only with a 500ms race-to-null timeout (`polygon-options-gex.ts:1716-1731`), documented in
its own comment as explicitly NOT triggering a chain build ("Cold ECS replicas must not fire 11
concurrent matrix builds on `/api/ready`").

### What's still missing (unchanged from the 2026-09-02 standing blocker already on record)

No single blocking call site's own duration was found to match ~42s — no `elapsed=`/timeout/abort
log line anywhere near 42000ms in either spike window checked tonight. **ALB access logging remains
disabled** (`access_logs.s3.enabled: false`, confirmed again tonight) — this file's own 2026-10-08
entry already names enabling it as "the single highest-leverage next step... blocked on an AWS
permission boundary in this sandbox," which still holds; not re-attempted here.

### Next step for whoever picks this up

If ECS deploy-churn turns out to be a real, independent contributor (distinct from the cron-overlap
and per-endpoint-cold-rebuild mechanisms already tracked): the fix shape is likely the SAME pattern
2026-10-08 already used for boot-warm — gate the OTHER 7 `getZeroDteBoardPayload()` callers' cold-
rebuild fallback behind `isEtExtendedWarmHours()` too (or, more surgically, push the off-hours
short-circuit into `getZeroDteBoardPayload()`/`runColdBoardBuild()` itself so every caller benefits
at once, rather than gating 7 call sites individually). Not implemented here — this needs the
pinned per-request evidence (ALB access logs, once unblocked) to confirm which of several plausible
mechanisms (this one, the already-tracked cron overlaps, or something not yet found) is actually
dominant, per this file's own "measure before guessing" discipline.

### Blast radius

None — no source file changed. Posted in parallel to PR #4076 (comment, same content) for Cursor/
future-session visibility per the standing collaboration protocol.
