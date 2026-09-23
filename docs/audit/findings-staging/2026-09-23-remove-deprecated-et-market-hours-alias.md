> **kind:** FINDING

## Dead-code cleanup: removed the deprecated `isEtMarketHours` alias — FIXED

| | |
|---|---|
| **Area** | Shared infra (`src/lib/et-market-hours.ts`) |
| **Severity** | P4 (dead-code/stale-reference hygiene — zero behavior change, not a bug) |
| **Status** | FIXED |
| **File** | `src/lib/et-market-hours.ts`, `src/hooks/use-et-market-open.ts`, `src/lib/et-market-hours.test.ts` |

### Root cause

`isEtMarketHours` was a `@deprecated` alias ("prefer isEtCashRth for early-close
correctness") that was already a pure passthrough — `return isEtCashRth(now);` —
so the two functions have been behaviorally identical since the deprecation was
added. It still had exactly one production caller left
(`src/hooks/use-et-market-open.ts`'s `useEtMarketOpen`, which drives polling-interval
selection for multiple desk hooks) plus its own two dedicated regression tests, so it
hadn't actually gone dead — just stale.

### Fix

- `useEtMarketOpen` now calls `isEtCashRth` directly (zero behavior change — confirmed
  by reading the alias's own implementation before touching anything).
- The alias's two regression tests (weekend rejection, NYSE full-day-holiday rejection)
  were repointed to exercise `isEtCashRth` directly instead of forwarding through the
  now-removed wrapper — same assertions, same coverage, just naming the canonical
  function.
- Removed the now-fully-unused `isEtMarketHours` export.

Verified no remaining references repo-wide (`grep -rn isEtMarketHours src` → 0 hits),
`tsc --noEmit` clean, and both `src/lib/et-market-hours.test.ts` (7/7) and
`src/hooks/use-et-market-open.test.ts` (1/1) green on Node 20.

### Blast radius

Two call sites migrated (one production, one test file), one dead export removed.
No behavior change anywhere — `isEtMarketHours` was already a literal passthrough to
`isEtCashRth`.
