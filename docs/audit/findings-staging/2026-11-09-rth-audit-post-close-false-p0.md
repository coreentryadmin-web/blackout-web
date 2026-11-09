## 2026-11-09 — RTH deep audit RED post-close on desk spot 0 + swing-discovery — FIXED

> **kind:** `FINDING`

| Field | Detail |
| --- | --- |
| **Symptom** | `RTH deep audit` on `main` @ `ebb16827` failed off-hours (~6:12 PM ET): P0 `spx-desk spot 0`, `cron-watchdog: swing-discovery`. |
| **Root cause** | Workflow schedules a **4:30 PM ET** pass outside `inRthOpenWindow()` (ends 16:15 ET). Full-site audit still P0'd missing spot; cron watchdog failed any `problem_keys` even when `rth_stale_keys` was empty. |
| **Fix** | `full-site-deep-audit.mjs`: P0 spot only in RTH window unless `available:false` (honest empty). `gha-rth-audit.mjs`: off-hours cron-watchdog fails only on `rth_stale_keys`. |
| **Status** | Fixed + source regression tests. |
