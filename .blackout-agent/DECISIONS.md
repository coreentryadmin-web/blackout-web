# DECISIONS

## D-001 — Shared autopilot state (2026-09-03)

Claude and Cursor are peer engineers; `.blackout-agent/` is the controller.
Task leases prevent duplicate work. Peer review required before merge.

## D-003 — Autopilot hardening (2026-09-03)

Cursor audit found gaps in v1: no session-start, select-task, record-review,
watchdog, dispatch-guard, or scheduled fallback. Added in BO-P1-0006.
Claude heartbeat integration still pending (Claude must call session-start).
