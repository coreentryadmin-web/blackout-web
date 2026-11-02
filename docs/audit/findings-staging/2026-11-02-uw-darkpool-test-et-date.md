> **kind:** FINDING

## 2026-11-02 — verify red: UW dark-pool tests used UTC date vs ET session filter — FIXED

| **Status** | FIXED on `fix/uw-darkpool-test-et-date` |
| --- | --- |

**Symptom:** `verify` on `main` @ `1c760ad` failed `normalizeDarkPoolWsPayload scopes to onlyTicker` (`undefined !== 2`) and `readUwDarkPoolFromRedis falls back...` after a docs-only merge (flake timing: run at 00:22 UTC).

**Root cause:** Tests built `executed_at` dates from `toISOString().slice(0,10)` (UTC calendar day) while production filters with `todayEt()` / `execAtEtYmd` (America/New_York). After midnight UTC but still prior ET session day, all prints were dropped.

**Fix:** Use `todayEt()` in both tests when stamping same-session timestamps.

**Verify:** `node --import tsx --test` on the two test files; full `verify` CI.
