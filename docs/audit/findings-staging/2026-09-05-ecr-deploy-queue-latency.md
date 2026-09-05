## ECR deploy pipeline: merges queue serially behind `cancel-in-progress: false`, ~50min+ effective latency under a merge burst

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | OPEN — measured and confirmed, no fix applied this pass; documented here so it doesn't get lost, per the standing "absence is a finding" discipline |
| **Severity** | P2 (deploy latency, not correctness — production runs on the last-deployed commit until its queued turn, never a wrong/broken build) |

### What was measured

`ecr-push-production.yml` uses `concurrency: {group: ecr-push-production, cancel-in-progress: false}` — a deliberate design (see the workflow's own header comment, added after a prior incident where cancelling in-flight deploys left partial/unverified rollouts in production). This queues deploys strictly and lets each one finish fully, but during a burst of rapid merges every queued run waits its full turn.

Live evidence (this session's Phase 5 cross-exam, CLQ-045 in `.blackout-agent/CURSOR_ANSWERS_FOR_CLAUDE.md`): run `33961122872` succeeded with ~61min wall clock (10:36Z→11:37Z, including prior queued work); run `33963899225` was cancelled outright when a newer commit's deploy superseded it in the queue. **50+ minutes of effective latency under a merge burst is real**, confirmed by direct GitHub Actions run timing, not inferred.

### Why this is a distinct problem from the already-tracked deploy-speed finding

`docs/audit/FINDINGS.md`'s "`blackout-production-web` deploy speed: `maximumPercent` 120→200 change had NO measured effect" entry is about how fast a SINGLE deploy's ECS rollout completes once it starts running (task replacement cadence). This finding is upstream of that — how long a deploy waits *before* it starts running at all, when several commits merge close together. Both bottlenecks are real and independent; fixing one does not fix the other.

### Why not fixed here

The `cancel-in-progress: false` serialization is itself a considered, documented tradeoff (see the workflow's own header) — flipping it back to cancel-in-progress would reopen the exact partial-rollout risk it was added to prevent. A real fix here (e.g. batching/coalescing queued deploys so a burst of N merges triggers one deploy of the latest commit instead of N serial ones, or speeding up the per-deploy pipeline itself) is an infrastructure/workflow design change with its own tradeoffs, not a one-line code fix — appropriately left for an explicit decision rather than applied unilaterally.

### Recommended next step

Measure whether coalescing consecutive queued runs (skip an already-superseded commit's deploy rather than running and then cancelling it, or debounce the trigger by a short window) would recover most of the latency without reintroducing the cancel-in-progress risk — that is additive to the existing safety property (a superseded queued run that never started incurs no partial-rollout risk at all), unlike reverting `cancel-in-progress`.
