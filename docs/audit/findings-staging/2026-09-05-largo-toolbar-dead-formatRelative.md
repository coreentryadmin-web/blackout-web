# 2026-09-05 — Largo toolbar dead formatRelative helper removed

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | Largo Terminal history toolbar |
| **Status** | FIXED |

## Symptom

`LargoTerminalToolbar.tsx` still carried a local `formatRelative(ts)` that computed `Date.now() - ts` with no future-timestamp guard — a clock-skewed future `ts` would read as **"just now"**. The helper was dead code after the history list moved to `groupConversationsByDay` → `etClock` (ET wall-clock stamps).

## Root cause

Refactor to day-grouped ET clock times left the old relative-time helper in place unused.

## Fix

Remove the dead `formatRelative` function. Add regression test asserting no local relative helper remains and history still uses `groupConversationsByDay`.

## Evidence

- `toolbar-phone-layout.test.ts` structural regression guard.
- Pattern scan from hourly checklist §3 (class #2).

## RTH validation

- Open `/largo` → History popover — entries show ET clock times (e.g. `09:48`), not relative "2h ago".
