## 2026-09-06 — [FINDING, Meridian desk, P3] OpEx `divergence_headline`'s QQQ "X/N" claim was scoped to the wrong cohort — FIXED

> **kind:** `FINDING`

### Symptom

Found during a DISCOVERY-lane sweep of the Meridian desk for the population/cohort/order-mismatch
bug class already fixed repeatedly elsewhere this session (SPX gate calibration, Vector/Helix
direction reads, horizon-outcomes grading lane, and — same PR wave — Thermal's
`GreeksDistributionPanel`). Most of Meridian came back clean: several existing doc comments in the
same desk (`meridian-sector-core.ts`, `meridian-earnings-history.ts`) document this exact class
having been found and fixed earlier today, and both were verified correctly wired end-to-end.

### Root cause

`divergenceHeadline()` (`src/lib/meridian/meridian-opex-cross-market-core.ts:120`, feeding the
member-facing `aggregates.divergence_headline` field via `buildMeridianOpexCrossMarket`) computed
a single shared denominator `n` — dates where Mag 7 avg AND SPX session data were both usable —
and used it for **both** the Mag-7-led claim and the QQQ-led claim:

```ts
const n = rows.filter((r) => r.mag7.avg_session_pct != null && r.spx_session_pct != null).length;
...
if (qqqLed >= Math.ceil(n * 0.67)) {
  return `QQQ moved more than SPX on ${qqqLed}/${n} prior OpEx sessions`;
}
```

But `qqqLed` (the numerator) was gated on `row.qqq_session_pct != null` — a condition `n` never
checked. A prior OpEx date where SPX and Mag 7 reactions loaded fine but QQQ's failed to load
(a real gap: `qqq_session_pct` comes from its own Polygon fetch, independent of the SPX/Mag7
fetches) is counted in `N` but can never count toward the QQQ numerator, understating the reported
percentage and quietly widening the sample to include a date the claim's own numerator excludes.
Concretely: 3 graded dates, QQQ data present on only 2, QQQ genuinely led on both of those (100%)
— the old code reported neither "QQQ moved more... 2/3" (mathematically wrong, since 2/3 dates had
QQQ data at all) nor the true 2/2, but silently fell through to a vaguer "Mixed index leadership
across 3 prior OpEx sessions" because `2 < ceil(3 * 0.67) = 3`.

### Fix

Give Mag 7 and QQQ their own denominators (`nMag7`, `nQqq`), each counting only dates where that
metric's own required fields are present, matching the population each numerator is actually drawn
from. The "mixed leadership" fallback now reports the true evaluated population (`rows.length`,
i.e. all SPX-graded dates) rather than the Mag-7-scoped count that was quietly standing in for it.

### Evidence

- RED→GREEN: `git stash push -- meridian-opex-cross-market-core.ts` (keeping the new test) → test
  fails (old code returns `"Mixed index leadership across 3 prior OpEx sessions"` instead of the
  correctly-scoped `"QQQ moved more than SPX on 2/2 prior OpEx sessions"`) → `git stash pop` →
  test passes.
- `npx tsc --noEmit`: clean.
- Targeted tests (`meridian-opex-cross-market-core`, `meridian-thermal-scope`): 13/13 pass.
- Full `npm test` (Node 20): see PR for final count.

### Blast radius

`src/lib/meridian/meridian-opex-cross-market-core.ts` and its test file only. Single call site
(`buildMeridianOpexCrossMarket`), no other consumer of `divergenceHeadline` (unexported).

### Also fixed in the same PR — 1 confirmed-dead export (Meridian desk, same sweep)

`src/lib/meridian/meridian-thermal-scope.ts` — `scopesAreMixed(scopes)`, exported, zero callers
outside its own definition and its own test file (verified via
`grep -rn "scopesAreMixed"`: only the definition + 2 test-assertion call sites, no production
caller anywhere). Removed the function and the 2 supporting assertions that called it (both were
one line inside larger tests whose primary subject is `thermalScopes()`, not `scopesAreMixed`
itself — the surrounding tests are otherwise untouched and still assert their original behavior).

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
