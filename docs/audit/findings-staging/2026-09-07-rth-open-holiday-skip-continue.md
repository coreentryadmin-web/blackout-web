# rth-open-check spurious socket retry after holiday skip — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED (pending merge) |
| **Priority** | P3 |
| **Area** | ops / validate:rth-open |
| **PR** | fix/rth-open-holiday-skip-continue |

## Symptom

After #4523 merged, `validate:rth-open` passed GREEN on Labor Day but still logged a spurious warning:

```
✓ options-socket: non-trading day (2026-09-07)
⚠ options-socket (attempt 1/3): HTTP 200 — retrying…
```

## Root cause

`isSocketHealthSkipped()` set `socketProbeOk = true` but the loop fell through to the `else` branch (no `websockets.options`), treating HTTP 200 as a retryable failure.

## Fix

`continue` after holiday skip; guard the HTTP-200 else branch with `else if (!socketProbeOk)`.

## Evidence

- Pre-fix: spurious retry line on 2026-09-07
- Post-fix: only `✓ options-socket: non-trading day (2026-09-07)`, no retry line
