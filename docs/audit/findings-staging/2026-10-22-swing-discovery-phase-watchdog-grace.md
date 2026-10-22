# swing-discovery: phase retry grace for cron watchdog

> **kind:** FINDING

| **Status** | FIXED (pending merge) |

## What broke

`cron-audit-query` failed on `main` (2026-10-22 ~12:20 ET) with `problems: swing-discovery` while `error_spike: none`. The phase-anchored cron had a **failed** run for the active MIDDAY phase with `claim_released: true` (intentional retry semantics), but the watchdog treated that as a hard outage.

## Fix

`buildCronHealthSnapshot` now downgrades to `warning` (non-blocking) when:
- the current ET phase claim is `running` within max scan duration, or
- the last failure released its claim for the **same** active phase within ~50m (EventBridge retry window).

## Verify after deploy

- `Cron audit query` GREEN when a phase attempt fails once but a later retry succeeds same window.
- Admin cron health still escalates if a phase ends with no successful `ok` run.
