## Night Hawk Legacy — bearish-posture `composite_regime` check is provably dead code — SHADOW-LOG ADDED, LIVE FIX DEFERRED (operator instruction)

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | `src/features/nighthawk/lib/bearish-posture.ts` (`detectBookPosture`) |
| **Status** | SHADOW-LOGGED, NOT FIXED |
| **Severity** | P3 — the gate still works today at a stricter-than-intended bar (2 of 2 live signals instead of 2 of 3); no incorrect picks, no data corruption, but the SHORT-posture re-rank engages less often than the original PR-N9 design intended |
| **Found via** | operator directive to unblock task #30 (previously held pending confirmation that the fix is genuinely low-risk — investigation showed it is not) |

### Root cause

`detectBookPosture` (`bearish-posture.ts:49-52`) checks:

```ts
const comp = regime.composite_regime?.toUpperCase();
if (comp && (comp.includes("BEARISH") || comp.includes("NEGATIVE"))) {
  signals.push(`composite regime bearish (${regime.composite_regime})`);
}
```

`composite_regime` is populated from `deriveComposite()`
(`src/app/api/cron/market-regime-detector/derive-composite.ts`), whose only 7 possible return
values are `MEAN_REVERT_TRENDING_UP`, `MEAN_REVERT_TRENDING_DOWN`, `AMPLIFY_BREAKOUT`,
`AMPLIFY_BREAKDOWN`, `AMPLIFY_MIXED`, `MEAN_REVERT_MIXED`, `NEUTRAL`. None of these — including
the two genuinely bearish ones — contain the substrings `"BEARISH"` or `"NEGATIVE"`. This branch
of the "any 2 of 3" gate (`BEARISH_POSTURE_MIN_SIGNALS = 2`, line 31) can therefore never fire on
real data; it is structurally, permanently dead. `composite_regime` itself IS correctly wired
through (`scorer.ts`'s `regimeContextFromMarket` → `edition-builder.ts:793`/`:990`), so this is a
one-line string-match bug, not a wiring gap.

### Why this was initially mis-scoped as "low-risk"

A plain string-match fix (`comp.includes("DOWN")`, matching both `MEAN_REVERT_TRENDING_DOWN` and
`AMPLIFY_BREAKDOWN`, since `"BREAKDOWN"` contains `"DOWN"`) restores this dead path — but doing so
changes LIVE ranking behavior on any future session where `composite_regime` reads a down-trend
value: it can newly complete the 2-of-3 gate and trigger `applyBearishPosture`'s SHORT-preference
re-rank (`bearish-posture.ts:65-98`, `SHORT_POSTURE_BONUS=8`/`LONG_POSTURE_PENALTY=6`), which
directly changes which candidates rank highest and can change which plays publish. This is a real
selection-behavior change, not a pure dead-code cleanup — which is why fixing it directly was not
authorized.

### Fix shipped this PR: shadow-log only

New file `src/features/nighthawk/lib/bearish-posture-shadow.ts` (pure, zero edits to
`bearish-posture.ts`):
- `detectBookPostureCorrected(regime)` — mirrors `detectBookPosture` with the one corrected line.
- `compareBearishPosture(ranked, regime)` — calls the REAL, unmodified `detectBookPosture`/
  `applyBearishPosture` for the "actual" side (so it can never diverge from real production
  output) and the corrected mirror for the "corrected" side; reports whether posture, the
  resulting Top-5, and boost/penalty counts would differ.
- `buildBearishPostureShadowSnapshotRow` — one sentinel row per edition build (`ticker:
  "__EDITION__"`), new free-text `stage: "bearish_posture_shadow"` on the existing, unmigrated
  `nighthawk_candidate_snapshot` table.

Wired into `edition-builder.ts` immediately after the existing `applyBearishPosture(ranked,
regime)` call (STAGE 4c), against the pre-adjustment `ranked` snapshot, fire-and-forget via the
same `insertNighthawkCandidateSnapshots(...).catch(...)` idiom every other capture call site in
this file already uses. `bearish-posture.ts` itself has an EMPTY diff in this PR and its existing
test suite passes completely unmodified — the load-bearing proof that live selection is
byte-identical before and after.

### Evidence

- `git diff` on `bearish-posture.ts`: empty.
- `bearish-posture.test.ts`: 8/8 pass, unmodified.
- New `bearish-posture-shadow.test.ts`: reproduces the real bug directly (`MEAN_REVERT_TRENDING_DOWN`
  + tide BEARISH → `actual.posture === "NEUTRAL"` today, `corrected.posture === "SHORT"` once
  fixed), asserts the "actual" side can never drift from a direct `detectBookPosture` call across
  multiple fixtures, and source-inspects `bearish-posture.ts` as a drift guard so this shadow
  module is flagged for review the moment the real fix (or the two re-rank constants) ever change.
- Full `src/features/nighthawk/**` suite: 1813/1813 pass, `tsc --noEmit` clean.

### What's still open

The real fix (`comp.includes("DOWN")`) remains deferred pending a fresh, explicit operator
go-ahead, informed by whatever the shadow log shows once it accumulates real editions where
`composite_regime` reads a down-trend value — i.e., whether the corrected gate would have
materially changed recent nights' Top 5, before flipping live behavior.
