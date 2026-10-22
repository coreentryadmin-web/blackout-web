# zerodte-warm critical_stale heal bypass — cooldown + overlap

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **Area** | cron / 0DTE scan heartbeat |
| **CI** | `query` on `main` @ `0301d5123` — `problems: zerodte-warm` |

## Symptom

Cron audit `query` failed during RTH with `zerodte-warm` in `problem_keys` while `error_spike: none`. Prior fixes (#5213 wedged-lock steal, reserved heavy slot, #6546 escalate past pool cap) were on `main` but afternoon RTH runs still flagged `zerodte_scan_heartbeat` critical_stale (>10m).

## Root cause

Recovery paths were still gated by the normal 60s rerun cooldown and unconditional overlap skip. The steal attempt clears locks only for one replica every 30s; other replicas (and steal losers) could still log `rate-limited` or `still in flight` while the scanner heartbeat remained critical. Accepted handshakes every 60s did not imply `recordZeroDteScanTick` advanced.

## Fix

When `scanHeartbeat.critical_stale` during cash RTH:

1. Skip the cooldown NX claim (delete any wedged cooldown key instead).
2. On overlap lock miss, delete and retry the overlap claim once (same intent as steal, per-request).

Heavy-slot escalate path unchanged.

## Verify

- `npx tsx --test src/app/api/cron/zerodte-warm/route.test.ts`
- After deploy: `npm run validate:cron` / Cron audit `query` green during RTH; admin cron-health `zerodte-warm` not `Scanner stale`.
