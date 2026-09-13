> **kind:** FINDING

## Night Hawk Legacy — recap-only diagnostic (`recapReasonAtPublishExit`) checks 0DTE's OWN scanner heartbeat, not anything Legacy's evening pipeline actually depends on — OPEN, holding

| | |
|---|---|
| **Status** | OPEN — reported per the standing escalation policy ("ambiguous/live-picks-logic → report, hold"), no code changed |
| **Severity** | P3 (misleading diagnostic text on an already-rare failure path; does not change alert firing/severity or any grading/pick logic) |
| **Lane** | Night Hawk Legacy |
| **Found** | 2026-09-13, aggressive improvement-hunting sweep per the standing v3 mandate |

### What was found

`edition-builder.ts`'s `buildEveningEdition` — on the rare path where the evening pipeline
produces zero final plays even after all rescue mechanisms (gate promotion, thin-edition
backfill) — calls `loadZeroDteScanHeartbeat()` and feeds it into `edition-funnel.ts`'s
`recapReasonAtPublishExit` to decide the member/ops-visible `recap_only_reason`:

```ts
const scanHeartbeat = await loadZeroDteScanHeartbeat().catch(() => null);
const reason = recapReasonAtPublishExit(blocked, funnel, scanHeartbeat);
```

`recapReasonAtPublishExit` prioritizes a stale/critical-stale heartbeat OVER the more specific
`publishGateBlockedRecapReason`/`synthesisEmptyRecapReason` wordings — i.e. if the heartbeat reads
stale, the reason ALWAYS becomes `"0DTE scan heartbeat is CRITICAL (last tick Ns ago) —
recap-only reflects a possibly-stalled upstream feed... Check the scan cron."`, even when the real,
already-computed, more useful reason (which gates blocked which tickers, or that synthesis itself
produced zero candidates) is sitting right there in `blocked`/`funnel`.

**The heartbeat being checked is not Legacy's own upstream feed.** Traced
`recordZeroDteScanTick` to exactly one call site: `zerodte/scan.ts`'s `warmZeroDteBoard` — the
0DTE Command desk's OWN always-on intraday scanner tick, unrelated to Legacy's evening dossier
pipeline (`buildEveningEdition -> fetchAllDossiers`, its own ~10+ UW REST calls per ticker,
confirmed via the cron route's own comment). The `edition-funnel.ts` comment introducing this
(`NH-R10`) frames "the upstream 0DTE scan cycle" as if it WERE Legacy's upstream feed — it is not;
it is a different desk's unrelated scanner.

### Why this isn't a clean, unilateral fix (why it's held, not shipped)

Initially looked like a guaranteed-every-night false positive (0DTE's RTH-only scanner going
stale right when Legacy's 5:30 PM ET evening build runs) — but tracing `zerodte-warm/route.ts`
found the actual warm window is **weekday 4:00 AM – 8:00 PM ET**, not RTH-only, so the 0DTE
heartbeat is typically still fresh (~2-min tick) through most of Legacy's normal evening build
window. The misfire is real but conditional: it only produces a wrong reason when (a) Legacy's
build/retries run past ~8:00 PM ET (the registry's own `stale_after_min: 240` from a 5:30 PM start
implies this is possible on a slow night), or (b) 0DTE's own scanner is independently down for a
reason unrelated to Legacy's data health, at which point the alert still fires (severity/firing is
NOT reason-text-gated — confirmed `alertRecapOnlyIfAnomalous` branches only on `candidates ?? 0
=== 0` and `flowFetchFailed`, never on the reason string) but the Discord body sent to ops names
the wrong system to investigate.

Deciding the right fix requires a design call this lane shouldn't make unilaterally: does Legacy
need its OWN upstream-freshness heartbeat (e.g. "did tonight's UW dossier fetch actually return
fresh data" — a real, separate signal that doesn't exist today), should the 0DTE cross-reference be
dropped entirely (falling back to the pre-existing gate/synthesis wording, which the code comment
itself says is the safe fallback on a heartbeat-read failure), or is the current cross-desk check
intentional on the theory that "if 0DTE's desk-wide scanner is down, something is probably wrong
platform-wide"? That's a genuine product/ops judgment call, not a mechanical correctness bug —
per the standing escalation policy, reporting and holding rather than picking a side.

### Evidence

- `recordZeroDteScanTick` call site: `src/lib/zerodte/scan.ts:2442`, inside `warmZeroDteBoard`.
- Warm window: `src/app/api/cron/zerodte-warm/route.ts:85` — `"Outside extended warm window
  (weekday 4:00 AM–8:00 PM ET) — use ?force=1"`.
- Legacy evening build schedule: `src/lib/cron-registry.ts` — `schedule_label: "5:30 PM ET
  weekdays"`, `stale_after_min: 240`, "fires every 15 min across the evening window."
- Stale/critical-stale thresholds: `src/lib/play-engine-heartbeat.ts`'s `createEngineHeartbeat` —
  5 min / 10 min respectively, cross-replica via `getMeta`/`setMeta`.
- `alertRecapOnlyIfAnomalous` (edition-builder.ts:118-134) confirmed NOT reason-text-gated — this
  bug affects diagnostic TEXT quality only, not whether/how loudly ops gets alerted.

### What would resolve this

Next time a real recap-only edition fires (rare — check `docs/audit/nighthawk-legacy-live-journal.json`
or CloudWatch for `[nighthawk/edition] publish gates zeroed, no plays to promote`), pull the actual
`reason` string logged and cross-check the real ET time and whether 0DTE's warm cron was genuinely
healthy at that moment. If the wrong-reason case is observed live (not just theoretically
possible), that's the evidence needed to justify one of the three options above — worth revisiting
with real data rather than deciding from code-reading alone.
