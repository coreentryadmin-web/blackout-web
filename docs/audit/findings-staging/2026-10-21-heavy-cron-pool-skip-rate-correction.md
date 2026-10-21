## 2026-10-21 — [FINDING, performance mandate, follow-up] heavy-cron-concurrency-guard shared-pool skip rate CAN be measured without AWS creds, but not off-hours — correction + partial live pull

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P3 — tooling/methodology correction, no product defect |
| **Status** | OPEN — overnight pull taken, genuinely inconclusive; needs an RTH re-run to actually answer the question |

**Context.** A standing-mandate sweep this session (background agent, "CloudWatch performance/
latency sweep") re-checked `src/lib/cron/heavy-cron-concurrency-guard.ts` after `swing-active-
refresh` got its own `RESERVED_SLOT_CRONS` entry on 2026-10-14 (fixing its starvation behind the
shared 2-slot pool — see that file's own header comment for the full incident). It correctly
identified a genuinely open question: now that the shared pool only has to seat 5 crons instead
of 6 (`vector-pick-sweep`, `vector-dark-pool-warm`, `vector-full-state-snapshot`,
`bie-full-state-snapshot`, `zerodte-warm`), nobody has re-measured whether `bie-full-state-
snapshot` — the shortest-runtime of the remaining five, in exactly the shape that got
`swing-active-refresh` starved — is now itself starved behind the other four. It reported this
as blocked on **AWS CloudWatch access**, unavailable in its sandbox run (`boto3
sts.get_caller_identity()` → `InvalidClientTokenId`).

**Correction.** That conflates two different things this repo's own CLAUDE.md environment notes
already distinguish (§"Access reality", item 3 vs item 1): CloudWatch Logs/metrics genuinely do
need AWS creds, but the live **skip-rate signal itself is already served over plain authenticated
HTTP** — `GET /api/admin/cron-health` (`requireAdminApi()` gate only, no AWS dependency at all —
see `src/app/api/admin/cron-health/route.ts`), which every existing audit script reaches via the
standard Clerk temp-admin-session pattern (`scripts/audit/lib/audit-auth-fetch.mjs`'s
`fetchAuditJson`). No AWS credentials were ever required to check this.

**What was actually pulled live (2026-10-21, ~03:25 UTC — overnight, cash RTH closed):**

| cron | last_message | runs_24h (ok/failed/skipped) | skip% |
|---|---|---|---|
| `zerodte-warm` | ok, dispatched | 193/0/188 | 49.3% |
| `swing-active-refresh` | skipped — outside RTH | 27/0/17 | 38.6% |
| `vector-full-state-snapshot` | skipped — Outside cash RTH | 32/0/100 | 75.8% |
| `vector-pick-sweep` | skipped — Outside cash RTH | 98/0/336 | 77.4% |
| `bie-full-state-snapshot` | skipped — Outside cash RTH | 10/0/122 | 92.4% |
| `vector-dark-pool-warm` | skipped — Outside cash RTH | 6/0/60 | 90.9% |

**Why this does NOT answer the question (and is not being presented as if it does).** Every one
of these jobs is `market_hours_only` — most of each 24h window is legitimately outside cash RTH,
and the aggregate `runs_24h.skipped` counter does not distinguish an off-hours self-skip (healthy,
by design) from a `heavy-cron concurrency slot unavailable (idempotent skip)` skip (the thing
actually in question — see the guard file's own `last_message` string for that exact phrase,
quoted in its 2026-10-14 header comment). `bie-full-state-snapshot`'s 92.4% looks alarming next to
`zerodte-warm`'s 49.3%, but `zerodte-warm` is not gated on cash RTH at all (it ran at `age_min:
201`, i.e. recently, overnight) while the other four are — so the comparison is apples-to-oranges
on its face, before even getting to the slot-contention question. This is the same overnight-vs-
RTH trap this file's own environment notes already document for `gex-force-rebuild-timing.mjs`
("overnight is a floor... the cap was NOT changed on this evidence") — recorded here rather than
repeated from scratch.

**What would actually answer it:** either (a) a per-run breakdown of `last_message` across the
24h window (not just the single latest run `admin-cron-health` currently surfaces per job — would
need a DB query or a route change to expose `COUNT(*) WHERE message LIKE '%concurrency slot
unavailable%'` per cron), or (b) a live RTH-window poll of `/api/admin/cron-health` at a few-minute
cadence during tomorrow's cash session, diffing `bie-full-state-snapshot`'s own skip reasons
against the shared pool's occupancy. Neither was built this cycle — this entry exists so the next
RTH-hours session doesn't restart from "we need AWS creds" (we don't) or re-derive the off-hours
trap from scratch.

**No code changed, no gate touched.** This is a methodology correction + a live, honestly-labeled
partial pull, not a fix.
