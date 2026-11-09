> **kind:** FINDING

## Full-site RTH audit false P0 off-hours (SPX spot 0 + post-close cron noise) — FIXED

| **Status** | Fixed in PR (off-hours gate) |
| --- | --- |

**Symptom:** Scheduled `audit` job on `main` (commit `ebb16827`, docs-only merge) failed at ~6:12 PM ET Monday: P0 `spx-desk` spot `0`, P1 snapshot missing SPX, and `cron-watchdog: swing-discovery`.

**Root cause:** `scripts/full-site-deep-audit.mjs` and `scripts/gha-rth-audit.mjs` treated honest off-hours desk payloads (`price: 0`) and generic `problem_keys` (post-close market-hours-only crons idle) like RTH production defects. Deploy smoke already allowed this pattern; full-site audit did not.

**Fix:** `inRthOpenWindow()` for desk/snapshot spot checks; shared `watchdogProblemKeysForAudit()` uses `rth_stale_keys` only outside RTH.

**Verify:** Unit tests in `watchdog-audit-keys.test.mjs` + source guards in `full-site-deep-audit.test.mjs`.
