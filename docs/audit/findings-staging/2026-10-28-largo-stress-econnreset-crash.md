# 2026-10-28 — largo-stress nightly crash on ECONNRESET

> **kind:** FINDING

| Field | Detail |
| --- | --- |
| **Severity** | P2 CI / Largo stress harness |
| **Symptom** | `Largo stress nightly` run [40695702887](https://github.com/coreentryadmin-web/blackout-web/actions/runs/40695702887) exited 1 with uncaught `TypeError: fetch failed` / `read ECONNRESET` after a tail of http-429 transport skips — not a `live_bad` quality verdict. |
| **Root cause** | `askLive()` let `fetchRetry` throw after retries; worker promise rejected and aborted the bank before summary/artifact write. |
| **Fix** | Catch exhausted fetch errors in `askLive`, return `status: 0` so the existing non-200 → SKIP path runs; bump Largo query `fetchRetry` retries 1→3 for transient resets. |
| **Status** | FIXED on branch `cursor/bc-200a9b63-5185-4916-bd36-6f4def2b45b9-dd80`. |
