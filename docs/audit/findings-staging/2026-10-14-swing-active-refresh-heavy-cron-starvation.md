## 2026-10-14 — [Night Hawk Swings / Ask Largo] `swing-active-refresh` chronically starved by the shared heavy-cron concurrency guard — sign-inverted, ~19.5h-stale P&L shown live on Ask Largo swing play-briefs — FIXED

> **kind:** `FINDING`

### Root cause

`heavy-cron-concurrency-guard.ts` (added 2026-10-13, PR fixing a measured ALB-tail-latency
incident) caps six registered "heavy" crons to a shared pool of `MAX_CONCURRENT_HEAVY_CRONS = 2`
Redis-backed slots, cluster-wide. `swing-active-refresh` — the ONLY cron that marks live open
swing positions (every 15 minutes, RTH) — was one of the six crons wired into that shared pool,
competing for the same 2 slots as five other crons, several of which can legitimately hold a slot
for minutes at a time (`vector-pick-sweep` measured up to ~900s elapsed this same day).

Live evidence (5-engine monitor cycle, 2026-10-14):
- `GET /api/market/swing/play-brief?playId=SWING:INTC:56` showed `Mark: $5.45 (2026-10-13 16:00
  ET) / P&L: +15.3%`. The SAME instant's live marks feed (`GET /api/market/zerodte/marks`) for
  the identical OCC reported `mark=3.85, mark_as_of=2026-10-14T15:07:59Z, live_pnl_pct=-20.63` —
  opposite sign, ~36pp off. GOOG/GOOGL (the desk's only other 2 native swing positions) showed the
  identical pattern (+6.6%/+8.7% in the brief vs -0.27%/-0.24% live).
- CloudWatch: last `[cron/swing-active-refresh] background done` log line was 2026-10-13 20:01:03
  UTC — nothing since, despite 16 scheduled fires 11:15-15:00 UTC the next day all Lambda-logged
  as `-> 200`.
- `GET /api/admin/cron-health`: `swing-active-refresh` `last_status: "skipped"`,
  `last_message: "heavy-cron concurrency slot unavailable (idempotent skip)"`,
  `runs_24h: {ok: 20, skipped: 24}` — a 54.5% skip rate.
- Own measured elapsed= runtime across 18 real runs the prior day: 4,093ms-65,819ms — never once
  close to the other five crons' measured durations (78,415ms-476,169ms).

A secondary gap: cron-health's staleness watchdog only checks "was this cron invoked recently"
(yes, every 15 min), not "did the refresh actually complete" — so 19.5h of silent staleness never
surfaced as an alert.

### Fix rationale

Gave `swing-active-refresh` its own dedicated Redis slot (`heavy-cron-concurrency-guard.ts`,
`RESERVED_SLOT_CRONS`), independent of the shared 2-slot pool, instead of removing it from the
guard entirely or raising `MAX_CONCURRENT_HEAVY_CRONS` for everyone:
- Its own measured runtime (max ~66s) is an order of magnitude below the other five crons' —
  it was never a meaningful contributor to the ALB-tail-latency problem the guard exists for.
- A dedicated slot bounds total concurrent heavy work to AT MOST 3 (2 shared + 1 reserved), not
  the original uncapped 6 — still a real, bounded mitigation of the ALB-latency incident.
- It keeps the cron's own pre-existing self-overlap semantics (the atomic `SET NX` primitive
  still serializes it against itself) — this only changes who it waits on, not how many
  concurrent `swing-active-refresh` runs can exist.
- `swing-active-refresh/route.ts`'s call site (`acquireHeavyCronSlot("swing-active-refresh",
  ...)`) is unchanged — the fix is entirely internal to the guard module.

### Blast radius

Only `swing-active-refresh`'s own scheduling behavior changes (it no longer waits on the shared
pool). The other five crons' contention for the shared 2 slots is completely unaffected — same
cap, same keys, same behavior. No change to the ALB-tail-latency mitigation for those five.

### Alternative approaches not taken

1. **Remove `swing-active-refresh` from the guard entirely** (rely solely on its own self-overlap
   claim) — would reintroduce it as a 6th cron able to run concurrently with 2 shared-pool crons
   AND itself overlapping... no, its own lock still prevents self-overlap, but this was rejected
   in favor of the dedicated-slot approach anyway since it's functionally near-identical but less
   explicit about the intentional cap on total concurrent heavy work.
2. **Raise `MAX_CONCURRENT_HEAVY_CRONS` to 3 for everyone** — would also let two of the SLOW
   crons (e.g. two `vector-pick-sweep`-class jobs) run concurrently, reintroducing exactly the
   contention shape the guard was built to prevent. The dedicated-slot approach only grows
   capacity for the one cron proven to need it.
3. **Fix only the staleness watchdog** (key off actual completion, not invocation) — would make
   the problem visible but not fix the underlying stale P&L members were seeing live. Both are
   worth doing; this fix addresses the root cause, the watchdog gap remains a smaller, separate
   observability follow-up.

| **Status** | Fixed |
|---|---|
| **PR** | (opening) |
| **Test coverage** | 4 new regression tests in `heavy-cron-concurrency-guard.test.ts` proving: a reserved cron is never starved by an exhausted shared pool, a reserved cron never consumes a shared-pool slot, a reserved cron still cannot overlap with itself, and release correctly frees its dedicated key |
| **Production effect** | Root-caused via CloudWatch + EventBridge + `GET /api/admin/cron-health`, live Ask Largo play-brief P&L sign-inversion confirmed on 3 real positions (INTC/GOOG/GOOGL) |

---
_Generated by [Claude Code](https://claude.com/claude-code)_
