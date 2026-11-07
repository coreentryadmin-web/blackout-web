> **kind:** FINDING

## `docs/audit/X-CONTENT-CERTIFICATION.md` still claims the x-autopost DST defect is a live, unfixed P0 blocker — it was fixed three times over since the doc was written — FIXED (docs)

| | |
|---|---|
| **Status** | Fixed (docs-only) |
| **Severity** | P3 (stale audit doc — no source changed, no behavior changed) |
| **Files** | `docs/audit/X-CONTENT-CERTIFICATION.md` |

### Symptom

`docs/audit/X-CONTENT-CERTIFICATION.md`, written and "completed" 2026-08-23, carries an
Executive Summary headline of **"STATUS: BLOCKING ISSUE CONFIRMED — x-autopost DST defect"**, a
dedicated `### P0: DST DEFECT — x-autopost SILENT DARK NOV 1 – MAR 9` finding with
**`**Status:** UNFIXED`**, and more than a dozen other inline tags (`LIVE + **DST BROKEN**`,
`**BROKEN**` matrix rows, "DST hold respected", "ET-clock gate without DST shift (known, unfixed,
silent failure)") all asserting the same thing: that `isPostWindow()` (`src/lib/x-content-
schedule.ts`) checks a fixed ET hour set against a cron that fires on a fixed UTC schedule, so the
EDT→EST transition (Nov 1) would silence `x-autopost` for four months, and that this is still
true and still blocking.

It is not true today, 2026-11-07 — six days into the exact EST window this doc warned would be
silent.

### Root cause (of the staleness, not of a code bug — there is no live code bug here)

The doc was never revisited after it was written, and the underlying code has moved substantially
since:

- **PR #3829** ("Fix x-autopost DST silent-window failure"), merged 2026-09-04 — three weeks
  after this doc's "completed" date — added `isDST(nowEt)` to `src/lib/x-content-schedule.ts` and
  made `isPostWindow()`/`selectPostType()` branch on it, selecting the EDT hour set
  `{8,10,12,14,16,18,20}` or the EST hour set `{7,9,11,13,15,17,19}` depending on calendar date,
  instead of testing a single fixed set. This is precisely the "rewrite gate as single source of
  truth checking both market-open AND DST-aware wall-clock time" option the doc's own P0 finding
  listed as one of three candidate fixes.
- **PR #4500** ("gate X marketing posts on isTradingDayEt for NYSE holidays"), merged 2026-09-07,
  closed the doc's separately-tracked item 6 ("Market holiday deadband... NOT ENFORCED") — the
  weekday branch of `isPostWindow()` now calls `isTradingDayEt(todayEt(nowEt))` and returns
  `false` on a closed-market day, exactly the fix the doc's own matrix row asked for
  (`Add isTradingDayEt() call`).
- **PR #7224** ("weekend desk posts never fire during EST (Nov-Mar)"), merged 2026-11-01 (the
  very day this doc's "Impact" line named as the start of the blackout), independently found and
  fixed a related but distinct gap this doc never named: the weekend branch's own EDT-only
  `{10, 14}` hour array, which would have gone dark the same way the weekday gate almost did.

### Evidence

Read directly against `main`, not inferred from commit messages alone:

```ts
// src/lib/x-content-schedule.ts (current)
export function isPostWindow(nowEt: Date): boolean {
  const h = nowEt.getHours();
  const dow = nowEt.getDay();
  if (dow === 0 || dow === 6) {
    const weekendHours = isDST(nowEt) ? EDT_WEEKEND_POST_HOURS : EST_WEEKEND_POST_HOURS;
    return (weekendHours as readonly number[]).includes(h);
  }
  if (!isTradingDayEt(todayEt(nowEt))) return false;
  const postHours = isDST(nowEt)
    ? ([8, 10, 12, 14, 16, 18, 20] as const)
    : ([7, 9, 11, 13, 15, 17, 19] as const);
  return (postHours as readonly number[]).includes(h);
}
```

This is DST-aware on both the weekday and weekend branches, and holiday-gated on the weekday
branch — none of which the certification doc's current text reflects. `git log` confirms all
three fixing commits post-date the doc's 2026-08-23 write date (#3829: 2026-09-04, #4500:
2026-09-07, #7224: 2026-11-01), so this is a case of the doc simply never being revisited, not a
regression that reintroduced the bug after a real fix.

### Blast radius

Documentation only — a reader (human or a future agent) trusting this cert doc's headline status
without independently checking `main` would believe `@BlackOutTrade`'s live posting cron has been
silently dark since 2026-11-01, which could trigger a wasted re-investigation, a duplicate "fix",
or an incorrect escalation about a real outage that is not happening. No source file needed a
change — `src/lib/x-content-schedule.ts` was already correct.

### Fix (docs-only)

Added a prominent correction note under the Executive Summary and under the `### P0: DST DEFECT`
finding (with the PR numbers, dates, and the exact current source quoted), and updated every
other inline `DST BROKEN`/`UNFIXED`/`BROKEN` status tag and the two closing "DST hold" lines to
point at the same correction rather than silently rewriting the original 2026-08-23 prose — so a
reader sees both what was claimed at the time and what is verified true now, matching this
session's established pattern for fixing stale audit docs (see `docs/audit/DATA-API-
PROCUREMENT.md`'s `#7531` fix for the same shape of correction). The doc's genuinely still-open
work (the queue/review-gate build order, items 1-7, and the several other P0/P1 product-quality
gaps it lists) is untouched — this correction speaks only to the DST/holiday-gating status, which
is the one claim verifiably false against current `main`.
